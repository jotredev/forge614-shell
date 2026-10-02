import { startNativeProcess } from "../engines/process.ts";
import { CodexSession } from "../engines/codex/session.ts";
import type { Approve, Emit, NativeId } from "../engines/types.ts";
import type { RpcConnection } from "../infrastructure/rpc.ts";
import { runNativeUI } from "../ui/basic/native.ts";
import { openLoginBrowser } from "../infrastructure/browser.ts";
import { getStartupContext } from "../infrastructure/forge614-engram.ts";
import { withStartupNotices } from "../infrastructure/engram-notices.ts";
import { createMemoryHookProbe } from "../infrastructure/memory-hook.ts";
import type { EcosystemVersions } from "../infrastructure/ecosystem-versions.ts";
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

/** How the app-server is started: `startNativeProcess`, or a stand-in in a test. */
export type StartProcess = (id: NativeId, executable: string, cwd: string, env: NodeJS.ProcessEnv, diagnostic: (text: string) => void) => RpcConnection;

/**
 * Builds the Codex session with everything the composition root gives it: the app-server connection, Engram's memory (with its notices as transcript text), the
 * once-per-run check of Engines' startup hook, and `start` again as the way to open the app-server anew — what lets a `/f614:stop` that Codex never answers end in
 * a reconnection that resumes the same conversation. `start` is the process starter, a parameter only so a test can stand in for it. Exported for testing.
 */
export function createCodexSession(
  id: NativeId, executable: string, cwd: string, emit: Emit, approve: Approve, locale: Locale, start: StartProcess = startNativeProcess,
): CodexSession {
  const open = () => start(id, executable, cwd, process.env, text => emit({ type: "text", text }));
  // Engram's notices reach the person as transcript text; the session never knows about them.
  const startupContext = withStartupNotices(codexStartupContext, text => emit({ type: "text", text }), locale);
  // Engines' startup hook already delivers the memory to Codex when `verify memory-integration` (and the session's `hooks/list`) says so.
  return new CodexSession(open(), cwd, emit, approve, openLoginBrowser, startupContext, locale, createMemoryHookProbe("codex", { env: process.env }), open);
}

// Composition root: views render sessions; they do not construct transports.
export async function startNativeUI(id: NativeId, executable: string, args: string[], version?: string, locale: Locale = "en", readVersions?: () => Promise<EcosystemVersions>): Promise<void> {
  const t = getCatalog(locale).chat;
  if (args.length) throw new Error(t.nativeCliOptionsUnsupported({ id }));
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error(t.nativeRequiresInteractiveTerminal);
  const cwd = process.cwd();
  await runNativeUI(id, cwd, (emit, approve) => createCodexSession(id, executable, cwd, emit, approve, locale), undefined, version, locale, undefined, undefined, readVersions);
}
