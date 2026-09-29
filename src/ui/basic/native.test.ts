import { afterEach, beforeEach, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Terminal } from "@earendil-works/pi-tui";
import type { Approve } from "../../engines/types.ts";
import { runNativeUI } from "./native.ts";
import { CodexSession } from "../../engines/codex/session.ts";
import { FixtureRpc } from "../../../tests/support/rpc-fixture.ts";
import { getCatalog } from "../../i18n/index.ts";

// Shell persists /model and /effort picks to $FORGE614_HOME/shell/preferences.json (see
// shell-preferences.ts). Without isolating this, a test run would read and write the real
// developer's ~/.forge614 preferences file — cross-contaminating tests and their machine.
let forgeHome: string; let previousForgeHome: string | undefined;
beforeEach(() => {
  previousForgeHome = process.env.FORGE614_HOME;
  forgeHome = mkdtempSync(join(tmpdir(), "forge614-shell-native-test-"));
  process.env.FORGE614_HOME = forgeHome;
});
afterEach(() => {
  if (previousForgeHome === undefined) delete process.env.FORGE614_HOME; else process.env.FORGE614_HOME = previousForgeHome;
  rmSync(forgeHome, { recursive: true, force: true });
});

class TestTerminal implements Terminal {
  columns = 100; rows = 40; kittyProtocolActive = false;
  input: (data: string) => void = () => {}; output = ""; stopped = false;
  start(input: (data: string) => void) { this.input = input; this.stopped = false; }
  stop() { this.stopped = true; }
  async drainInput() {}
  write(data: string) { this.output += data; }
  moveBy() {} hideCursor() {} showCursor() {} clearLine() {} clearFromCursor() {} clearScreen() {} setTitle() {} setProgress() {}
}
const tick = () => new Promise(resolve => setTimeout(resolve, 25));

test("model picker applies arrow selection, cancels unchanged and never sends a chat turn", async () => {
  const terminal = new TestTerminal(); const rpc = new FixtureRpc();
  rpc.replies.set("initialize", {});
  rpc.replies.set("account/read", { account: { type: "chatgpt", planType: "plus" }, requiresOpenaiAuth: true });
  rpc.replies.set("model/list", { data: [
    { id: "alpha", model: "alpha", displayName: "Alpha", supportedReasoningEfforts: [] },
    { id: "beta", model: "beta", displayName: "Beta", supportedReasoningEfforts: [] },
  ], nextCursor: null });
  let session!: CodexSession;
  const ui = runNativeUI("codex", "/project", (emit, approve) => session = new CodexSession(rpc, "/project", emit, approve), terminal);
  const enter = (value: string) => { terminal.input(value); terminal.input("\r"); };
  try {
    await tick(); enter("/model"); await tick();
    expect(terminal.output).toContain("Select model");
    terminal.input("\x1b[B"); terminal.input("\r"); await tick();
    expect(session.visual().model).toBe("beta");
    enter("/model"); await tick(); terminal.input("\x1b[A"); terminal.input("\x1b"); await tick();
    expect(session.visual().model).toBe("beta");
    expect(rpc.calls.some(call => call.method === "turn/start")).toBe(false);
  } finally { enter("/quit!"); await ui; }
});

test("Shift+Tab cycles only a native work mode reported by Codex", async () => {
  const terminal = new TestTerminal(); const rpc = new FixtureRpc();
  rpc.replies.set("initialize", {});
  rpc.replies.set("account/read", { account: { type: "chatgpt" }, requiresOpenaiAuth: true });
  rpc.replies.set("configRequirements/read", { requirements: { allowedApprovalPolicies: ["onRequest"], allowedSandboxModes: ["readOnly"] } });
  rpc.replies.set("model/list", { data: [], nextCursor: null });
  const ui = runNativeUI("codex", "/project", (emit, approve) => new CodexSession(rpc, "/project", emit, approve), terminal);
  try {
    await tick(); terminal.input("\x1b[Z"); await tick();
    expect(stripVTControlCharacters(terminal.output)).toContain("manual mode on · read only");
  } finally { terminal.input("/quit!"); terminal.input("\r"); await ui; }
});

test("local logout waits for consent and never calls native account logout", async () => {
  const terminal = new TestTerminal(); const rpc = new FixtureRpc();
  rpc.replies.set("initialize", {});
  rpc.replies.set("account/read", { account: null, requiresOpenaiAuth: true });
  rpc.replies.set("model/list", { data: [], nextCursor: null });
  rpc.replies.set("account/logout", {});
  const ui = runNativeUI("codex", "/project", (emit, approve) => new CodexSession(rpc, "/project", emit, approve), terminal);
  const enter = (text: string) => { terminal.input(text); terminal.input("\r"); };
  try {
    await tick(); enter("/logout"); await tick();
    expect(terminal.output).toContain("SESSION");
    expect(terminal.output).toContain("F614");
    expect(terminal.output).toContain("╭─");
    expect(terminal.output).toContain("Connect with /login");
    expect(terminal.output).not.toContain("Ask anything, or / for commands…");
    expect(terminal.output).toContain("only in this Forge614-Shell session");
    expect(rpc.calls.some(c => c.method === "account/logout")).toBe(false);
    enter("/stop"); await tick();
    expect(rpc.calls.some(c => c.method === "account/logout")).toBe(false);
    enter("/logout"); await tick(); enter("/yes"); await tick();
    expect(rpc.calls.filter(c => c.method === "account/logout")).toHaveLength(0);
    expect(terminal.output).toContain("Disconnected locally");
  } finally { enter("/quit!"); await ui; }
});

test("native UI reports backgroundActivitySupported as true and shows idle text when the session implements backgroundActivity()", async () => {
  const terminal = new TestTerminal();
  const session = {
    busy: false, models: [],
    async initialize() {}, async login() {}, async cancel() {}, reset() {}, async resume(_id: string) {},
    async listSessions() { return []; }, async setModel(_id: string) {}, async setEffort(_effort: string) {},
    status() { return ["native status"]; },
    async send(_text: string) {},
    close() {},
    backgroundActivity() { return []; },
  };
  const ui = runNativeUI("codex", "/project", (_emit, _approve) => session, terminal);
  try {
    await tick();
    // Feature-detected purely from the presence of `backgroundActivity()` on the session object —
    // never from the engine id ("codex" here is incidental to this fake, not what drives the check).
    // The sidebar rail is narrower than the full idle sentence, so it truncates mid-word with "…" —
    // assert a safe leading fragment (still sourced from the real catalog string) instead.
    expect(terminal.output).toContain(getCatalog("en").backgroundActivity.idle.slice(0, 16));
  } finally { terminal.input("/quit!"); terminal.input("\r"); await ui; }
});

test("native UI reports backgroundActivitySupported as false when the session has no backgroundActivity()", async () => {
  const terminal = new TestTerminal();
  const session = {
    busy: false, models: [],
    async initialize() {}, async login() {}, async cancel() {}, reset() {}, async resume(_id: string) {},
    async listSessions() { return []; }, async setModel(_id: string) {}, async setEffort(_effort: string) {},
    status() { return ["native status"]; },
    async send(_text: string) {},
    close() {},
  };
  const ui = runNativeUI("codex", "/project", (_emit, _approve) => session, terminal);
  try {
    await tick();
    // Same truncation caveat as the idle-text test above — assert a safe leading fragment.
    expect(terminal.output).toContain(getCatalog("en").backgroundActivity.notReportedByEngine.slice(0, 20));
  } finally { terminal.input("/quit!"); terminal.input("\r"); await ui; }
});

test("native chat waits for input and warns instead of quitting an active turn", async () => {
  const terminal = new TestTerminal(); let approve!: Approve; let received = ""; let closed = false;
  let finishTurn!: () => void;
  const session = {
    busy: false, models: [],
    async initialize() {}, async login() {}, async cancel() {}, reset() {}, async resume(_id: string) {},
    async listSessions() { return []; }, async setModel(_id: string) {}, async setEffort(_effort: string) {},
    status() { return ["native status"]; },
    async send(text: string) { received = text; session.busy = true; await new Promise<void>(resolve => { finishTurn = resolve; }); session.busy = false; },
    close() { closed = true; finishTurn?.(); },
  };
  const ui = runNativeUI("codex", "/project", (_emit, callback) => { approve = callback; return session; }, terminal);
  await tick(); expect(received).toBe("");
  terminal.input("hello"); terminal.input("\r"); await tick(); expect(received).toBe("hello");
  const permission = approve("Write a file", new AbortController().signal);
  terminal.input("/no"); terminal.input("\r"); expect(await permission).toBe(false);
  terminal.input("/quit"); terminal.input("\r"); await tick();
  expect(closed).toBe(false); expect(terminal.output).toContain("Nothing was stopped");
  terminal.input("/quit!"); terminal.input("\r"); await ui;
  expect(closed).toBe(true); expect(terminal.stopped).toBe(true);
});

/** Mejora 14 en Codex: mientras un comando corre, el indicador dice «Working · <comando> · <tiempo legible>»; cuando no hay ninguno, solo «Working · <tiempo>». Se lee de `currentActivity()` de la sesión, sin mirar el id del motor. */
test("the working indicator names the running command for a native session, and only the time when there is none", async () => {
  const terminal = new TestTerminal(); let finishTurn!: () => void; let activity: string | undefined = "gh pr checks 3 --watch";
  const session = {
    busy: false, models: [],
    async initialize() {}, async login() {}, async cancel() {}, reset() {}, async resume(_id: string) {},
    async listSessions() { return []; }, async setModel(_id: string) {}, async setEffort(_effort: string) {},
    status() { return ["native status"]; },
    async send(_text: string) { session.busy = true; await new Promise<void>(resolve => { finishTurn = resolve; }); session.busy = false; },
    close() { finishTurn?.(); },
    currentActivity() { return activity; },
  };
  const ui = runNativeUI("codex", "/project", (_emit, _approve) => session, terminal);
  try {
    await tick(); terminal.input("go"); terminal.input("\r"); await tick();
    await new Promise(resolve => setTimeout(resolve, 600));
    const withCommand = stripVTControlCharacters(terminal.output);
    expect(withCommand).toContain("Working · gh pr checks 3 --watch · 0s");
    expect(withCommand).not.toMatch(/Working · \d+s/);
    terminal.output = ""; activity = undefined;
    await new Promise(resolve => setTimeout(resolve, 600));
    expect(stripVTControlCharacters(terminal.output)).toMatch(/Working · \d+s/);
  } finally { terminal.input("/quit!"); terminal.input("\r"); await ui; }
});

/** Doble de sesión con tres conversaciones del mismo título (como «Color favorito» ×3), entregadas de la más vieja a la más nueva a propósito, para comprobar que el selector las reordena y que se distinguen. Sin cuenta ni disco reales. */
function sessionWithThreeSameTitle(resumed: string[]) {
  return {
    busy: false, models: [],
    async initialize() {}, async login() {}, async cancel() {}, reset() {}, async resume(id: string) { resumed.push(id); },
    async listSessions() {
      return [
        { id: "thread-old", title: "Favorite color", firstMessage: "alpha-message", folder: "/project", updatedAt: Date.UTC(2026, 8, 20, 10) },
        { id: "thread-new", title: "Favorite color", firstMessage: "gamma-message", folder: "/project", updatedAt: Date.UTC(2026, 8, 28, 10) },
        { id: "thread-mid", title: "Favorite color", firstMessage: "beta-message", folder: "/project", updatedAt: Date.UTC(2026, 8, 25, 10) },
      ];
    },
    async setModel(_id: string) {}, async setEffort(_effort: string) {},
    status() { return ["native status"]; },
    async send(_text: string) {},
    close() {},
  };
}

/** Mejora 8: `/resume` abre un selector (no imprime una lista): la más reciente arriba, cada fila con su primer mensaje para distinguir las repetidas, y Enter retoma la resaltada. */
test("/resume opens a selector with the newest first and Enter resumes the highlighted conversation", async () => {
  const terminal = new TestTerminal(); const resumed: string[] = [];
  const ui = runNativeUI("codex", "/project", () => sessionWithThreeSameTitle(resumed), terminal);
  const enter = (value: string) => { terminal.input(value); terminal.input("\r"); };
  try {
    await tick(); enter("/resume"); await tick();
    const shown = stripVTControlCharacters(terminal.output);
    for (const message of ["alpha-message", "beta-message", "gamma-message"]) expect(shown).toContain(message);
    expect(shown.indexOf("gamma-message")).toBeLessThan(shown.indexOf("beta-message"));
    expect(shown.indexOf("beta-message")).toBeLessThan(shown.indexOf("alpha-message"));
    expect(resumed).toEqual([]);
    terminal.input("\r"); await tick();
    expect(resumed).toEqual(["thread-new"]);
  } finally { enter("/quit!"); await ui; }
});

/** Mejora 8: escribir filtra (sin mayúsculas ni acentos, también por primer mensaje) y Esc cancela sin retomar nada ni cambiar la conversación. */
test("/resume filters by what is typed and Esc cancels without resuming anything", async () => {
  const terminal = new TestTerminal(); const resumed: string[] = [];
  const ui = runNativeUI("codex", "/project", () => sessionWithThreeSameTitle(resumed), terminal);
  const enter = (value: string) => { terminal.input(value); terminal.input("\r"); };
  try {
    await tick(); enter("/resume"); await tick();
    for (const char of "BETA-MESS") terminal.input(char);
    await tick(); terminal.input("\r"); await tick();
    expect(resumed).toEqual(["thread-mid"]);
    enter("/resume"); await tick(); terminal.input("\x1b"); await tick();
    expect(resumed).toEqual(["thread-mid"]);
    expect(stripVTControlCharacters(terminal.output).split("History restored")).toHaveLength(2);
  } finally { enter("/quit!"); await ui; }
});

/** Mejora 8, punto 3: quien ya usaba `/resume <número>` (sobre el orden que ve en pantalla) o `/resume <id>` sigue igual; y sin sesiones sale el mensaje de siempre. */
test("/resume <number> and /resume <id> keep working and an empty list keeps its message", async () => {
  const terminal = new TestTerminal(); const resumed: string[] = [];
  const ui = runNativeUI("codex", "/project", () => sessionWithThreeSameTitle(resumed), terminal);
  const enter = (value: string) => { terminal.input(value); terminal.input("\r"); };
  try {
    await tick(); enter("/resume"); await tick(); terminal.input("\x1b"); await tick();
    enter("/resume 2"); await tick();
    expect(resumed).toEqual(["thread-mid"]);
    enter("/resume some-native-id"); await tick();
    expect(resumed).toEqual(["thread-mid", "some-native-id"]);
  } finally { enter("/quit!"); await ui; }
  const emptyTerminal = new TestTerminal();
  const emptyUi = runNativeUI("codex", "/project", () => ({ ...sessionWithThreeSameTitle([]), async listSessions() { return []; } }), emptyTerminal);
  try {
    await tick(); emptyTerminal.input("/resume"); emptyTerminal.input("\r"); await tick();
    expect(stripVTControlCharacters(emptyTerminal.output)).toContain(getCatalog("en").chat.noSessionsFound);
  } finally { emptyTerminal.input("/quit!"); emptyTerminal.input("\r"); await emptyUi; }
});
