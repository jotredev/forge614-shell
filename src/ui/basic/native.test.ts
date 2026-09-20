import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import type { Terminal } from "@earendil-works/pi-tui";
import type { Approve } from "../../engines/types.ts";
import { runNativeUI } from "./native.ts";
import { CodexSession } from "../../engines/codex/session.ts";
import { FixtureRpc } from "../../../tests/support/rpc-fixture.ts";

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
