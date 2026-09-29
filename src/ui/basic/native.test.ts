import { afterEach, beforeEach, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Terminal } from "@earendil-works/pi-tui";
import type { Approve } from "../../engines/types.ts";
import { runNativeUI } from "./native.ts";
import { CodexSession } from "../../engines/codex/session.ts";
import { FixtureRpc } from "../../../tests/support/rpc-fixture.ts";
import { getCatalog } from "../../i18n/index.ts";
import { ShellError, describeError } from "../../shell-error.ts";

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

/** Idea 26: Shift+Tab only reaches a mode Codex itself allows (here a single restriction, in the protocol's own values) and the composer shows Codex's name for it, not Shell's «manual/auto». */
test("Shift+Tab cycles only a native work mode reported by Codex, shown with the name Codex uses", async () => {
  const terminal = new TestTerminal(); const rpc = new FixtureRpc();
  rpc.replies.set("initialize", {});
  rpc.replies.set("account/read", { account: { type: "chatgpt" }, requiresOpenaiAuth: true });
  rpc.replies.set("configRequirements/read", { requirements: { allowedApprovalPolicies: ["on-request"], allowedSandboxModes: ["read-only"] } });
  rpc.replies.set("model/list", { data: [], nextCursor: null });
  const ui = runNativeUI("codex", "/project", (emit, approve) => new CodexSession(rpc, "/project", emit, approve), terminal);
  try {
    await tick(); terminal.input("\x1b[Z"); await tick();
    expect(stripVTControlCharacters(terminal.output)).toContain("Read Only");
  } finally { terminal.input("/quit!"); terminal.input("\r"); await ui; }
});

/** A Codex fixture with the three native modes available and a turn that stays open until the test completes it. */
function codexUi(locale: "en" | "es" = "en", configure: (rpc: FixtureRpc) => void = () => {}) {
  const terminal = new TestTerminal(); const rpc = new FixtureRpc();
  rpc.replies.set("initialize", {});
  rpc.replies.set("account/read", { account: { type: "chatgpt" }, requiresOpenaiAuth: true });
  rpc.replies.set("configRequirements/read", { requirements: null });
  rpc.replies.set("model/list", { data: [], nextCursor: null });
  rpc.replies.set("thread/start", { thread: { id: "t" }, model: "m", modelProvider: "openai" });
  rpc.replies.set("turn/start", { turn: { id: "u", status: "inProgress" } });
  rpc.replies.set("thread/compact/start", {});
  configure(rpc);
  let session!: CodexSession;
  const ui = runNativeUI("codex", "/project", (emit, approve) => session = new CodexSession(rpc, "/project", emit, approve, undefined, undefined, locale), terminal, undefined, locale);
  const enter = (text: string) => { terminal.input(text); terminal.input("\r"); };
  const plain = () => stripVTControlCharacters(terminal.output);
  return { terminal, rpc, ui, enter, plain, session: () => session };
}
const savedPreferences = () => JSON.parse(readFileSync(join(forgeHome, "shell", "preferences.json"), "utf8"));

/** Idea 1: Shift+Tab mid-turn never says «Finish or /stop»; the mode changes and one line says it applies from the next turn. */
test("Shift+Tab during a Codex turn changes the mode and says it applies from the next turn", async () => {
  const { terminal, rpc, ui, enter, plain, session } = codexUi();
  try {
    await tick(); enter("work please"); await tick();
    expect(session().busy).toBe(true);
    terminal.input("\x1b[Z"); await tick();
    expect(session().workMode()).toBe("on-request:read-only");
    expect(plain()).toContain(getCatalog("en").chat.workModeNextTurn({ mode: "Read Only" }));
    expect(plain()).not.toContain("Finish or /stop");
    rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } });
    await tick();
  } finally { enter("/quit!"); await ui; }
});

/** Idea 1: with a permission question still open, Shift+Tab is not swallowed by it. */
test("Shift+Tab works while a Codex permission question is pending", async () => {
  const { terminal, rpc, ui, enter, session } = codexUi();
  try {
    await tick(); enter("run something"); await tick();
    const answer = rpc.onRequest("item/commandExecution/requestApproval", { threadId: "t", turnId: "u", itemId: "i", command: "touch x" });
    await tick();
    terminal.input("\x1b[Z"); await tick();
    expect(session().workMode()).toBe("on-request:read-only");
    enter("/no"); expect(await answer).toEqual({ decision: "decline" });
    rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } });
    await tick();
  } finally { enter("/quit!"); await ui; }
});

/** Idea 23: `/compact` reaches Codex's own compaction and the person is told when it is done. */
test("/compact with Codex calls thread/compact/start and reports the result", async () => {
  const { rpc, ui, enter, plain } = codexUi();
  try {
    await tick(); enter("hello"); await tick();
    rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } });
    await tick(); enter("/compact"); await tick();
    expect(rpc.calls.find(call => call.method === "thread/compact/start")?.params).toEqual({ threadId: "t" });
    rpc.onNotification("turn/started", { threadId: "t", turn: { id: "c1" } });
    rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "c1", status: "completed" } });
    await tick();
    expect(plain()).toContain(getCatalog("en").codexChat.compacted);
    expect(plain()).not.toContain("Unknown command");
  } finally { enter("/quit!"); await ui; }
});

/** Idea 23: a native command Shell cannot pass to Codex gets an honest one-line answer instead of «Unknown command». */
test("a command Shell cannot pass to Codex says so honestly, in English and in Spanish", async () => {
  for (const locale of ["en", "es"] as const) {
    const terminal = new TestTerminal(); const rpc = new FixtureRpc();
    rpc.replies.set("initialize", {});
    rpc.replies.set("account/read", { account: { type: "chatgpt" }, requiresOpenaiAuth: true });
    rpc.replies.set("configRequirements/read", { requirements: null });
    rpc.replies.set("model/list", { data: [], nextCursor: null });
    const ui = runNativeUI("codex", "/project", (emit, approve) => new CodexSession(rpc, "/project", emit, approve, undefined, undefined, locale), terminal, undefined, locale);
    try {
      await tick(); terminal.input("/diff"); terminal.input("\r"); await tick();
      const text = stripVTControlCharacters(terminal.output);
      expect(text).toContain(getCatalog(locale).codexChat.commandNotAllowed({ name: "/diff" }));
      expect(text).not.toContain(getCatalog(locale).chat.unknownCommand({ name: "/diff" }));
    } finally { terminal.input("/quit!"); terminal.input("\r"); await ui; }
  }
});

/** Idea 7: the mode chosen with Shift+Tab is written next to the model, so it survives closing Shell. */
test("Shift+Tab saves the Codex mode, including full access, in Shell's preferences", async () => {
  const { terminal, ui, enter } = codexUi();
  try {
    await tick(); terminal.input("\x1b[Z"); await tick();
    expect(savedPreferences().codex.mode).toBe("on-request:read-only");
    for (let i = 0; i < 2; i++) { terminal.input("\x1b[Z"); await tick(); }
    expect(savedPreferences().codex.mode).toBe("never:danger-full-access");
  } finally { enter("/quit!"); await ui; }
});

/** Idea 7: opening Shell again puts the saved mode back without asking, even the full-access one. */
test("Codex reopens in the saved work mode without asking", async () => {
  mkdirSync(join(forgeHome, "shell"), { recursive: true });
  writeFileSync(join(forgeHome, "shell", "preferences.json"), JSON.stringify({ codex: { mode: "never:danger-full-access" } }));
  const { ui, enter, session } = codexUi();
  try {
    await tick();
    expect(session().workMode()).toBe("never:danger-full-access");
  } finally { enter("/quit!"); await ui; }
});

/** Idea 7: a saved mode Codex no longer has (it changed version) leaves Codex on its default, with no error on screen. */
test("a saved Codex mode that no longer exists falls back to the default without an error", async () => {
  mkdirSync(join(forgeHome, "shell"), { recursive: true });
  writeFileSync(join(forgeHome, "shell", "preferences.json"), JSON.stringify({ codex: { mode: "unlessTrusted:workspaceWrite" } }));
  const { ui, enter, session, plain } = codexUi();
  try {
    await tick();
    expect(session().workMode()).toBeUndefined();
    expect(plain()).not.toContain("Error");
    expect(plain()).not.toContain("Choose a mode");
  } finally { enter("/quit!"); await ui; }
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
    enter("/f614:stop"); await tick();
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

/**
 * Codex native commands, part 1 — through the screen. Each case types the command and checks two things:
 * the exact method and parameters Codex's protocol defines for it (the generated files are cited next to
 * each method in `src/engines/codex/session.test.ts`) and what the person reads afterwards. `FixtureRpc`
 * stands in for the app-server, so no account is involved.
 */
type CommandHarness = ReturnType<typeof codexUi>;
/** Sends one message and completes its turn, so the conversation `t` exists for the commands that act on a thread. */
async function withConversation(h: CommandHarness): Promise<void> {
  await tick(); h.enter("hello"); await tick();
  h.rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } });
  await tick();
}
const mcpServers = { data: [{
  name: "forge614-engram", runtimeStatus: "connected", pluginId: null, httpOrigin: null,
  serverInfo: { name: "engram", title: null, version: "1.6.0", description: null, icons: null, websiteUrl: null },
  serverCapabilities: null, toolsError: null, resources: [], resourceTemplates: [], authStatus: "unsupported",
  tools: { memory_search: { name: "memory_search", description: "Search memory", inputSchema: {} } },
}], nextCursor: null };
const skillCatalog = { data: [{ cwd: "/project", errors: [], skills: [
  { name: "review-pr", description: "Review a pull request", path: "/project/.agents/skills/review-pr/SKILL.md", scope: "repo", enabled: true, pluginId: null },
] }] };
const goalReply = { goal: { threadId: "t", objective: "Ship 1.12", status: "active", tokenBudget: null, tokensUsed: 10, timeUsedSeconds: 5, createdAt: 1, updatedAt: 2 } };
type CommandCase = { line: string; method: string; reply: unknown; params: unknown; exact?: boolean; shows: (c: ReturnType<typeof getCatalog>["codexCommands"]) => string };
const commandCases: CommandCase[] = [
  { line: "/rename Release notes", method: "thread/name/set", reply: {}, params: { threadId: "t", name: "Release notes" }, shows: c => c.renamed({ name: "Release notes" }) },
  { line: "/goal Ship 1.12", method: "thread/goal/set", reply: goalReply, params: { threadId: "t", objective: "Ship 1.12" }, shows: c => c.goalSet({ objective: "Ship 1.12" }) },
  { line: "/goal", method: "thread/goal/get", reply: { goal: null }, params: { threadId: "t" }, shows: c => c.goalNone },
  { line: "/goal clear", method: "thread/goal/clear", reply: { cleared: true }, params: { threadId: "t" }, shows: c => c.goalCleared },
  { line: "/mcp", method: "mcpServerStatus/list", reply: mcpServers, params: { detail: "toolsAndAuthOnly", threadId: "t" }, shows: () => "memory_search" },
  { line: "/mcp verbose", method: "mcpServerStatus/list", reply: mcpServers, params: { detail: "full", threadId: "t" }, shows: () => "1.6.0" },
  { line: "/hooks", method: "hooks/list", reply: { data: [{ cwd: "/project", warnings: [], errors: [], hooks: [{ key: "k", eventName: "preToolUse", matcher: null, handlerType: "command", command: "echo hi", async: false, enabled: true, trustStatus: "trusted", source: "user", isManaged: false }] }] }, params: { cwds: ["/project"] }, shows: () => "echo hi" },
  { line: "/usage", method: "account/usage/read", reply: { summary: { lifetimeTokens: 1234567, peakDailyTokens: null, longestRunningTurnSec: null, currentStreakDays: null, longestStreakDays: null }, dailyUsageBuckets: null }, params: {}, shows: c => c.usageLine({ label: c.usageLifetimeTokens, value: "1234567" }) },
  { line: "/ps", method: "thread/backgroundTerminals/list", reply: { data: [{ itemId: "i", processId: "p", command: "npm run dev", cwd: "/project", osPid: 42, cpuPercent: null, rssKb: null }], nextCursor: null }, params: { threadId: "t" }, shows: () => "npm run dev" },
  { line: "/stop", method: "thread/backgroundTerminals/clean", reply: {}, params: { threadId: "t" }, shows: c => c.stopped },
  { line: "/skills", method: "skills/list", reply: skillCatalog, params: { cwds: ["/project"] }, shows: () => "review-pr" },
  { line: "/archive", method: "thread/archive", reply: {}, params: { threadId: "t" }, shows: c => c.archived },
  { line: "/clear", method: "thread/start", reply: { thread: { id: "t2" }, model: "m", modelProvider: "openai" }, params: { cwd: "/project", modelProvider: "openai" }, exact: false, shows: c => c.cleared },
];
test("each Codex command of this part sends the protocol's method and parameters and shows its result", async () => {
  for (const item of commandCases) {
    const h = codexUi();
    try {
      await withConversation(h);
      h.rpc.replies.set(item.method, item.reply);
      h.enter(item.line); await tick(); await tick();
      const call = h.rpc.calls.filter(c => c.method === item.method).at(-1);
      expect(call, item.line).toBeDefined();
      if (item.exact === false) expect(call!.params, item.line).toMatchObject(item.params as object); else expect(call!.params, item.line).toEqual(item.params);
      expect(h.plain(), item.line).toContain(item.shows(getCatalog("en").codexCommands));
      expect(h.plain(), item.line).not.toContain("Unknown command");
      expect(h.plain(), item.line).not.toContain(getCatalog("en").codexChat.commandNotAllowed({ name: item.line.split(" ")[0]! }));
    } finally { h.enter("/quit!"); await h.ui; }
  }
});

/** `/pwd` (and Codex's spelling `/cwd`) is local: it shows the folder Shell opened Codex in and calls nothing. */
test("/pwd and /cwd show the working folder without calling Codex", async () => {
  const h = codexUi();
  try {
    await tick(); const before = h.rpc.calls.length;
    h.enter("/pwd"); await tick(); h.enter("/cwd"); await tick();
    expect(h.plain().split(getCatalog("en").codexCommands.pwd({ path: "/project" }))).toHaveLength(3);
    expect(h.rpc.calls.length).toBe(before);
  } finally { h.enter("/quit!"); await h.ui; }
});

/** `/rename` with no name says how to use it and calls nothing; with no conversation open there is nothing to rename and the person is told. */
test("/rename without a name shows its usage and without a conversation says there is nothing to rename", async () => {
  const h = codexUi("en", rpc => rpc.replies.set("thread/name/set", {}));
  try {
    await withConversation(h);
    h.enter("/rename"); await tick();
    expect(h.plain()).toContain(getCatalog("en").codexCommands.renameUsage);
    expect(h.rpc.calls.some(call => call.method === "thread/name/set")).toBe(false);
  } finally { h.enter("/quit!"); await h.ui; }
  const empty = codexUi("en", rpc => rpc.replies.set("thread/name/set", {}));
  try {
    await tick(); empty.enter("/rename Something"); await tick();
    expect(empty.plain()).toContain(describeError(new ShellError("codex-command-needs-conversation"), "en"));
    expect(empty.rpc.calls.some(call => call.method === "thread/name/set")).toBe(false);
  } finally { empty.enter("/quit!"); await empty.ui; }
});

/** `/delete` is forever, so it asks first: the first choice is «No», Enter on it (or Esc) calls nothing, and only «Yes» calls `thread/delete` (`v2/ThreadDeleteParams.ts`). */
test("/delete asks first and calls thread/delete only when the person says Yes", async () => {
  const c = getCatalog("en").codexCommands;
  const answers: [string[], boolean][] = [[["\r"], false], [["\x1b"], false], [["\x1b[B", "\r"], true]];
  for (const [keys, deleted] of answers) {
    const h = codexUi("en", rpc => rpc.replies.set("thread/delete", {}));
    try {
      await withConversation(h);
      h.enter("/delete"); await tick();
      expect(h.plain()).toContain(c.deletePrompt);
      expect(h.rpc.calls.some(call => call.method === "thread/delete")).toBe(false);
      for (const key of keys) h.terminal.input(key);
      await tick(); await tick();
      const calls = h.rpc.calls.filter(call => call.method === "thread/delete");
      if (deleted) { expect(calls).toEqual([{ method: "thread/delete", params: { threadId: "t" } }]); expect(h.plain()).toContain(c.deleted); }
      else { expect(calls).toHaveLength(0); expect(h.plain()).toContain(c.deleteKept); }
    } finally { h.enter("/quit!"); await h.ui; }
  }
});

/**
 * `/stop` is Codex's own now — «stop all background terminals» — and must not touch the turn; cancelling the
 * answer in progress moved to `/f614:stop`. Both are allowed while Codex works (`available_during_task`).
 */
test("/stop with Codex stops background terminals and leaves the turn alone; /f614:stop cancels the turn", async () => {
  const h = codexUi("en", rpc => { rpc.replies.set("thread/backgroundTerminals/clean", {}); rpc.replies.set("turn/interrupt", {}); });
  try {
    await tick(); h.enter("long work"); await tick();
    expect(h.session().busy).toBe(true);
    h.enter("/stop"); await tick();
    expect(h.rpc.calls.filter(call => call.method === "thread/backgroundTerminals/clean")).toEqual([{ method: "thread/backgroundTerminals/clean", params: { threadId: "t" } }]);
    expect(h.rpc.calls.some(call => call.method === "turn/interrupt")).toBe(false);
    expect(h.session().busy).toBe(true);
    h.enter("/f614:stop"); await tick();
    expect(h.rpc.calls.filter(call => call.method === "turn/interrupt")).toEqual([{ method: "turn/interrupt", params: { threadId: "t", turnId: "u" } }]);
    expect(h.plain()).toContain(getCatalog("en").codexChat.cancellationRequested.slice(0, 22)); // the message wraps on screen; its start is enough
    h.rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "interrupted" } });
    await tick();
  } finally { h.enter("/quit!"); await h.ui; }
});

/** While Codex works, the commands Codex allows then (`/rename`) run, and the ones it does not (`/clear`) wait instead of starting a second thread. */
test("during a turn /rename runs and /clear waits, as Codex's available_during_task says", async () => {
  const h = codexUi("en", rpc => rpc.replies.set("thread/name/set", {}));
  try {
    await tick(); h.enter("long work"); await tick();
    h.enter("/rename While working"); await tick();
    expect(h.rpc.calls.filter(call => call.method === "thread/name/set")).toHaveLength(1);
    h.enter("/clear"); await tick();
    expect(h.rpc.calls.filter(call => call.method === "thread/start")).toHaveLength(1);
    expect(h.plain()).toContain(getCatalog("en").codexChat.waitForEngine.slice(0, 20)); // the message wraps on screen; its start is enough
    h.rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } });
    await tick();
  } finally { h.enter("/quit!"); await h.ui; }
});

/** The menu offers Codex's commands with Codex's own descriptions (Shell's own ones sit under FORGE614, `/f614:stop` among them), and hides what Codex's macOS menu hides. */
test("the / menu shows Codex's descriptions, Shell's own group, and hides what Codex hides", async () => {
  for (const [typed, shown, hidden] of [
    ["/stop", ["CODEX", "stop all background terminals"], ["Cancel active turn"]],
    ["/mc", ["list configured MCP tools"], []],
    ["/f614:s", ["FORGE614", "/f614:stop"], []],
    ["/rol", [], ["print the rollout file path"]],
    ["/apps", [], ["manage apps"]],
  ] as [string, string[], string[]][]) {
    const h = codexUi();
    try {
      await tick(); h.terminal.output = ""; h.terminal.input(typed); await tick();
      for (const text of shown) expect(h.plain(), typed).toContain(text);
      for (const text of hidden) expect(h.plain(), typed).not.toContain(text);
    } finally { h.terminal.input("\x1b"); h.terminal.input("\x03"); await h.ui; } // Ctrl+C quits without typing into the box that still holds the text
  }
});

/** A command on Codex's official list that Shell has not connected yet answers with the honest message; a name that is not Codex's at all is an unknown command. */
test("an official but unconnected command is answered honestly and a made-up one is unknown, in both languages", async () => {
  for (const locale of ["en", "es"] as const) {
    const h = codexUi(locale);
    try {
      await tick();
      h.enter("/fork"); await tick();
      expect(h.plain()).toContain(getCatalog(locale).codexChat.commandNotAllowed({ name: "/fork" }));
      expect(h.plain()).not.toContain(getCatalog(locale).chat.unknownCommand({ name: "/fork" }));
      h.enter("/nope"); await tick();
      expect(h.plain()).toContain(getCatalog(locale).chat.unknownCommand({ name: "/nope" }));
      expect(h.plain()).not.toContain(getCatalog(locale).codexChat.commandNotAllowed({ name: "/nope" }));
    } finally { h.enter("/quit!"); await h.ui; }
  }
});

/** The command messages exist in Spanish too: same method, the person reads Spanish. */
test("Codex command results are shown in Spanish when Shell's language is Spanish", async () => {
  const h = codexUi("es", rpc => rpc.replies.set("thread/backgroundTerminals/list", { data: [], nextCursor: null }));
  try {
    await withConversation(h);
    h.enter("/pwd"); await tick(); h.enter("/ps"); await tick();
    expect(h.plain()).toContain(getCatalog("es").codexCommands.pwd({ path: "/project" }));
    expect(h.plain()).toContain(getCatalog("es").codexCommands.psNone);
    expect(getCatalog("es").codexCommands.psNone).not.toBe(getCatalog("en").codexCommands.psNone);
  } finally { h.enter("/quit!"); await h.ui; }
});

/** The `$` autocomplete lists Codex's own catalog (`skills/list`), and sending it reaches Codex as a real skill item with its path. */
test("$ autocompletes from skills/list and the chosen skill is sent as a skill item", async () => {
  const h = codexUi("en", rpc => rpc.replies.set("skills/list", skillCatalog));
  try {
    await tick(); h.terminal.output = ""; h.terminal.input("$rev"); await tick();
    expect(h.plain()).toContain("Review a pull request");
    h.terminal.input("\r"); await tick(); await tick();
    const turn = h.rpc.calls.find(call => call.method === "turn/start")!;
    expect(turn.params.input).toEqual([
      { type: "text", text: "$review-pr" },
      { type: "skill", name: "review-pr", path: "/project/.agents/skills/review-pr/SKILL.md" },
    ]);
    h.rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } });
    await tick();
  } finally { h.enter("/quit!"); await h.ui; }
});
