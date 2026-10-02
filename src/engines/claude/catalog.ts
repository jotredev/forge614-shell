import type { Query, SettingSource } from "@anthropic-ai/claude-agent-sdk";

/** The setting files Shell asks Claude Code to load, for the live query that serves the whole conversation; `/status` reports this same list. */
export const CLAUDE_SETTING_SOURCES: readonly SettingSource[] = ["user", "project", "local"];

/** How long the handshake may take before the catalog gives up waiting (the query itself is never closed because of it). */
const CATALOG_TIMEOUT_MS = 15_000;

/**
 * Reads the handshake of an open query — models, commands, account and plan usage — with control requests only: nothing reaches the model. It reads over the SAME query the conversation
 * uses (Claude Code stays open), so it never opens or closes anything; when `signal` aborts or Claude Code does not answer in time it stops waiting and the query stays as it was.
 */
export async function readClaudeCatalog(connection: Query, signal?: AbortSignal) {
  signal?.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Claude Code did not answer the catalog request in time.")), CATALOG_TIMEOUT_MS);
    timer.unref?.();
    onAbort = () => reject(signal?.reason ?? new Error("The catalog request was aborted."));
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([(async () => {
      const result = await connection.initializationResult();
      const usage = await readPlanUsage(connection);
      return { models: result.models, commands: result.commands ?? [], account: result.account, usage };
    })(), limit]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

/** Optional, version-sensitive control API. Never gate chat on its availability. */
export async function readPlanUsage(connection: Query) {
  try {
    const response = await connection.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
    if (!response.rate_limits_available || !response.rate_limits) return [];
    return Object.entries(response.rate_limits).flatMap(([label, value]) => {
      if (!value || typeof value !== "object" || !("utilization" in value) || typeof value.utilization !== "number") return [];
      const reset = "resets_at" in value && typeof value.resets_at === "string" ? value.resets_at : undefined;
      return [{ label, usedPercent: value.utilization, ...(reset ? { reset } : {}) }];
    });
  } catch { return []; }
}
