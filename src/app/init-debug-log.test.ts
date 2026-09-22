import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyDebugKey, createInitDebugLog } from "./init-debug-log.ts";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "forge614-shell-debug-log-"));
}

test("the debug log is silent (no file, no writes) unless FORGE614_SHELL_DEBUG_INIT is exactly \"1\"", () => {
  const home = tempHome();
  try {
    expect(createInitDebugLog({}, home).path).toBeUndefined();
    expect(createInitDebugLog({ FORGE614_SHELL_DEBUG_INIT: "0" }, home).path).toBeUndefined();
    expect(createInitDebugLog({ FORGE614_SHELL_DEBUG_INIT: "true" }, home).path).toBeUndefined();
    // Nothing under .forge614 was ever created for a disabled log.
    expect(existsSync(join(home, ".forge614"))).toBe(false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("never writes to stdout or stderr, even while enabled — this is the whole point: stderr and stdout share Orca's screen buffer with the alternate-screen TUI, and pi-tui's differential rendering does not expect anything else to touch it", () => {
  const home = tempHome();
  const stderrChunks: unknown[] = [];
  const stdoutChunks: unknown[] = [];
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  process.stderr.write = ((chunk: unknown) => { stderrChunks.push(chunk); return true; }) as typeof process.stderr.write;
  process.stdout.write = ((chunk: unknown) => { stdoutChunks.push(chunk); return true; }) as typeof process.stdout.write;
  try {
    const log = createInitDebugLog({ FORGE614_SHELL_DEBUG_INIT: "1" }, home);
    log.event("stdin-state", { isTTY: true, isRaw: false });
    log.event("input", { key: "escape" });
    log.event("alt-screen-enter");
    log.event("alt-screen-exit");
    expect(stderrChunks).toEqual([]);
    expect(stdoutChunks).toEqual([]);
  } finally {
    process.stderr.write = originalStderrWrite;
    process.stdout.write = originalStdoutWrite;
    rmSync(home, { recursive: true, force: true });
  }
});

test("when enabled, writes to a private log file under $FORGE614_HOME/shell/logs/, with restrictive permissions", () => {
  const home = tempHome();
  try {
    const log = createInitDebugLog({ FORGE614_SHELL_DEBUG_INIT: "1" }, home);
    expect(log.path).toBeDefined();
    const logsDir = join(home, ".forge614", "shell", "logs");
    expect(log.path!.startsWith(logsDir)).toBe(true);
    log.event("stdin-state", { isTTY: true, isRaw: false });
    const content = readFileSync(log.path!, "utf8");
    expect(content).toContain("[forge614-shell:init-debug]");
    expect(content).toContain("stdin-state");
    expect(content).toContain("isTTY=true");
    expect(content).toContain("isRaw=false");
    // Restrictive permissions: owner read/write only, nothing for group/other.
    const fileMode = statSync(log.path!).mode & 0o777;
    expect(fileMode & 0o077).toBe(0);
    const dirMode = statSync(logsDir).mode & 0o777;
    expect(dirMode & 0o077).toBe(0);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("respects FORGE614_HOME the same way the rest of Shell does", () => {
  const home = tempHome();
  const customHome = join(home, "custom-forge-home");
  try {
    const log = createInitDebugLog({ FORGE614_SHELL_DEBUG_INIT: "1", FORGE614_HOME: customHome }, home);
    expect(log.path!.startsWith(join(customHome, "shell", "logs"))).toBe(true);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("falls back to no-op (never throws, never falls back to stdout/stderr) when the log directory cannot be created", () => {
  const home = tempHome();
  const blocked = join(home, "blocked-file");
  writeFileSync(blocked, "not a directory");
  try {
    let log: ReturnType<typeof createInitDebugLog> | undefined;
    expect(() => { log = createInitDebugLog({ FORGE614_SHELL_DEBUG_INIT: "1", FORGE614_HOME: join(blocked, "nested") }, home); }).not.toThrow();
    expect(log!.path).toBeUndefined();
    expect(() => log!.event("stdin-state", { isTTY: true })).not.toThrow();
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("never logs secrets: only booleans, classified key names, short enum-like reasons and counts ever reach the file", () => {
  const home = tempHome();
  try {
    const log = createInitDebugLog({ FORGE614_SHELL_DEBUG_INIT: "1" }, home);
    // Exactly how init-engram.ts calls it: raw bytes are classified before ever reaching the log.
    log.event("input", { key: classifyDebugKey("postgres://user:sup3rsecret@host:5432/db") });
    log.event("signal", { name: "SIGTERM" });
    log.event("terminate", { reason: "completed", exitCode: 0 });
    const content = readFileSync(log.path!, "utf8");
    expect(content).not.toContain("sup3rsecret");
    expect(content).not.toContain("postgres://");
    expect(content).toContain("key=other");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("classifyDebugKey recognizes Enter, Esc, Ctrl-D, and Ctrl-C without ever exposing the raw bytes", () => {
  expect(classifyDebugKey("\r")).toBe("enter");
  expect(classifyDebugKey("\x1b")).toBe("escape");
  expect(classifyDebugKey("\x04")).toBe("ctrl+d");
  expect(classifyDebugKey("\x03")).toBe("ctrl+c");
  expect(classifyDebugKey("postgres://user:secret@host/db")).toBe("other");
});
