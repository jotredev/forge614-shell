import { expect, test } from "bun:test";
import type { Terminal } from "@earendil-works/pi-tui";
import { chooseMcpAgents, showMcpPreviewConfirm } from "./mcp-setup.ts";

class TestTerminal implements Terminal {
  columns = 100; rows = 30; kittyProtocolActive = false;
  input: (data: string) => void = () => {}; output = "";
  start(input: (data: string) => void) { this.input = input; }
  stop() {}
  async drainInput() {}
  write(data: string) { this.output += data; }
  moveBy() {} hideCursor() {} showCursor() {} clearLine() {}
  clearFromCursor() {} clearScreen() {} setTitle() {} setProgress() {}
}
const tick = () => new Promise(resolve => setTimeout(resolve, 25));
const agents = [
  { id: "claude-code", label: "Claude Code", executable: "/bin/claude" },
  { id: "codex", label: "Codex", executable: "/bin/codex" },
];

test("shows every agent and submits the checked ids", async () => {
  const terminal = new TestTerminal();
  const result = chooseMcpAgents(agents, terminal);
  await tick();
  expect(terminal.output).toContain("Claude Code");
  expect(terminal.output).toContain("Codex");
  terminal.input("\x1b[B"); terminal.input(" "); // check Codex
  terminal.input("\r");
  expect(await result).toEqual(["codex"]);
});

test("submitting with nothing checked returns an empty array, not undefined", async () => {
  const terminal = new TestTerminal();
  const result = chooseMcpAgents(agents, terminal);
  await tick();
  terminal.input("\r");
  expect(await result).toEqual([]);
});

test("escape returns undefined without selecting anything", async () => {
  const terminal = new TestTerminal();
  const result = chooseMcpAgents(agents, terminal);
  await tick();
  terminal.input("\x1b");
  expect(await result).toBeUndefined();
});

test("the preview screen shows a pending write's file path", async () => {
  const terminal = new TestTerminal();
  const result = showMcpPreviewConfirm([{ agentLabel: "Claude Code", filePath: "/Users/tester/.claude.json", status: "pending" }], terminal);
  await tick();
  expect(terminal.output).toContain("Claude Code");
  expect(terminal.output).toContain("/Users/tester/.claude.json");
  terminal.input("\r");
  expect(await result).toBe(true);
});

test("the preview screen also shows already-configured and blocked assistants, never a file content field", async () => {
  const terminal = new TestTerminal();
  const result = showMcpPreviewConfirm([
    { agentLabel: "Claude Code", filePath: "/Users/tester/.claude.json", status: "pending" },
    { agentLabel: "Cursor", filePath: null, status: "already-configured" },
    { agentLabel: "Codex", filePath: null, status: "blocked", detail: "A different MCP already uses this name." },
  ], terminal);
  await tick();
  expect(terminal.output).toContain("Cursor");
  expect(terminal.output).toContain("already configured");
  expect(terminal.output).toContain("Codex");
  expect(terminal.output).toContain("A different MCP already uses this name.");
  expect(terminal.output).not.toContain("afterContent");
  expect(terminal.output).not.toContain("beforeHash");
  terminal.input("\r");
  expect(await result).toBe(true);
});

test("cancelling the preview returns false", async () => {
  const terminal = new TestTerminal();
  const result = showMcpPreviewConfirm([{ agentLabel: "Claude Code", filePath: "/Users/tester/.claude.json", status: "pending" }], terminal);
  await tick();
  terminal.input("\x1b[B"); terminal.input("\r"); // move to Cancel, submit
  expect(await result).toBe(false);
});
