import { startNativeProcess } from "../engines/process.ts";
import { CodexSession } from "../engines/codex/session.ts";
import type { NativeId } from "../engines/types.ts";
import { runNativeUI } from "../ui/basic/native.ts";
import { openLoginBrowser } from "../infrastructure/browser.ts";
import { getStartupContext } from "../infrastructure/forge614-engram.ts";
import { withStartupNotices } from "../infrastructure/engram-notices.ts";
import { getCatalog } from "../i18n/index.ts";
import type { Locale } from "../i18n/index.ts";

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
export async function startNativeUI(id: NativeId, executable: string, args: string[], version?: string, locale: Locale = "en"): Promise<void> {
  const t = getCatalog(locale).chat;
  if (args.length) throw new Error(t.nativeCliOptionsUnsupported({ id }));
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error(t.nativeRequiresInteractiveTerminal);
  const cwd = process.cwd();
  await runNativeUI(id, cwd, (emit, approve) => {
    const rpc = startNativeProcess(id, executable, cwd, process.env, text => emit({ type: "text", text }));
    // Engram's notices reach the person as transcript text; the session never knows about them.
    const startupContext = withStartupNotices(codexStartupContext, text => emit({ type: "text", text }), locale);
    return new CodexSession(rpc, cwd, emit, approve, openLoginBrowser, startupContext, locale);
  }, undefined, version, locale);
}
