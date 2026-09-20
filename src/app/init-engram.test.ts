import { expect, spyOn, test } from "bun:test";
import { requireEngramProduct } from "./init-engram.ts";

test("requires --product with a value", () => {
  expect(() => requireEngramProduct([])).toThrow("--product <name>");
  expect(() => requireEngramProduct(["--product"])).toThrow("--product <name>");
});

test("rejects an unsupported product", () => {
  expect(() => requireEngramProduct(["--product", "atlas"])).toThrow('"engram" is supported today');
});

test("rejects extra arguments", () => {
  expect(() => requireEngramProduct(["--product", "engram", "extra"])).toThrow("does not accept");
});

test("accepts exactly --product engram", () => {
  expect(() => requireEngramProduct(["--product", "engram"])).not.toThrow();
});

test("accepts the --product=engram form too", () => {
  expect(() => requireEngramProduct(["--product=engram"])).not.toThrow();
  expect(() => requireEngramProduct(["--product=atlas"])).toThrow('"engram" is supported today');
  expect(() => requireEngramProduct(["--product="])).toThrow("--product <name>");
});

import type { Terminal } from "@earendil-works/pi-tui";
import { readFile } from "node:fs/promises";
import { runInitCommand } from "./init-engram.ts";

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

test("rejects a missing product before ever starting the terminal UI", async () => {
  const terminal = new TestTerminal();
  await expect(runInitCommand([], { terminal })).rejects.toThrow("--product <name>");
  expect(terminal.output).toBe("");
});

test("rejects a non-interactive terminal", async () => {
  // `interactive: false` is the sole gate here, so this never depends on the test runner's own TTY state.
  await expect(runInitCommand(["--product", "engram"], { interactive: false })).rejects.toThrow("interactive terminal");
});

test("an injected terminal alone is enough to run, even with no TTY on the real process", async () => {
  const stdin = process.stdin.isTTY;
  const stdout = process.stdout.isTTY;
  process.stdin.isTTY = false;
  process.stdout.isTTY = false;
  try {
    const terminal = new TestTerminal();
    process.exitCode = 0;
    const run = runInitCommand(["--product", "engram"], { terminal });
    await tick();
    expect(terminal.output).toContain("Forge614 Engram stores persistent memory locally on this device.");
    terminal.input("\x1b"); // Escape on the intro screen
    await run;
    process.exitCode = 0;
  } finally {
    process.stdin.isTTY = stdin;
    process.stdout.isTTY = stdout;
  }
});

test("cancelling makes zero Engram calls and sets exit code 130", async () => {
  const terminal = new TestTerminal();
  const calls: string[][] = [];
  process.exitCode = 0; // Bun's process.exitCode setter ignores `undefined`, so `0` is the actual reset value.
  const run = runInitCommand(["--product", "engram"], {
    terminal,
    run: async (command, args) => { calls.push([command, ...args]); return { status: 0, stdout: "{}", stderr: "" }; },
  });
  await tick();
  terminal.input("\x1b"); // Escape on the intro screen
  await run;
  expect(calls).toEqual([]);
  expect(process.exitCode as number | undefined).toBe(130);
  process.exitCode = 0; // reset so this test's exit code doesn't leak into the overall `bun test` process exit status
});

test("confirming with local storage only runs exactly init --json", async () => {
  const terminal = new TestTerminal();
  const calls: string[][] = [];
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async (command, args) => { calls.push([command, ...args]); return { status: 0, stdout: "{}", stderr: "" }; },
    enginesRun: async () => ({ status: 0, stdout: JSON.stringify({ schemaVersion: 1, agents: [] }), stderr: "" }),
  });
  await tick();
  terminal.input("\r"); await tick(); // Continue
  terminal.input("\r"); await tick(); // PostgreSQL: No (default)
  terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // Reinforcement: No
  terminal.input("\r"); // Summary: Confirm (default)
  await run;
  expect(calls).toEqual([["/Users/tester/.forge614/engram/bin/forge614-engram", "init", "--json"]]);
});

test("confirming with PostgreSQL sends the connection string only to Engram, never to the screen", async () => {
  const terminal = new TestTerminal();
  const calls: string[][] = [];
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async (command, args) => { calls.push([command, ...args]); return { status: 0, stdout: "{}", stderr: "" }; },
    enginesRun: async () => ({ status: 0, stdout: JSON.stringify({ schemaVersion: 1, agents: [] }), stderr: "" }),
  });
  await tick();
  terminal.input("\r"); await tick(); // Continue
  terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // PostgreSQL: Yes
  terminal.input("postgres://user:pw@host/db");
  terminal.input("\r"); await tick(); // submit connection string
  terminal.input("\r"); await tick(); // Reinforcement: Yes (default)
  terminal.input("\r"); // Summary: Confirm
  await run;
  expect(calls).toEqual([
    ["/Users/tester/.forge614/engram/bin/forge614-engram", "init", "--json", "--postgres-url", "postgres://user:pw@host/db"],
    ["/Users/tester/.forge614/engram/bin/forge614-engram", "reinforcement-enable"],
  ]);
  expect(terminal.output).not.toContain("postgres://user:pw@host/db");
});

test("an Engram failure is reported, not swallowed as success", async () => {
  const terminal = new TestTerminal();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 1, stdout: "", stderr: JSON.stringify({ code: "STORAGE_ERROR", error: "No se pudo completar la operación." }) }),
  });
  await tick();
  terminal.input("\r"); await tick(); // Continue
  terminal.input("\r"); await tick(); // PostgreSQL: No (default)
  terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // Reinforcement: No
  terminal.input("\r"); // Summary: Confirm (default)
  await expect(run).rejects.toThrow("No se pudo completar la operación.");
});

test("a failure that echoes the connection string never leaks it to the error or the screen", async () => {
  const terminal = new TestTerminal();
  const postgresUrl = "postgres://user:sup3rsecret@host:5432/db";
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({
      status: 1,
      stdout: "",
      stderr: JSON.stringify({ code: "POSTGRES_UNAVAILABLE", error: `No se pudo conectar a ${postgresUrl}.` }),
    }),
  });
  await tick();
  terminal.input("\r"); await tick(); // Continue
  terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // PostgreSQL: Yes
  terminal.input(postgresUrl);
  terminal.input("\r"); await tick(); // submit connection string
  terminal.input("\r"); await tick(); // Reinforcement: Yes (default)
  terminal.input("\r"); // Summary: Confirm
  const error = await run.catch((thrown: Error) => thrown);
  expect((error as Error).message).not.toContain(postgresUrl);
  expect((error as Error).message).not.toContain("sup3rsecret");
  expect(terminal.output).not.toContain(postgresUrl);
  expect(terminal.output).not.toContain("sup3rsecret");
});

test("the init command never imports Shell's normal chat startup modules", async () => {
  const source = await readFile(new URL("./init-engram.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/native-chat|visual-picker|engine-picker/);
});

function captureLogs(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(" ")); });
  return { logs, restore: () => spy.mockRestore() };
}

test("choosing one MCP-capable assistant plans and applies exactly that one", async () => {
  const terminal = new TestTerminal();
  const enginesCalls: string[][] = [];
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (command, args) => {
      enginesCalls.push([command, ...args]);
      if (args[0] === "detect") {
        return {
          status: 0,
          stdout: JSON.stringify({ schemaVersion: 1, agents: [
            { id: "claude-code", label: "Claude Code", installed: true, executable: "/usr/local/bin/claude" },
          ] }),
          stderr: "",
        };
      }
      if (args[0] === "capabilities") {
        return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, id: "claude-code", label: "Claude Code", supportsMcp: true, supportsHooks: true, supportsHeadlessExec: true }), stderr: "" };
      }
      if (args[0] === "plan") {
        return {
          status: 0,
          stdout: JSON.stringify({ schemaVersion: 1, plan: { planId: "plan-1", agentId: "claude-code", action: "mcp-install", noop: false, writes: [{ path: "/Users/tester/.claude.json" }] } }),
          stderr: "",
        };
      }
      return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, result: { planId: "plan-1", applied: true, changedFiles: ["/Users/tester/.claude.json"] } }), stderr: "" };
    },
  });
  await tick();
  terminal.input("\r"); await tick(); // Continue
  terminal.input("\r"); await tick(); // PostgreSQL: No
  terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // Reinforcement: No
  terminal.input("\r"); await tick(); // Engram summary: Confirm
  terminal.input(" "); terminal.input("\r"); await tick(); // MCP picker: check Claude Code, submit
  terminal.input("\r"); // MCP preview: Confirm
  await run;
  restore();
  expect(enginesCalls[0]).toEqual(["/Users/tester/.forge614/engines/bin/forge614-engines", "detect"]);
  expect(enginesCalls[1]).toEqual(["/Users/tester/.forge614/engines/bin/forge614-engines", "capabilities", "--agent", "claude-code"]);
  expect(enginesCalls[2]).toEqual([
    "/Users/tester/.forge614/engines/bin/forge614-engines", "plan", "mcp-install",
    "--agent", "claude-code", "--name", "forge614-engram",
    "--command", "/Users/tester/.forge614/engram/bin/forge614-engram", "--args", "mcp",
  ]);
  expect(enginesCalls[3]).toEqual(["/Users/tester/.forge614/engines/bin/forge614-engines", "apply", "--plan-id", "plan-1"]);
  expect(logs).toContain("Claude Code: configured");
});

test("selecting no assistants initializes Engram without configuring any MCP", async () => {
  const terminal = new TestTerminal();
  const enginesCalls: string[][] = [];
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (command, args) => {
      enginesCalls.push([command, ...args]);
      if (args[0] === "detect") {
        return {
          status: 0,
          stdout: JSON.stringify({ schemaVersion: 1, agents: [
            { id: "claude-code", label: "Claude Code", installed: true, executable: "/usr/local/bin/claude" },
          ] }),
          stderr: "",
        };
      }
      return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, id: "claude-code", label: "Claude Code", supportsMcp: true, supportsHooks: true, supportsHeadlessExec: true }), stderr: "" };
    },
  });
  await tick();
  terminal.input("\r"); await tick();
  terminal.input("\r"); await tick();
  terminal.input("\x1b[B"); terminal.input("\r"); await tick();
  terminal.input("\r"); await tick(); // Engram summary confirm
  terminal.input("\r"); // MCP picker: submit with nothing checked
  await run;
  restore();
  expect(enginesCalls).toEqual([
    ["/Users/tester/.forge614/engines/bin/forge614-engines", "detect"],
    ["/Users/tester/.forge614/engines/bin/forge614-engines", "capabilities", "--agent", "claude-code"],
  ]);
  expect(logs).toContain("No assistant was selected. No MCP was configured.");
});

test("an already-configured assistant is reported without an apply call", async () => {
  const terminal = new TestTerminal();
  const enginesCalls: string[][] = [];
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (command, args) => {
      enginesCalls.push([command, ...args]);
      if (args[0] === "detect") {
        return {
          status: 0,
          stdout: JSON.stringify({ schemaVersion: 1, agents: [
            { id: "claude-code", label: "Claude Code", installed: true, executable: "/usr/local/bin/claude" },
          ] }),
          stderr: "",
        };
      }
      if (args[0] === "capabilities") {
        return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, id: "claude-code", label: "Claude Code", supportsMcp: true, supportsHooks: true, supportsHeadlessExec: true }), stderr: "" };
      }
      return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, plan: { planId: "plan-1", agentId: "claude-code", action: "mcp-install", noop: true, writes: [] } }), stderr: "" };
    },
  });
  await tick();
  terminal.input("\r"); await tick();
  terminal.input("\r"); await tick();
  terminal.input("\x1b[B"); terminal.input("\r"); await tick();
  terminal.input("\r"); await tick();
  terminal.input(" "); terminal.input("\r"); // check + submit
  await run;
  restore();
  expect(enginesCalls.filter(call => call.includes("apply")).length).toBe(0);
  expect(logs).toContain("Claude Code: already configured");
});

test("a plan error is shown as not configured and never applied", async () => {
  const terminal = new TestTerminal();
  const enginesCalls: string[][] = [];
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (command, args) => {
      enginesCalls.push([command, ...args]);
      if (args[0] === "detect") {
        return {
          status: 0,
          stdout: JSON.stringify({ schemaVersion: 1, agents: [
            { id: "claude-code", label: "Claude Code", installed: true, executable: "/usr/local/bin/claude" },
          ] }),
          stderr: "",
        };
      }
      if (args[0] === "capabilities") {
        return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, id: "claude-code", label: "Claude Code", supportsMcp: true, supportsHooks: true, supportsHeadlessExec: true }), stderr: "" };
      }
      return { status: 1, stdout: JSON.stringify({ schemaVersion: 1, error: { code: "CONFLICT", message: "A different MCP already uses this name." } }), stderr: "" };
    },
  });
  await tick();
  terminal.input("\r"); await tick();
  terminal.input("\r"); await tick();
  terminal.input("\x1b[B"); terminal.input("\r"); await tick();
  terminal.input("\r"); await tick();
  terminal.input(" "); terminal.input("\r"); // check + submit
  await run;
  restore();
  expect(enginesCalls.filter(call => call.includes("apply")).length).toBe(0);
  expect(logs).toContain("Claude Code: not configured — A different MCP already uses this name.");
});

test("cancelling the MCP preview confirmation applies nothing", async () => {
  const terminal = new TestTerminal();
  const enginesCalls: string[][] = [];
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (command, args) => {
      enginesCalls.push([command, ...args]);
      if (args[0] === "detect") {
        return {
          status: 0,
          stdout: JSON.stringify({ schemaVersion: 1, agents: [
            { id: "claude-code", label: "Claude Code", installed: true, executable: "/usr/local/bin/claude" },
          ] }),
          stderr: "",
        };
      }
      if (args[0] === "capabilities") {
        return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, id: "claude-code", label: "Claude Code", supportsMcp: true, supportsHooks: true, supportsHeadlessExec: true }), stderr: "" };
      }
      return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, plan: { planId: "plan-1", agentId: "claude-code", action: "mcp-install", noop: false, writes: [{ path: "/Users/tester/.claude.json" }] } }), stderr: "" };
    },
  });
  await tick();
  terminal.input("\r"); await tick();
  terminal.input("\r"); await tick();
  terminal.input("\x1b[B"); terminal.input("\r"); await tick();
  terminal.input("\r"); await tick();
  terminal.input(" "); terminal.input("\r"); await tick(); // check + submit MCP picker
  terminal.input("\x1b[B"); terminal.input("\r"); // preview: move to Cancel, submit
  await run;
  restore();
  expect(enginesCalls.filter(call => call.includes("apply")).length).toBe(0);
  expect(logs).toContain("Claude Code: skipped");
});

test("two selected assistants report independently when one apply fails", async () => {
  const terminal = new TestTerminal();
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      if (args[0] === "detect") {
        return {
          status: 0,
          stdout: JSON.stringify({ schemaVersion: 1, agents: [
            { id: "claude-code", label: "Claude Code", installed: true, executable: "/usr/local/bin/claude" },
            { id: "codex", label: "Codex", installed: true, executable: "/usr/local/bin/codex" },
          ] }),
          stderr: "",
        };
      }
      if (args[0] === "capabilities") {
        const agentId = args[args.indexOf("--agent") + 1];
        return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, id: agentId, label: agentId, supportsMcp: true, supportsHooks: true, supportsHeadlessExec: true }), stderr: "" };
      }
      if (args[0] === "plan") {
        const agentId = args[args.indexOf("--agent") + 1];
        return {
          status: 0,
          stdout: JSON.stringify({ schemaVersion: 1, plan: { planId: `plan-${agentId}`, agentId, action: "mcp-install", noop: false, writes: [{ path: `/Users/tester/.${agentId}.json` }] } }),
          stderr: "",
        };
      }
      if (args.includes("plan-codex")) {
        return { status: 1, stdout: JSON.stringify({ schemaVersion: 1, error: { code: "WRITE_FAILED", message: "Could not write the Codex config file." } }), stderr: "" };
      }
      return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, result: { planId: "plan-claude-code", applied: true, changedFiles: ["/Users/tester/.claude-code.json"] } }), stderr: "" };
    },
  });
  await tick();
  terminal.input("\r"); await tick();
  terminal.input("\r"); await tick();
  terminal.input("\x1b[B"); terminal.input("\r"); await tick();
  terminal.input("\r"); await tick();
  terminal.input(" "); terminal.input("\x1b[B"); terminal.input(" "); terminal.input("\r"); await tick(); // check both, submit
  terminal.input("\r"); // preview: Confirm
  await run;
  restore();
  expect(logs).toContain("Claude Code: configured");
  expect(logs).toContain("Codex: not configured — Could not write the Codex config file.");
});
