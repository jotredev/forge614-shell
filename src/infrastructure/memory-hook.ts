import { verifyMemoryIntegration } from "./forge614-engines.ts";
import type { DetectRun, MemoryVerification } from "./forge614-engines.ts";

/** How long the one check waits for Engines before Shell gives up and pastes its own memory block (better twice than never). */
export const MEMORY_HOOK_TIMEOUT_MS = 8000;

/**
 * Whether the assistant's own startup hook (the one Engines installs) delivers Engram's memory: it is present, its dry run passes and
 * its runtime status is none of `unsupported`, `absent` and `needs-user-trust`. `pending-runtime-verification` and `runtime-observed`
 * both count: the hook is installed and trusted, it just may not have been seen running yet.
 */
export function isStartupHookActive(verification: MemoryVerification): boolean {
  const { present, dryRunOk, runtimeStatus } = verification.hook;
  return present && dryRunOk && !["unsupported", "absent", "needs-user-trust"].includes(runtimeStatus.kind);
}

/**
 * The check a chat session asks before pasting Engram's memory itself: one `verify memory-integration --agent <id> --json` (the only
 * Engines command involved — Shell never runs `memory-hook-run` nor reads `hook-evidence`), run at most once per Shell run for this
 * assistant, and shared by everyone who asks. Anything that goes wrong — a failed or unreadable answer, an Engines without the hook
 * part, an error, or no answer within `timeoutMs` — means «not active», so Shell pastes its own block.
 */
export function createMemoryHookProbe(
  agentId: string,
  options: { home?: string; env?: NodeJS.ProcessEnv; run?: DetectRun; timeoutMs?: number } = {},
): () => Promise<boolean> {
  let decided: Promise<boolean> | undefined;
  return () => decided ??= (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), options.timeoutMs ?? MEMORY_HOOK_TIMEOUT_MS); });
      const { timeoutMs: _timeoutMs, ...engines } = options;
      return await Promise.race([verifyMemoryIntegration({ agentId, ...engines }).then(isStartupHookActive), timeout]);
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  })();
}
