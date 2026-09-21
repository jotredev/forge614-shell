import { expect, test } from "bun:test";
import type { Terminal } from "@earendil-works/pi-tui";
import { chooseMemoryAgents, showMemoryPreviewConfirm } from "./memory-setup.ts";
import type { MemoryPreviewItem } from "./memory-setup.ts";

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
  const result = chooseMemoryAgents(agents, terminal);
  await tick();
  expect(terminal.output).toContain("Claude Code");
  expect(terminal.output).toContain("Codex");
  terminal.input("\x1b[B"); terminal.input(" "); // check Codex
  terminal.input("\r");
  expect(await result).toEqual(["codex"]);
});

test("submitting with nothing checked returns an empty array, not undefined", async () => {
  const terminal = new TestTerminal();
  const result = chooseMemoryAgents(agents, terminal);
  await tick();
  terminal.input("\r");
  expect(await result).toEqual([]);
});

test("escape returns undefined without selecting anything", async () => {
  const terminal = new TestTerminal();
  const result = chooseMemoryAgents(agents, terminal);
  await tick();
  terminal.input("\x1b");
  expect(await result).toBeUndefined();
});

test("the preview screen shows a pending plan's paths, MCP status, instructions status, and overall status", async () => {
  const terminal = new TestTerminal();
  const items: MemoryPreviewItem[] = [{
    agentLabel: "Claude Code", kind: "pending",
    mcpPath: "/Users/tester/.claude.json", instructionsPaths: ["/Users/tester/.claude/CLAUDE.md"],
    mcp: { kind: "write" }, instructions: { kind: "write" }, overallStatus: "complete",
  }];
  const result = showMemoryPreviewConfirm(items, terminal);
  await tick();
  expect(terminal.output).toContain("Claude Code");
  expect(terminal.output).toContain("/Users/tester/.claude.json");
  expect(terminal.output).toContain("/Users/tester/.claude/CLAUDE.md");
  expect(terminal.output).toContain("complete");
  terminal.input("\r");
  expect(await result).toBe(true);
});

test("an unsupported instructions component explains why, and a blocked component shows its details, never a file content field", async () => {
  const terminal = new TestTerminal();
  const items: MemoryPreviewItem[] = [
    {
      agentLabel: "Cursor", kind: "pending",
      mcpPath: "/Users/tester/.cursor/mcp.json", instructionsPaths: [],
      mcp: { kind: "write" },
      instructions: { kind: "unsupported", reason: "Cursor has no officially supported mechanism to auto-load global instructions." },
      overallStatus: "partial",
    },
    { agentLabel: "Codex", kind: "blocked", detail: "A different MCP already uses this name." },
  ];
  const result = showMemoryPreviewConfirm(items, terminal);
  await tick();
  expect(terminal.output).toContain("Cursor has no officially supported mechanism to auto-load global instructions.");
  expect(terminal.output).toContain("partial");
  expect(terminal.output).toContain("Codex");
  expect(terminal.output).toContain("A different MCP already uses this name.");
  expect(terminal.output).not.toContain("afterContent");
  expect(terminal.output).not.toContain("beforeHash");
  terminal.input("\r");
  expect(await result).toBe(true);
});

test("a resolved (already-configured) item shows its status without a paths line implying a pending write", async () => {
  const terminal = new TestTerminal();
  const items: MemoryPreviewItem[] = [{
    agentLabel: "Claude Code", kind: "resolved",
    mcp: { kind: "noop" }, instructions: { kind: "noop" }, overallStatus: "complete",
  }];
  const result = showMemoryPreviewConfirm(items, terminal);
  await tick();
  expect(terminal.output).toContain("already configured");
  expect(terminal.output).toContain("already present");
  terminal.input("\r");
  expect(await result).toBe(true);
});

test("cancelling the preview returns false", async () => {
  const terminal = new TestTerminal();
  const items: MemoryPreviewItem[] = [{
    agentLabel: "Claude Code", kind: "pending",
    mcpPath: "/Users/tester/.claude.json", instructionsPaths: ["/Users/tester/.claude/CLAUDE.md"],
    mcp: { kind: "write" }, instructions: { kind: "write" }, overallStatus: "complete",
  }];
  const result = showMemoryPreviewConfirm(items, terminal);
  await tick();
  terminal.input("\x1b[B"); terminal.input("\r"); // move to Cancel, submit
  expect(await result).toBe(false);
});

test("the preview always states that nothing has changed yet", async () => {
  const terminal = new TestTerminal();
  const items: MemoryPreviewItem[] = [{ agentLabel: "Claude Code", kind: "resolved", mcp: { kind: "noop" }, instructions: { kind: "noop" }, overallStatus: "complete" }];
  const result = showMemoryPreviewConfirm(items, terminal);
  await tick();
  expect(terminal.output).toContain("Nothing has been changed yet");
  terminal.input("\r");
  await result;
});
