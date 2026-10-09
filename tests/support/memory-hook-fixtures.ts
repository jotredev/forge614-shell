import { join } from "node:path";
import type { DetectRun } from "../../src/infrastructure/forge614-engines.ts";

/** A real-shaped `forge614-engines verify memory-integration --agent <id> --json` answer, with the hook part the test wants (none = an Engines older than the hook). */
export function verifyStdout(hook: Record<string, unknown> | undefined, agentId = "claude-code"): string {
  return JSON.stringify({
    schemaVersion: 1,
    verification: {
      agentId,
      mcp: { path: "/Users/tester/.claude.json", present: true },
      instructions: { supported: true, paths: ["/Users/tester/.claude/CLAUDE.md"], present: true },
      ...(hook ? { hook } : {}),
      overallStatus: "complete",
    },
  });
}

/** The `hook` part of a verification: present, dry run passed, with the given `runtimeStatus` unless `overrides` says otherwise. */
export const hookOf = (runtimeStatus: Record<string, unknown>, overrides: Record<string, unknown> = {}) =>
  ({ supported: true, path: "/Users/tester/.claude/settings.json", present: true, dryRunOk: true, runtimeStatus, ...overrides });

/** A double of Engines that answers every command with `stdout` and `status`, and records each command it was run with. */
export function enginesDouble(stdout: string, status = 0) {
  const commands: string[][] = [];
  const run: DetectRun = async (_binary, args) => { commands.push(args); return { status, stdout, stderr: "" }; };
  return { run, commands };
}

/** The `hooks/list` answer of a Codex app-server (`v2/HooksListResponse.ts`) with Engines' startup hook as the given trust and enabled state. */
export function hooksListWithEngramHook(overrides: Record<string, unknown> = {}) {
  const enginesCmd = join("/Users/tester", ".forge614", "engines", "bin", process.platform === "win32" ? "forge614-engines.exe" : "forge614-engines");
  return { data: [{ cwd: "/project", warnings: [], errors: [], hooks: [
    { key: "k0", eventName: "preToolUse", matcher: "Bash", handlerType: "command", command: "echo hi", async: false, enabled: true, trustStatus: "trusted", source: "user", isManaged: false },
    {
      key: "k1", eventName: "sessionStart", matcher: "^(startup|resume|clear|compact)$", handlerType: "command",
      command: `${enginesCmd} memory-hook-run --agent codex`, async: false, enabled: true,
      trustStatus: "trusted", source: "user", isManaged: false, ...overrides,
    },
  ] }] };
}
