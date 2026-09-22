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
    hookPath: "/Users/tester/.claude/settings.json",
    mcp: { kind: "write" }, instructions: { kind: "write" }, hook: { kind: "noop" }, overallStatus: "complete",
  }];
  const result = showMemoryPreviewConfirm(items, terminal);
  await tick();
  expect(terminal.output).toContain("Claude Code — overall: complete");
  expect(terminal.output).toContain("paths to change: /Users/tester/.claude.json, /Users/tester/.claude/CLAUDE.md");
  expect(terminal.output).toContain("MCP forge614-engram: will add · memory instructions: will add");
  terminal.input("\r");
  expect(await result).toBe(true);
});

test("a pending assistant's whole preview block stays compact enough not to push the header off a small screen", async () => {
  const terminal = new TestTerminal();
  const items: MemoryPreviewItem[] = [
    {
      agentLabel: "Claude Code", kind: "pending",
      mcpPath: "/Users/tester/.claude.json", instructionsPaths: ["/Users/tester/.claude/CLAUDE.md"],
      hookPath: "/Users/tester/.claude/settings.json",
      mcp: { kind: "write" }, instructions: { kind: "write" }, hook: { kind: "noop" }, overallStatus: "complete",
    },
    {
      agentLabel: "Codex", kind: "pending",
      mcpPath: "/Users/tester/.codex/config.toml", instructionsPaths: ["/Users/tester/.codex/AGENTS.md"],
      hookPath: "/Users/tester/.codex/config.toml",
      mcp: { kind: "write" }, instructions: { kind: "write" }, hook: { kind: "noop" }, overallStatus: "complete",
    },
  ];
  const result = showMemoryPreviewConfirm(items, terminal);
  await tick();
  // Three lines per assistant: "<label> — overall: <status>", the paths, and both component
  // statuses on one shared line — never a separate line per component, and never a bare
  // "<label>:" line followed by a separate "overall:" line.
  const lines = terminal.output.split("\n");
  expect(lines.some(line => line.includes("memory instructions:") && !line.includes("MCP forge614-engram:"))).toBe(false);
  expect(terminal.output).toContain("Claude Code — overall: complete");
  expect(terminal.output).toContain("Codex — overall: complete");
  terminal.input("\r");
  expect(await result).toBe(true);
});

test("an unsupported instructions component explains why, and a blocked component shows its details, never a file content field", async () => {
  const terminal = new TestTerminal();
  const items: MemoryPreviewItem[] = [
    {
      agentLabel: "Cursor", kind: "pending",
      mcpPath: "/Users/tester/.cursor/mcp.json", instructionsPaths: [],
      hookPath: "/Users/tester/.cursor/config.json",
      mcp: { kind: "write" },
      instructions: { kind: "unsupported", reason: "Cursor has no officially supported mechanism to auto-load global instructions." },
      hook: { kind: "noop" },
      overallStatus: "partial",
    },
    { agentLabel: "Codex", kind: "blocked", detail: "A different MCP already uses this name." },
  ];
  const result = showMemoryPreviewConfirm(items, terminal);
  await tick();
  expect(terminal.output).toContain("Cursor — overall: partial");
  expect(terminal.output).toContain("MCP forge614-engram: will add · memory instructions: not supported by this assistant");
  // Engines' own explanation always gets a line of its own, so word wrap never splits it.
  expect(terminal.output).toContain("Cursor has no officially supported mechanism to auto-load global instructions.");
  expect(terminal.output).toContain("Codex: blocked — A different MCP already uses this name.");
  expect(terminal.output).not.toContain("afterContent");
  expect(terminal.output).not.toContain("beforeHash");
  terminal.input("\r");
  expect(await result).toBe(true);
});

test("a resolved (already-configured) item shows its status without a paths line implying a pending write", async () => {
  const terminal = new TestTerminal();
  const items: MemoryPreviewItem[] = [{
    agentLabel: "Claude Code", kind: "resolved",
    mcp: { kind: "noop" }, instructions: { kind: "noop" }, hook: { kind: "noop" }, overallStatus: "complete",
  }];
  const result = showMemoryPreviewConfirm(items, terminal);
  await tick();
  expect(terminal.output).toContain("MCP forge614-engram: already configured · memory instructions: already present");
  expect(terminal.output).toContain("paths to change: (none)");
  terminal.input("\r");
  expect(await result).toBe(true);
});

test("cancelling the preview returns false", async () => {
  const terminal = new TestTerminal();
  const items: MemoryPreviewItem[] = [{
    agentLabel: "Claude Code", kind: "pending",
    mcpPath: "/Users/tester/.claude.json", instructionsPaths: ["/Users/tester/.claude/CLAUDE.md"],
    hookPath: "/Users/tester/.claude/settings.json",
    mcp: { kind: "write" }, instructions: { kind: "write" }, hook: { kind: "noop" }, overallStatus: "complete",
  }];
  const result = showMemoryPreviewConfirm(items, terminal);
  await tick();
  terminal.input("\x1b[B"); terminal.input("\r"); // move to Cancel, submit
  expect(await result).toBe(false);
});

test("the preview always states that nothing has changed yet", async () => {
  const terminal = new TestTerminal();
  const items: MemoryPreviewItem[] = [{ agentLabel: "Claude Code", kind: "resolved", mcp: { kind: "noop" }, instructions: { kind: "noop" }, hook: { kind: "noop" }, overallStatus: "complete" }];
  const result = showMemoryPreviewConfirm(items, terminal);
  await tick();
  expect(terminal.output).toContain("Nothing has been changed yet");
  terminal.input("\r");
  await result;
});

test("the preview shows the memory-hook status on its own segment of the summary line", async () => {
  const terminal = new TestTerminal();
  const run = showMemoryPreviewConfirm([
    {
      agentLabel: "Claude Code", kind: "pending",
      mcpPath: "/Users/tester/.claude.json", instructionsPaths: ["/Users/tester/.claude/CLAUDE.md"],
      hookPath: "/Users/tester/.claude/settings.json",
      mcp: { kind: "noop" }, instructions: { kind: "noop" },
      hook: { kind: "write" },
      overallStatus: "partial",
    },
  ], terminal);
  await tick();
  expect(terminal.output).toContain("memory hook: will add");
  terminal.input("\r");
  await run;
});

test("the preview never shows a hook write's afterContent or beforeHash — only its status", async () => {
  const terminal = new TestTerminal();
  const run = showMemoryPreviewConfirm([
    {
      agentLabel: "Codex", kind: "pending",
      mcpPath: "/Users/tester/.codex/config.toml", instructionsPaths: ["/Users/tester/.codex/AGENTS.md"],
      hookPath: "/Users/tester/.codex/config.toml",
      mcp: { kind: "noop" }, instructions: { kind: "noop" },
      hook: { kind: "write" },
      overallStatus: "partial",
    },
  ], terminal);
  await tick();
  expect(terminal.output).not.toContain("afterContent");
  expect(terminal.output).not.toContain("beforeHash");
  terminal.input("\r");
  await run;
});
