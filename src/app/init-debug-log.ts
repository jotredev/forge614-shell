import { mkdirSync, openSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { matchesKey } from "@earendil-works/pi-tui";

/**
 * Temporary, opt-in diagnostics for `forge614-shell init --product engram`, activated only by
 * `FORGE614_SHELL_DEBUG_INIT=1`. Writes one line per event to a private file under
 * `$FORGE614_HOME/shell/logs/` (falling back to `~/.forge614/shell/logs/`) — never to stdout or
 * stderr. A real terminal's alternate-screen buffer is one shared screen: stdout and stderr both
 * write to it, and `pi-tui`'s differential renderer assumes nothing else touches that buffer while
 * the alt-screen TUI is active. A stray `stderr.write` during that window corrupts the render
 * (confirmed in Orca: stale `→` selection markers left behind when navigating PostgreSQL/
 * reinforcement lists) — this module must never write to either stream while debugging is on.
 * Never logs PostgreSQL connection strings, tokens, secrets, MCP configuration, `afterContent`,
 * hashes, full environment variables, or raw keystrokes — only booleans, key classifications, and
 * short enum-like reasons.
 */
export interface InitDebugLog {
  event(kind: string, detail?: Record<string, string | number | boolean>): void;
  /** The log file's path, set only when debugging is active and the file was actually opened. */
  readonly path?: string;
}

const noop: InitDebugLog = { event() {} };

function logsDir(env: NodeJS.ProcessEnv, home: string): string {
  const forgeHome = env.FORGE614_HOME ?? join(home, ".forge614");
  return join(forgeHome, "shell", "logs");
}

export function createInitDebugLog(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): InitDebugLog {
  if (env.FORGE614_SHELL_DEBUG_INIT !== "1") return noop;
  let fd: number;
  let path: string;
  try {
    const dir = logsDir(env, home);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
    path = join(dir, `init-${stamp}-${process.pid}.log`);
    fd = openSync(path, "a", 0o600);
  } catch {
    // Diagnostics are never load-bearing: if the log file can't be created (permissions, a
    // blocked path, …), fall back to doing nothing — never to stdout/stderr, which would
    // reintroduce the exact alt-screen corruption this module exists to avoid.
    return noop;
  }
  return {
    path,
    event(kind, detail) {
      const suffix = detail ? ` ${Object.entries(detail).map(([key, value]) => `${key}=${value}`).join(" ")}` : "";
      try { writeSync(fd, `[forge614-shell:init-debug] ${new Date().toISOString()} ${kind}${suffix}\n`); } catch { /* best effort */ }
    },
  };
}

/**
 * Classifies raw terminal input into the small set of event names the debug log is allowed to
 * record. Never returns or logs the raw bytes: an unrecognized sequence is just `"other"`.
 */
export function classifyDebugKey(data: string): "enter" | "escape" | "ctrl+d" | "ctrl+c" | "other" {
  if (matchesKey(data, "enter") || matchesKey(data, "return")) return "enter";
  if (matchesKey(data, "escape")) return "escape";
  if (matchesKey(data, "ctrl+d")) return "ctrl+d";
  if (matchesKey(data, "ctrl+c")) return "ctrl+c";
  return "other";
}
