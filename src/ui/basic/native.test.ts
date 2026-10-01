import { afterEach, beforeEach, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  /** What the screen asked to be told when the terminal changes size: calling it makes the next frame draw every row again, not just the rows that changed. */
  resize: () => void = () => {};
  start(input: (data: string) => void, resize: () => void = () => {}) { this.input = input; this.resize = resize; this.stopped = false; }
  stop() { this.stopped = true; }
  async drainInput() {}
  write(data: string) { this.output += data; }
  moveBy() {} hideCursor() {} showCursor() {} clearLine() {} clearFromCursor() {} clearScreen() {} setTitle() {} setProgress() {}
}
const tick = () => new Promise(resolve => setTimeout(resolve, 25));
/** Waits, a tick at a time, until `condition` holds (at most 60 ticks), instead of a fixed moment that a loaded machine overruns; the test's own expectation still decides. */
async function until(condition: () => boolean): Promise<void> { for (let i = 0; i < 60 && !condition(); i++) await tick(); }

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
  } finally { enter("/f614:quit"); await ui; }
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
  } finally { terminal.input("\x1b"); terminal.input("/f614:quit"); terminal.input("\r"); await ui; }
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
function codexUi(locale: "en" | "es" = "en", configure: (rpc: FixtureRpc) => void = () => {}, local = localDouble(), columns = 100, memoryHook?: () => Promise<boolean>) {
  const terminal = new TestTerminal(); const rpc = new FixtureRpc();
  terminal.columns = columns;
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
  const ui = runNativeUI("codex", "/project", (emit, approve) => session = new CodexSession(rpc, "/project", emit, approve, undefined, undefined, locale, memoryHook), terminal, undefined, locale, local.tools);
  const enter = (text: string) => { terminal.input(text); terminal.input("\r"); };
  const plain = () => stripVTControlCharacters(terminal.output);
  return { terminal, rpc, ui, enter, plain, session: () => session, local };
}
const savedPreferences = () => JSON.parse(readFileSync(join(forgeHome, "shell", "preferences.json"), "utf8"));

/** The opening sign is transcript content, so a real Codex chat shows it before any turn and its first person message removes it for this Shell opening, including after `/new`. */
test("a new Codex chat removes the FORGE614 sign after its first person message and never restores it on new", async () => {
  const { terminal, rpc, ui, enter, plain } = codexUi();
  try {
    await tick();
    expect(plain()).toContain("█▀▀▄");
    terminal.output = "";
    enter("first message"); await tick();
    expect(plain()).not.toContain("█▀▀▄");
    rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } });
    await tick(); terminal.output = "";
    enter("/new"); await tick();
    expect(plain()).not.toContain("█▀▀▄");
  } finally { enter("/f614:quit"); await ui; }
});

/**
 * `/review` is a turn of the assistant like any message, so it removes the opening sign too; before this it went straight to `session.startReview`
 * and the sign stayed on top of the review. The control: a full redraw before `/review` still shows the sign, so the redraw after it proves the sign is really gone and does not come back.
 */
test("/review removes the FORGE614 sign like any turn and it does not come back", async () => {
  const h = codexUi("en", rpc => rpc.replies.set("review/start", { turn: { id: "r", status: "inProgress" }, reviewThreadId: "t" }));
  try {
    await tick();
    h.terminal.columns = 101; h.terminal.output = ""; h.terminal.resize(); await tick();
    expect(h.plain()).toContain("█▀▀▄");
    h.enter("/review focus on security"); await tick();
    expect(h.rpc.calls.filter(call => call.method === "review/start")).toHaveLength(1);
    h.terminal.columns = 100; h.terminal.output = ""; h.terminal.resize(); await tick();
    expect(h.plain()).not.toContain("█▀▀▄");
    h.rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "r", status: "completed" } });
    await tick(); h.terminal.columns = 101; h.terminal.output = ""; h.terminal.resize(); await tick();
    expect(h.plain()).not.toContain("█▀▀▄");
  } finally {
    // The review turn ends here even when an expectation above failed, so leaving does not wait on «Quit anyway?» and the screen's warning listeners are given back.
    h.rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "r", status: "completed" } }); await tick();
    h.enter("/f614:quit"); await h.ui;
  }
});

/**
 * `/review` with no text opens the picker first: leaving it with Esc sends nothing, so it is no turn and the sign stays (only a review that really starts removes it).
 */
test("/review cancelled from its picker keeps the FORGE614 sign", async () => {
  const h = codexUi();
  try {
    await tick();
    h.enter("/review"); await tick();
    expect(h.plain()).toContain("1. Review against a base branch");
    h.terminal.input("\x1b"); await tick();
    expect(h.rpc.calls.some(call => call.method === "review/start")).toBe(false);
    h.terminal.columns = 101; h.terminal.output = ""; h.terminal.resize(); await tick();
    expect(h.plain()).toContain("█▀▀▄");
  } finally { h.enter("/f614:quit"); await h.ui; }
});

/**
 * Node prints every `process.emitWarning` raw on stderr, which lands on top of the screen Shell draws (it came out of a real photo: the Claude SDK's
 * «canUseTool will not be invoked» cut across the writing box). While the Codex screen is open Shell takes the warnings: the one the Claude SDK raises on purpose
 * (code `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`) says nothing at all, any other shows once in the chat as a muted line with the catalog's prefix and without «(node:<pid>)»,
 * and nothing reaches stderr. Both languages, with the exact words of each.
 */
test("while the Codex screen is open Node warnings do not reach stderr: the expected one is silent, another shows once in the chat", async () => {
  for (const [locale, shown] of [["en", "Node warning: Something odd happened"], ["es", "Aviso de Node: Something odd happened"]] as const) {
    const h = codexUi(locale); const stderr: string[] = []; const realWrite = process.stderr.write;
    try {
      await tick();
      process.stderr.write = ((chunk: string | Uint8Array) => { stderr.push(String(chunk)); return true; }) as typeof process.stderr.write;
      h.terminal.output = "";
      process.emitWarning("canUseTool will not be invoked: permissionMode 'bypassPermissions' auto-approves every tool call", { code: "CLAUDE_SDK_CAN_USE_TOOL_SHADOWED" });
      await tick(); await tick();
      expect(h.plain()).not.toContain("canUseTool");
      expect(h.plain()).not.toContain("Node warning"); expect(h.plain()).not.toContain("Aviso de Node");
      expect(stderr).toEqual([]);
      process.emitWarning("Something odd happened", { code: "SOME_OTHER_WARNING" });
      await tick(); await tick();
      expect(h.plain().split(shown)).toHaveLength(2);
      expect(h.plain()).not.toContain("(node:");
      expect(stderr).toEqual([]);
      // A long message stays on one row: it is cut with «…» and its end never reaches the chat.
      h.terminal.output = "";
      process.emitWarning(`${"long ".repeat(60)}THE-END`, { code: "SOME_OTHER_WARNING" });
      await tick(); await tick();
      expect(h.plain()).toContain("…");
      expect(h.plain()).not.toContain("THE-END");
      expect(stderr).toEqual([]);
    } finally { process.stderr.write = realWrite; h.enter("/f614:quit"); await h.ui; }
  }
});

/**
 * Shell only borrows the process's `warning` listeners while its screen is open: Node's own printer (the listener named `onWarning`) is taken out while it is open
 * and, on leaving, the listeners are exactly the ones there were before opening (same number, same functions, same order), with nothing of Shell's left hanging.
 */
test("the Codex screen takes Node's warning printer while it is open and gives back the very same warning listeners on leaving", async () => {
  const before = process.listeners("warning");
  expect(before.some(listener => listener.name === "onWarning")).toBe(true);
  const h = codexUi();
  try {
    await tick();
    expect(process.listeners("warning").some(listener => listener.name === "onWarning")).toBe(false);
    expect(process.listenerCount("warning")).toBe(before.length);
  } finally { h.enter("/f614:quit"); await h.ui; }
  const after = process.listeners("warning");
  expect(after).toHaveLength(before.length);
  for (const [index, listener] of before.entries()) expect(after[index]).toBe(listener);
});

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
  } finally { enter("/f614:quit"); await ui; }
});

/** Idea 1: with a permission question still open, Shift+Tab is not swallowed by it. */
test("Shift+Tab works while a Codex permission question is pending", async () => {
  const { terminal, rpc, ui, enter, plain, session } = codexUi();
  try {
    await tick(); enter("run something"); await tick();
    const answer = rpc.onRequest("item/commandExecution/requestApproval", { threadId: "t", turnId: "u", itemId: "i", command: "touch x" });
    // `/f614:no` only answers a question that is already open: wait for it on screen, or the answer never arrives and the test waits out its whole 5 seconds.
    await until(() => plain().includes(getCatalog("en").permission.question));
    terminal.input("\x1b[Z"); await until(() => session().collaborationMode() === "plan");
    expect(session().collaborationMode()).toBe("plan");
    enter("/f614:no"); expect(await answer).toEqual({ decision: "decline" });
    rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } });
    await tick();
  } finally { enter("/f614:quit"); await ui; }
});

/**
 * Came out of the third real-account test, with Codex: while a permission question waits for the person the box said «Working». It says «Waiting for your answer»
 * ("Esperando tu respuesta" in Spanish) while the question is open, and once it is answered, with the turn still running, it says «Working» again.
 */
test("with Codex the box says it waits for the person's answer while a permission question is open, and Working again after", async () => {
  const pause = () => new Promise(resolve => setTimeout(resolve, 600));
  for (const [locale, waiting, working] of [["en", "Waiting for your answer", "Working"], ["es", "Esperando tu respuesta", "Trabajando"]] as const) {
    const { terminal, rpc, ui, enter, plain } = codexUi(locale);
    try {
      await tick(); enter("run something"); await tick(); await pause();
      expect(plain()).toContain(working);
      terminal.output = "";
      const answer = rpc.onRequest("item/commandExecution/requestApproval", { threadId: "t", turnId: "u", itemId: "i", command: "touch x" });
      await tick(); await pause();
      expect(plain()).toContain(waiting);
      expect(plain()).not.toContain(working);
      terminal.output = "";
      enter("/f614:no"); expect(await answer).toEqual({ decision: "decline" });
      await tick(); await pause();
      expect(plain()).toContain(working);
      expect(plain()).not.toContain(waiting);
      rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } });
      await tick();
    } finally { enter("/f614:quit"); await ui; }
  }
}, 20000);

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
  } finally { enter("/f614:quit"); await ui; }
});

/**
 * Idea 23: a native command Shell cannot pass to Codex gets an honest one-line answer instead of «Unknown command». Every command of Codex's list is connected now, so the
 * case left is a session that has no request for it (another assistant, an older adapter): a stand-in without `/recap` stands for it.
 */
test("a command Shell cannot pass to Codex says so honestly, in English and in Spanish", async () => {
  for (const locale of ["en", "es"] as const) {
    const terminal = new TestTerminal();
    const ui = runNativeUI("codex", "/project", () => sessionWithThreeSameTitle([]), terminal, undefined, locale);
    try {
      await tick(); terminal.input("/recap"); terminal.input("\r"); await tick();
      const text = stripVTControlCharacters(terminal.output);
      expect(text).toContain(getCatalog(locale).codexChat.commandNotAllowed({ name: "/recap" }));
      expect(text).not.toContain(getCatalog(locale).chat.unknownCommand({ name: "/recap" }));
    } finally { terminal.input("/f614:quit"); terminal.input("\r"); await ui; }
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
  } finally { enter("/f614:quit"); await ui; }
});

/** Idea 7: opening Shell again puts the saved mode back without asking, even the full-access one. */
test("Codex reopens in the saved work mode without asking", async () => {
  mkdirSync(join(forgeHome, "shell"), { recursive: true });
  writeFileSync(join(forgeHome, "shell", "preferences.json"), JSON.stringify({ codex: { mode: "never:danger-full-access" } }));
  const { ui, enter, session } = codexUi();
  try {
    await tick();
    expect(session().workMode()).toBe("never:danger-full-access");
  } finally { enter("/f614:quit"); await ui; }
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
  } finally { enter("/f614:quit"); await ui; }
});

/**
 * The owner's rule: the marked «Yes» is only for the permissions the assistant asks; a question of Shell's own that disconnects goes out with «No» marked and its own
 * words. With Codex, `/logout` shows «Disconnect Codex from this Shell?» with «No, stay connected» marked and «Yes, disconnect»; it never shows the permission
 * card («Permission requested», «Allow?»). Enter alone and Esc keep the connection and call nothing; only picking «Yes» disconnects, and even then Codex's own
 * `account/logout` is never called (the native account stays). Also in Spanish.
 */
test("Codex /logout asks with its own question and «No» marked: Enter alone and Esc keep the connection, only «Yes» disconnects", async () => {
  for (const locale of ["en", "es"] as const) {
    const t = getCatalog(locale);
    const terminal = new TestTerminal(); const rpc = new FixtureRpc();
    rpc.replies.set("initialize", {});
    rpc.replies.set("account/read", { account: null, requiresOpenaiAuth: true });
    rpc.replies.set("model/list", { data: [], nextCursor: null });
    rpc.replies.set("account/logout", {});
    const plain = () => stripVTControlCharacters(terminal.output);
    const ui = runNativeUI("codex", "/project", (emit, approve) => new CodexSession(rpc, "/project", emit, approve, undefined, undefined, locale), terminal, undefined, locale);
    const enter = (text: string) => { terminal.input(text); terminal.input("\r"); };
    const question = t.logout.confirmTitle({ engine: "Codex" });
    try {
      await tick(); terminal.output = ""; enter("/logout"); await tick();
      expect(plain()).toContain(question);
      expect(plain()).toContain(`▎ 1. ${t.logout.stay}`);
      expect(plain()).toContain(t.logout.disconnect);
      expect(plain()).not.toContain(`▎ 2. ${t.logout.disconnect}`);
      expect(plain()).not.toContain(t.chat.permissionRequestedTitle);
      expect(plain()).not.toContain(t.permission.question);
      expect(plain()).not.toContain("/f614:stop");
      // Enter alone is «No».
      terminal.output = ""; terminal.input("\r"); await tick();
      expect(plain()).toContain(t.codexSession.logoutCancelled.slice(0, 30));
      expect(plain()).not.toContain(t.codexSession.disconnectedLocally.slice(0, 30));
      // Esc is «No».
      terminal.output = ""; enter("/logout"); await tick(); terminal.input("\x1b"); await tick();
      expect(plain()).toContain(t.codexSession.logoutCancelled.slice(0, 30));
      expect(plain()).not.toContain(t.codexSession.disconnectedLocally.slice(0, 30));
      // Picking «Yes» disconnects.
      terminal.output = ""; enter("/logout"); await tick(); terminal.input("\x1b[B"); terminal.input("\r"); await tick();
      expect(plain()).toContain(t.codexSession.disconnectedLocally.slice(0, 30));
      expect(rpc.calls.some(c => c.method === "account/logout")).toBe(false);
    } finally { enter("/f614:quit"); await ui; }
  }
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
  } finally { terminal.input("/f614:quit"); terminal.input("\r"); await ui; }
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
  } finally { terminal.input("/f614:quit"); terminal.input("\r"); await ui; }
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
  terminal.input("/f614:no"); terminal.input("\r"); expect(await permission).toBe(false);
  terminal.input("/quit"); terminal.input("\r"); await tick();
  expect(closed).toBe(false); expect(terminal.output).toContain("Nothing was stopped");
  // Shell's own `/f614:quit` asks first while the turn runs; «Yes» stops it and leaves.
  terminal.input("/f614:quit"); terminal.input("\r"); await tick();
  expect(closed).toBe(false); expect(stripVTControlCharacters(terminal.output)).toContain("Quit anyway?");
  terminal.input("\x1b[B"); terminal.input("\r"); await ui;
  expect(closed).toBe(true); expect(terminal.stopped).toBe(true);
});

/** Mejora 14 en Codex: mientras un comando corre, el indicador dice «Working · <comando> · <tiempo legible>»; cuando no hay ninguno, solo «Working · <tiempo>». Se lee de `currentActivity()` de la sesión, sin mirar el id del motor. */
test("the working indicator names the running command for a native session, and only the time when there is none", async () => {
  const terminal = new TestTerminal(); let finishTurn!: () => void; let activity: string | undefined = "gh pr checks 3 --watch";
  terminal.columns = 200; // the status shares its row with the mode text now, so the command only stays whole on a wide screen
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
  } finally { terminal.input("/f614:quit"); terminal.input("\r"); await tick(); terminal.input("\x1b[B"); terminal.input("\r"); await ui; } // the turn is still open: «Quit anyway?» → «Yes»
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
  } finally { enter("/f614:quit"); await ui; }
});

/** Mejora 8: escribir filtra (sin mayúsculas ni acentos, también por primer mensaje) y Esc cancela sin retomar nada ni cambiar la conversación. El buffer de TestTerminal suma cada cuadro, así que contar «History restored» ya no mide retomadas: el repintado centrado vuelve a dibujar el historial; la lista de retomadas sí es el efecto real. */
test("/resume filters by what is typed and Esc cancels without resuming anything", async () => {
  const terminal = new TestTerminal(); const resumed: string[] = [];
  const ui = runNativeUI("codex", "/project", () => sessionWithThreeSameTitle(resumed), terminal);
  const enter = (value: string) => { terminal.input(value); terminal.input("\r"); };
  try {
    await tick(); enter("/resume"); await tick();
    for (const char of "BETA-MESS") terminal.input(char);
    await tick(); terminal.input("\r"); await tick();
    expect(resumed).toEqual(["thread-mid"]);
    const resumedBeforeCancel = [...resumed];
    enter("/resume"); await tick(); terminal.input("\x1b"); await tick();
    expect(resumed).toEqual(resumedBeforeCancel);
  } finally { enter("/f614:quit"); await ui; }
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
  } finally { enter("/f614:quit"); await ui; }
  const emptyTerminal = new TestTerminal();
  const emptyUi = runNativeUI("codex", "/project", () => ({ ...sessionWithThreeSameTitle([]), async listSessions() { return []; } }), emptyTerminal);
  try {
    await tick(); emptyTerminal.input("/resume"); emptyTerminal.input("\r"); await tick();
    expect(stripVTControlCharacters(emptyTerminal.output)).toContain(getCatalog("en").chat.noSessionsFound);
  } finally { emptyTerminal.input("/f614:quit"); emptyTerminal.input("\r"); await emptyUi; }
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
    } finally { h.enter("/f614:quit"); await h.ui; }
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
  } finally { h.enter("/f614:quit"); await h.ui; }
});

/** `/rename` with no name says how to use it and calls nothing; with no conversation open there is nothing to rename and the person is told. */
test("/rename without a name shows its usage and without a conversation says there is nothing to rename", async () => {
  const h = codexUi("en", rpc => rpc.replies.set("thread/name/set", {}));
  try {
    await withConversation(h);
    h.enter("/rename"); await tick();
    expect(h.plain()).toContain(getCatalog("en").codexCommands.renameUsage);
    expect(h.rpc.calls.some(call => call.method === "thread/name/set")).toBe(false);
  } finally { h.enter("/f614:quit"); await h.ui; }
  const empty = codexUi("en", rpc => rpc.replies.set("thread/name/set", {}));
  try {
    await tick(); empty.enter("/rename Something"); await tick();
    expect(empty.plain()).toContain(describeError(new ShellError("codex-command-needs-conversation"), "en"));
    expect(empty.rpc.calls.some(call => call.method === "thread/name/set")).toBe(false);
  } finally { empty.enter("/f614:quit"); await empty.ui; }
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
    } finally { h.enter("/f614:quit"); await h.ui; }
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
  } finally { h.enter("/f614:quit"); await h.ui; }
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
  } finally { h.enter("/f614:quit"); await h.ui; }
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

/**
 * A command on Codex's official list that the session cannot pass on answers with the honest message (a stand-in session without `/side`, since every command is connected
 * on the real one); a name that is not Codex's at all is an unknown command.
 */
test("an official command the session lacks is answered honestly and a made-up one is unknown, in both languages", async () => {
  for (const locale of ["en", "es"] as const) {
    const terminal = new TestTerminal();
    const ui = runNativeUI("codex", "/project", () => sessionWithThreeSameTitle([]), terminal, undefined, locale);
    const enter = (text: string) => { terminal.input(text); terminal.input("\r"); };
    const plain = () => stripVTControlCharacters(terminal.output);
    try {
      await tick();
      enter("/side"); await tick();
      expect(plain()).toContain(getCatalog(locale).codexChat.commandNotAllowed({ name: "/side" }));
      expect(plain()).not.toContain(getCatalog(locale).chat.unknownCommand({ name: "/side" }));
      enter("/nope"); await tick();
      expect(plain()).toContain(getCatalog(locale).chat.unknownCommand({ name: "/nope" }));
      expect(plain()).not.toContain(getCatalog(locale).codexChat.commandNotAllowed({ name: "/nope" }));
    } finally { enter("/f614:quit"); await ui; }
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
  } finally { h.enter("/f614:quit"); await h.ui; }
});

/**
 * The `$` autocomplete lists Codex's own catalog (`skills/list`). Choosing a skill with Enter (or Tab) only puts «$review-pr »
 * in the box, like Codex: the person goes on writing and the next Enter sends the whole message, which reaches Codex as text plus
 * a real skill item with its path. Changed after the real-account test, where Enter sent «$find-skills» alone at once.
 */
for (const key of ["\r", "\t"]) {
  test(`$ autocompletes from skills/list; ${key === "\r" ? "Enter" : "Tab"} on a skill fills the box and the next Enter sends it as a skill item`, async () => {
    const h = codexUi("en", rpc => rpc.replies.set("skills/list", skillCatalog));
    try {
      await tick(); h.terminal.output = ""; h.terminal.input("$rev"); await tick();
      expect(h.plain()).toContain("Review a pull request");
      expect(h.plain()).toContain("CODEX SKILLS");
      expect(h.plain()).toContain("Skills · 1–1 of 1");
      h.terminal.input(key); await tick(); await tick();
      expect(h.rpc.calls.some(call => call.method === "turn/start")).toBe(false);
      h.terminal.input("check the PR"); await tick();
      h.terminal.input("\r"); await tick(); await tick();
      const turn = h.rpc.calls.find(call => call.method === "turn/start")!;
      expect(turn.params.input).toEqual([
        { type: "text", text: "$review-pr check the PR" },
        { type: "skill", name: "review-pr", path: "/project/.agents/skills/review-pr/SKILL.md" },
      ]);
      h.rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } });
      await tick();
    } finally { h.enter("/f614:quit"); await h.ui; }
  });
}

/** In Spanish the `$` list is titled and counted as skills («HABILIDADES DE CODEX», «Habilidades · 1–1 de 1»), never «Comandos». */
test("the $ list reads «HABILIDADES DE CODEX» and «Habilidades · 1–1 de 1» in Spanish", async () => {
  const h = codexUi("es", rpc => rpc.replies.set("skills/list", skillCatalog));
  try {
    await tick(); h.terminal.output = ""; h.terminal.input("$rev"); await tick();
    expect(h.plain()).toContain("HABILIDADES DE CODEX");
    expect(h.plain()).toContain("Habilidades · 1–1 de 1");
    expect(h.plain()).not.toContain("Comandos · 1");
    h.terminal.input("\x1b"); for (let i = 0; i < 4; i++) h.terminal.input("\x7f"); await tick();
  } finally { h.enter("/f614:quit"); await h.ui; }
});

/**
 * Came out of the real-account test: after typing `/compact` the box said «Ready» for seconds and only later «Working». As Codex does
 * (`chatwidget/compaction.rs:6-7`, «Compacting context» / «Making room to continue.»), the box says so at once, with the time going
 * up, until «Conversation compacted.» Codex reports no real progress, so there is no bar.
 */
test("/compact shows «Compacting context · Making room to continue · Ns» at once, counting up, until it is done", async () => {
  const h = codexUi("en", () => {}, localDouble(), 160); // wide enough for the whole line next to the sidebar; narrower boxes drop the middle part (composer.test.ts)
  try {
    await withConversation(h);
    const before = h.terminal.output.length;
    const since = () => stripVTControlCharacters(h.terminal.output.slice(before));
    h.enter("/compact"); await tick();
    expect(since()).toContain("Compacting context · Making room to continue · 0s");
    for (let i = 0; i < 80 && !since().includes("Making room to continue · 1s"); i++) await tick();
    expect(since()).toContain("Compacting context · Making room to continue · 1s");
    const finished = h.terminal.output.length;
    h.rpc.onNotification("turn/started", { threadId: "t", turn: { id: "c1" } });
    h.rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "c1", status: "completed" } });
    await tick(); await tick();
    const after = stripVTControlCharacters(h.terminal.output.slice(finished));
    expect(after).toContain("Conversation compacted.");
    expect(after).toContain(getCatalog("en").chat.statusReady);
  } finally { h.enter("/f614:quit"); await h.ui; }
});

/** The same in Spanish, in the words of Shell's catalog (only command and mode names stay as in Codex). */
test("/compact says «Compactando el contexto · Haciendo espacio para continuar» in Spanish", async () => {
  const h = codexUi("es", () => {}, localDouble(), 160);
  try {
    await withConversation(h);
    const before = h.terminal.output.length;
    h.enter("/compact"); await tick();
    expect(stripVTControlCharacters(h.terminal.output.slice(before))).toContain("Compactando el contexto · Haciendo espacio para continuar · 0s");
    h.rpc.onNotification("turn/started", { threadId: "t", turn: { id: "c1" } });
    h.rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "c1", status: "completed" } });
    await tick(); await tick();
  } finally { h.enter("/f614:quit"); await h.ui; }
});

/**
 * Came out of the real-account test: `/f614:stop` on a stuck turn waited for `turn/interrupt` to time out. When Codex says there is
 * no active turn, Shell ends the turn on its side, says so once (in the person's language) and does not add «cancellation requested».
 */
test("/f614:stop when Codex says there is no active turn frees the box and says so once", async () => {
  const h = codexUi("es");
  try {
    await tick(); h.enter("trabajo largo"); await tick();
    expect(h.session().busy).toBe(true);
    h.rpc.handler = async method => { if (method === "turn/interrupt") throw new Error("no active turn to interrupt"); throw new Error(`Unexpected ${method}`); };
    const before = h.terminal.output.length;
    h.enter("/f614:stop"); await tick(); await tick();
    const shown = stripVTControlCharacters(h.terminal.output.slice(before));
    expect(h.session().busy).toBe(false);
    expect(shown).toContain("Codex dice que no había ningún turno en marcha");
    expect(shown).not.toContain(getCatalog("es").codexChat.cancellationRequested.slice(0, 22));
    expect(shown).toContain(getCatalog("es").chat.statusReady);
  } finally { h.enter("/f614:quit"); await h.ui; }
});

/**
 * Came out of the real-account test: after `/resume` every old message carried the time of now. Each one shows its turn's time from the protocol
 * (`v2/Turn.ts` `startedAt` for what the person wrote); an answer whose time Codex did not give shows none.
 */
test("/resume draws each old message with the time of its turn and no time when Codex gave none", async () => {
  const startedAt = Math.floor(new Date(2026, 8, 29, 11, 52).getTime() / 1000);
  const h = codexUi("en", rpc => rpc.replies.set("thread/read", { thread: { id: "old", cwd: "/project", status: { type: "idle" }, turns: [{
    id: "a", items: [
      { type: "userMessage", id: "i1", clientId: null, content: [{ type: "text", text: "Plan a hello.sh script", text_elements: [] }] },
      { type: "agentMessage", id: "i2", text: "Here is the plan", phase: null, memoryCitation: null, delivery: null, questions: null },
    ], itemsView: "full", status: "interrupted", error: null, startedAt, completedAt: null, durationMs: null,
  }] } }));
  try {
    await tick();
    const before = h.terminal.output.length;
    h.enter("/resume old"); await tick(); await tick();
    const shown = stripVTControlCharacters(h.terminal.output.slice(before));
    const roles = getCatalog("en").chatRoles;
    expect(shown).toContain(`${roles.you} · ${new Date(startedAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
    expect(shown).toContain("Plan a hello.sh script");
    expect(shown).toContain("Here is the plan");
    expect(shown).toContain(roles.assistant);
    expect(shown).not.toContain(`${roles.assistant} · `);
  } finally { h.enter("/f614:quit"); await h.ui; }
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
  } finally { h.enter("/f614:quit"); await h.ui; }
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
  } finally { h.enter("/f614:quit"); await h.ui; }
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
  } finally { first.enter("/f614:quit"); await first.ui; }
  const second = codexUi();
  try {
    await tick();
    expect(second.session().workMode()).toBe("on-request:workspace-write");
    expect(second.plain()).not.toContain(notice);
  } finally { second.enter("/f614:quit"); await second.ui; }
});

/**
 * With Codex, Shift+Tab is Codex's own (`chatwidget/interaction.rs:224`, `collaboration_modes.rs` `next_mask`):
 * it switches Default ↔ Plan in the list's order and never touches the permissions. The indicator shows Codex's
 * «Plan mode» next to the permission, and its help says what Shift+Tab does now.
 */
test("Shift+Tab with Codex switches Plan and Default, keeps the permission, and the indicator says so", async () => {
  mkdirSync(join(forgeHome, "shell"), { recursive: true });
  writeFileSync(join(forgeHome, "shell", "preferences.json"), JSON.stringify({ codex: { mode: "never:danger-full-access" } }));
  const h = codexUi("en", () => {}, localDouble(), 200); // the status shares its row with the mode text now: the help (on the right) needs a wide screen
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
  } finally { h.enter("/f614:quit"); await h.ui; }
});

/** Shell remembers the collaboration mode too and puts it back on opening, without asking. */
test("Codex reopens in the saved collaboration mode", async () => {
  mkdirSync(join(forgeHome, "shell"), { recursive: true });
  writeFileSync(join(forgeHome, "shell", "preferences.json"), JSON.stringify({ codex: { collaborationMode: "plan" } }));
  const h = codexUi();
  try {
    await tick();
    expect(h.session().collaborationMode()).toBe("plan");
  } finally { h.enter("/f614:quit"); await h.ui; }
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
  } finally { h.enter("/f614:quit"); await h.ui; }
});

/**
 * A command that only exists in Codex's own screen gets its own answer, and one the session lacks keeps the honest «not from Shell yet» (a stand-in session without
 * `/subagents`; on the real one it is connected). `/agents` is no longer screen-only: it answers «Shared agents unavailable». Both languages.
 */
test("screen-only Codex commands and commands the session lacks answer with their own messages", async () => {
  for (const locale of ["en", "es"] as const) {
    const h = codexUi(locale);
    try {
      // `/rollout` is typed (Codex's menu hides it, so no suggestion replaces it); aliases such as `/pet` are covered in commands.test.ts.
      await tick(); h.enter("/theme"); await tick(); h.enter("/rollout"); await tick();
      expect(h.plain()).toContain(getCatalog(locale).codexCommands.screenOnly({ name: "/theme" }));
      expect(h.plain()).toContain(getCatalog(locale).codexCommands.screenOnly({ name: "/rollout" }));
      expect(h.plain()).not.toContain(getCatalog(locale).codexChat.commandNotAllowed({ name: "/theme" }));
    } finally { h.enter("/f614:quit"); await h.ui; }
    const terminal = new TestTerminal();
    const ui = runNativeUI("codex", "/project", () => sessionWithThreeSameTitle([]), terminal, undefined, locale);
    try {
      await tick(); terminal.input("/subagents"); terminal.input("\r"); await tick();
      expect(stripVTControlCharacters(terminal.output)).toContain(getCatalog(locale).codexChat.commandNotAllowed({ name: "/subagents" }));
    } finally { terminal.input("/f614:quit"); terminal.input("\r"); await ui; }
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
  } finally { h.enter("/f614:quit"); await h.ui; }
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
    } finally { h.enter("/f614:quit"); await h.ui; }
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
  } finally { h.enter("/f614:quit"); await h.ui; }
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
  } finally { h.enter("/f614:quit"); await h.ui; }
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
  } finally { h.enter("/f614:quit"); await h.ui; }
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
  } finally { h.enter("/f614:quit"); await h.ui; }
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
    } finally { h.enter("/f614:quit"); await h.ui; }
  }
  const h = codexUi("en", rpc => rpc.replies.set("review/start", { turn: { id: "r", status: "inProgress" }, reviewThreadId: "t" }));
  try {
    await withConversation(h);
    h.enter("/review focus on security"); await tick();
    expect(h.rpc.calls.filter(call => call.method === "review/start").map(call => call.params)).toEqual([{ threadId: "t", target: { type: "custom", instructions: "focus on security" }, delivery: "inline" }]);
    h.rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "r", status: "completed" } });
    await tick();
  } finally { h.enter("/f614:quit"); await h.ui; }
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
  } finally { h.enter("/f614:quit"); await h.ui; }
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
  } finally { h.enter("/f614:quit"); await h.ui; }
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
  } finally { h.enter("/f614:quit"); await h.ui; }
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
  } finally { h.enter("/f614:quit"); await h.ui; }
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
  } finally { h.enter("/f614:quit"); await h.ui; }
});
/** The start of «Unknown command: <name>.» without the hint that follows (it wraps on screen, and the hint has its own exact-value check). */
const unknownStart = (locale: "en" | "es", name: string) => getCatalog(locale).chat.unknownCommand({ name }).replace(/ (Use|Usa) .*$/, "");

/**
 * In Codex `/exit` and `/quit` are the same command («exit Codex»), so with Codex both close Shell the same way: they refuse
 * while work is in progress and leave when idle. Stopping what runs and leaving is Shell's own `/f614:quit`, which asks first
 * (see the «Quit anyway?» test); the old `/quit!` and `/exit!` no longer exist. It exists because 1.12.0 moved the forced exit
 * out of the unprefixed names and Codex's own `/quit` and `/exit` must keep working exactly as in Codex's terminal.
 */
test("/exit and /quit with Codex refuse while work runs and leave when idle; /f614:quit asks first; /quit! and /exit! are unknown", async () => {
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
  // The old forced exits are unknown commands (checked idle: while Codex works, any name that is not Codex's asks to wait first).
  for (const name of ["/exit!", "/quit!"]) {
    terminal.output = ""; terminal.input(name); terminal.input("\r"); await tick();
    expect(closed, name).toBe(false);
    expect(stripVTControlCharacters(terminal.output), name).toContain(unknownStart("en", name));
  }
  terminal.input("hello"); terminal.input("\r"); await tick();
  const refusal = getCatalog("en").codexChat.workOrLoginActive;
  for (const name of ["/exit", "/quit"]) {
    terminal.output = ""; terminal.input(name); terminal.input("\r"); await tick();
    expect(closed, name).toBe(false);
    expect(stripVTControlCharacters(terminal.output), name).toContain("Nothing was stopped");
    expect(stripVTControlCharacters(terminal.output), name).not.toContain(getCatalog("en").codexChat.commandNotAllowed({ name }));
  }
  // The refusal names the command that leaves (it asks before stopping anything), with its prefix.
  expect(refusal).toBe("Work or login is active. Use /f614:quit to leave: it asks before stopping anything. Nothing was stopped.");
  terminal.input("\x03"); await tick();
  expect(closed).toBe(false); // Ctrl+C is `/f614:quit`: it asks, and nothing is stopped until the answer is «Yes»
  terminal.input("\x1b"); await tick();
  expect(closed).toBe(false);
  terminal.input("/f614:quit"); terminal.input("\r"); await tick();
  terminal.input("\x1b[B"); terminal.input("\r"); await ui;
  expect(closed).toBe(true); expect(terminal.stopped).toBe(true);
  // Idle: plain `/exit`, plain `/quit`, Ctrl+D and `/f614:quit` all leave.
  for (const keys of [["/exit", "\r"], ["/quit", "\r"], ["\x04"], ["/f614:quit", "\r"]]) {
    const idleTerminal = new TestTerminal(); let idleClosed = false;
    const idle = { ...session, busy: false, close() { idleClosed = true; } };
    const idleUi = runNativeUI("codex", "/project", () => idle, idleTerminal);
    await tick(); for (const key of keys) idleTerminal.input(key); await idleUi;
    expect(idleClosed, keys.join("")).toBe(true);
  }
});

/**
 * `/f614:quit` is Shell's way out with any assistant (owner, 2026-09-29: «ese quit debería ser para todos»), and Ctrl+C and Ctrl+D
 * do the same. Idle they leave at once; while a turn runs they ask «Quit anyway? What is running will be stopped.» with «No»
 * marked (stopping work cannot be undone), so Enter and Esc keep everything and only «Yes» stops and leaves. It exists because
 * the real-account test of 1.12.0 showed the forced exit had no obvious place: the owner typed `/quit` and the menu did not list it.
 */
test("with Codex /f614:quit, Ctrl+C and Ctrl+D leave when idle and ask first while work runs, with No marked", async () => {
  const question = { en: "Quit anyway? What is running will be stopped.", es: "¿Salir de todos modos? Se detendrá lo que está en curso." };
  const words = { en: { yes: "Yes", no: "No", yesKey: "y" }, es: { yes: "Sí", no: "No", yesKey: "s" } };
  const ways: [string, string[]][] = [["/f614:quit", ["/f614:quit", "\r"]], ["Ctrl+C", ["\x03"]], ["Ctrl+D", ["\x04"]]];
  for (const locale of ["en", "es"] as const) {
    for (const [way, keys] of ways) {
      const name = `${locale} ${way}`;
      const make = () => {
        const terminal = new TestTerminal(); let closed = false; let finishTurn: (() => void) | undefined;
        const session = {
          busy: false, models: [],
          async initialize() {}, async login() {}, async cancel() {}, reset() {}, async resume(_id: string) {},
          async listSessions() { return []; }, async setModel(_id: string) {}, async setEffort(_effort: string) {},
          status() { return ["native status"]; },
          async send(_text: string) { session.busy = true; await new Promise<void>(resolve => { finishTurn = resolve; }); session.busy = false; },
          close() { closed = true; finishTurn?.(); },
        };
        const ui = runNativeUI("codex", "/project", () => session, terminal, undefined, locale);
        return { terminal, ui, closed: () => closed, plain: () => stripVTControlCharacters(terminal.output) };
      };
      // Idle: it leaves at once and never asks.
      const idle = make(); await tick();
      idle.terminal.output = ""; for (const key of keys) idle.terminal.input(key); await idle.ui;
      expect(idle.closed(), name).toBe(true);
      expect(idle.plain(), name).not.toContain(question[locale]);
      // While a turn runs: it asks, with «No» marked.
      const busy = make(); await tick();
      busy.terminal.input("hello"); busy.terminal.input("\r"); await tick();
      busy.terminal.output = ""; for (const key of keys) busy.terminal.input(key); await tick();
      expect(busy.plain(), name).toContain(question[locale]);
      expect(busy.plain(), name).toContain(`▎ ${words[locale].no}`);
      expect(busy.plain(), name).not.toContain(`▎ ${words[locale].yes}`);
      // Enter takes the marked «No»: nothing is stopped.
      busy.terminal.input("\r"); await tick();
      expect(busy.closed(), name).toBe(false);
      // Esc is «No» too.
      for (const key of keys) busy.terminal.input(key); await tick();
      busy.terminal.input("\x1b"); await tick();
      expect(busy.closed(), name).toBe(false);
      // «Yes» (the arrow, then Enter; the row's first letter works too) stops the work and leaves.
      for (const key of keys) busy.terminal.input(key); await tick();
      busy.terminal.input(way === "Ctrl+D" ? words[locale].yesKey : "\x1b[B"); if (way !== "Ctrl+D") busy.terminal.input("\r");
      await busy.ui;
      expect(busy.closed(), name).toBe(true);
    }
  }
});

/**
 * Codex's `/status` shows the reset moment of each limit in local time and in Shell's language, and no machine date. It exists
 * because the real-account test of 1.12.0 showed «codex primary: 14% usado · se reinicia 2026-10-03T23:22:22.000Z (último reporte)». The limit is now named by
 * its window («Usage limit» when Codex reports none), never «codex primary»; `outside-commands.test.ts` covers the named windows.
 * The reset is built with the local constructor, so the expected text does not depend on the time zone of the machine.
 */
test("with Codex /status shows the reset moment in local time, in es and en, and no ISO date", async () => {
  const reset = Math.floor(new Date(2026, 9, 3, 17, 22, 22).getTime() / 1000);
  const expected = {
    en: "Usage limit: 14% used · resets Oct 3, 5:22 PM (last report)",
    es: "Límite de uso: 14% usado · se reinicia el 3 oct, 5:22 p.m. (último reporte)",
  };
  for (const locale of ["en", "es"] as const) {
    const h = codexUi(locale, rpc => rpc.replies.set("account/rateLimits/read", { rateLimits: { primary: { usedPercent: 14, resetsAt: reset } } }), undefined, 220);
    try {
      await tick(); await tick();
      h.terminal.output = ""; h.enter("/status"); await tick();
      expect(h.plain(), locale).toContain(expected[locale]);
      expect(h.plain(), locale).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    } finally { h.enter("/f614:quit"); await h.ui; }
  }
});

/**
 * Every Shell command with Codex answers to `/f614:<name>` and does what its unprefixed name did before 1.12.0: `/f614:login`
 * connects the account (there is no `/login` in Codex), `/f614:refresh` asks Codex for the quotas again, `/f614:help` and
 * `/f614:commands` open Shell's command menu, `/f614:yes` and `/f614:no` answer a pending permission.
 */
test("with Codex each Shell command answers to /f614:<name> and does what the old name did", async () => {
  const h = codexUi("en", rpc => rpc.replies.set("account/rateLimits/read", { rateLimits: { primary: { usedPercent: 12, resetsAt: 1_800_000_000 } } }));
  try {
    await tick();
    h.enter("/f614:login"); await tick(); await tick();
    expect(h.plain()).toContain(getCatalog("en").codexSession.connectedExistingAccount.slice(0, 40));
    const before = h.rpc.calls.filter(call => call.method === "account/rateLimits/read").length;
    h.enter("/f614:refresh"); await tick(); await tick();
    expect(h.rpc.calls.filter(call => call.method === "account/rateLimits/read")).toHaveLength(before + 1);
    for (const name of ["/f614:help", "/f614:commands"]) {
      h.terminal.output = ""; h.enter(name); await tick();
      expect(h.plain(), name).toContain("Commands · 1–5 of");
      h.terminal.input("\x1b"); await tick();
    }
    h.enter("work please"); await tick();
    const allowed = h.rpc.onRequest("item/commandExecution/requestApproval", { threadId: "t", turnId: "u", itemId: "i", command: "touch x" });
    await tick(); h.enter("/f614:yes");
    expect(await allowed).toEqual({ decision: "accept" });
    const denied = h.rpc.onRequest("item/commandExecution/requestApproval", { threadId: "t", turnId: "u", itemId: "j", command: "touch y" });
    await tick(); h.enter("/f614:no");
    expect(await denied).toEqual({ decision: "decline" });
    h.rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } });
    await tick();
  } finally { h.enter("/f614:quit"); await h.ui; }
});

/**
 * With Codex a slash command without prefix is Codex's or nothing: the names Shell used to answer (`/login`, `/refresh`,
 * `/yes`, `/no`, `/commands`, `/help`, `/quit!`, `/exit!`, `/forge614-status`) and the ones Codex does not have (`/effort` and
 * `/thinking`: the effort lives inside `/model`) are unknown commands, and none of them reaches Codex. It exists so that no
 * silent alias survives the move to `/f614:`. `/f614:status` is Claude Code's own telemetry and does not exist with Codex,
 * whose `/status` is already Codex's.
 */
test("with Codex the old unprefixed Shell names are unknown commands and call nothing", async () => {
  for (const locale of ["en", "es"] as const) {
    const h = codexUi(locale);
    try {
      await tick();
      const calls = h.rpc.calls.length;
      for (const name of ["/login", "/refresh", "/yes", "/no", "/commands", "/help", "/quit!", "/exit!", "/forge614-status", "/effort", "/thinking", "/f614:status"]) {
        h.terminal.output = ""; h.enter(name); await tick();
        expect(h.plain(), `${locale} ${name}`).toContain(unknownStart(locale, name));
        expect(h.plain(), `${locale} ${name}`).not.toContain(getCatalog(locale).codexChat.commandNotAllowed({ name }));
      }
      expect(h.rpc.calls).toHaveLength(calls);
    } finally { h.enter("/f614:quit"); await h.ui; }
  }
  expect(getCatalog("en").chat.unknownCommand({ name: "/help" })).toBe("Unknown command: /help. Use /f614:help.");
  expect(getCatalog("es").chat.unknownCommand({ name: "/help" })).toBe("Comando desconocido: /help. Usa /f614:help.");
});

/** Codex's own commands keep working without a prefix, and `/status` is still Codex's (folder, work mode and conversation). */
test("with Codex /status and /new stay Codex's own, without a prefix", async () => {
  const h = codexUi();
  try {
    await withConversation(h);
    h.terminal.output = ""; h.enter("/status"); await tick();
    expect(h.plain()).toContain(getCatalog("en").codexSession.folderLine({ path: "/project" }));
    h.enter("/new"); await tick();
    expect(h.plain()).not.toContain(getCatalog("en").chat.unknownCommand({ name: "/new" }));
  } finally { h.enter("/f614:quit"); await h.ui; }
});

/**
 * The `/` menu with Codex: what Codex has goes under CODEX without any Shell name in it, and the FORGE614 group has only
 * `/f614:` commands. Typing `/f614:` lists exactly those five; typing `/l` or `/re` does not offer the old `/login` or `/refresh`.
 */
test("the / menu with Codex lists only /f614: commands under FORGE614 and no old Shell name", async () => {
  const h = codexUi();
  try {
    await tick();
    h.terminal.output = ""; h.terminal.input("/f614:"); await tick();
    for (const name of ["/f614:login", "/f614:refresh", "/f614:commands", "/f614:stop", "/f614:quit"]) expect(h.plain(), name).toContain(name);
    expect(h.plain()).toContain("FORGE614 ");
    expect(h.plain()).toContain(getCatalog("en").chat.commandConnectAccount);
    expect(h.plain()).toContain("Refresh plan usage");
  } finally { h.terminal.input("\x1b"); h.terminal.input("\x03"); await h.ui; } // Ctrl+C quits without typing into the box that still holds the text
  for (const [typed, hidden] of [["/l", "/login"], ["/re", "/refresh"], ["/q", "/quit!"], ["/e", "/effort"], ["/h", "/help"], ["/c", "/commands"]] as const) {
    const other = codexUi();
    try {
      await tick(); other.terminal.output = ""; other.terminal.input(typed); await tick();
      expect(other.plain(), typed).not.toContain(hidden);
    } finally { other.terminal.input("\x1b"); other.terminal.input("\x03"); await other.ui; }
  }
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
      expect(screen).toContain(`▎ ${locale === "es" ? "Sí" : "Yes"}`);
      for (const internal of ["\"type\"", "pluginId", "aggregatedOutput", "commandActions", "item/commandExecution/requestApproval", "/yes", "/no "]) expect(screen).not.toContain(internal);
      terminal.input("\r");
      expect(await answer).toEqual({ decision: "accept" });
      rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } });
      await tick();
    } finally { enter("/f614:quit"); await ui; }
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
    } finally { enter("/f614:quit"); await ui; }
  });
}

/**
 * Codex `/status` says where the memory comes from, so the person can check it without asking the model (the memory used to arrive twice: measured with a
 * real account on 2026-09-29, build of 067e348, Codex 0.159.0). The assistant delivers it only when Engines reports the hook active AND the session's own
 * `hooks/list` shows the sessionStart hook of Engines enabled and trusted; otherwise Shell pastes it. Exact words in es and en.
 */
test("Codex /status says who delivers the memory, in es and en", async () => {
  const hooks = { data: [{ cwd: "/project", warnings: [], errors: [], hooks: [{ key: "k", eventName: "sessionStart", matcher: "^(startup|resume|clear|compact)$", handlerType: "command", command: "forge614-engines memory-hook-run --agent codex", async: false, enabled: true, trustStatus: "trusted", source: "user", isManaged: false }] }] };
  const cases = [
    ["en", true, "Memory: the assistant delivers it at startup"], ["en", false, "Memory: Shell pastes it"],
    ["es", true, "Memoria: la entrega el asistente al arrancar"], ["es", false, "Memoria: la pega Shell"],
  ] as const;
  for (const [locale, delivers, line] of cases) {
    const h = codexUi(locale, rpc => rpc.replies.set("hooks/list", hooks), undefined, 100, delivers ? async () => true : undefined);
    try {
      await tick(); h.terminal.output = ""; h.enter("/status"); await tick();
      expect(h.plain(), `${locale} ${delivers}`).toContain(line);
      expect(h.plain(), `${locale} ${delivers}`).toContain(getCatalog(locale).codexSession.folderLine({ path: "/project" }));
    } finally { h.enter("/f614:quit"); await h.ui; }
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Codex commands, part 3a: /approve, /feedback, /import, /plugins (each with the confirmations that keep «No» first) and the limit names.
// ---------------------------------------------------------------------------------------------------------------------

/** `item/autoApprovalReview/completed` as `v2/ItemGuardianApprovalReviewCompletedNotification.ts` defines it: one denied command of conversation `t`. */
const autoDenial = {
  threadId: "t", turnId: "u", startedAtMs: 1000, completedAtMs: 1500, reviewId: "review-1", targetItemId: "item-1", decisionSource: "agent",
  review: { status: "denied", riskLevel: "high", userAuthorization: "low", rationale: "Deletes files outside the project" },
  action: { type: "command", source: "shell", command: "rm -rf /tmp/build", cwd: "/project" },
};

/** With no recent denial Codex says so and how they are recorded; with one it lists the action and its rationale, Esc sends nothing and Enter approves that one retry (`thread/approveGuardianDeniedAction`). */
test("/approve says there is nothing to approve, lists a denial and approves only the one chosen", async () => {
  const texts = {
    en: { none: "No recent auto-review denials in this thread.", hint: "Denials are recorded after auto-review rejects an action.", title: "Auto-review Denials", done: "Approval recorded for one retry of the selected auto-review denial." },
    es: { none: "No hay denegaciones recientes de la revisión automática en esta conversación.", hint: "Las denegaciones se guardan cuando la revisión automática rechaza una acción.", title: "Denegaciones de la revisión automática", done: "Aprobación guardada para un reintento de la denegación elegida." },
  };
  for (const locale of ["en", "es"] as const) {
    const h = codexUi(locale, rpc => rpc.replies.set("thread/approveGuardianDeniedAction", {}), undefined, 220);
    try {
      await withConversation(h);
      h.terminal.output = ""; h.enter("/approve"); await tick();
      expect(h.plain()).toContain(texts[locale].none);
      expect(h.plain()).toContain(texts[locale].hint);
      expect(h.rpc.calls.some(call => call.method === "thread/approveGuardianDeniedAction")).toBe(false);
      h.rpc.onNotification("item/autoApprovalReview/completed", autoDenial);
      h.terminal.output = ""; h.enter("/approve"); await tick();
      expect(h.plain()).toContain(texts[locale].title);
      expect(h.plain()).toContain("1. rm -rf /tmp/build");
      expect(h.plain()).toContain("Deletes files outside the project");
      h.terminal.input("\x1b"); await tick();
      expect(h.rpc.calls.some(call => call.method === "thread/approveGuardianDeniedAction")).toBe(false);
      h.terminal.output = ""; h.enter("/approve"); await tick(); h.terminal.input("\r"); await tick(); await tick();
      expect(h.rpc.calls.filter(call => call.method === "thread/approveGuardianDeniedAction").map(call => call.params)).toEqual([{ threadId: "t", event: {
        id: "review-1", turn_id: "u", started_at_ms: 1000, completed_at_ms: 1500, status: "denied", risk_level: "high", user_authorization: "low",
        rationale: "Deletes files outside the project", decision_source: "agent", action: { type: "command", source: "shell", command: "rm -rf /tmp/build", cwd: "/project" },
      } }]);
      expect(h.plain()).toContain(texts[locale].done);
      h.terminal.output = ""; h.enter("/approve"); await tick();
      expect(h.plain()).toContain(texts[locale].none);
    } finally { h.enter("/f614:quit"); await h.ui; }
  }
});

/** A conversation that already has a rollout file, so `/feedback` can attach it when the person agrees to send logs. */
const feedbackSetup = (rpc: FixtureRpc) => {
  rpc.replies.set("thread/start", { thread: { id: "t", path: "/home/u/.codex/sessions/rollout-1.jsonl" }, model: "m", modelProvider: "openai" });
  rpc.replies.set("feedback/upload", { threadId: "t", promptHash: null });
};
const uploads = (h: CommandHarness) => h.rpc.calls.filter(call => call.method === "feedback/upload");

/**
 * `/feedback` sends data to a third party, so before anything leaves it asks «Send this to OpenAI?» with the summary of what goes and «No» marked:
 * Enter alone (which takes the marked «No») and Esc call nothing; only choosing «Yes» calls `feedback/upload`. Category, log consent and note come first, as in Codex.
 */
test("/feedback walks through category, logs and note, then asks with No marked and sends nothing unless the person says Yes", async () => {
  const h = codexUi("en", feedbackSetup, undefined, 220);
  try {
    await withConversation(h);
    h.terminal.output = ""; h.enter("/feedback"); await tick();
    for (const row of ["How was this?", "1. bug", "2. bad result", "3. good result", "4. safety check", "5. other", "Crash, error message, hang, or broken UI/behavior"]) expect(h.plain()).toContain(row);
    h.terminal.input("\r"); await tick();
    for (const row of ["Upload logs?", "1. Yes", "2. No", "Share the current Codex session logs and diagnostics with the team for troubleshooting"]) expect(h.plain()).toContain(row);
    h.terminal.input("\r"); await tick();
    expect(h.plain()).toContain("Tell us more (bug)");
    expect(h.plain()).toContain("(optional) Write a short description to help us further");
    h.terminal.input("It hangs on start"); h.terminal.input("\r"); await tick();
    expect(h.plain()).toContain("Send this to OpenAI?");
    expect(h.plain()).toContain("1. No, don't send");
    expect(h.plain()).toContain("2. Yes, send");
    for (const line of ["• Type: bug", "• Note: It hangs on start", "• Logs and diagnostics: yes", "• Conversation: t"]) expect(h.plain()).toContain(line);
    expect(uploads(h)).toHaveLength(0);
    h.terminal.input("\r"); await tick();
    expect(uploads(h)).toHaveLength(0);
    expect(h.plain()).toContain("Nothing was sent.");
  } finally { h.enter("/f614:quit"); await h.ui; }
});

/** Esc on the final question is a «No» too, and the question is in Spanish when Shell is: «¿Enviar esto a OpenAI?» with «No, no enviar» first. */
test("/feedback: Esc on the confirmation sends nothing, and the confirmation is in Spanish in es", async () => {
  const h = codexUi("es", feedbackSetup, undefined, 220);
  try {
    await withConversation(h);
    h.terminal.output = ""; h.enter("/feedback"); await tick();
    expect(h.plain()).toContain("¿Cómo te fue?");
    h.terminal.input("\x1b[B"); h.terminal.input("\r"); await tick();
    expect(h.plain()).toContain("¿Enviar los registros?");
    h.terminal.input("\x1b[B"); h.terminal.input("\r"); await tick();
    expect(h.plain()).toContain("Cuéntanos más (mal resultado)");
    h.terminal.input("\r"); await tick();
    expect(h.plain()).toContain("¿Enviar esto a OpenAI?");
    expect(h.plain()).toContain("1. No, no enviar");
    expect(h.plain()).toContain("2. Sí, enviar");
    expect(h.plain()).toContain("• Nota: ninguna");
    expect(h.plain()).toContain("• Registros y diagnósticos: no");
    h.terminal.input("\x1b"); await tick();
    expect(uploads(h)).toHaveLength(0);
    expect(h.plain()).toContain("No se envió nada.");
  } finally { h.enter("/f614:quit"); await h.ui; }
});

/** Choosing «Yes» calls `feedback/upload` once with the exact parameters and shows Codex's own follow-up (the issue address and the conversation id). Esc on the category or the note sends nothing. */
test("/feedback sends with Yes, shows the follow-up and is silent when the person leaves the category or the note", async () => {
  const h = codexUi("en", feedbackSetup, undefined, 220);
  try {
    await withConversation(h);
    h.enter("/feedback"); await tick(); h.terminal.input("\x1b"); await tick();
    h.enter("/feedback"); await tick(); h.terminal.input("\r"); await tick(); h.terminal.input("\x1b[B"); h.terminal.input("\r"); await tick();
    h.terminal.input("half a note"); h.terminal.input("\x1b"); await tick();
    expect(uploads(h)).toHaveLength(0);
    h.terminal.output = "";
    h.enter("/feedback"); await tick(); h.terminal.input("\r"); await tick(); h.terminal.input("\r"); await tick();
    h.terminal.input("It hangs"); h.terminal.input("\r"); await tick();
    h.terminal.input("\x1b[B"); h.terminal.input("\r"); await tick(); await tick();
    expect(uploads(h).map(call => call.params)).toEqual([{
      classification: "bug", reason: "It hangs", threadId: "t", includeLogs: true, extraLogFiles: ["/home/u/.codex/sessions/rollout-1.jsonl"], tags: { turn_id: "u" },
    }]);
    expect(h.plain()).toContain("Feedback uploaded.");
    expect(h.plain()).toContain("Please open an issue using the following URL:");
    expect(h.plain()).toContain("https://github.com/openai/codex/issues/new?template=3-cli.yml&steps=Uploaded%20thread:%20t");
    expect(h.plain()).toContain("Or mention your thread ID t in an existing issue.");
  } finally { h.enter("/f614:quit"); await h.ui; }
});

/** A good result has no issue to open: Codex just thanks and shows the id, and with No logs it says «recorded (no logs)». */
test("/feedback for a good result without logs says it was recorded and thanks", async () => {
  const h = codexUi("en", feedbackSetup, undefined, 220);
  try {
    await withConversation(h);
    h.terminal.output = ""; h.enter("/feedback"); await tick();
    h.terminal.input("\x1b[B"); h.terminal.input("\x1b[B"); h.terminal.input("\r"); await tick();
    h.terminal.input("\x1b[B"); h.terminal.input("\r"); await tick();
    h.terminal.input("\r"); await tick();
    h.terminal.input("\x1b[B"); h.terminal.input("\r"); await tick(); await tick();
    expect(uploads(h).map(call => call.params)).toEqual([{ classification: "good_result", threadId: "t", includeLogs: false, tags: { turn_id: "u" } }]);
    expect(h.plain()).toContain("Feedback recorded (no logs).");
    expect(h.plain()).toContain("Thanks for the feedback!");
    expect(h.plain()).toContain("Thread ID: t");
  } finally { h.enter("/f614:quit"); await h.ui; }
});

/** What Codex 0.159.0's `externalAgentConfig/detect` answers for Claude Code (`v2/ExternalAgentConfigMigrationItem.ts`), and nothing for Cursor. */
const importSettings = { itemType: "CONFIG", description: "Migrate /home/u/.claude/settings.json into /home/u/.codex/config.toml", cwd: null, details: null };
const importMcp = { itemType: "MCP_SERVER_CONFIG", description: "Migrate MCP servers from /home/u/.claude.json into /home/u/.codex/config.toml", cwd: null,
  details: { plugins: [], skills: [], sessions: [], mcpServers: [{ name: "forge614-engram" }, { name: "github" }], hooks: [], subagents: [], commands: [] } };
const importChats = { itemType: "SESSIONS", description: "Migrate recent Claude Code sessions", cwd: "/project",
  details: { plugins: [], skills: [], sessions: [{ path: "/home/u/.claude/projects/p/1.jsonl", cwd: "/project", title: "Fix login" }], mcpServers: [], hooks: [], subagents: [], commands: [] } };
const importSetup = (rpc: FixtureRpc, items: object[] = [importSettings, importMcp, importChats]) => {
  rpc.handler = async (method, params) => {
    if (method === "externalAgentConfig/detect") return { items: params.migrationSource === "claude-code" ? items : [], connectors: [] };
    if (method === "externalAgentConfig/import") return { importId: "imp-1" };
    if (!rpc.replies.has(method)) throw new Error(`Unexpected ${method}`);
    return rpc.replies.get(method);
  };
};
const imports = (h: CommandHarness) => h.rpc.calls.filter(call => call.method === "externalAgentConfig/import");

/**
 * `/import` copies setup into `~/.codex`, MCP keys and chats included, so it asks before copying: the question names exactly what is copied (each item with its
 * source and destination), warns in plain words about MCP connections and chats, and has «No» marked. Enter alone and Esc call nothing; only «Yes» calls import.
 */
test("/import lists what was found, names exactly what will be copied, warns about MCP and chats and calls import only on Yes", async () => {
  const h = codexUi("en", rpc => importSetup(rpc), undefined, 220);
  try {
    await tick(); h.terminal.output = ""; h.enter("/import"); await tick();
    expect(h.rpc.calls.filter(call => call.method === "externalAgentConfig/detect").map(call => call.params)).toEqual([
      { includeHome: true, cwds: ["/project"], migrationSource: "claude-code" }, { includeHome: true, cwds: ["/project"], migrationSource: "cursor" },
    ]);
    for (const row of ["Import from Claude Code", "1. Import selected (3)", "2. [x] Settings", "3. [x] MCP servers", "4. [x] Recent chat sessions", "5. Cancel"]) expect(h.plain()).toContain(row);
    h.terminal.output = ""; h.terminal.input("\r"); await tick();
    expect(h.plain()).toContain("Copy this into ~/.codex?");
    for (const line of [
      "• Settings — from /home/u/.claude/settings.json to /home/u/.codex/config.toml",
      "• MCP servers (2: forge614-engram, github) — from /home/u/.claude.json to /home/u/.codex/config.toml",
      "• Recent chat sessions (1: Fix login) — /project",
    ]) expect(h.plain().replace(/\s+/g, " ")).toContain(line.replace(/\s+/g, " "));
    expect(h.plain()).toContain("This can include the settings of your MCP connections (with their access keys) and your Claude Code chats.");
    expect(h.plain()).toContain("1. No, don't copy");
    expect(h.plain()).toContain("2. Yes, copy");
    expect(imports(h)).toHaveLength(0);
    h.terminal.input("\r"); await tick();
    expect(imports(h)).toHaveLength(0);
    expect(h.plain()).toContain("Nothing was copied.");
  } finally { h.enter("/f614:quit"); await h.ui; }
});

/** Esc on the confirmation is «No» as well, in Spanish too: «¿Copiar esto a ~/.codex?» with the MCP and chats warning in plain Spanish. */
test("/import: Esc on the confirmation copies nothing, and the question and the warning are in Spanish in es", async () => {
  const h = codexUi("es", rpc => importSetup(rpc), undefined, 220);
  try {
    await tick(); h.terminal.output = ""; h.enter("/import"); await tick();
    for (const row of ["Importar desde Claude Code", "1. Importar lo marcado (3)", "2. [x] Ajustes", "3. [x] Servidores MCP", "4. [x] Chats recientes", "5. Cancelar"]) expect(h.plain()).toContain(row);
    h.terminal.input("\r"); await tick();
    expect(h.plain()).toContain("¿Copiar esto a ~/.codex?");
    expect(h.plain()).toContain("• Ajustes — de /home/u/.claude/settings.json a /home/u/.codex/config.toml");
    expect(h.plain()).toContain("Esto puede incluir la configuración de tus conexiones MCP (con sus llaves de acceso) y tus chats de Claude Code.");
    expect(h.plain()).toContain("1. No, no copiar");
    expect(h.plain()).toContain("2. Sí, copiar");
    h.terminal.input("\x1b"); await tick();
    expect(imports(h)).toHaveLength(0);
    expect(h.plain()).toContain("No se copió nada.");
  } finally { h.enter("/f614:quit"); await h.ui; }
});

/** Enter on an item marks or unmarks it and reopens the list on that row; «Yes» then copies only what is still marked, with the items exactly as the server listed them, and says the import started. */
test("/import: Enter toggles an item and Yes imports only the marked ones, then says it started", async () => {
  const h = codexUi("en", rpc => importSetup(rpc), undefined, 220);
  try {
    await tick(); h.enter("/import"); await tick();
    // The screen redraws only what changed: after toggling «MCP servers» the count and that row are what comes out again.
    h.terminal.output = ""; h.terminal.input("\x1b[B"); h.terminal.input("\x1b[B"); h.terminal.input("\r"); await tick();
    for (const row of ["1. Import selected (2)", "3. [ ] MCP servers"]) expect(h.plain()).toContain(row);
    h.terminal.output = ""; h.terminal.input("\x1b[A"); h.terminal.input("\x1b[A"); h.terminal.input("\r"); await tick();
    h.terminal.input("\x1b[B"); h.terminal.input("\r"); await tick(); await tick();
    expect(imports(h).map(call => call.params)).toEqual([{ migrationItems: [importSettings, importChats], source: "cli", providerId: "claude-code", migrationSource: "claude-code" }]);
    for (const line of ["Import started. You can keep working while it finishes.", "Imported setup will apply to new chats.", "Importing:", "Settings: 1", "Chat sessions: 1 — Fix login"]) expect(h.plain()).toContain(line);
    expect(h.plain()).toContain("1 additional item remains. After it finishes, run /import again to review it.");
    h.rpc.onNotification("externalAgentConfig/import/completed", { importId: "imp-1", itemTypeResults: [{ itemType: "CONFIG", successes: [{}], failures: [] }, { itemType: "SESSIONS", successes: [{}], failures: [] }] });
    await tick();
    expect(h.plain()).toContain("Import finished: 2 imported, 0 failed.");
    expect(h.plain()).toContain("Run /import again to check for additional items.");
  } finally { h.terminal.input("\x1b"); await tick(); h.enter("/f614:quit"); await h.ui; }
});

/** With nothing to import Codex says so; with a detection error and nothing found it says the check failed, and neither asks anything. */
test("/import says when there is nothing to import and when the check failed", async () => {
  const empty = codexUi("en", rpc => importSetup(rpc, []), undefined, 220);
  try {
    await tick(); empty.terminal.output = ""; empty.enter("/import"); await tick();
    expect(empty.plain()).toContain("No compatible setup was found to import.");
    expect(imports(empty)).toHaveLength(0);
  } finally { empty.enter("/f614:quit"); await empty.ui; }
  const failing = codexUi("es", rpc => { rpc.handler = async method => { if (method === "externalAgentConfig/detect") throw new Error("boom"); if (!rpc.replies.has(method)) throw new Error(`Unexpected ${method}`); return rpc.replies.get(method); }; }, undefined, 220);
  try {
    await tick(); failing.terminal.output = ""; failing.enter("/import"); await tick();
    expect(failing.plain()).toContain("No se pudo revisar qué se puede importar: Claude Code: boom; Cursor: boom");
  } finally { failing.enter("/f614:quit"); await failing.ui; }
});

/** Codex's `plugin/list` shape (`v2/PluginSummary.ts` in full) with one installed and one installable plugin, and a marketplace that Codex hides in the CLI. */
const uiSummary = (over: Record<string, unknown> = {}) => ({
  id: "figma@openai-curated", remotePluginId: null, version: null, localVersion: null, name: "figma", shareContext: null, source: { type: "local", path: "/m/figma" },
  installed: false, installedAt: null, enabled: false, installPolicy: "AVAILABLE", installPolicySource: null, mustShowInstallationInterstitial: null, authPolicy: "ON_INSTALL",
  availability: "AVAILABLE", disabledReason: null, eligiblePlanTypes: null,
  interface: { displayName: "Figma", shortDescription: "Design context", longDescription: null, developerName: null, category: null, capabilities: [], websiteUrl: null, privacyPolicyUrl: null, termsOfServiceUrl: null, defaultPrompt: null, brandColor: null, composerIcon: null, composerIconUrl: null, logo: null, logoDark: null, logoUrl: null, logoUrlDark: null, screenshots: [], screenshotUrls: [] },
  keywords: [], ...over,
});
const uiPlugins = { marketplaces: [
  { name: "openai-bundled", path: "/b/marketplace.json", interface: null, plugins: [uiSummary({ id: "hidden@openai-bundled", name: "hidden" })] },
  { name: "openai-curated", path: "/m/.agents/plugins/marketplace.json", interface: { displayName: "OpenAI Curated" }, plugins: [
    uiSummary(),
    uiSummary({ id: "docs@openai-curated", name: "docs", installed: true, enabled: true, interface: null }),
  ] },
], marketplaceLoadErrors: [], featuredPluginIds: [] };
const uiPluginDetail = (summary: object, description: string) => ({ plugin: { marketplaceName: "openai-curated", marketplacePath: "/m/.agents/plugins/marketplace.json", summary, shareUrl: null, description,
  skills: [{ name: "design-review", description: "", shortDescription: null, interface: null, path: null, enabled: true }], onboardingSkill: null,
  hooks: [{ key: "a", eventName: "preToolUse" }], apps: [], appTemplates: [], mcpServers: ["figma-mcp"], scheduledTasks: null } });
const pluginsSetup = (rpc: FixtureRpc) => {
  rpc.handler = async (method, params) => {
    if (method === "plugin/list") return uiPlugins;
    if (method === "plugin/read") return params.pluginName === "docs" ? uiPluginDetail(uiSummary({ id: "docs@openai-curated", name: "docs", installed: true, enabled: true, interface: null }), "Read the docs.") : uiPluginDetail(uiSummary(), "Turn Figma files into implementation context.");
    if (method === "plugin/install") return { authPolicy: "ON_INSTALL", appsNeedingAuth: [] };
    if (method === "plugin/uninstall") return {};
    if (!rpc.replies.has(method)) throw new Error(`Unexpected ${method}`);
    return rpc.replies.get(method);
  };
};
const pluginCalls = (h: CommandHarness, method: string) => h.rpc.calls.filter(call => call.method === method);

/** `/plugins` lists the plugins with their state and marketplace (installed first, the hidden marketplace left out), opens the detail with Codex's rows and reads it with `plugin/read`. */
test("/plugins lists installed and available plugins, opens the detail and reads it with plugin/read", async () => {
  const h = codexUi("en", pluginsSetup, undefined, 220);
  try {
    await tick(); h.terminal.output = ""; h.enter("/plugins"); await tick();
    expect(pluginCalls(h, "plugin/list").map(call => call.params)).toEqual([{ cwds: ["/project"], forceRefetch: false }]);
    for (const row of ["Browse plugins from available marketplaces.", "Installed 1 of 2 available plugins.", "1. docs", "Installed · OpenAI Curated", "2. Figma", "Available · OpenAI Curated · Design context", "3. Marketplaces"]) expect(h.plain()).toContain(row);
    expect(h.plain()).not.toContain("hidden");
    h.terminal.output = ""; h.terminal.input("\x1b[B"); h.terminal.input("\r"); await tick();
    expect(pluginCalls(h, "plugin/read").map(call => call.params)).toEqual([{ marketplacePath: "/m/.agents/plugins/marketplace.json", pluginName: "figma" }]);
    for (const line of ["Figma · Can be installed · Local", "Turn Figma files into implementation context.", "Auth: Auth on install", "Skills: design-review", "Hooks: PreToolUse (1)", "Apps: No plugin apps", "MCP servers: figma-mcp", "1. Back to plugins", "2. Install plugin", "Install this plugin now"]) expect(h.plain()).toContain(line);
  } finally { h.enter("/f614:quit"); await h.ui; }
});

/**
 * Came out of the third real-account test: `/plugins` said «Installed 11 of 5015 available plugins» above and «1–5 of 5016» in the footer, because the
 * «Marketplaces» row (not a plugin) was counted. The footer now counts only plugins, so both numbers say the same, in Spanish and in English.
 */
test("/plugins footer counts only plugins, so it agrees with the count above the list", async () => {
  for (const [locale, top, footer, wrong] of [["en", "Installed 1 of 2 available plugins.", "1–2 of 2 ·", "of 3"], ["es", "Instalados 1 de 2 plugins disponibles.", "1–2 de 2 ·", "de 3"]] as const) {
    const h = codexUi(locale, pluginsSetup, undefined, 220);
    try {
      await tick(); h.terminal.output = ""; h.enter("/plugins"); await tick();
      expect(h.plain()).toContain(top);
      expect(h.plain()).toContain(footer);
      expect(h.plain()).not.toContain(wrong);
      h.terminal.input("\x1b"); await tick();
    } finally { h.enter("/f614:quit"); await h.ui; }
  }
});

/** Same care in `/import`: its «Import selected» and «Cancel» rows are actions, not items, so the footer counts the three items the list holds and not five rows. */
test("/import footer counts only the items, not its Import and Cancel rows", async () => {
  const h = codexUi("en", rpc => importSetup(rpc), undefined, 220);
  try {
    await tick(); h.terminal.output = ""; h.enter("/import"); await tick();
    expect(h.plain()).toContain("5. Cancel");
    expect(h.plain()).toContain("1–3 of 3 ·");
    expect(h.plain()).not.toContain("of 5");
    h.terminal.input("\x1b"); await tick();
  } finally { h.enter("/f614:quit"); await h.ui; }
});

/**
 * Installing downloads code from a third party, so it asks «Install Figma?» with «No» marked: Enter alone and Esc call nothing, and only «Yes» calls
 * `plugin/install` with the marketplace and the plugin name, then says what Codex says.
 */
test("/plugins install asks with No marked, calls nothing on No or Esc and plugin/install only on Yes", async () => {
  const h = codexUi("en", pluginsSetup, undefined, 220);
  const toInstallQuestion = async () => {
    h.enter("/plugins"); await tick(); h.terminal.input("\x1b[B"); h.terminal.input("\r"); await tick(); h.terminal.input("\x1b[B"); h.terminal.input("\r"); await tick();
  };
  try {
    await tick(); h.terminal.output = "";
    await toInstallQuestion();
    expect(h.plain()).toContain("Install Figma?");
    expect(h.plain()).toContain("This downloads code from a third party and adds it to Codex. Only install plugins you trust.");
    expect(h.plain()).toContain("1. No, don't install");
    expect(h.plain()).toContain("2. Yes, install");
    h.terminal.input("\r"); await tick();
    expect(pluginCalls(h, "plugin/install")).toHaveLength(0);
    expect(h.plain()).toContain("Nothing was installed.");
    await toInstallQuestion(); h.terminal.input("\x1b"); await tick();
    expect(pluginCalls(h, "plugin/install")).toHaveLength(0);
    h.terminal.output = "";
    await toInstallQuestion(); h.terminal.input("\x1b[B"); h.terminal.input("\r"); await tick(); await tick();
    expect(pluginCalls(h, "plugin/install").map(call => call.params)).toEqual([{ marketplacePath: "/m/.agents/plugins/marketplace.json", pluginName: "figma" }]);
    expect(h.plain()).toContain("Installed Figma plugin.");
    expect(h.plain()).toContain("No additional app authentication is required.");
  } finally { h.enter("/f614:quit"); await h.ui; }
});

/** Uninstalling asks «Uninstall docs?» with «No» marked too; only «Yes» calls `plugin/uninstall` with the plugin id, and it says Codex's «Bundled apps remain installed.». Spanish has its own words. */
test("/plugins uninstall asks with No marked and calls plugin/uninstall only on Yes, in English and Spanish", async () => {
  const texts = { en: ["Uninstall docs?", "1. No, keep it", "2. Yes, uninstall", "Uninstalled docs plugin.", "Bundled apps remain installed."], es: ["¿Desinstalar docs?", "1. No, dejarlo", "2. Sí, desinstalar", "Plugin docs desinstalado.", "Las apps que traía siguen instaladas."] };
  for (const locale of ["en", "es"] as const) {
    const h = codexUi(locale, pluginsSetup, undefined, 220);
    try {
      await tick(); h.terminal.output = ""; h.enter("/plugins"); await tick(); h.terminal.input("\r"); await tick(); h.terminal.input("\x1b[B"); h.terminal.input("\r"); await tick();
      for (const line of texts[locale].slice(0, 3)) expect(h.plain(), locale).toContain(line);
      h.terminal.input("\r"); await tick();
      expect(pluginCalls(h, "plugin/uninstall")).toHaveLength(0);
      h.terminal.output = ""; h.enter("/plugins"); await tick(); h.terminal.input("\r"); await tick(); h.terminal.input("\x1b[B"); h.terminal.input("\r"); await tick();
      h.terminal.input("\x1b[B"); h.terminal.input("\r"); await tick(); await tick();
      expect(pluginCalls(h, "plugin/uninstall").map(call => call.params)).toEqual([{ pluginId: "docs@openai-curated" }]);
      for (const line of texts[locale].slice(3)) expect(h.plain(), locale).toContain(line);
    } finally { h.enter("/f614:quit"); await h.ui; }
  }
});

/** Marketplaces (add, remove, upgrade) are not part of this step: the row Codex's screen would offer answers honestly and calls nothing; a disabled plugins feature says so like Codex. */
test("/plugins answers honestly for marketplaces and says when the plugins feature is off", async () => {
  const h = codexUi("en", pluginsSetup, undefined, 220);
  try {
    await tick(); h.terminal.output = ""; h.enter("/plugins"); await tick();
    h.terminal.input("\x1b[B"); h.terminal.input("\x1b[B"); h.terminal.input("\r"); await tick();
    expect(h.plain()).toContain("Adding, removing and upgrading marketplaces is not connected in Shell yet.");
    expect(h.rpc.calls.some(call => ["marketplace/add", "marketplace/remove", "marketplace/upgrade", "plugin/install"].includes(call.method))).toBe(false);
  } finally { h.enter("/f614:quit"); await h.ui; }
  const off = codexUi("es", rpc => {
    pluginsSetup(rpc);
    rpc.replies.set("experimentalFeature/list", featureList(false, [{ name: "plugins", stage: "stable", displayName: null, description: null, announcement: null, enabled: false, defaultEnabled: true }]));
  }, undefined, 220);
  try {
    await tick(); off.terminal.output = ""; off.enter("/plugins"); await tick();
    expect(off.plain()).toContain("Los plugins están desactivados.");
    expect(off.plain()).toContain("Activa la función de plugins para usar /plugins.");
    expect(pluginCalls(off, "plugin/list")).toHaveLength(0);
  } finally { off.enter("/f614:quit"); await off.ui; }
});

/** The sidebar meter and `/status` name each Codex limit by its window (here 5 hours and a week), in both languages, and never by Codex's «primary» and «secondary». */
test("with Codex the sidebar and /status name each limit by its window and never say primary or secondary", async () => {
  const limits = { rateLimits: { primary: { usedPercent: 14, windowDurationMins: 300, resetsAt: null }, secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: null } } };
  const expected = { en: ["5-hour limit · 14% used", "Weekly limit · 40% used"], es: ["Límite de 5 horas · 14% usado", "Límite semanal · 40% usado"] };
  for (const locale of ["en", "es"] as const) {
    const h = codexUi(locale, rpc => rpc.replies.set("account/rateLimits/read", limits), undefined, 220);
    try {
      await tick(); await tick();
      for (const line of expected[locale]) expect(h.plain(), locale).toContain(line);
      h.terminal.output = ""; h.enter("/status"); await tick();
      expect(h.plain(), locale).toContain(locale === "en" ? "5-hour limit: 14% used" : "Límite de 5 horas: 14% usado");
      expect(h.plain(), locale).not.toMatch(/primary|secondary/i);
    } finally { h.enter("/f614:quit"); await h.ui; }
  }
});

// ── Codex native commands, part 3b: /recap, /side and /btw, /subagents, /agents ───────────────────────────────────────

/** Threads the app-server holds for the subagent tests (`v2/Thread.ts`): a running subagent of the conversation `t` with a saved turn, and a finished one. */
const subagentThread = (id: string, over: Record<string, unknown>, nickname: string) => ({
  id, preview: "", ephemeral: false, createdAt: 10, updatedAt: 10, status: { type: "idle" }, cwd: "/project", path: null, canAcceptDirectInput: false, agentNickname: nickname, agentRole: null,
  source: { subAgent: { thread_spawn: { parent_thread_id: "t", depth: 1, agent_path: null, agent_nickname: nickname, agent_role: null } } }, turns: [], ...over,
});
const reviewerThread = subagentThread("c1", { status: { type: "active", activeFlags: [] }, preview: "Review the login tests", turns: [{ id: "ct1", startedAt: 100, completedAt: 200, items: [
  { type: "userMessage", id: "cm1", content: [{ type: "text", text: "Review the login tests", text_elements: [] }] }, { type: "agentMessage", id: "cm2", text: "Found 2 issues." },
] }], source: { subAgent: { thread_spawn: { parent_thread_id: "t", depth: 1, agent_path: "/root/reviewer", agent_nickname: "Kepler", agent_role: null } } } }, "Kepler");

/**
 * Makes the fixture answer what the four commands ask (`v2/ConfigReadResponse.ts`, `ThreadForkResponse.ts`, `ThreadInjectItemsResponse.ts`, `ThreadUnsubscribeResponse.ts`,
 * `ThreadLoadedListResponse.ts`, `ThreadReadResponse.ts`, `ThreadListResponse.ts`, `ExperimentalFeatureListResponse.ts`) and tells the temporary recap thread `r` and the side
 * thread `s` (each with its own turn) from the conversation `t`. Replies set afterwards on `rpc.replies` still apply; `over` replaces one method's answer.
 */
function threadReplies(rpc: FixtureRpc, over: Record<string, (params: any) => any> = {}) {
  rpc.replies.set("config/read", { config: { developer_instructions: null, mcp_servers: {} }, origins: {}, layers: null });
  rpc.replies.set("thread/fork", { thread: { id: "s" }, model: "m", modelProvider: "openai" });
  rpc.replies.set("thread/inject_items", {});
  rpc.replies.set("thread/unsubscribe", { status: "unsubscribed" });
  rpc.replies.set("turn/interrupt", {});
  rpc.replies.set("experimentalFeature/list", featureList(false, [{ name: "multi_agent", stage: "stable", displayName: null, description: null, announcement: null, enabled: true, defaultEnabled: true }]));
  rpc.replies.set("thread/loaded/list", { data: ["t", "c1"], nextCursor: null });
  rpc.replies.set("thread/list", { data: [], nextCursor: null, backwardsCursor: null });
  rpc.replies.set("config/batchWrite", { status: "ok", version: "v1", filePath: "/home/u/.codex/config.toml", overriddenMetadata: null });
  rpc.handler = async (method, params) => {
    if (over[method]) return over[method]!(params);
    if (method === "thread/start" && params.ephemeral === true) return { thread: { id: "r" }, model: "m", modelProvider: "openai", sandbox: { type: "readOnly", networkAccess: false } };
    if (method === "turn/start" && params.threadId === "r") return { turn: { id: "ru", status: "inProgress" } };
    if (method === "turn/start" && params.threadId === "s") return { turn: { id: "su", status: "inProgress" } };
    if (method === "thread/read" && params.threadId === "c1") return { thread: reviewerThread };
    if (!rpc.replies.has(method)) throw new Error(`Unexpected ${method}`);
    return rpc.replies.get(method);
  };
}
/** One whole exchange in the conversation `t`: the person writes «hello», Codex answers «Hi there» and the turn ends. */
async function converseUi(h: CommandHarness): Promise<void> {
  await tick(); h.enter("hello"); await tick();
  h.rpc.onNotification("item/completed", { threadId: "t", turnId: "u", item: { type: "agentMessage", id: "a1", text: "Hi there", phase: null, memoryCitation: null }, completedAtMs: 1 });
  h.rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } });
  await tick();
}
const asked = (h: CommandHarness, method: string) => h.rpc.calls.filter(call => call.method === method);

/**
 * `/recap` through the screen: the box shows Codex's «Generating conversation recap» (translated) while the temporary thread works, then the summary in its
 * «↳ Recap:» frame with the next action, and the temporary thread is detached. Nothing the recap thread streams reaches the chat.
 */
for (const locale of ["en", "es"] as const) {
  test(`/recap shows the loading line while it waits and then the summary, and detaches the temporary thread (${locale})`, async () => {
    const nt = getCatalog(locale).codexNative;
    const h = codexUi(locale, rpc => threadReplies(rpc), undefined, 220);
    try {
      await converseUi(h);
      h.terminal.output = ""; h.enter("/recap"); await tick(); await tick();
      expect(h.plain(), "loading").toContain(getCatalog(locale).codexChat.recapLoadingTitle);
      h.rpc.onNotification("item/agentMessage/delta", { threadId: "r", turnId: "ru", itemId: "ri", delta: "HIDDEN-RECAP-STREAM" });
      h.rpc.onNotification("item/completed", { threadId: "r", turnId: "ru", item: { type: "agentMessage", id: "ri", text: JSON.stringify({ summary: "You said hello.", next_action: "Say more." }), phase: null, memoryCitation: null }, completedAtMs: 2 });
      h.rpc.onNotification("turn/completed", { threadId: "r", turn: { id: "ru", status: "completed" } });
      await tick(); await tick();
      expect(h.plain()).toContain(nt.recapLine({ summary: "You said hello." }));
      expect(h.plain()).toContain(nt.recapNextLine({ action: "Say more." }));
      expect(h.plain()).not.toContain("HIDDEN-RECAP-STREAM");
      expect(h.rpc.calls.slice(-4).map(call => call.method)).toEqual(["config/read", "thread/start", "turn/start", "thread/unsubscribe"]);
      expect(h.rpc.calls.at(-1)!.params).toEqual({ threadId: "r" });
      expect(h.rpc.calls.at(-2)!.params.outputSchema.required).toEqual(["summary", "next_action"]);
      expect(h.session().sessionId).toBe("t");
    } finally { h.enter("/f614:quit"); await h.ui; }
  });
}

/** When the model breaks the schema, `/recap` says Codex's «Could not generate a recap. Please try again.» (translated), detaches the thread and the box works again. */
test("/recap says it could not generate a recap, still detaches the thread and leaves the box free", async () => {
  const h = codexUi("es", rpc => threadReplies(rpc));
  try {
    await converseUi(h);
    h.enter("/recap"); await tick(); await tick();
    h.rpc.onNotification("item/completed", { threadId: "r", turnId: "ru", item: { type: "agentMessage", id: "ri", text: "no es JSON", phase: null, memoryCitation: null }, completedAtMs: 2 });
    h.rpc.onNotification("turn/completed", { threadId: "r", turn: { id: "ru", status: "completed" } });
    await tick(); await tick();
    expect(h.plain()).toContain("No se pudo generar el resumen. Inténtalo de nuevo.");
    expect(asked(h, "thread/unsubscribe").map(call => call.params)).toEqual([{ threadId: "r" }]);
    h.terminal.output = ""; h.enter("/pwd"); await tick();
    expect(h.plain()).toContain("/project");
  } finally { h.enter("/f614:quit"); await h.ui; }
});

/** With nothing said yet there is no history: `/recap` says so and asks Codex for nothing. */
test("/recap before any message says there is no history and calls nothing", async () => {
  const h = codexUi("en", rpc => threadReplies(rpc), undefined, 220);
  try {
    await tick(); h.enter("/recap"); await tick();
    expect(h.plain()).toContain("There is no conversation history to recap.");
    expect(asked(h, "config/read")).toHaveLength(0);
  } finally { h.enter("/f614:quit"); await h.ui; }
});

/**
 * `/side question` through the screen (Codex's flow, `app/side.rs`): `config/read`, `thread/fork`, `thread/inject_items`, then the question as `turn/start` on the side thread.
 * The screen shows that this is a side conversation (a header in the view and a fixed line in the box), keeps the main conversation aside, and what the main thread says
 * meanwhile does not appear until Ctrl+C returns to it. A command Codex does not keep in a side conversation answers honestly; one it keeps works.
 */
for (const locale of ["en", "es"] as const) {
  test(`/side shows it is a side conversation, keeps the threads apart and Ctrl+C returns to the main one intact (${locale})`, async () => {
    const nt = getCatalog(locale).codexNative;
    const h = codexUi(locale, rpc => threadReplies(rpc), undefined, 220);
    try {
      await converseUi(h);
      h.terminal.output = ""; h.enter("/side what is X?"); await tick(); await tick();
      const calls = h.rpc.calls.map(call => call.method);
      expect(calls.slice(-4)).toEqual(["config/read", "thread/fork", "thread/inject_items", "turn/start"]);
      expect(h.rpc.calls.at(-1)!.params).toMatchObject({ threadId: "s", input: [{ type: "text", text: "what is X?" }] });
      expect(h.plain()).toContain(nt.sideHeader);
      expect(h.plain(), "the side turn is running, and the busy line names the side conversation").toContain(`${getCatalog(locale).chat.statusWorking} · ${nt.sideTitle}`);
      expect(h.plain()).toContain("what is X?");
      expect(h.session().detour?.()).toEqual({ kind: "side", readOnly: false });

      h.terminal.output = "";
      h.rpc.onNotification("item/agentMessage/delta", { threadId: "t", turnId: "u", itemId: "m9", delta: "MAIN-LATE-WORDS" });
      h.rpc.onNotification("item/agentMessage/delta", { threadId: "s", turnId: "su", itemId: "s9", delta: "SIDE-ANSWER-WORDS" });
      await tick();
      expect(h.plain()).toContain("SIDE-ANSWER-WORDS");
      expect(h.plain()).not.toContain("MAIN-LATE-WORDS");

      h.terminal.output = ""; h.enter("/model"); await tick();
      expect(h.plain()).toContain(nt.sideUnavailableCommand({ name: "/model" }));
      expect(h.plain()).not.toContain(getCatalog(locale).chat.commandSelectModel);
      h.terminal.output = ""; h.enter("/pwd"); await tick();
      expect(h.plain()).toContain("/project");
      expect(h.plain()).not.toContain(nt.sideUnavailableCommand({ name: "/pwd" }));

      const before = h.rpc.calls.length; h.terminal.output = "";
      h.terminal.input("\x03"); await tick(); await tick();
      expect(h.rpc.calls.slice(before).map(call => [call.method, call.params])).toEqual([["turn/interrupt", { threadId: "s", turnId: "su" }], ["thread/unsubscribe", { threadId: "s" }]]);
      expect(h.session().detour?.()).toBeUndefined();
      expect(h.plain()).toContain("MAIN-LATE-WORDS");
      expect(h.plain()).not.toContain("SIDE-ANSWER-WORDS");
      expect(h.plain()).not.toContain(nt.sideHeader);
      expect(h.session().sessionId).toBe("t");

      h.enter("back in main"); await tick();
      expect(h.rpc.calls.filter(call => call.method === "turn/start").at(-1)!.params.threadId).toBe("t");
      h.rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } }); await tick();
    } finally { h.enter("/f614:quit"); await h.ui; }
  });
}

/** `/btw` is `/side` under another name (same description in Codex's list): it opens the same side conversation. */
test("/btw opens the same side conversation as /side", async () => {
  const h = codexUi("en", rpc => threadReplies(rpc), undefined, 220);
  try {
    await converseUi(h);
    h.enter("/btw quick one"); await tick(); await tick();
    expect(h.rpc.calls.filter(call => call.method === "thread/fork")).toHaveLength(1);
    expect(h.rpc.calls.filter(call => call.method === "turn/start").at(-1)!.params).toMatchObject({ threadId: "s", input: [{ type: "text", text: "quick one" }] });
    expect(h.session().detour?.()).toMatchObject({ kind: "side" });
  } finally { h.terminal.input("\x03"); await tick(); h.enter("/f614:quit"); await h.ui; }
});

/** `/side` alone only opens the branch: no turn is sent until the person writes, and what they write then goes to the side thread. */
test("/side alone opens the branch without sending a turn, and the next message goes to it", async () => {
  const h = codexUi("en", rpc => threadReplies(rpc), undefined, 220);
  try {
    await converseUi(h);
    const turns = asked(h, "turn/start").length;
    h.terminal.output = ""; h.enter("/side"); await tick(); await tick();
    expect(asked(h, "turn/start")).toHaveLength(turns);
    expect(h.session().detour?.()).toMatchObject({ kind: "side" });
    const nt = getCatalog("en").codexNative;
    expect(h.plain(), "the fixed line in the box says where the person is and how to leave").toContain([nt.sideTitle, nt.sideFromMain, nt.sideCloseHint].join(" · "));
    expect(h.plain()).toContain(nt.sideHeader);
    h.enter("and this?"); await tick();
    expect(asked(h, "turn/start").at(-1)!.params).toMatchObject({ threadId: "s", input: [{ type: "text", text: "and this?" }] });
  } finally { h.terminal.input("\x03"); await tick(); h.enter("/f614:quit"); await h.ui; }
});

/** Codex lets `/side` start while a turn runs. With the main turn still working, Ctrl+D from the side conversation asks before leaving (the main work would be stopped), with «No» marked. */
test("/side starts during a main turn, keeps working there and Ctrl+D asks before stopping the main work", async () => {
  const h = codexUi("en");
  threadRepliesLater(h);
  try {
    await tick(); h.enter("long task"); await tick();
    expect(h.session().busy).toBe(true);
    h.enter("/side hi"); await tick(); await tick();
    expect(h.session().detour?.()).toMatchObject({ kind: "side" });
    expect(h.session().mainBusy?.()).toBe(true);
    h.terminal.output = ""; h.terminal.input("\x04"); await tick();
    expect(h.plain()).toContain("Quit anyway? What is running will be stopped.");
    expect(h.plain()).toContain("▎ No");
    h.terminal.input("\x1b"); await tick();
    h.terminal.input("\x03"); await tick();
    expect(h.session().detour?.()).toBeUndefined();
    h.rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } });
    await tick();
  } finally { h.enter("/f614:quit"); await h.ui; }
});
/** Installs the thread replies on a harness that was built before them (the main `turn/start` and `thread/start` replies stay). */
function threadRepliesLater(h: CommandHarness) { threadReplies(h.rpc); }

/**
 * `/subagents` through the screen: Codex's picker («Subagents», Main first), choosing a subagent shows its history read only with a fixed line saying so, writing to it is
 * refused without sending anything, the commands Codex keeps in a side conversation still work and the others answer honestly, and Ctrl+C returns to the main conversation.
 */
for (const locale of ["en", "es"] as const) {
  test(`/subagents opens the picker, watches the chosen subagent read only and Ctrl+C returns to the main conversation (${locale})`, async () => {
    const nt = getCatalog(locale).codexNative;
    const h = codexUi(locale, rpc => threadReplies(rpc), undefined, 220);
    try {
      await converseUi(h);
      h.terminal.output = ""; h.enter("/subagents"); await tick(); await tick();
      expect(h.plain()).toContain(nt.subagentsTitle);
      expect(h.plain()).toContain(`• ${nt.subagentMain}`);
      expect(h.plain()).toContain("• /root/reviewer");
      const listed = asked(h, "thread/list").at(-1)!.params;
      expect(listed).toMatchObject({ sourceKinds: ["subAgentThreadSpawn"], ancestorThreadId: "t" });

      h.terminal.output = ""; h.terminal.input("\x1b[B"); h.terminal.input("\r"); await tick(); await tick();
      expect(h.session().detour?.()).toEqual({ kind: "agent", name: "/root/reviewer", readOnly: true });
      expect(h.plain()).toContain("Found 2 issues.");
      expect(h.plain()).toContain(nt.agentHeader({ name: "/root/reviewer" }));
      expect(h.plain()).toContain(nt.agentTitle({ name: "/root/reviewer" }));

      const turns = asked(h, "turn/start").length; h.terminal.output = "";
      h.enter("hello subagent"); await tick();
      expect(h.plain()).toContain(getCatalog(locale).errors["codex-agent-read-only"]({}));
      expect(asked(h, "turn/start")).toHaveLength(turns);
      h.terminal.output = ""; h.enter("/model"); await tick();
      expect(h.plain()).toContain(nt.agentUnavailableCommand({ name: "/model" }));
      h.terminal.output = ""; h.enter("/pwd"); await tick();
      expect(h.plain()).toContain("/project");

      h.terminal.output = ""; h.terminal.input("\x03"); await tick();
      expect(h.session().detour?.()).toBeUndefined();
      expect(h.plain()).not.toContain(nt.agentHeader({ name: "/root/reviewer" }));
      expect(asked(h, "thread/unsubscribe")).toHaveLength(0);
      expect(asked(h, "turn/interrupt")).toHaveLength(0);
    } finally { h.enter("/f614:quit"); await h.ui; }
  });
}

/** Choosing «Main» from a watched subagent's own picker returns to the main conversation, the same as Ctrl+C. */
test("/subagents from a watched subagent returns to the main conversation when Main is chosen", async () => {
  const h = codexUi("en", rpc => threadReplies(rpc), undefined, 220);
  try {
    await converseUi(h);
    h.enter("/subagents"); await tick(); await tick(); h.terminal.input("\x1b[B"); h.terminal.input("\r"); await tick(); await tick();
    expect(h.session().detour?.()).toMatchObject({ kind: "agent" });
    h.enter("/subagents"); await tick(); await tick();
    h.terminal.input("\x1b[A"); h.terminal.input("\r"); await tick(); await tick();
    expect(h.session().detour?.()).toBeUndefined();
  } finally { h.enter("/f614:quit"); await h.ui; }
});

/** Without subagents Codex says «No agents available yet.» and opens nothing. */
test("/subagents without subagents says there are none", async () => {
  const h = codexUi("en", rpc => threadReplies(rpc, { "thread/loaded/list": () => ({ data: ["t"], nextCursor: null }) }), undefined, 220);
  try {
    await converseUi(h);
    h.terminal.output = ""; h.enter("/subagents"); await tick(); await tick();
    expect(h.plain()).toContain("No agents available yet.");
    expect(h.plain()).not.toContain("Select an agent to watch.");
  } finally { h.enter("/f614:quit"); await h.ui; }
});

/**
 * With the subagents feature off Codex asks «Enable subagents?» with «Yes, enable» marked; saving writes into the person's Codex configuration, and the question says so.
 * Enter alone takes «Yes» (as Codex marks it) and calls `config/batchWrite`; Esc calls nothing.
 */
test("/subagents with the feature off asks, says it writes to ~/.codex and saves only on Yes", async () => {
  const off = { name: "multi_agent", stage: "stable", displayName: null, description: null, announcement: null, enabled: false, defaultEnabled: true };
  const nt = getCatalog("en").codexNative;
  const h = codexUi("en", rpc => threadReplies(rpc, { "experimentalFeature/list": () => featureList(false, [off]), "thread/loaded/list": () => ({ data: ["t"], nextCursor: null }) }), undefined, 220);
  try {
    await converseUi(h);
    h.terminal.output = ""; h.enter("/subagents"); await tick(); await tick();
    expect(h.plain()).toContain(nt.subagentsEnableTitle);
    expect(h.plain()).toContain("~/.codex/config.toml");
    expect(h.plain()).toContain("1. Yes, enable");
    h.terminal.input("\x1b"); await tick();
    expect(asked(h, "config/batchWrite")).toHaveLength(0);
    h.terminal.output = ""; h.enter("/subagents"); await tick(); await tick(); h.terminal.input("\r"); await tick(); await tick();
    expect(asked(h, "config/batchWrite").map(call => call.params)).toEqual([{ edits: [{ keyPath: "features.multi_agent", value: true, mergeStrategy: "replace" }], reloadUserConfig: true }]);
    expect(h.plain()).toContain(nt.subagentsEnabled);
  } finally { h.enter("/f614:quit"); await h.ui; }
});

/**
 * `/agents` with the embedded server (the case of Shell): Codex's «Shared agents unavailable», in both languages, with nothing started. Codex keeps it in a side conversation, so it
 * works there too.
 */
for (const locale of ["en", "es"] as const) {
  test(`/agents says the shared agents are unavailable, also inside a side conversation (${locale})`, async () => {
    const nt = getCatalog(locale).codexNative;
    const h = codexUi(locale, rpc => threadReplies(rpc), undefined, 220);
    try {
      await converseUi(h);
      h.terminal.output = ""; h.enter("/agents"); await tick();
      expect(h.plain()).toContain(nt.agentsUnavailableTitle);
      expect(h.plain()).toContain(nt.agentsUnavailableSubtitle);
      expect(h.plain()).not.toContain(getCatalog(locale).codexCommands.screenOnly({ name: "/agents" }));
      h.enter("/side"); await tick(); await tick();
      h.terminal.output = ""; h.enter("/agents"); await tick();
      expect(h.plain()).toContain(nt.agentsUnavailableTitle);
      expect(h.plain()).not.toContain(nt.sideUnavailableCommand({ name: "/agents" }));
    } finally { h.terminal.input("\x03"); await tick(); h.enter("/f614:quit"); await h.ui; }
  });
}

/**
 * The sidebar's grip through the whole Codex screen, with real SGR mouse sequences: hovering it asks the terminal for the resize pointer (OSC 22), pressing and dragging it changes
 * the sidebar's width, releasing saves `sidebarWidth` (46 here: 140 − 2 − 93 + 1) in Shell's preferences with the sidebar still shown, and closing the screen with the pointer over the grip gives
 * the pointer back before leaving the alternate screen. It exists because the unit tests drive the layout directly; this one proves the screen wires the layout, the preferences and the terminal.
 */
test("dragging the sidebar's grip saves the width on release and closing gives the resize pointer back", async () => {
  const h = codexUi("en", undefined, undefined, 140);
  const ew = "\x1b]22;ew-resize\x07"; const back = "\x1b]22;default\x07";
  const count = (text: string) => h.terminal.output.split(text).length - 1;
  try {
    await tick();
    h.terminal.input("\x1b[<35;104;21M"); await tick(); // moving over the grip: columns 102–103 of a 140-column terminal, middle row 20 (SGR is 1-based)
    expect(count(ew)).toBe(1);
    h.terminal.input("\x1b[<0;104;21M"); h.terminal.input("\x1b[<32;94;21M"); await tick(); // press, then drag to column 93
    expect(existsSync(join(forgeHome, "shell", "preferences.json"))).toBe(false); // nothing is saved while the button is down
    h.terminal.input("\x1b[<0;94;21m"); await tick(); // release
    expect(savedPreferences()).toMatchObject({ sidebarWidth: 46, sidebarHidden: false });
    expect([count(ew), count(back)]).toEqual([1, 1]);
    h.terminal.input("\x1b[<35;94;21M"); await tick(); // the grip is now at columns 92–93
    expect(count(ew)).toBe(2);
  } finally { h.enter("/f614:quit"); await h.ui; }
  const out = h.terminal.output;
  expect(count(back)).toBe(2);
  expect(out.lastIndexOf(ew)).toBeLessThan(out.lastIndexOf(back));
  expect(out.lastIndexOf(back)).toBeLessThan(out.lastIndexOf("\x1b[?1049l"));
});
