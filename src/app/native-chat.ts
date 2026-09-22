import { startNativeProcess } from "../engines/process.ts";
import { CodexSession } from "../engines/codex/session.ts";
import type { NativeId } from "../engines/types.ts";
import { runNativeUI } from "../ui/basic/native.ts";
import { openLoginBrowser } from "../infrastructure/browser.ts";
import { getStartupContext } from "../infrastructure/forge614-engram.ts";

/**
 * CodexSession calls its `getStartupContextFn` with no `env` of its own (it holds no env
 * dependency, unlike ClaudeSession, which already gets the full environment via
 * `claudeEnvironment(process.env)`). This wrapper carries Shell's real process env through
 * instead, so a custom `FORGE614_HOME` reaches `getStartupContext`'s `locateEngramBinary` the same
 * way it already does for `init --product engram` — rather than every call silently resolving
 * against `~/.forge614/...` regardless of what the person configured. Exported for testing; real
 * usage is the sole wiring point below.
 */
export function codexStartupContext(
  directory: string,
  options: Parameters<typeof getStartupContext>[1] = {},
): ReturnType<typeof getStartupContext> {
  return getStartupContext(directory, { ...options, env: process.env });
}

// Composition root: views render sessions; they do not construct transports.
export async function startNativeUI(id: NativeId, executable: string, args: string[], version?: string): Promise<void> {
  if (args.length) throw new Error(`${id} mode accepts no CLI options yet. Use the in-chat commands.`);
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Native chat requires an interactive terminal.");
  const cwd = process.cwd();
  await runNativeUI(id, cwd, (emit, approve) => {
    const rpc = startNativeProcess(id, executable, cwd, process.env, text => emit({ type: "text", text }));
    return new CodexSession(rpc, cwd, emit, approve, openLoginBrowser, codexStartupContext);
  }, undefined, version);
}
