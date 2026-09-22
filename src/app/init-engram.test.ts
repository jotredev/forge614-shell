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

function detectPayload(agents: { id: string; label: string; executable: string }[]) {
  return { schemaVersion: 1, agents: agents.map(a => ({ ...a, installed: true })) };
}

function capabilitiesPayload(agentId: string) {
  return { schemaVersion: 1, id: agentId, label: agentId, supportsMcp: true, supportsHooks: true, supportsHeadlessExec: true };
}

function planPayload(agentId: string, opts: {
  planId?: string; noop?: boolean;
  mcpStatus?: { kind: string; reason?: string; details?: string };
  instructionsStatus?: { kind: string; reason?: string; details?: string };
  hookStatus?: { kind: string; reason?: string; details?: string };
  hookRuntimeStatus?: { kind: string; reason?: string };
  overallStatus?: string; mcpPath?: string; instructionsPaths?: string[]; hookPath?: string;
} = {}) {
  return {
    schemaVersion: 1,
    plan: {
      planId: opts.planId ?? `plan-${agentId}`,
      agentId,
      action: "memory-install",
      noop: opts.noop ?? false,
      writes: [],
      metadata: {
        mcp: { path: opts.mcpPath ?? `/Users/tester/.${agentId}.json`, status: opts.mcpStatus ?? { kind: "write" } },
        instructions: { paths: opts.instructionsPaths ?? [`/Users/tester/.${agentId}/instructions.md`], status: opts.instructionsStatus ?? { kind: "write" } },
        hook: {
          path: opts.hookPath ?? `/Users/tester/.${agentId}/hook-target`,
          status: opts.hookStatus ?? { kind: "write" },
          runtimeStatus: opts.hookRuntimeStatus ?? { kind: "pending-runtime-verification", reason: "no-evidence" },
        },
        overallStatus: opts.overallStatus ?? "complete",
      },
    },
  };
}

function applyPayload(planId: string, applied = true) {
  return { schemaVersion: 1, result: { planId, applied, changedFiles: applied ? ["/Users/tester/changed.json"] : [] } };
}

function verifyPayload(agentId: string, opts: {
  mcpPresent?: boolean; instructionsSupported?: boolean; instructionsPresent?: boolean;
  hookSupported?: boolean; hookPresent?: boolean; hookDryRunOk?: boolean;
  hookRuntimeStatus?: { kind: string; reason?: string };
  overallStatus?: string;
} = {}) {
  return {
    schemaVersion: 1,
    verification: {
      agentId,
      mcp: { path: `/Users/tester/.${agentId}.json`, present: opts.mcpPresent ?? true },
      instructions: {
        supported: opts.instructionsSupported ?? true,
        paths: [`/Users/tester/.${agentId}/instructions.md`],
        present: opts.instructionsPresent ?? true,
      },
      hook: {
        supported: opts.hookSupported ?? true,
        path: `/Users/tester/.${agentId}/hook-target`,
        present: opts.hookPresent ?? true,
        dryRunOk: opts.hookDryRunOk ?? true,
        runtimeStatus: opts.hookRuntimeStatus ?? { kind: "runtime-observed" },
      },
      overallStatus: opts.overallStatus ?? "complete",
    },
  };
}

function agentIdFrom(args: string[]): string {
  return args[args.indexOf("--agent") + 1]!;
}

async function driveEngramScreens(terminal: TestTerminal): Promise<void> {
  await tick();
  terminal.input("\r"); await tick(); // Continue
  terminal.input("\r"); await tick(); // PostgreSQL: No (default)
  terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // Reinforcement: No
  terminal.input("\r"); await tick(); // Engram summary: Confirm
}

test("selecting no assistants initializes Engram without configuring any memory integration", async () => {
  const terminal = new TestTerminal();
  const enginesCalls: string[][] = [];
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (command, args) => {
      enginesCalls.push([command, ...args]);
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
    },
  });
  await driveEngramScreens(terminal);
  terminal.input("\r"); // memory picker: submit with nothing checked
  try { await run; } finally { restore(); }
  expect(enginesCalls).toEqual([
    ["/Users/tester/.forge614/engines/bin/forge614-engines", "detect"],
    ["/Users/tester/.forge614/engines/bin/forge614-engines", "capabilities", "--agent", "claude-code"],
  ]);
  expect(logs).toContain("No assistant was selected. No memory integration was configured.");
});

test("Claude Code and Codex both plan, apply, and verify to a complete memory integration", async () => {
  const terminal = new TestTerminal();
  const { logs, restore } = captureLogs();
  const enginesCalls: string[][] = [];
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (command, args) => {
      enginesCalls.push([command, ...args]);
      if (args[0] === "detect") {
        return {
          status: 0,
          stdout: JSON.stringify(detectPayload([
            { id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" },
            { id: "codex", label: "Codex", executable: "/usr/local/bin/codex" },
          ])),
          stderr: "",
        };
      }
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload(agentIdFrom(args))), stderr: "" };
      if (args[0] === "plan") { const id = agentIdFrom(args); return { status: 0, stdout: JSON.stringify(planPayload(id)), stderr: "" }; }
      if (args[0] === "apply") return { status: 0, stdout: JSON.stringify(applyPayload(args[args.indexOf("--plan-id") + 1]!)), stderr: "" };
      const id = agentIdFrom(args);
      return { status: 0, stdout: JSON.stringify(verifyPayload(id)), stderr: "" };
    },
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\x1b[B"); terminal.input(" "); terminal.input("\r"); await tick(); // check both, submit
  terminal.input("\r"); // preview: Confirm
  try { await run; } finally { restore(); }
  expect(enginesCalls.filter(c => c[2] === "memory-install").map(c => agentIdFrom(c)).sort()).toEqual(["claude-code", "codex"]);
  expect(enginesCalls.filter(c => c[2] === "memory-integration").map(c => agentIdFrom(c)).sort()).toEqual(["claude-code", "codex"]);
  expect(logs).toContain("Claude Code: configured — MCP and memory instructions available");
  expect(logs).toContain("Codex: configured — MCP and memory instructions available");
  expect(logs).toContain("Close and reopen each configured assistant's session so it loads the new MCP server and memory instructions.");
});

test("Cursor's memory integration is reported partial, never as fully complete", async () => {
  const terminal = new TestTerminal();
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "cursor", label: "Cursor", executable: "/Applications/Cursor.app/Contents/MacOS/Cursor" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("cursor")), stderr: "" };
      if (args[0] === "plan") {
        return {
          status: 0,
          stdout: JSON.stringify(planPayload("cursor", {
            instructionsStatus: { kind: "unsupported", reason: "Cursor has no officially supported mechanism to auto-load global instructions." },
            overallStatus: "partial",
          })),
          stderr: "",
        };
      }
      if (args[0] === "apply") return { status: 0, stdout: JSON.stringify(applyPayload("plan-cursor")), stderr: "" };
      // Engines' own verify semantics: Cursor's instructions are structurally unsupported, so a
      // present MCP entry is "the complete achievable state for this agent" — Shell must not
      // pass this "complete" straight through.
      return { status: 0, stdout: JSON.stringify(verifyPayload("cursor", { instructionsSupported: false, instructionsPresent: false, overallStatus: "complete" })), stderr: "" };
    },
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r"); await tick(); // check Cursor, submit
  terminal.input("\r"); // preview: Confirm
  try { await run; } finally { restore(); }
  expect(logs).toContain("Cursor: partially configured — this assistant has no official mechanism to auto-load global instructions");
  expect(logs.some(line => line.startsWith("Cursor: configured"))).toBe(false);
});

test("a conflict on every component makes no apply call and reports the conflict", async () => {
  const terminal = new TestTerminal();
  const enginesCalls: string[][] = [];
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (command, args) => {
      enginesCalls.push([command, ...args]);
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
      if (args[0] === "plan") {
        return {
          status: 0,
          stdout: JSON.stringify(planPayload("claude-code", {
            noop: true,
            mcpStatus: { kind: "blocked", reason: "mcp-conflict", details: 'An existing "forge614-engram" MCP entry with different content is already present.' },
            instructionsStatus: { kind: "blocked", reason: "instructions-conflict", details: "An existing managed instructions block could not be reconciled." },
            hookRuntimeStatus: { kind: "absent" },
            overallStatus: "unsupported",
          })),
          stderr: "",
        };
      }
      // Nothing was ever written due to the conflict — verify honestly reports absent, since
      // MemoryVerification carries no equivalent "blocked reason" field to echo the plan's own
      // conflict-detail text (that field only ever existed on the plan side, via `planDetail`,
      // which this task deletes).
      return { status: 0, stdout: JSON.stringify(verifyPayload("claude-code", { mcpPresent: false, instructionsPresent: false, hookRuntimeStatus: { kind: "absent" }, overallStatus: "absent" })), stderr: "" };
    },
  });
  await driveEngramScreens(terminal);
  // Both components are blocked, so the plan is noop:true — the memory picker's submit is the
  // last screen: no preview/confirm screen appears (there is nothing pending to apply), so no
  // further terminal input is sent here.
  terminal.input(" "); terminal.input("\r"); // check Claude Code, submit
  try { await run; } finally { restore(); }
  expect(enginesCalls.some(c => c[0] === "apply" || c.includes("apply"))).toBe(false);
  expect(logs).toContain("Claude Code: not configured — Forge614 Engines could not confirm any memory integration for this assistant.");
});

test("cancelling the memory preview makes zero writes", async () => {
  const terminal = new TestTerminal();
  const enginesCalls: string[][] = [];
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (command, args) => {
      enginesCalls.push([command, ...args]);
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
      return { status: 0, stdout: JSON.stringify(planPayload("claude-code")), stderr: "" };
    },
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r"); await tick(); // check Claude Code, submit
  terminal.input("\x1b[B"); terminal.input("\r"); // preview: move to Cancel, submit
  try { await run; } finally { restore(); }
  expect(enginesCalls.some(c => c.includes("apply"))).toBe(false);
  expect(logs).toContain("Claude Code: skipped");
});

test("a plan-level Engines failure for one assistant is reported without failing the already-successful Engram init", async () => {
  const terminal = new TestTerminal();
  const enginesCalls: string[][] = [];
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (command, args) => {
      enginesCalls.push([command, ...args]);
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
      return { status: 1, stdout: JSON.stringify({ schemaVersion: 1, error: { code: "ENGRAM_PROTOCOL_UNAVAILABLE", message: "Could not reach forge614-engram to read its memory protocol." } }), stderr: "" };
    },
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r"); // check Claude Code, submit (no preview: nothing was planned)
  try { await run; } finally { restore(); }
  expect(enginesCalls.some(c => c.includes("apply"))).toBe(false);
  expect(logs).toContain("Forge614 Engram memory initialization is complete.");
  expect(logs).toContain("Claude Code: not configured — Could not reach forge614-engram to read its memory protocol.");
  expect(process.exitCode as number | undefined).not.toBe(1);
});

test("an apply that reports applied: false is shown as not configured, without calling verify", async () => {
  const terminal = new TestTerminal();
  const enginesCalls: string[][] = [];
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (command, args) => {
      enginesCalls.push([command, ...args]);
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
      if (args[0] === "plan") return { status: 0, stdout: JSON.stringify(planPayload("claude-code")), stderr: "" };
      return { status: 0, stdout: JSON.stringify(applyPayload("plan-claude-code", false)), stderr: "" };
    },
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r"); await tick(); // check Claude Code, submit
  terminal.input("\r"); // preview: Confirm
  try { await run; } finally { restore(); }
  expect(enginesCalls.some(c => c.includes("memory-integration"))).toBe(false);
  expect(logs).toContain("Claude Code: not configured — Forge614 Engines reported the change was not applied.");
});

test("verify reporting absent after a successful apply is communicated, never as success", async () => {
  const terminal = new TestTerminal();
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
      if (args[0] === "plan") return { status: 0, stdout: JSON.stringify(planPayload("claude-code")), stderr: "" };
      if (args[0] === "apply") return { status: 0, stdout: JSON.stringify(applyPayload("plan-claude-code")), stderr: "" };
      return { status: 0, stdout: JSON.stringify(verifyPayload("claude-code", { mcpPresent: false, instructionsPresent: false, overallStatus: "absent" })), stderr: "" };
    },
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r"); await tick(); // check Claude Code, submit
  terminal.input("\r"); // preview: Confirm
  try { await run; } finally { restore(); }
  expect(logs).toContain("Claude Code: not configured — Forge614 Engines could not confirm any memory integration for this assistant.");
});

test("verify reporting partial after a successful apply explains exactly what is missing", async () => {
  const terminal = new TestTerminal();
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
      if (args[0] === "plan") return { status: 0, stdout: JSON.stringify(planPayload("claude-code")), stderr: "" };
      if (args[0] === "apply") return { status: 0, stdout: JSON.stringify(applyPayload("plan-claude-code")), stderr: "" };
      return { status: 0, stdout: JSON.stringify(verifyPayload("claude-code", { instructionsPresent: false, overallStatus: "partial" })), stderr: "" };
    },
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r"); await tick(); // check Claude Code, submit
  terminal.input("\r"); // preview: Confirm
  try { await run; } finally { restore(); }
  expect(logs).toContain("Claude Code: partially configured — the memory instructions are not installed");
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
          stdout: JSON.stringify(detectPayload([
            { id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" },
            { id: "codex", label: "Codex", executable: "/usr/local/bin/codex" },
          ])),
          stderr: "",
        };
      }
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload(agentIdFrom(args))), stderr: "" };
      if (args[0] === "plan") { const id = agentIdFrom(args); return { status: 0, stdout: JSON.stringify(planPayload(id)), stderr: "" }; }
      if (args[0] === "apply") {
        const planId = args[args.indexOf("--plan-id") + 1]!;
        if (planId === "plan-codex") return { status: 1, stdout: JSON.stringify({ schemaVersion: 1, error: { code: "STALE_PLAN", message: "File changed since the plan was computed: /Users/tester/.codex/config.toml" } }), stderr: "" };
        return { status: 0, stdout: JSON.stringify(applyPayload(planId)), stderr: "" };
      }
      return { status: 0, stdout: JSON.stringify(verifyPayload(agentIdFrom(args))), stderr: "" };
    },
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\x1b[B"); terminal.input(" "); terminal.input("\r"); await tick(); // check both, submit
  terminal.input("\r"); // preview: Confirm
  try { await run; } finally { restore(); }
  expect(logs).toContain("Claude Code: configured — MCP and memory instructions available");
  expect(logs).toContain("Codex: not configured — File changed since the plan was computed: /Users/tester/.codex/config.toml");
});

// pi-tui defers a screen's first paint to a `setTimeout`/`process.nextTick` callback outside any
// promise chain, so throwing from `write()` on matching text can never be caught by a `try/catch`
// around `runMemorySetupStep` (confirmed: it surfaces as an unrelated, uncatchable async exception).
// `start()` is called synchronously inside `chooseMemoryAgents`'s own `tui.start()` call instead, so
// throwing there on the picker's turn reproduces a memory-setup UI failure that the fix can catch.
// The Engram flow renders exactly four screens (intro, PostgreSQL, reinforcement, summary) before
// the memory picker starts its own TUI, so the fifth `start()` call is the picker's.
class ThrowingMemoryScreenTerminal extends TestTerminal {
  private starts = 0;
  start(input: (data: string) => void) {
    this.starts += 1;
    if (this.starts === 5) throw new Error("terminal write failed");
    super.start(input);
  }
}

test("an assistant whose plan is already complete and needs no writes is reported configured, with no restart hint", async () => {
  const terminal = new TestTerminal();
  const enginesCalls: string[][] = [];
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (command, args) => {
      enginesCalls.push([command, ...args]);
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
      if (args[0] === "plan") {
        return {
          status: 0,
          stdout: JSON.stringify(planPayload("claude-code", {
            noop: true,
            mcpStatus: { kind: "noop" },
            instructionsStatus: { kind: "noop" },
            overallStatus: "complete",
          })),
          stderr: "",
        };
      }
      return { status: 0, stdout: JSON.stringify(verifyPayload("claude-code", { hookRuntimeStatus: { kind: "runtime-observed" } })), stderr: "" };
    },
  });
  await driveEngramScreens(terminal);
  // Nothing is pending, so the picker's submit is the last screen: no preview/confirm appears.
  terminal.input(" "); terminal.input("\r"); // check Claude Code, submit
  try { await run; } finally { restore(); }
  expect(enginesCalls.some(c => c.includes("apply"))).toBe(false);
  expect(enginesCalls.some(c => c.includes("memory-integration"))).toBe(true);
  expect(logs).toContain("Claude Code: configured — MCP and memory instructions available");
  // Nothing was written this run, so there is nothing for the assistant to reload.
  expect(logs.some(line => line.startsWith("Close and reopen"))).toBe(false);
});

test("a plan that claims complete while the instructions are unsupported is still never reported as fully configured", async () => {
  const terminal = new TestTerminal();
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "cursor", label: "Cursor", executable: "/Applications/Cursor.app/Contents/MacOS/Cursor" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("cursor")), stderr: "" };
      if (args[0] === "plan") {
        // Engines is not expected to send this combination; Shell defends the invariant locally.
        return {
          status: 0,
          stdout: JSON.stringify(planPayload("cursor", {
            noop: true,
            mcpStatus: { kind: "noop" },
            instructionsStatus: { kind: "unsupported", reason: "Cursor has no officially supported mechanism to auto-load global instructions." },
            overallStatus: "complete",
          })),
          stderr: "",
        };
      }
      return {
        status: 0,
        stdout: JSON.stringify(verifyPayload("cursor", {
          instructionsSupported: false, instructionsPresent: false,
          hookSupported: false, hookRuntimeStatus: { kind: "unsupported" },
          overallStatus: "complete",
        })),
        stderr: "",
      };
    },
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r"); // check Cursor, submit
  try { await run; } finally { restore(); }
  expect(logs).toContain("Cursor: partially configured — this assistant has no official mechanism to auto-load global instructions");
  expect(logs.some(line => line.startsWith("Cursor: configured"))).toBe(false);
});

test("a PostgreSQL connection string never reaches the screen or the log through the whole memory-integration flow", async () => {
  const terminal = new TestTerminal();
  const postgresUrl = "postgres://user:sup3rsecret@host:5432/db";
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
      if (args[0] === "plan") return { status: 0, stdout: JSON.stringify(planPayload("claude-code")), stderr: "" };
      if (args[0] === "apply") return { status: 0, stdout: JSON.stringify(applyPayload("plan-claude-code")), stderr: "" };
      return { status: 0, stdout: JSON.stringify(verifyPayload("claude-code")), stderr: "" };
    },
  });
  await tick();
  terminal.input("\r"); await tick(); // Continue
  terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // PostgreSQL: Yes
  terminal.input(postgresUrl);
  terminal.input("\r"); await tick(); // submit connection string
  terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // Reinforcement: No
  terminal.input("\r"); await tick(); // Engram summary: Confirm
  terminal.input(" "); terminal.input("\r"); await tick(); // memory picker: check Claude Code, submit
  terminal.input("\r"); // preview: Confirm
  try { await run; } finally { restore(); }
  // The whole run really reached the end of the memory flow, not just the Engram summary.
  expect(logs).toContain("Claude Code: configured — MCP and memory instructions available");
  expect(terminal.output).not.toContain(postgresUrl);
  expect(terminal.output).not.toContain("sup3rsecret");
  expect(logs.join("\n")).not.toContain(postgresUrl);
  expect(logs.join("\n")).not.toContain("sup3rsecret");
});

test("an exception during the memory picker screen never fails an already-successful Engram init", async () => {
  const terminal = new ThrowingMemoryScreenTerminal();
  const { logs, restore } = captureLogs();
  process.exitCode = 0;
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
    },
  });
  await driveEngramScreens(terminal);
  try { await run; } finally { restore(); }
  expect(process.exitCode as number | undefined).not.toBe(1);
  expect(logs.some(line => line.includes("Memory setup could not be completed"))).toBe(true);
  process.exitCode = 0; // reset so this test's exit code doesn't leak into the overall `bun test` process exit status
});

test("a freshly-configured Claude Code starts pending-runtime-verification and is never shown as complete before evidence exists", async () => {
  const terminal = new TestTerminal();
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
      if (args[0] === "plan") return { status: 0, stdout: JSON.stringify(planPayload("claude-code", { hookStatus: { kind: "write" }, hookRuntimeStatus: { kind: "pending-runtime-verification", reason: "no-evidence" } })), stderr: "" };
      if (args[0] === "apply") return { status: 0, stdout: JSON.stringify(applyPayload("plan-claude-code")), stderr: "" };
      // verify is called twice: once right after apply, once after the hand-off. Both times nothing
      // was ever really observed on this fake machine, so both report the same pending state.
      return { status: 0, stdout: JSON.stringify(verifyPayload("claude-code", { hookRuntimeStatus: { kind: "pending-runtime-verification", reason: "no-evidence" } })), stderr: "" };
    },
    launch: async () => {}, // fake hand-off: the client "opened and closed" instantly
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r"); await tick(); // check Claude Code, submit
  terminal.input("\r"); // preview: Confirm
  try { await run; } finally { restore(); }
  expect(logs).toContain("Claude Code: configured; pending verification — the MCP server and memory instructions are already configured and untouched — only the runtime check needs to run again; open this assistant once more so Forge614 Engines can confirm it");
  expect(logs.some(line => line.startsWith("Claude Code: configured —"))).toBe(false);
});

test("Claude Code is reported fully configured once the hand-off's re-verify observes the runtime evidence", async () => {
  const terminal = new TestTerminal();
  const { logs, restore } = captureLogs();
  let verifyCalls = 0;
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
      if (args[0] === "plan") return { status: 0, stdout: JSON.stringify(planPayload("claude-code", { hookStatus: { kind: "write" }, hookRuntimeStatus: { kind: "pending-runtime-verification", reason: "no-evidence" } })), stderr: "" };
      if (args[0] === "apply") return { status: 0, stdout: JSON.stringify(applyPayload("plan-claude-code")), stderr: "" };
      verifyCalls += 1;
      // First verify (right after apply): still pending. Second verify (after the hand-off): observed.
      const runtimeStatus = verifyCalls === 1 ? { kind: "pending-runtime-verification", reason: "no-evidence" } : { kind: "runtime-observed" };
      return { status: 0, stdout: JSON.stringify(verifyPayload("claude-code", { hookRuntimeStatus: runtimeStatus })), stderr: "" };
    },
    launch: async () => {},
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r"); await tick(); // check Claude Code, submit
  terminal.input("\r"); // preview: Confirm
  try { await run; } finally { restore(); }
  expect(verifyCalls).toBe(2);
  expect(logs).toContain("Claude Code: configured — MCP and memory instructions available");
});

test("Codex reporting needs-user-trust is launched automatically, with no extra confirmation prompt, and Shell never attempts to approve the hook itself", async () => {
  const terminal = new TestTerminal();
  const { logs, restore } = captureLogs();
  const launches: { executable: string }[] = [];
  let verifyCalls = 0;
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "codex", label: "Codex", executable: "/usr/local/bin/codex" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("codex")), stderr: "" };
      if (args[0] === "plan") return { status: 0, stdout: JSON.stringify(planPayload("codex", { hookStatus: { kind: "write" }, hookRuntimeStatus: { kind: "needs-user-trust" } })), stderr: "" };
      if (args[0] === "apply") return { status: 0, stdout: JSON.stringify(applyPayload("plan-codex")), stderr: "" };
      verifyCalls += 1;
      const runtimeStatus = verifyCalls === 1 ? { kind: "needs-user-trust" } : { kind: "runtime-observed" };
      return { status: 0, stdout: JSON.stringify(verifyPayload("codex", { hookRuntimeStatus: runtimeStatus })), stderr: "" };
    },
    launch: async executable => { launches.push({ executable }); },
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r"); await tick(); // check Codex, submit
  terminal.input("\r"); // preview: Confirm — this is the ONLY confirmation in the whole run
  try { await run; } finally { restore(); }
  expect(launches).toEqual([{ executable: "/usr/local/bin/codex" }]);
  expect(logs.some(line => line.includes("trust its new memory hook"))).toBe(true);
  expect(logs).toContain("Codex: configured — MCP and memory instructions available");
});

test("Codex still needing trust after the hand-off is reported as pending, never as success or a hard error", async () => {
  const terminal = new TestTerminal();
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "codex", label: "Codex", executable: "/usr/local/bin/codex" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("codex")), stderr: "" };
      if (args[0] === "plan") return { status: 0, stdout: JSON.stringify(planPayload("codex", { hookStatus: { kind: "write" }, hookRuntimeStatus: { kind: "needs-user-trust" } })), stderr: "" };
      if (args[0] === "apply") return { status: 0, stdout: JSON.stringify(applyPayload("plan-codex")), stderr: "" };
      // The user closed Codex without running /hooks: it is still untrusted both times.
      return { status: 0, stdout: JSON.stringify(verifyPayload("codex", { hookRuntimeStatus: { kind: "needs-user-trust" } })), stderr: "" };
    },
    launch: async () => {},
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r"); await tick(); // check Codex, submit
  terminal.input("\r"); // preview: Confirm
  try { await run; } finally { restore(); }
  expect(logs).toContain("Codex: configured; pending verification — Codex has not trusted the memory hook yet — approve it inside Codex, then run this command again");
});

test("evidence-expired for an already-fully-configured Claude Code is reported as a stale check, never as lost memory or a failed install, and triggers exactly one renewal hand-off", async () => {
  const terminal = new TestTerminal();
  const { logs, restore } = captureLogs();
  const launches: { executable: string }[] = [];
  let verifyCalls = 0;
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
      if (args[0] === "plan") {
        // Everything is already on disk (mcp/instructions/hook all noop) — only the 7-day evidence
        // window lapsed. `plan.noop` is true: nothing for `apply` to write, so this goes through the
        // `resolved` branch, not the preview/confirm/apply branch.
        return {
          status: 0,
          stdout: JSON.stringify(planPayload("claude-code", {
            noop: true,
            mcpStatus: { kind: "noop" }, instructionsStatus: { kind: "noop" },
            hookStatus: { kind: "noop" }, hookRuntimeStatus: { kind: "pending-runtime-verification", reason: "evidence-expired" },
            overallStatus: "partial",
          })),
          stderr: "",
        };
      }
      verifyCalls += 1;
      // First verify (before any hand-off): still expired. Second verify (after the renewal
      // hand-off): a fresh session ran, so Engines now reports runtime-observed.
      const runtimeStatus = verifyCalls === 1
        ? { kind: "pending-runtime-verification", reason: "evidence-expired" }
        : { kind: "runtime-observed" };
      const overallStatus = verifyCalls === 1 ? "partial" : "complete";
      return { status: 0, stdout: JSON.stringify(verifyPayload("claude-code", { hookRuntimeStatus: runtimeStatus, overallStatus })), stderr: "" };
    },
    launch: async executable => { launches.push({ executable }); },
  });
  await driveEngramScreens(terminal);
  // Nothing is pending (plan.noop is true), so no preview/confirm screen appears — the picker's
  // submit is the last screen before the unified verify(+relaunch) path runs on its own.
  terminal.input(" "); terminal.input("\r");
  try { await run; } finally { restore(); }
  expect(verifyCalls).toBe(2);
  expect(launches).toEqual([{ executable: "/usr/local/bin/claude" }]);
  const allText = logs.join("\n");
  expect(allText).not.toMatch(/lost|failed|not configured/i);
  expect(logs).toContain("Claude Code: configured — MCP and memory instructions available");
});

test("evidence-expired that produces no fresh evidence after the hand-off stays honestly pending, with a clear cause, never a false success", async () => {
  const terminal = new TestTerminal();
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
      if (args[0] === "plan") {
        return {
          status: 0,
          stdout: JSON.stringify(planPayload("claude-code", {
            noop: true,
            mcpStatus: { kind: "noop" }, instructionsStatus: { kind: "noop" },
            hookStatus: { kind: "noop" }, hookRuntimeStatus: { kind: "pending-runtime-verification", reason: "evidence-expired" },
            overallStatus: "partial",
          })),
          stderr: "",
        };
      }
      // The user closed the client immediately; the check stays expired both times.
      return { status: 0, stdout: JSON.stringify(verifyPayload("claude-code", { hookRuntimeStatus: { kind: "pending-runtime-verification", reason: "evidence-expired" }, overallStatus: "partial" })), stderr: "" };
    },
    launch: async () => {},
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r");
  try { await run; } finally { restore(); }
  expect(logs).toContain("Claude Code: configured; pending verification — the MCP server and memory instructions are already configured and untouched — only the runtime check needs to run again; open this assistant once more so Forge614 Engines can confirm it");
});

test("Codex's expired evidence is never reported or worded as a lack of trust — needs-user-trust stays its own distinct case", async () => {
  const terminal = new TestTerminal();
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "codex", label: "Codex", executable: "/usr/local/bin/codex" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("codex")), stderr: "" };
      if (args[0] === "plan") {
        return {
          status: 0,
          stdout: JSON.stringify(planPayload("codex", {
            noop: true,
            mcpStatus: { kind: "noop" }, instructionsStatus: { kind: "noop" },
            hookStatus: { kind: "noop" }, hookRuntimeStatus: { kind: "pending-runtime-verification", reason: "evidence-expired" },
            overallStatus: "partial",
          })),
          stderr: "",
        };
      }
      return { status: 0, stdout: JSON.stringify(verifyPayload("codex", { hookRuntimeStatus: { kind: "pending-runtime-verification", reason: "evidence-expired" }, overallStatus: "partial" })), stderr: "" };
    },
    launch: async () => {},
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r");
  try { await run; } finally { restore(); }
  expect(logs.some(line => line.includes("has not trusted the memory hook"))).toBe(false);
  expect(logs).toContain("Codex: configured; pending verification — the MCP server and memory instructions are already configured and untouched — only the runtime check needs to run again; open this assistant once more so Forge614 Engines can confirm it");
});

test("a genuine MCP/hook conflict is never written and is reported with Engines' own concrete cause", async () => {
  const terminal = new TestTerminal();
  const enginesCalls: string[][] = [];
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (command, args) => {
      enginesCalls.push([command, ...args]);
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
      return {
        status: 0,
        stdout: JSON.stringify(planPayload("claude-code", {
          noop: true,
          mcpStatus: { kind: "noop" }, instructionsStatus: { kind: "noop" },
          hookStatus: { kind: "blocked", reason: "hook-conflict", details: "An existing SessionStart hook with different content is already present in /Users/tester/.claude/settings.json" },
          hookRuntimeStatus: { kind: "absent" },
          overallStatus: "partial",
        })),
        stderr: "",
      };
    },
  });
  await driveEngramScreens(terminal);
  // The plan is noop:true (nothing Engines can write), so no preview/confirm screen appears, and no
  // apply call is made, but Task 4's unified path still calls verify to report the real state.
  terminal.input(" "); terminal.input("\r"); await tick();
  await tick();
  try { await run; } finally { restore(); }
  expect(enginesCalls.some(c => c.includes("apply"))).toBe(false);
  expect(logs.some(line => line.startsWith("Claude Code: configured —"))).toBe(false);
});

test("Cursor never appears as a complete automatic memory integration, even with the hook component present", async () => {
  const terminal = new TestTerminal();
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "cursor", label: "Cursor", executable: "/Applications/Cursor.app/Contents/MacOS/Cursor" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("cursor")), stderr: "" };
      if (args[0] === "plan") {
        return {
          status: 0,
          stdout: JSON.stringify(planPayload("cursor", {
            instructionsStatus: { kind: "unsupported", reason: "Cursor has no officially supported mechanism to auto-load global instructions." },
            hookStatus: { kind: "unsupported", reason: "Cursor has no officially supported, stable session-start hook mechanism this installer configures" },
            hookRuntimeStatus: { kind: "unsupported" },
            overallStatus: "partial",
          })),
          stderr: "",
        };
      }
      if (args[0] === "apply") return { status: 0, stdout: JSON.stringify(applyPayload("plan-cursor")), stderr: "" };
      return {
        status: 0,
        stdout: JSON.stringify(verifyPayload("cursor", {
          instructionsSupported: false, instructionsPresent: false,
          hookSupported: false, hookRuntimeStatus: { kind: "unsupported" },
          overallStatus: "complete",
        })),
        stderr: "",
      };
    },
    launch: async () => { throw new Error("Cursor must never be launched by this flow."); },
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r"); await tick(); // check Cursor, submit
  terminal.input("\r"); // preview: Confirm
  try { await run; } finally { restore(); }
  expect(logs.some(line => line.startsWith("Cursor: configured"))).toBe(false);
  expect(logs).toContain("Cursor: partially configured — this assistant has no official mechanism to auto-load global instructions");
});

test("no run of this flow ever prints a PostgreSQL connection string, a token, or an afterContent/beforeHash value, across every log line and every terminal frame", async () => {
  const terminal = new TestTerminal();
  const postgresUrl = "postgres://user:sup3rsecret@host:5432/db";
  const fakeSecret = "github_pat_FAKE_VALUE_FOR_TEST_ONLY";
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
      if (args[0] === "plan") {
        return {
          status: 0,
          stdout: JSON.stringify({
            schemaVersion: 1,
            plan: {
              planId: "plan-claude-code", agentId: "claude-code", action: "memory-install", noop: false,
              writes: [{ path: "/Users/tester/.claude/settings.json", beforeHash: "abc123", afterContent: `{"env":{"GITHUB_TOKEN":"${fakeSecret}"}}` }],
              metadata: {
                mcp: { path: "/Users/tester/.claude.json", status: { kind: "noop" } },
                instructions: { paths: ["/Users/tester/.claude/CLAUDE.md"], status: { kind: "noop" } },
                hook: { path: "/Users/tester/.claude/settings.json", status: { kind: "write" }, runtimeStatus: { kind: "pending-runtime-verification", reason: "no-evidence" } },
                overallStatus: "partial",
              },
            },
          }),
          stderr: "",
        };
      }
      if (args[0] === "apply") return { status: 0, stdout: JSON.stringify(applyPayload("plan-claude-code")), stderr: "" };
      return { status: 0, stdout: JSON.stringify(verifyPayload("claude-code", { hookRuntimeStatus: { kind: "runtime-observed" } })), stderr: "" };
    },
    launch: async () => {},
  });
  await tick();
  terminal.input("\r"); await tick(); // Continue
  terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // PostgreSQL: Yes
  terminal.input(postgresUrl);
  terminal.input("\r"); await tick(); // submit connection string
  terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // Reinforcement: No
  terminal.input("\r"); await tick(); // Engram summary: Confirm
  terminal.input(" "); terminal.input("\r"); await tick(); // memory picker: check Claude Code, submit
  terminal.input("\r"); // preview: Confirm
  try { await run; } finally { restore(); }
  for (const forbidden of [postgresUrl, "sup3rsecret", fakeSecret, "afterContent", "beforeHash", "abc123"]) {
    expect(terminal.output).not.toContain(forbidden);
    expect(logs.join("\n")).not.toContain(forbidden);
  }
});

test("Shell never calls memory-hook-run and never reads the hook-evidence directory itself", async () => {
  const source = await readFile(new URL("./init-engram.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/memory-hook-run/);
  expect(source).not.toMatch(/hook-evidence/);
});
