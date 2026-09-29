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
import type { CodexLocalTools } from "./codex-commands.ts";
import { CODEX_INIT_PROMPT } from "../../engines/codex/prompts.ts";

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

/** Idea 26: `/permissions` offers only a mode Codex itself allows (here a single restriction, in the protocol's own values), with the name Codex's macOS menu uses. */
test("/permissions offers only the modes Codex allows, with the names Codex uses", async () => {
  const terminal = new TestTerminal(); const rpc = new FixtureRpc();
  rpc.replies.set("initialize", {});
  rpc.replies.set("account/read", { account: { type: "chatgpt" }, requiresOpenaiAuth: true });
  rpc.replies.set("configRequirements/read", { requirements: { allowedApprovalPolicies: ["on-request"], allowedSandboxModes: ["workspace-write"] } });
  rpc.replies.set("model/list", { data: [], nextCursor: null });
  const ui = runNativeUI("codex", "/project", (emit, approve) => new CodexSession(rpc, "/project", emit, approve), terminal);
  try {
    await tick(); terminal.input("/permissions"); terminal.input("\r"); await tick();
    const text = stripVTControlCharacters(terminal.output);
    expect(text).toContain("1. Ask for approval");
    expect(text).not.toContain("Full Access");
    expect(text).not.toContain("Read Only");
  } finally { terminal.input("\x1b"); terminal.input("/quit!"); terminal.input("\r"); await ui; }
});

/**
 * `collaborationMode/list` (`v2/CollaborationModeListResponse.ts`) as Codex 0.159.0 answers it
 * (`models-manager/src/collaboration_mode_presets.rs`): Plan first, then Default.
 */
const collaborationList = { data: [
  { name: "Plan", mode: "plan", model: null, reasoning_effort: "medium" },
  { name: "Default", mode: "default", model: null, reasoning_effort: null },
] };

/** Stand-ins for what Shell does on the person's own machine (git, clipboard, a new file, the browser): records the calls, never touches the real ones. */
function localDouble(overrides: Partial<CodexLocalTools> = {}) {
  const copied: string[] = []; const saved: [string, string][] = []; const opened: string[] = []; const diffed: string[] = [];
  const tools: CodexLocalTools = {
    gitDiff: async cwd => { diffed.push(cwd); return { inRepo: true, diff: "diff --git a/x.ts b/x.ts\n+added line\n" }; },
    gitBranches: async () => ["main", "feature/login"],
    gitCurrentBranch: async () => "feature/login",
    gitCommits: async () => [{ sha: "abc123", subject: "Fix the login" }, { sha: "def456", subject: "Add tests" }],
    copyText: async text => { copied.push(text); },
    saveNewFile: async (path, text) => { saved.push([path, text]); },
    openLink: async url => { opened.push(url); return true; },
    ...overrides,
  };
  return { tools, copied, saved, opened, diffed };
}

/** A Codex fixture with the native modes available, Codex's two collaboration modes, and a turn that stays open until the test completes it. */
function codexUi(locale: "en" | "es" = "en", configure: (rpc: FixtureRpc) => void = () => {}, local = localDouble()) {
  const terminal = new TestTerminal(); const rpc = new FixtureRpc();
  rpc.replies.set("initialize", {});
  rpc.replies.set("account/read", { account: { type: "chatgpt" }, requiresOpenaiAuth: true });
  rpc.replies.set("configRequirements/read", { requirements: null });
  rpc.replies.set("model/list", { data: [], nextCursor: null });
  rpc.replies.set("thread/start", { thread: { id: "t" }, model: "m", modelProvider: "openai" });
  rpc.replies.set("turn/start", { turn: { id: "u", status: "inProgress" } });
  rpc.replies.set("thread/compact/start", {});
  rpc.replies.set("collaborationMode/list", collaborationList);
  rpc.replies.set("thread/settings/update", {});
  configure(rpc);
  let session!: CodexSession;
  const ui = runNativeUI("codex", "/project", (emit, approve) => session = new CodexSession(rpc, "/project", emit, approve, undefined, undefined, locale), terminal, undefined, locale, local.tools);
  const enter = (text: string) => { terminal.input(text); terminal.input("\r"); };
  const plain = () => stripVTControlCharacters(terminal.output);
  return { terminal, rpc, ui, enter, plain, session: () => session, local };
}
const savedPreferences = () => JSON.parse(readFileSync(join(forgeHome, "shell", "preferences.json"), "utf8"));

/** Idea 1 with Codex's own Shift+Tab (Plan ↔ Default): mid-turn it never says «Finish or /stop»; the mode changes and one line says it applies from the next turn. */
test("Shift+Tab during a Codex turn switches to Plan and says it applies from the next turn", async () => {
  const { terminal, rpc, ui, enter, plain, session } = codexUi();
  try {
    await tick(); enter("work please"); await tick();
    expect(session().busy).toBe(true);
    terminal.input("\x1b[Z"); await tick();
    expect(session().collaborationMode()).toBe("plan");
    expect(plain()).toContain(getCatalog("en").chat.workModeNextTurn({ mode: "Plan" }));
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
    expect(session().collaborationMode()).toBe("plan");
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
      await tick(); terminal.input("/recap"); terminal.input("\r"); await tick();
      const text = stripVTControlCharacters(terminal.output);
      expect(text).toContain(getCatalog(locale).codexChat.commandNotAllowed({ name: "/recap" }));
      expect(text).not.toContain(getCatalog(locale).chat.unknownCommand({ name: "/recap" }));
    } finally { terminal.input("/quit!"); terminal.input("\r"); await ui; }
  }
});

/** Idea 7: the permission chosen in `/permissions` (full access included) and the collaboration mode chosen with Shift+Tab are written next to the model, so they survive closing Shell. */
test("the Codex permission and collaboration mode, including full access, are saved in Shell's preferences", async () => {
  const { terminal, ui, enter } = codexUi();
  try {
    await tick(); enter("/permissions"); await tick();
    terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // Full Access → Codex's confirmation
    terminal.input("\r"); await tick(); // «Yes, continue anyway»
    expect(savedPreferences().codex.mode).toBe("never:danger-full-access");
    terminal.input("\x1b[Z"); await tick();
    expect(savedPreferences().codex).toEqual({ mode: "never:danger-full-access", collaborationMode: "plan" });
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

/** Idea 7: a saved mode Codex no longer has (it changed version) comes back as «Ask for approval», with no error on screen. */
test("a saved Codex mode that no longer exists comes back as Ask for approval without an error", async () => {
  mkdirSync(join(forgeHome, "shell"), { recursive: true });
  writeFileSync(join(forgeHome, "shell", "preferences.json"), JSON.stringify({ codex: { mode: "unlessTrusted:workspaceWrite" } }));
  const { ui, enter, session, plain } = codexUi();
  try {
    await tick();
    expect(session().workMode()).toBe("on-request:workspace-write");
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
  // Shown as Markdown: the `thread/archive` code span loses its backticks on screen, and the start is enough because the line wraps.
  { line: "/archive", method: "thread/archive", reply: {}, params: { threadId: "t" }, shows: c => c.archived.replaceAll("`", "").slice(0, 40) },
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
      h.enter("/side"); await tick();
      expect(h.plain()).toContain(getCatalog(locale).codexChat.commandNotAllowed({ name: "/side" }));
      expect(h.plain()).not.toContain(getCatalog(locale).chat.unknownCommand({ name: "/side" }));
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

/**
 * Codex native commands, part 2, the permission menu and Shift+Tab — through the screen. Each case types what
 * the person types and checks the exact protocol call (the generated file is cited next to each method in
 * `src/engines/codex/session.test.ts`) and what the person reads. `FixtureRpc` stands in for the app-server and
 * `localDouble` for git, the clipboard, files and the browser, so nothing real is touched.
 */
const featureList = (guardian: boolean, extra: object[] = []) => ({ data: [
  { name: "guardian_approval", stage: "stable", displayName: null, description: null, announcement: null, enabled: guardian, defaultEnabled: true },
  ...extra,
], nextCursor: null });

/** The selector lists exactly Codex's macOS menu (`chatwidget/permission_popups.rs`), in its order and words; Read Only never appears; the choice is applied, announced like Codex and saved. */
test("/permissions shows exactly Codex's macOS names, never Read Only, and applies the choice", async () => {
  const h = codexUi("en", rpc => rpc.replies.set("experimentalFeature/list", featureList(true)));
  try {
    await tick(); h.enter("/permissions"); await tick();
    const shown = h.plain();
    expect(shown).toContain("Update Model Permissions");
    expect(shown).toContain("1. Ask for approval");
    expect(shown).toContain("2. Approve for me");
    expect(shown).toContain("3. Full Access");
    expect(shown).not.toContain("4. ");
    expect(shown).not.toContain("Read Only");
    h.terminal.input("\x1b[B"); h.terminal.input("\r"); await tick();
    expect(h.session().workMode()).toBe("on-request:workspace-write:auto_review");
    expect(h.plain()).toContain("Permissions updated to Approve for me");
    expect(savedPreferences().codex.mode).toBe("on-request:workspace-write:auto_review");
  } finally { h.enter("/quit!"); await h.ui; }
});

/** Full Access asks first with Codex's own confirmation (`open_full_access_confirmation`); «Cancel» goes back to the menu and changes nothing. */
test("Full Access asks with Codex's confirmation and Cancel changes nothing", async () => {
  const h = codexUi();
  try {
    await tick(); h.enter("/permissions"); await tick();
    h.terminal.input("\x1b[B"); h.terminal.input("\r"); await tick();
    expect(h.plain()).toContain("Enable full access?");
    expect(h.plain()).toContain("1. Yes, continue anyway");
    expect(h.plain()).toContain("2. Cancel");
    const beforeCancel = h.terminal.output.length;
    h.terminal.input("\x1b[B"); h.terminal.input("\r"); await tick();
    expect(h.session().workMode()).toBeUndefined();
    expect(stripVTControlCharacters(h.terminal.output.slice(beforeCancel))).toContain("Update Model Permissions");
    h.terminal.input("\x1b"); await tick();
  } finally { h.enter("/quit!"); await h.ui; }
});

/** A remembered Read Only (gone from Codex's macOS menu) comes back as «Ask for approval» with one notice; the next opening says nothing, because the replacement was saved. */
test("a remembered Read Only is restored as Ask for approval and the notice is shown once", async () => {
  mkdirSync(join(forgeHome, "shell"), { recursive: true });
  writeFileSync(join(forgeHome, "shell", "preferences.json"), JSON.stringify({ codex: { mode: "on-request:read-only" } }));
  const notice = getCatalog("en").codexCommands.retiredModeReplaced({ mode: "Ask for approval" }).slice(0, 40); // the line wraps on screen; its start is enough
  const first = codexUi();
  try {
    await tick();
    expect(first.session().workMode()).toBe("on-request:workspace-write");
    expect(first.plain()).toContain(notice);
    expect(savedPreferences().codex.mode).toBe("on-request:workspace-write");
  } finally { first.enter("/quit!"); await first.ui; }
  const second = codexUi();
  try {
    await tick();
    expect(second.session().workMode()).toBe("on-request:workspace-write");
    expect(second.plain()).not.toContain(notice);
  } finally { second.enter("/quit!"); await second.ui; }
});

/**
 * With Codex, Shift+Tab is Codex's own (`chatwidget/interaction.rs:224`, `collaboration_modes.rs` `next_mask`):
 * it switches Default ↔ Plan in the list's order and never touches the permissions. The indicator shows Codex's
 * «Plan mode» next to the permission, and its help says what Shift+Tab does now.
 */
test("Shift+Tab with Codex switches Plan and Default, keeps the permission, and the indicator says so", async () => {
  mkdirSync(join(forgeHome, "shell"), { recursive: true });
  writeFileSync(join(forgeHome, "shell", "preferences.json"), JSON.stringify({ codex: { mode: "never:danger-full-access" } }));
  const h = codexUi();
  try {
    await tick();
    expect(h.session().collaborationMode()).toBe("default");
    h.terminal.output = ""; h.terminal.input("\x1b[Z"); await tick();
    expect(h.session().collaborationMode()).toBe("plan");
    expect(h.session().workMode()).toBe("never:danger-full-access");
    expect(h.plain()).toContain("Plan mode");
    expect(h.plain()).toContain("Full Access");
    expect(h.plain()).toContain(getCatalog("en").workMode.shiftTabCollaboration({ modes: "Plan ↔ Default" }));
    expect(h.plain()).not.toContain(getCatalog("en").workMode.shiftTabToCycle);
    h.terminal.input("\x1b[Z"); await tick();
    expect(h.session().collaborationMode()).toBe("default");
    expect(h.session().workMode()).toBe("never:danger-full-access");
  } finally { h.enter("/quit!"); await h.ui; }
});

/** Shell remembers the collaboration mode too and puts it back on opening, without asking. */
test("Codex reopens in the saved collaboration mode", async () => {
  mkdirSync(join(forgeHome, "shell"), { recursive: true });
  writeFileSync(join(forgeHome, "shell", "preferences.json"), JSON.stringify({ codex: { collaborationMode: "plan" } }));
  const h = codexUi();
  try {
    await tick();
    expect(h.session().collaborationMode()).toBe("plan");
  } finally { h.enter("/quit!"); await h.ui; }
});

/** `/model` and `/resume` are `available_during_task` in Codex: they run while it works instead of asking to wait. */
test("/model and /resume run during a Codex turn", async () => {
  const h = codexUi("en", rpc => {
    rpc.replies.set("model/list", { data: [{ model: "alpha", displayName: "Alpha", supportedReasoningEfforts: [] }], nextCursor: null });
    rpc.replies.set("thread/list", { data: [], nextCursor: null });
  });
  try {
    await tick(); h.enter("long work"); await tick();
    expect(h.session().busy).toBe(true);
    h.enter("/model alpha"); await tick();
    expect(h.session().visual().model).toBe("alpha");
    expect(h.plain()).toContain(getCatalog("en").codexChat.selectedModel({ model: "alpha" }));
    h.enter("/resume"); await tick();
    expect(h.plain()).toContain(getCatalog("en").codexChat.noSessionsFound);
    expect(h.plain()).not.toContain(getCatalog("en").codexChat.waitForEngine.slice(0, 20));
    h.rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } });
    await tick();
  } finally { h.enter("/quit!"); await h.ui; }
});

/** A command that only exists in Codex's own screen gets its own answer; one from part 3 keeps the honest «not from Shell yet». Both languages. */
test("screen-only Codex commands and part-3 commands answer with their own messages", async () => {
  for (const locale of ["en", "es"] as const) {
    const h = codexUi(locale);
    try {
      // `/rollout` is typed (Codex's menu hides it, so no suggestion replaces it); aliases such as `/pet` are covered in commands.test.ts.
      await tick(); h.enter("/theme"); await tick(); h.enter("/rollout"); await tick(); h.enter("/approve"); await tick();
      expect(h.plain()).toContain(getCatalog(locale).codexCommands.screenOnly({ name: "/theme" }));
      expect(h.plain()).toContain(getCatalog(locale).codexCommands.screenOnly({ name: "/rollout" }));
      expect(h.plain()).toContain(getCatalog(locale).codexChat.commandNotAllowed({ name: "/approve" }));
      expect(h.plain()).not.toContain(getCatalog(locale).codexChat.commandNotAllowed({ name: "/theme" }));
    } finally { h.enter("/quit!"); await h.ui; }
  }
  expect(getCatalog("en").codexCommands.screenOnly({ name: "/theme" })).toBe("/theme only exists in Codex's own screen.");
  expect(getCatalog("es").codexCommands.screenOnly({ name: "/theme" })).toBe("/theme solo existe en la pantalla de Codex.");
});

/** `/init` sends, as a normal turn, exactly Codex's `tui/assets/prompt_for_init_command.md` (`slash_dispatch.rs:290`). */
test("/init sends Codex's init prompt verbatim as a normal turn", async () => {
  const h = codexUi();
  try {
    await tick(); h.enter("/init"); await tick(); await tick();
    const turn = h.rpc.calls.find(call => call.method === "turn/start")!;
    expect(turn.params.input.at(-1)).toEqual({ type: "text", text: CODEX_INIT_PROMPT });
    expect(CODEX_INIT_PROMPT.startsWith("Generate a file named AGENTS.md that serves as a contributor guide for this repository.\n")).toBe(true);
    expect(CODEX_INIT_PROMPT).toContain("- Summarize commit message conventions found in the project’s Git history.\n");
    expect(CODEX_INIT_PROMPT.endsWith("Architecture Overview, or Agent-Specific Instructions.\n")).toBe(true);
    expect(CODEX_INIT_PROMPT.split("\n")).toHaveLength(42);
    h.rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } });
    await tick();
  } finally { h.enter("/quit!"); await h.ui; }
});

/** `/diff` shows the local git diff with untracked files (`get_git_diff.rs`), and Codex's words when there is no repository or no change. */
test("/diff shows the local diff, and Codex's messages outside a repository or with no changes", async () => {
  const cases: [Partial<CodexLocalTools>, string][] = [
    [{}, "+added line"],
    [{ gitDiff: async () => ({ inRepo: false, diff: "" }) }, "/diff — not inside a git repository"], // Codex's Markdown, as it reads on screen
    [{ gitDiff: async () => ({ inRepo: true, diff: "" }) }, "No changes detected."],
    [{ gitDiff: async () => { throw new Error("git missing"); } }, "Failed to compute diff: git missing"],
  ];
  for (const [override, expected] of cases) {
    const h = codexUi("en", () => {}, localDouble(override));
    try {
      await tick(); h.enter("/diff"); await tick();
      expect(h.plain()).toContain(expected);
      expect(h.rpc.calls.some(call => call.method === "command/exec")).toBe(false);
    } finally { h.enter("/quit!"); await h.ui; }
  }
});

/** `/apps` lists `app/list` read-only (`chatwidget/connectors.rs`) and Enter opens the app's page in the browser. */
test("/apps lists the apps with Codex's words and Enter opens the app page", async () => {
  const h = codexUi("en", rpc => rpc.replies.set("app/list", { data: [
    { id: "gh", name: "GitHub", description: "Code hosting", installUrl: "https://chatgpt.com/apps/github/gh", isAccessible: true, isEnabled: true },
    { id: "cal", name: "Calendar", description: null, installUrl: "https://chatgpt.com/apps/calendar/cal", isAccessible: false, isEnabled: true },
  ], nextCursor: null }));
  try {
    await tick(); h.enter("/apps"); await tick();
    expect(h.rpc.calls.find(call => call.method === "app/list")?.params).toEqual({ forceRefetch: true });
    expect(h.plain()).toContain("Installed 1 of 2 available apps.");
    expect(h.plain()).toContain("1. GitHub");
    expect(h.plain()).toContain("Installed · Code hosting");
    expect(h.plain()).toContain("Can be installed");
    h.terminal.input("\r"); await tick();
    expect(h.local.opened).toEqual(["https://chatgpt.com/apps/github/gh"]);
    expect(h.plain()).toContain("Manage this app in your browser.");
  } finally { h.enter("/quit!"); await h.ui; }
});

/** `/experimental` lists only Codex's beta features; Enter switches the chosen one, saves it with `config/batchWrite` and shows its new state. */
test("/experimental switches the chosen beta feature and shows its new state", async () => {
  let enabled = false;
  const h = codexUi("en", rpc => {
    rpc.handler = async (method, params) => {
      if (method === "experimentalFeature/list") return featureList(false, [{ name: "fast_mode", stage: "beta", displayName: "Fast mode", description: "Answer faster", announcement: null, enabled, defaultEnabled: false }]);
      if (method === "config/batchWrite") { enabled = params.edits[0].value === true; return { status: "ok", version: "v", filePath: "/c", overriddenMetadata: null }; }
      if (!rpc.replies.has(method)) throw new Error(`Unexpected ${method}`);
      return rpc.replies.get(method);
    };
  });
  try {
    await tick(); h.enter("/experimental"); await tick();
    expect(h.plain()).toContain("Experimental features");
    expect(h.plain()).toContain("1. [ ] Fast mode");
    expect(h.plain()).not.toContain("guardian_approval");
    h.terminal.input("\r"); await tick(); await tick();
    expect(h.rpc.calls.filter(call => call.method === "config/batchWrite").map(call => call.params)).toEqual([{ edits: [{ keyPath: "features.\"fast_mode\"", value: true, mergeStrategy: "replace" }], reloadUserConfig: true }]);
    expect(h.plain()).toContain(getCatalog("en").codexCommands.featureState({ name: "Fast mode", state: getCatalog("en").codexCommands.stateOn }));
  } finally { h.enter("/quit!"); await h.ui; }
});

/** «Reset all memories» deletes for good, so it asks with «Go back» first: saying no calls nothing; only the explicit choice calls `memory/reset`. */
test("/memories reset asks first, calls nothing on No and memory/reset only on Yes", async () => {
  const memories = { name: "memories", stage: "stable", displayName: null, description: null, announcement: null, enabled: true, defaultEnabled: false };
  const h = codexUi("en", rpc => {
    rpc.replies.set("experimentalFeature/list", featureList(false, [memories]));
    rpc.replies.set("config/read", { config: {}, origins: {}, layers: null });
    rpc.replies.set("memory/reset", {});
  });
  try {
    await tick(); h.enter("/memories"); await tick();
    expect(h.plain()).toContain("1. [x] Use memories");
    expect(h.plain()).toContain("2. [x] Generate memories");
    expect(h.plain()).toContain("3. Reset all memories");
    h.terminal.input("\x1b[B"); h.terminal.input("\x1b[B"); h.terminal.input("\r"); await tick();
    expect(h.plain()).toContain("Reset all memories?");
    expect(h.plain()).toContain("1. Go back");
    h.terminal.input("\r"); await tick();
    expect(h.rpc.calls.some(call => call.method === "memory/reset")).toBe(false);
    h.terminal.input("\x1b"); await tick();
    h.enter("/memories"); await tick();
    h.terminal.input("\x1b[B"); h.terminal.input("\x1b[B"); h.terminal.input("\r"); await tick();
    h.terminal.input("\x1b[B"); h.terminal.input("\r"); await tick();
    expect(h.rpc.calls.filter(call => call.method === "memory/reset")).toEqual([{ method: "memory/reset", params: {} }]);
    expect(h.plain()).toContain("Reset local memories.");
  } finally { h.enter("/quit!"); await h.ui; }
});

/** With memories off, Codex asks «Enable memories?» with «Yes, enable» first (`open_feature_enable_prompt`) and saves the feature for new threads. */
test("/memories with the feature off offers to enable it, Yes first", async () => {
  const h = codexUi("en", rpc => {
    rpc.replies.set("experimentalFeature/list", featureList(false, [{ name: "memories", stage: "stable", displayName: null, description: null, announcement: null, enabled: false, defaultEnabled: false }]));
    rpc.replies.set("config/read", { config: {}, origins: {}, layers: null });
    rpc.replies.set("config/batchWrite", { status: "ok", version: "v", filePath: "/c", overriddenMetadata: null });
  });
  try {
    await tick(); h.enter("/memories"); await tick();
    expect(h.plain()).toContain("Enable memories?");
    expect(h.plain()).toContain("1. Yes, enable");
    expect(h.plain()).toContain("2. Not now");
    h.terminal.input("\r"); await tick();
    expect(h.rpc.calls.find(call => call.method === "config/batchWrite")?.params.edits.map((edit: any) => edit.keyPath)).toEqual(["features.memories", "features.memory_tool"]);
    expect(h.plain()).toContain("Memories setting saved on the server for new threads.");
  } finally { h.enter("/quit!"); await h.ui; }
});

/** `/review` offers Codex's four presets in its order (`review_popups.rs`); each target reaches `review/start`, and `/review text` goes straight in as custom instructions. */
test("/review sends each preset's target, and /review with text sends custom instructions", async () => {
  const cases: [string[], unknown][] = [
    [["\x1b[B", "\r"], { type: "uncommittedChanges" }],
    [["\r", "\r"], { type: "baseBranch", branch: "main" }],
    [["\x1b[B", "\x1b[B", "\r", "\x1b[B", "\r"], { type: "commit", sha: "def456", title: "Add tests" }],
  ];
  for (const [keys, target] of cases) {
    const h = codexUi("en", rpc => rpc.replies.set("review/start", { turn: { id: "r", status: "inProgress" }, reviewThreadId: "t" }));
    try {
      await withConversation(h);
      h.enter("/review"); await tick();
      expect(h.plain()).toContain("1. Review against a base branch");
      expect(h.plain()).toContain("2. Review uncommitted changes");
      expect(h.plain()).toContain("3. Review a commit");
      expect(h.plain()).toContain("4. Custom review instructions");
      for (const key of keys) { h.terminal.input(key); await tick(); }
      expect(h.rpc.calls.filter(call => call.method === "review/start").map(call => call.params)).toEqual([{ threadId: "t", target, delivery: "inline" }]);
      h.rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "r", status: "completed" } });
      await tick();
    } finally { h.enter("/quit!"); await h.ui; }
  }
  const h = codexUi("en", rpc => rpc.replies.set("review/start", { turn: { id: "r", status: "inProgress" }, reviewThreadId: "t" }));
  try {
    await withConversation(h);
    h.enter("/review focus on security"); await tick();
    expect(h.rpc.calls.filter(call => call.method === "review/start").map(call => call.params)).toEqual([{ threadId: "t", target: { type: "custom", instructions: "focus on security" }, delivery: "inline" }]);
    h.rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "r", status: "completed" } });
    await tick();
  } finally { h.enter("/quit!"); await h.ui; }
});

/** `/fork name` copies the conversation (`thread/fork`), names the copy and continues there, with Codex's message. */
test("/fork with a name forks, names the copy and says so", async () => {
  const h = codexUi("en", rpc => {
    rpc.replies.set("thread/fork", { thread: { id: "f", turns: [] }, model: "m", modelProvider: "openai" });
    rpc.replies.set("thread/name/set", {});
  });
  try {
    await withConversation(h);
    h.enter("/fork Other idea"); await tick();
    expect(h.rpc.calls.find(call => call.method === "thread/fork")?.params.threadId).toBe("t");
    expect(h.rpc.calls.find(call => call.method === "thread/name/set")?.params).toEqual({ threadId: "f", name: "Other idea" });
    expect(h.session().sessionId).toBe("f");
    expect(h.plain()).toContain("Fork created. You can continue here.");
  } finally { h.enter("/quit!"); await h.ui; }
});

/**
 * `/plan` switches to Plan; `/plan text` also sends the text in Plan. A turn that ends in Plan with a plan asks
 * «Implement this plan?» with Codex's three options (`chatwidget/plan_implementation.rs`); the first sends
 * «Implement the plan.» in Default.
 */
test("/plan switches to Plan, /plan text sends it in Plan, and a finished plan offers Codex's three options", async () => {
  const h = codexUi();
  try {
    await tick(); h.enter("/plan"); await tick();
    expect(h.session().collaborationMode()).toBe("plan");
    h.enter("/plan write the tests first"); await tick(); await tick();
    const turn = h.rpc.calls.find(call => call.method === "turn/start")!;
    expect(turn.params.input.at(-1)).toEqual({ type: "text", text: "write the tests first" });
    expect(turn.params.collaborationMode.mode).toBe("plan");
    h.rpc.onNotification("item/completed", { threadId: "t", turnId: "u", item: { type: "plan", id: "p", text: "1. Test\n2. Code" } });
    h.rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } });
    await tick(); await tick();
    expect(h.plain()).toContain("Implement this plan?");
    expect(h.plain()).toContain("1. Yes, implement this plan");
    expect(h.plain()).toContain("2. Yes, clear context and implement");
    expect(h.plain()).toContain("3. No, stay in Plan mode");
    h.terminal.input("\r"); await tick(); await tick();
    const next = h.rpc.calls.filter(call => call.method === "turn/start").at(-1)!;
    expect(next.params.input.at(-1)).toEqual({ type: "text", text: "Implement the plan." });
    expect(next.params.collaborationMode.mode).toBe("default");
    h.rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } });
    await tick();
  } finally { h.enter("/quit!"); await h.ui; }
});

/** `/export` reads the whole thread and, like Codex, copies the Markdown or saves it as `codex-session-<id>.md` in the folder. */
test("/export copies the Markdown or saves it as codex-session-<id>.md", async () => {
  const markdown = "# Codex conversation\n\n## User\n\nhello\n";
  const thread = { thread: { id: "t", cwd: "/project", turns: [{ id: "1", items: [{ type: "userMessage", id: "a", content: [{ type: "text", text: "hello" }] }] }] } };
  const h = codexUi("en", rpc => rpc.replies.set("thread/read", thread));
  try {
    await withConversation(h);
    h.enter("/export"); await tick();
    expect(h.plain()).toContain("1. Copy to clipboard");
    expect(h.plain()).toContain("2. Save to file");
    h.terminal.input("\r"); await tick();
    expect(h.local.copied).toEqual([markdown]);
    expect(h.plain()).toContain("Copied conversation to clipboard");
    h.enter("/export"); await tick(); h.terminal.input("\x1b[B"); h.terminal.input("\r"); await tick();
    expect(h.local.saved).toEqual([["/project/codex-session-t.md", markdown]]);
    expect(h.plain()).toContain("Saved conversation to /project/codex-session-t.md");
  } finally { h.enter("/quit!"); await h.ui; }
});

/** `/copy` offers the whole last answer and each code block or quote in it (`chatwidget/copy_picker.rs`), and copies the one chosen. */
test("/copy offers the whole answer and its code blocks and copies the chosen one", async () => {
  const h = codexUi();
  try {
    await tick(); h.enter("show code"); await tick();
    h.rpc.onNotification("item/completed", { threadId: "t", turnId: "u", item: { type: "agentMessage", id: "m", text: "Here:\n\n```rust\nlet answer = 42;\n```\n" } });
    h.rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } });
    await tick();
    h.enter("/copy"); await tick();
    expect(h.plain()).toContain("Copy to clipboard");
    expect(h.plain()).toContain("1. Whole response");
    expect(h.plain()).toContain("2. rust code");
    h.terminal.input("\x1b[B"); h.terminal.input("\r"); await tick();
    expect(h.local.copied).toEqual(["let answer = 42;\n"]);
    expect(h.plain()).toContain("Copied rust code to clipboard");
  } finally { h.enter("/quit!"); await h.ui; }
});

/** `/mention` puts «@» in the box; typing searches with `fuzzyFileSearch`; the chosen path replaces the token as plain text and travels in `turn/start` as Codex sends it (`chat_composer.rs` `insert_selected_path`). */
test("/mention inserts @, searches files and the chosen path travels as text", async () => {
  const h = codexUi("en", rpc => rpc.replies.set("fuzzyFileSearch", { files: [{ root: "/project", path: "src/session.ts", match_type: "file", file_name: "session.ts", score: 9, indices: null }] }));
  try {
    await tick(); h.enter("/mention"); await tick();
    for (const char of "sess") h.terminal.input(char);
    await tick(); await tick();
    expect(h.rpc.calls.filter(call => call.method === "fuzzyFileSearch").at(-1)?.params).toEqual({ query: "sess", roots: ["/project"], cancellationToken: null });
    expect(h.plain()).toContain("src/session.ts");
    h.terminal.input("\r"); await tick();
    for (const char of "explain") h.terminal.input(char);
    h.terminal.input("\r"); await tick(); await tick();
    expect(h.rpc.calls.find(call => call.method === "turn/start")?.params.input.at(-1)).toEqual({ type: "text", text: "src/session.ts explain" });
    h.rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } });
    await tick();
  } finally { h.enter("/quit!"); await h.ui; }
});

/**
 * In Codex `/exit` and `/quit` are the same command («exit Codex»), so with Codex `/exit` closes Shell exactly like `/quit`:
 * the same refusal while work is in progress and the same `/exit!` (like `/quit!`) to stop and leave. It exists because `/exit`
 * used to answer «Codex doesn't allow /exit from Shell yet».
 */
test("/exit with Codex behaves like /quit and /exit! like /quit!", async () => {
  const terminal = new TestTerminal(); let closed = false; let finishTurn: (() => void) | undefined;
  const session = {
    busy: false, models: [],
    async initialize() {}, async login() {}, async cancel() {}, reset() {}, async resume(_id: string) {},
    async listSessions() { return []; }, async setModel(_id: string) {}, async setEffort(_effort: string) {},
    status() { return ["native status"]; },
    async send(_text: string) { session.busy = true; await new Promise<void>(resolve => { finishTurn = resolve; }); session.busy = false; },
    close() { closed = true; finishTurn?.(); },
  };
  const ui = runNativeUI("codex", "/project", () => session, terminal);
  await tick();
  terminal.input("hello"); terminal.input("\r"); await tick();
  terminal.input("/exit"); terminal.input("\r"); await tick();
  expect(closed).toBe(false); expect(terminal.output).toContain("Nothing was stopped");
  expect(terminal.output).not.toContain(getCatalog("en").codexChat.commandNotAllowed({ name: "/exit" }));
  terminal.input("/exit!"); terminal.input("\r"); await ui;
  expect(closed).toBe(true); expect(terminal.stopped).toBe(true);
  // Idle: plain `/exit` leaves too.
  const idleTerminal = new TestTerminal(); let idleClosed = false;
  const idle = { ...session, busy: false, close() { idleClosed = true; } };
  const idleUi = runNativeUI("codex", "/project", () => idle, idleTerminal);
  await tick(); idleTerminal.input("/exit"); idleTerminal.input("\r"); await idleUi;
  expect(idleClosed).toBe(true);
});

/** A `commandExecution` item and its approval request, with the shape of the generated protocol (`v2/ThreadItem.ts`, `v2/CommandExecutionRequestApprovalParams.ts`). */
const commandExecution = {
  item: {
    type: "commandExecution", id: "i", command: "touch example", cwd: "/project", processId: null, source: "agent", status: "inProgress",
    commandActions: [{ type: "unknown", command: "touch example" }], aggregatedOutput: null, exitCode: null, durationMs: null, pluginId: null,
  },
  request: {
    kind: "command", threadId: "t", turnId: "u", itemId: "i", startedAtMs: 1790000000000, approvalId: null, environmentId: null,
    reason: "Needs to create a file", networkApprovalContext: null, command: "touch example", cwd: "/project",
    commandActions: [{ type: "unknown", command: "touch example" }], proposedExecpolicyAmendment: null, proposedNetworkPolicyAmendments: null,
  },
};

/**
 * With a Codex command permission open, the screen reads in plain words (what, where, the command) with «Yes»/«No» (or
 * «Sí»/«No») and the approving row marked, none of the event's JSON, and Enter alone approves. It exists because Codex's
 * request used to be printed as the whole event (`"type": "commandExecution"`, `"pluginId": null`…) with «/no» marked first.
 */
for (const locale of ["es", "en"] as const) {
  test(`a Codex command permission shows plain words and «${locale === "es" ? "Sí" : "Yes"}» marked, and Enter alone approves it (${locale})`, async () => {
    const { terminal, rpc, ui, enter, plain } = codexUi(locale);
    try {
      await tick(); enter("run something"); await tick();
      rpc.onNotification("item/started", { threadId: "t", turnId: "u", item: commandExecution.item });
      const answer = rpc.onRequest("item/commandExecution/requestApproval", commandExecution.request);
      await tick();
      const screen = plain();
      expect(screen).toContain("Needs to create a file");
      expect(screen).toContain(`${locale === "es" ? "Carpeta" : "Folder"}: /project`);
      expect(screen).toContain("touch example");
      expect(screen).toContain(`› ${locale === "es" ? "Sí" : "Yes"}`);
      for (const internal of ["\"type\"", "pluginId", "aggregatedOutput", "commandActions", "item/commandExecution/requestApproval", "/yes", "/no "]) expect(screen).not.toContain(internal);
      terminal.input("\r");
      expect(await answer).toEqual({ decision: "accept" });
      rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } });
      await tick();
    } finally { enter("/quit!"); await ui; }
  });
}

/** Every way of saying No on a Codex permission — Esc, the down arrow with Enter, the N key — declines, and none of them approves by accident. */
for (const [name, keys] of [["Esc", ["\x1b"]], ["the down arrow and Enter", ["\x1b[B", "\r"]], ["the N key", ["n"]]] as const) {
  test(`a Codex command permission is declined with ${name}`, async () => {
    const { terminal, rpc, ui, enter } = codexUi("es");
    try {
      await tick(); enter("run something"); await tick();
      rpc.onNotification("item/started", { threadId: "t", turnId: "u", item: commandExecution.item });
      const answer = rpc.onRequest("item/commandExecution/requestApproval", commandExecution.request);
      await tick();
      for (const key of keys) { terminal.input(key); await tick(); }
      expect(await answer).toEqual({ decision: "decline" });
      rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } });
      await tick();
    } finally { enter("/quit!"); await ui; }
  });
}
