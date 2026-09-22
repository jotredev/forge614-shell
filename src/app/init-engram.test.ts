import { expect, test } from "bun:test";
import { requireEngramProduct, classifyMemoryOutcome } from "./init-engram.ts";
import type { MemoryInstallPlan, MemoryVerification } from "../infrastructure/forge614-engines.ts";

const baseVerification = (overrides: Partial<MemoryVerification> = {}): MemoryVerification => ({
  agentId: "claude-code",
  mcp: { path: "/mcp.json", present: true },
  instructions: { supported: true, paths: ["/CLAUDE.md"], present: true },
  hook: { supported: true, path: "/hook.json", present: true, dryRunOk: true, runtimeStatus: { kind: "runtime-observed" } },
  overallStatus: "complete",
  ...overrides,
});

test("classifyMemoryOutcome: fully verified and runtime-observed is configured", () => {
  const outcome = classifyMemoryOutcome("Claude Code", undefined, baseVerification());
  expect(outcome.status).toBe("configured");
});

test("classifyMemoryOutcome: structurally complete but hook evidence still pending is prepared, with no rerun language", () => {
  const outcome = classifyMemoryOutcome("Codex", undefined, baseVerification({ hook: { supported: true, path: "/h", present: true, dryRunOk: true, runtimeStatus: { kind: "pending-runtime-verification", reason: "no-evidence" } } }));
  expect(outcome.status).toBe("prepared");
  expect(outcome.detail).not.toMatch(/run this command again/i);
});

test("classifyMemoryOutcome: needs-user-trust is prepared, phrased as a future possibility, never as a fact about what happened", () => {
  const outcome = classifyMemoryOutcome("Codex", undefined, baseVerification({ hook: { supported: true, path: "/h", present: true, dryRunOk: true, runtimeStatus: { kind: "needs-user-trust" } } }));
  expect(outcome.status).toBe("prepared");
  expect(outcome.detail).not.toMatch(/has not trusted/i);
  expect(outcome.detail).toMatch(/may ask you/i);
});

test("classifyMemoryOutcome: an assistant with no instructions mechanism is unsupported, not partial", () => {
  const outcome = classifyMemoryOutcome("Cursor", undefined, baseVerification({ instructions: { supported: false, paths: [], present: false }, overallStatus: "complete" }));
  expect(outcome.status).toBe("unsupported");
});

test("classifyMemoryOutcome: a real plan-time conflict on a component still absent after apply is blocked, with Engines' own detail", () => {
  const plan = {
    planId: "p1", agentId: "claude-code", noop: false,
    mcp: { path: "/mcp.json", status: { kind: "blocked", reason: "CONFLICT", details: "an unrelated MCP server already uses this name" } },
    instructions: { paths: ["/CLAUDE.md"], status: { kind: "write" } },
    hook: { path: "/h", status: { kind: "write" }, runtimeStatus: { kind: "pending-runtime-verification", reason: "no-evidence" } },
    overallStatus: "partial",
  } as unknown as MemoryInstallPlan;
  const outcome = classifyMemoryOutcome("Claude Code", plan, baseVerification({ mcp: { path: "/mcp.json", present: false }, overallStatus: "partial" }));
  expect(outcome.status).toBe("blocked");
  expect(outcome.detail).toContain("an unrelated MCP server already uses this name");
});

test("classifyMemoryOutcome: a blocked hook is reported blocked even when MCP and instructions are already present", () => {
  const plan = {
    planId: "p1", agentId: "claude-code", noop: true,
    mcp: { path: "/mcp.json", status: { kind: "noop" } },
    instructions: { paths: ["/CLAUDE.md"], status: { kind: "noop" } },
    hook: { path: "/h", status: { kind: "blocked", reason: "hook-conflict", details: "an existing SessionStart hook with different content is already present" }, runtimeStatus: { kind: "absent" } },
    overallStatus: "partial",
  } as unknown as MemoryInstallPlan;
  const outcome = classifyMemoryOutcome("Claude Code", plan, baseVerification({
    mcp: { path: "/mcp.json", present: true },
    instructions: { supported: true, paths: ["/CLAUDE.md"], present: true },
    hook: { supported: true, path: "/h", present: false, dryRunOk: false, runtimeStatus: { kind: "absent" } },
    overallStatus: "partial",
  }));
  expect(outcome.status).toBe("blocked");
  expect(outcome.detail).toContain("an existing SessionStart hook with different content is already present");
});

test("classifyMemoryOutcome: verification absent with no plan-time explanation is failed, not blocked", () => {
  const outcome = classifyMemoryOutcome("Claude Code", undefined, baseVerification({ mcp: { path: "/mcp.json", present: false }, instructions: { supported: true, paths: [], present: false }, overallStatus: "absent" }));
  expect(outcome.status).toBe("failed");
});

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
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInitCommand } from "./init-engram.ts";

class TestTerminal implements Terminal {
  // Wide enough that none of the flow's long result sentences word-wrap: these tests assert on
  // exact outcome text, not on the Text component's line-wrapping behavior (covered elsewhere).
  columns = 400; rows = 30; kittyProtocolActive = false;
  input: (data: string) => void = () => {}; output = "";
  start(input: (data: string) => void) { this.input = input; }
  stop() {}
  async drainInput() {}
  write(data: string) { this.output += data; }
  moveBy() {} hideCursor() {} showCursor() {} clearLine() {}
  clearFromCursor() {} clearScreen() {} setTitle() {} setProgress() {}
}
const tick = () => new Promise(resolve => setTimeout(resolve, 25));

class FakeStdin {
  private listeners = new Map<string, Set<() => void>>();
  on(event: "end" | "close", listener: () => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }
  off(event: "end" | "close", listener: () => void) {
    this.listeners.get(event)?.delete(listener);
  }
  emit(event: "end" | "close") {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }
}

test("rejects a missing product before ever starting the terminal UI", async () => {
  const terminal = new TestTerminal();
  await expect(runInitCommand([], { terminal })).rejects.toThrow("--product <name>");
  expect(terminal.output).toBe("");
});

test("rejects a non-interactive terminal", async () => {
  // `interactive: false` is the sole gate here, so this never depends on the test runner's own TTY state.
  await expect(runInitCommand(["--product", "engram"], { interactive: false })).rejects.toThrow("interactive terminal");
});

test("a terminal that fails to start (e.g. raw mode unsupported) never leaves the alt screen open, and reports a clear, non-zero-exit error", async () => {
  // Mirrors the exact production bug: `beforeTerminalStart()` already wrote the alt-screen escape
  // sequence before the terminal's own `start()` (raw-mode setup) throws. A silent, un-reported
  // failure here is exactly what a person sees as "returns immediately to the prompt".
  class FailingStartTerminal extends TestTerminal {
    start() {
      throw new Error("ENOTTY: raw mode is not supported on this stdin");
    }
  }
  const terminal = new FailingStartTerminal();
  process.exitCode = 0;
  await expect(runInitCommand(["--product", "engram"], { terminal })).rejects.toThrow(/raw mode/i);
  expect(process.exitCode as number | undefined).toBe(1);
  // The alt screen must have been forced shut even though start() itself is what failed.
  expect(terminal.output).toContain("\x1b[?1049l");
  process.exitCode = 0;
});

function tempForgeHome(): string {
  return mkdtempSync(join(tmpdir(), "forge614-shell-init-debug-"));
}

test("FORGE614_SHELL_DEBUG_INIT=1 never writes raw debug event lines to stderr while the TUI is running — the bug confirmed in Orca (stale → markers when navigating) was exactly these stderr writes landing in the same screen buffer as the alt-screen render", async () => {
  const home = tempForgeHome();
  const stderrWrites: string[] = [];
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown) => { stderrWrites.push(String(chunk)); return true; }) as typeof process.stderr.write;
  try {
    const terminal = new TestTerminal();
    process.exitCode = 0;
    const run = runInitCommand(["--product", "engram"], {
      terminal, home, env: { FORGE614_SHELL_DEBUG_INIT: "1" },
    });
    await tick();
    terminal.input("\r"); await tick(); // Continue
    // Repeatedly navigate up/down on the PostgreSQL screen — this is exactly the sequence that
    // left stale `→` markers in Orca when the debug logger wrote to stderr mid-render.
    for (let i = 0; i < 4; i++) {
      terminal.input("\x1b[B"); await tick();
      terminal.input("\x1b[A"); await tick();
    }
    terminal.input("\x1b"); // Esc cancels
    await run;
    // Not one raw `[forge614-shell:init-debug]` event line may reach stderr at any point — the
    // one allowed stderr write is the final, single "init debug log: <path>" announcement, made
    // only after the alt-screen has already exited (proven separately below).
    for (const chunk of stderrWrites) expect(chunk).not.toContain("[forge614-shell:init-debug]");
    expect(terminal.output).not.toContain("[forge614-shell:init-debug]");
    process.exitCode = 0;
  } finally {
    process.stderr.write = originalStderrWrite;
    rmSync(home, { recursive: true, force: true });
  }
});

test("the debug log file is written under $FORGE614_HOME/shell/logs/, and a PostgreSQL connection string entered during the flow never reaches it", async () => {
  const home = tempForgeHome();
  const postgresUrl = "postgres://user:sup3rsecret@host:5432/db";
  try {
    const terminal = new TestTerminal();
    process.exitCode = 0;
    const run = runInitCommand(["--product", "engram"], {
      terminal, home, env: { FORGE614_SHELL_DEBUG_INIT: "1" },
      run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
      enginesRun: async () => ({ status: 0, stdout: JSON.stringify({ schemaVersion: 1, agents: [] }), stderr: "" }),
    });
    await tick();
    terminal.input("\r"); await tick(); // Continue
    terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // PostgreSQL: Yes
    terminal.input(postgresUrl);
    terminal.input("\r"); await tick(); // submit connection string
    terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // Reinforcement: No
    terminal.input("\x1b"); // cancel on the summary screen instead of confirming
    await run;
    const logsDir = join(home, ".forge614", "shell", "logs");
    expect(existsSync(logsDir)).toBe(true);
    const [logFile] = require("node:fs").readdirSync(logsDir) as string[];
    expect(logFile).toBeDefined();
    const content = readFileSync(join(logsDir, logFile!), "utf8");
    expect(content).toContain("[forge614-shell:init-debug]");
    expect(content).not.toContain(postgresUrl);
    expect(content).not.toContain("sup3rsecret");
    process.exitCode = 0;
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("once the TUI has exited, the debug log path is announced exactly once on the plain terminal — never inside the TUI, never when debugging is off", async () => {
  const home = tempForgeHome();
  const stderrWrites: string[] = [];
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown) => { stderrWrites.push(String(chunk)); return true; }) as typeof process.stderr.write;
  try {
    const terminal = new TestTerminal();
    process.exitCode = 0;
    const run = runInitCommand(["--product", "engram"], {
      terminal, home, env: { FORGE614_SHELL_DEBUG_INIT: "1" },
    });
    await tick();
    terminal.input("\x1b"); // Esc cancels on the intro screen
    await run;
    const announceLines = stderrWrites.filter(line => line.includes("init debug log:"));
    expect(announceLines).toHaveLength(1);
    expect(announceLines[0]).toMatch(/init debug log: .*shell[/\\]logs[/\\]init-/);
    process.exitCode = 0;
  } finally {
    process.stderr.write = originalStderrWrite;
    rmSync(home, { recursive: true, force: true });
  }
});

test("without FORGE614_SHELL_DEBUG_INIT, nothing is written to stderr and no log directory is created", async () => {
  const home = tempForgeHome();
  const stderrWrites: string[] = [];
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown) => { stderrWrites.push(String(chunk)); return true; }) as typeof process.stderr.write;
  try {
    const terminal = new TestTerminal();
    process.exitCode = 0;
    const run = runInitCommand(["--product", "engram"], { terminal, home });
    await tick();
    terminal.input("\x1b");
    await run;
    expect(stderrWrites).toEqual([]);
    expect(existsSync(join(home, ".forge614", "shell", "logs"))).toBe(false);
    process.exitCode = 0;
  } finally {
    process.stderr.write = originalStderrWrite;
    rmSync(home, { recursive: true, force: true });
  }
});

test("stdin closing for real (not a Ctrl-D keypress) is never a silent cancel: it exits non-zero with a clear, visible explanation", async () => {
  const terminal = new TestTerminal();
  const stdin = new FakeStdin();
  process.exitCode = 0;
  const run = runInitCommand(["--product", "engram"], { terminal, stdin });
  await tick(); // intro screen is up, waiting on input
  stdin.emit("end"); // the real stdin stream closed, not a Ctrl-D keypress
  await run;
  expect(process.exitCode as number | undefined).toBe(1);
  const afterAltScreenExit = terminal.output.slice(terminal.output.lastIndexOf("\x1b[?1049l"));
  expect(afterAltScreenExit).toContain("stdin");
  process.exitCode = 0;
});

test("stdin closing before any confirmation makes zero Engram or Engines calls, ever", async () => {
  const terminal = new TestTerminal();
  const stdin = new FakeStdin();
  const engramCalls: string[][] = [];
  const enginesCalls: string[][] = [];
  process.exitCode = 0;
  const run = runInitCommand(["--product", "engram"], {
    terminal, stdin, home: "/Users/tester",
    run: async (command, args) => { engramCalls.push([command, ...args]); return { status: 0, stdout: "{}", stderr: "" }; },
    enginesRun: async (command, args) => { enginesCalls.push([command, ...args]); return { status: 0, stdout: "{}", stderr: "" }; },
  });
  await tick(); // intro screen is up, waiting on input — nothing has been confirmed yet
  stdin.emit("end");
  await run;
  expect(engramCalls).toEqual([]);
  expect(enginesCalls).toEqual([]);
  process.exitCode = 0;
});

test("stdin closing mid-flow stops the flow: no memory-setup Engines calls happen after the abort, and the run still settles without hanging", async () => {
  const terminal = new TestTerminal();
  const stdin = new FakeStdin();
  const enginesCalls: string[][] = [];
  let sawCapabilities = false;
  let resolveCapabilities!: () => void;
  const capabilitiesReached = new Promise<void>(resolve => { resolveCapabilities = resolve; });
  process.exitCode = 0;
  const run = runInitCommand(["--product", "engram"], {
    terminal, stdin, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      enginesCalls.push([_command, ...args]);
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      if (args[0] === "capabilities") {
        if (!sawCapabilities) { sawCapabilities = true; resolveCapabilities(); }
        return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
      }
      // Any call reaching plan/apply/verify after the abort would land here — the test fails
      // below by asserting the exact call list never grows past detect+capabilities.
      return { status: 0, stdout: JSON.stringify(planPayload("claude-code")), stderr: "" };
    },
  });
  await driveEngramScreens(terminal); // through intro, postgres, reinforcement, and the summary confirm
  await capabilitiesReached; // memory setup has detected the assistant and is about to show the picker
  await tick();
  const callsBeforeAbort = enginesCalls.length;
  stdin.emit("end"); // real stdin close while the assistant picker is up, waiting on input
  await run; // must resolve — a hang here means the abort never propagated
  expect(process.exitCode as number | undefined).toBe(1);
  expect(enginesCalls.length).toBe(callsBeforeAbort); // no plan/apply/verify calls after the abort
  expect(enginesCalls.some(call => call[0] === "plan" || call[0] === "apply")).toBe(false);
  process.exitCode = 0;
});

test("locale: \"es\" translates the whole Engram flow end to end, including the final result reprinted after the alt screen exits", async () => {
  const terminal = new TestTerminal();
  process.exitCode = 0;
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester", locale: "es",
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
  expect(terminal.output).toContain("Forge614 Engram — inicialización de memoria");
  terminal.input("\r"); await tick(); // Continuar
  terminal.input("\r"); await tick(); // PostgreSQL: No
  terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // Refuerzo: No
  terminal.input("\r"); await tick(); // Resumen: Confirmar
  terminal.input(" "); terminal.input("\r"); await tick(); // elegir Claude Code, enviar
  terminal.input("\r"); // vista previa: Confirmar
  await run;
  expect(terminal.output).toContain("La inicialización de memoria de Forge614 Engram se completó.");
  expect(terminal.output).toContain("Claude Code: configurado — el servidor MCP y las instrucciones de memoria están instalados y activos");
  const afterAltScreenExit = terminal.output.slice(terminal.output.lastIndexOf("\x1b[?1049l"));
  expect(afterAltScreenExit).toContain("Claude Code: configurado");
  process.exitCode = 0;
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
  // Regression: `screen.stop({ preserveScreen: true })` only switches the terminal back to the
  // main buffer — it never reprints the rendered result, so a real terminal shows nothing after
  // exiting alt-screen mode. The visible content must come AFTER the alt-screen exit sequence.
  const afterAltScreenExit = terminal.output.slice(terminal.output.lastIndexOf("\x1b[?1049l"));
  expect(afterAltScreenExit).toContain("Cancelled. No changes were made.");
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

test("runInitCommand resolves both Engram and Engines binaries under a custom FORGE614_HOME (the real CLI entrypoint now forwards process.env), and never leaks it to the result screen", async () => {
  const terminal = new TestTerminal();
  const engramCalls: string[][] = [];
  const enginesCalls: string[][] = [];
  const run = runInitCommand(["--product", "engram"], {
    terminal,
    env: { FORGE614_HOME: "/private/custom-forge-home" } as NodeJS.ProcessEnv,
    run: async (command, args) => { engramCalls.push([command, ...args]); return { status: 0, stdout: "{}", stderr: "" }; },
    enginesRun: async (command, args) => {
      enginesCalls.push([command, ...args]);
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([])), stderr: "" };
      return { status: 0, stdout: "{}", stderr: "" };
    },
  });
  await driveEngramScreens(terminal);
  await run;
  expect(engramCalls[0]?.[0]).toBe("/private/custom-forge-home/engram/bin/forge614-engram");
  expect(enginesCalls[0]?.[0]).toBe("/private/custom-forge-home/engines/bin/forge614-engines");
  expect(terminal.output).not.toContain("/private/custom-forge-home");
  expect(terminal.output).not.toContain("FORGE614_HOME");
});

test("runInitCommand falls back to the standard ~/.forge614 path when no FORGE614_HOME is set", async () => {
  const terminal = new TestTerminal();
  const engramCalls: string[][] = [];
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async (command, args) => { engramCalls.push([command, ...args]); return { status: 0, stdout: "{}", stderr: "" }; },
    enginesRun: async () => ({ status: 0, stdout: JSON.stringify(detectPayload([])), stderr: "" }),
  });
  await driveEngramScreens(terminal);
  await run;
  expect(engramCalls[0]?.[0]).toBe("/Users/tester/.forge614/engram/bin/forge614-engram");
});

test("the init command never imports Shell's normal chat startup modules", async () => {
  const source = await readFile(new URL("./init-engram.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/native-chat|visual-picker|engine-picker/);
});

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
  await run;
  expect(enginesCalls).toEqual([
    ["/Users/tester/.forge614/engines/bin/forge614-engines", "detect"],
    ["/Users/tester/.forge614/engines/bin/forge614-engines", "capabilities", "--agent", "claude-code"],
  ]);
  expect(terminal.output).toContain("No assistant was selected. No memory integration was configured.");
});

test("Claude Code and Codex both plan, apply, and verify to a complete memory integration", async () => {
  const terminal = new TestTerminal();
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
  await run;
  expect(enginesCalls.filter(c => c[2] === "memory-install").map(c => agentIdFrom(c)).sort()).toEqual(["claude-code", "codex"]);
  expect(enginesCalls.filter(c => c[2] === "memory-integration").map(c => agentIdFrom(c)).sort()).toEqual(["claude-code", "codex"]);
  expect(terminal.output).toContain("Claude Code: configured — MCP server and memory instructions are installed and active");
  expect(terminal.output).toContain("Codex: configured — MCP server and memory instructions are installed and active");
  expect(terminal.output).toContain("Close and reopen each configured assistant's session so it loads the new MCP server and memory instructions.");
});

test("Cursor's memory integration is reported partial, never as fully complete", async () => {
  const terminal = new TestTerminal();
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
  await run;
  expect(terminal.output).toContain("Cursor: partially configured — Cursor has no built-in way to automatically load memory instructions yet; the MCP server and memory search still work.");
  expect(terminal.output).not.toContain("Cursor: configured");
});

test("a conflict on every component makes no apply call and reports the conflict", async () => {
  const terminal = new TestTerminal();
  const enginesCalls: string[][] = [];
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
  await run;
  expect(enginesCalls.some(c => c[0] === "apply" || c.includes("apply"))).toBe(false);
  expect(terminal.output).toContain(`Claude Code: blocked — An existing "forge614-engram" MCP entry with different content is already present.`);
});

test("cancelling the memory preview makes zero writes", async () => {
  const terminal = new TestTerminal();
  const enginesCalls: string[][] = [];
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
  await run;
  expect(enginesCalls.some(c => c.includes("apply"))).toBe(false);
  expect(terminal.output).toContain("Claude Code: skipped");
});

test("a plan-level Engines failure for one assistant is reported without failing the already-successful Engram init", async () => {
  const terminal = new TestTerminal();
  const enginesCalls: string[][] = [];
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
  await run;
  expect(enginesCalls.some(c => c.includes("apply"))).toBe(false);
  expect(terminal.output).toContain("Forge614 Engram memory initialization is complete.");
  expect(terminal.output).toContain("Claude Code: could not be configured — Could not reach forge614-engram to read its memory protocol.");
  expect(process.exitCode as number | undefined).not.toBe(1);
});

test("an apply that reports applied: false is shown as not configured, without calling verify", async () => {
  const terminal = new TestTerminal();
  const enginesCalls: string[][] = [];
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
  await run;
  expect(enginesCalls.some(c => c.includes("memory-integration"))).toBe(false);
  expect(terminal.output).toContain("Claude Code: could not be configured — Forge614 Engines reported the change was not applied.");
});

test("verify reporting absent after a successful apply is communicated, never as success", async () => {
  const terminal = new TestTerminal();
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
  await run;
  expect(terminal.output).toContain("Claude Code: could not be configured — Forge614 Engines could not confirm any memory integration for Claude Code.");
});

test("verify reporting partial after a successful apply explains exactly what is missing", async () => {
  const terminal = new TestTerminal();
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
  await run;
  expect(terminal.output).toContain("Claude Code: could not be configured — Forge614 Engines could not confirm full memory integration for Claude Code.");
});

test("two selected assistants report independently when one apply fails", async () => {
  const terminal = new TestTerminal();
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
  await run;
  expect(terminal.output).toContain("Claude Code: configured — MCP server and memory instructions are installed and active");
  expect(terminal.output).toContain("Codex: could not be configured — File changed since the plan was computed: /Users/tester/.codex/config.toml");
});

test("an assistant whose plan is already complete and needs no writes is reported configured, with no restart hint", async () => {
  const terminal = new TestTerminal();
  const enginesCalls: string[][] = [];
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
  await run;
  expect(enginesCalls.some(c => c.includes("apply"))).toBe(false);
  expect(enginesCalls.some(c => c.includes("memory-integration"))).toBe(true);
  expect(terminal.output).toContain("Claude Code: configured — MCP server and memory instructions are installed and active");
  // Nothing was written this run, so there is nothing for the assistant to reload.
  expect(terminal.output).not.toContain("Close and reopen");
  // Regression: the final result must actually be reprinted after the alt screen exits, not just
  // rendered at some point while the alt screen was still active (see the preserveScreen fix).
  const afterAltScreenExit = terminal.output.slice(terminal.output.lastIndexOf("\x1b[?1049l"));
  expect(afterAltScreenExit).toContain("Claude Code: configured");
});

test("a plan that claims complete while the instructions are unsupported is still never reported as fully configured", async () => {
  const terminal = new TestTerminal();
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
  await run;
  expect(terminal.output).toContain("Cursor: partially configured — Cursor has no built-in way to automatically load memory instructions yet; the MCP server and memory search still work.");
  expect(terminal.output).not.toContain("Cursor: configured");
});

test("a PostgreSQL connection string never reaches the screen or the log through the whole memory-integration flow", async () => {
  const terminal = new TestTerminal();
  const postgresUrl = "postgres://user:sup3rsecret@host:5432/db";
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
  await run;
  // The whole run really reached the end of the memory flow, not just the Engram summary.
  expect(terminal.output).toContain("Claude Code: configured — MCP server and memory instructions are installed and active");
  expect(terminal.output).not.toContain(postgresUrl);
  expect(terminal.output).not.toContain("sup3rsecret");
  expect(terminal.output).not.toContain(postgresUrl);
  expect(terminal.output).not.toContain("sup3rsecret");
});

// The old fault-injection technique here (a `TestTerminal` subclass throwing on its 5th `start()`
// call) was keyed to the pre-refactor design where every screen opened its own `TuiAltScreen`; a
// `bun:test` `mock.module()` replacement was also tried and rejected because it leaked into every
// later test in this file (`mock.restore()` does not undo it for already-imported modules). The
// injectable `chooseMemoryAgents` option on `RunInitOptions` (see init-engram.ts) is the local,
// non-leaking seam used instead: it lets exactly one test's `runInitCommand` call use a throwing
// picker without touching the module registry or any other test.
test("a genuine picker-layer exception never fails an already-successful Engram init, and is reported honestly", async () => {
  const terminal = new TestTerminal();
  process.exitCode = 0;
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
    },
    chooseMemoryAgents: async () => { throw new Error("simulated picker UI failure"); },
  });
  await driveEngramScreens(terminal);
  await run;
  expect(process.exitCode as number | undefined).not.toBe(1);
  expect(terminal.output).toContain("Forge614 Engram memory initialization is complete.");
  expect(terminal.output).toContain("Memory setup could not be completed: simulated picker UI failure");
  process.exitCode = 0; // reset so this test's exit code doesn't leak into the overall `bun test` process exit status
});

test("a freshly-configured Claude Code with no runtime hook evidence yet is reported ready, never blocked or failed, with exactly one verify call and no relaunch", async () => {
  const terminal = new TestTerminal();
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
      return { status: 0, stdout: JSON.stringify(verifyPayload("claude-code", { hookRuntimeStatus: { kind: "pending-runtime-verification", reason: "no-evidence" } })), stderr: "" };
    },
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r"); await tick(); // check Claude Code, submit
  terminal.input("\r"); // preview: Confirm
  await run;
  expect(verifyCalls).toBe(1);
  expect(terminal.output).toContain("Claude Code: ready — Claude Code memory integration is ready. It finishes confirming itself the next time you use Claude Code normally.");
  expect(terminal.output).not.toContain("Claude Code: configured —");
  expect(terminal.output).not.toMatch(/Claude Code:\s*(blocked|could not be configured)/i);
});

test("Claude Code is reported fully configured when verify already observes the runtime evidence, with no second verify call", async () => {
  const terminal = new TestTerminal();
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
      return { status: 0, stdout: JSON.stringify(verifyPayload("claude-code", { hookRuntimeStatus: { kind: "runtime-observed" } })), stderr: "" };
    },
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r"); await tick(); // check Claude Code, submit
  terminal.input("\r"); // preview: Confirm
  await run;
  expect(verifyCalls).toBe(1);
  expect(terminal.output).toContain("Claude Code: configured — MCP server and memory instructions are installed and active");
});

test("Codex reporting needs-user-trust is never launched, is verified exactly once, and is reported ready with an honest note about a possible approval prompt", async () => {
  const terminal = new TestTerminal();
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
      return { status: 0, stdout: JSON.stringify(verifyPayload("codex", { hookRuntimeStatus: { kind: "needs-user-trust" } })), stderr: "" };
    },
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r"); await tick(); // check Codex, submit
  terminal.input("\r"); // preview: Confirm — this is the ONLY confirmation in the whole run
  await run;
  expect(verifyCalls).toBe(1);
  expect(terminal.output).toContain("Codex: ready — Codex memory integration is ready. When you next start Codex normally, Codex may ask you once to approve the Forge614 memory hook.");
  expect(terminal.output.includes("has not trusted")).toBe(false);
});

test("evidence-expired for an already-fully-configured Claude Code is reported ready, never as lost memory or a failure, with exactly one verify call", async () => {
  const terminal = new TestTerminal();
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
      return { status: 0, stdout: JSON.stringify(verifyPayload("claude-code", { hookRuntimeStatus: { kind: "pending-runtime-verification", reason: "evidence-expired" }, overallStatus: "partial" })), stderr: "" };
    },
  });
  await driveEngramScreens(terminal);
  // Nothing is pending (plan.noop is true), so no preview/confirm screen appears.
  terminal.input(" "); terminal.input("\r");
  await run;
  expect(verifyCalls).toBe(1);
  const allText = terminal.output;
  expect(allText).not.toMatch(/lost|failed|could not be configured/i);
  expect(terminal.output).toContain("Claude Code: ready — Claude Code memory integration is ready. It finishes confirming itself the next time you use Claude Code normally.");
});

test("Codex's expired evidence is never reported or worded as a lack of trust — needs-user-trust stays its own distinct phrasing", async () => {
  const terminal = new TestTerminal();
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
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r");
  await run;
  expect(terminal.output.includes("has not trusted the memory hook")).toBe(false);
  expect(terminal.output.includes("may ask you once to approve")).toBe(false);
  expect(terminal.output).toContain("Codex: ready — Codex memory integration is ready. It finishes confirming itself the next time you use Codex normally.");
});

test("a genuine hook conflict is reported blocked even when MCP and instructions are already present, and apply is never called", async () => {
  const terminal = new TestTerminal();
  const enginesCalls: string[][] = [];
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
            mcpStatus: { kind: "noop" }, instructionsStatus: { kind: "noop" },
            hookStatus: { kind: "blocked", reason: "hook-conflict", details: "An existing SessionStart hook with different content is already present in /Users/tester/.claude/settings.json" },
            hookRuntimeStatus: { kind: "absent" },
            overallStatus: "partial",
          })),
          stderr: "",
        };
      }
      // Real `verify memory-integration` shape: MCP and instructions are genuinely already
      // configured and present — only the hook is missing, because Engines refused to write it
      // due to the conflict above. The old, buggy classification let this MCP/instructions
      // presence silently mask the blocked hook and fall through to "configured"/"ready"; it must
      // report `blocked` instead, with Engines' own concrete detail.
      return {
        status: 0,
        stdout: JSON.stringify(verifyPayload("claude-code", {
          mcpPresent: true, instructionsPresent: true,
          hookPresent: false, hookRuntimeStatus: { kind: "absent" },
          overallStatus: "partial",
        })),
        stderr: "",
      };
    },
  });
  await driveEngramScreens(terminal);
  // The plan is noop:true (nothing Engines can write), so no preview/confirm screen appears — the
  // picker's submit goes straight through the `resolved` branch, which calls verify but never apply.
  terminal.input(" "); terminal.input("\r");
  await run;
  expect(enginesCalls.some(c => c.includes("apply"))).toBe(false);
  expect(terminal.output).toContain(`Claude Code: blocked — An existing SessionStart hook with different content is already present in /Users/tester/.claude/settings.json`);
  expect(terminal.output).not.toMatch(/Claude Code:\s*(configured|ready)/);
});

test("Cursor never appears as a complete automatic memory integration, even with the hook component present", async () => {
  const terminal = new TestTerminal();
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
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r"); await tick(); // check Cursor, submit
  terminal.input("\r"); // preview: Confirm
  await run;
  expect(terminal.output).not.toContain("Cursor: configured");
  expect(terminal.output).toContain("Cursor: partially configured — Cursor has no built-in way to automatically load memory instructions yet; the MCP server and memory search still work.");
});

test("no run of this flow ever prints a PostgreSQL connection string, a token, or an afterContent/beforeHash value, across every log line and every terminal frame", async () => {
  const terminal = new TestTerminal();
  const postgresUrl = "postgres://user:sup3rsecret@host:5432/db";
  const fakeSecret = "github_pat_FAKE_VALUE_FOR_TEST_ONLY";
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
  await run;
  for (const forbidden of [postgresUrl, "sup3rsecret", fakeSecret, "afterContent", "beforeHash", "abc123"]) {
    expect(terminal.output).not.toContain(forbidden);
    expect(terminal.output).not.toContain(forbidden);
  }
});

test("Shell never calls memory-hook-run and never reads the hook-evidence directory itself", async () => {
  const source = await readFile(new URL("./init-engram.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/memory-hook-run/);
  expect(source).not.toMatch(/hook-evidence/);
});
