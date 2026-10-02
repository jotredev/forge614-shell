import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";
import { compactNumber, formatCount, formatMoment, limitName, quotaStatusText } from "../../i18n/status-text.ts";

export interface Quota {
  status?: string;
  utilization?: number;
  resetsAt?: number;
  isUsingOverage?: boolean;
}
export interface Telemetry {
  model?: string;
  effort?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  cacheRead?: number;
  cacheWrite?: number;
  contextTokens?: number;
  contextWindow?: number;
  estimateUSD?: number;
  quotas: Record<string, Quota>;
}
export function emptyTelemetry(): Telemetry { return { quotas: {} }; }

/** The counters of a `modelUsage` entry that add up across turns; the rest (`contextWindow`, `maxOutputTokens`) are sizes and are never subtracted. */
const ADDITIVE_USAGE = ["inputTokens", "outputTokens", "cacheReadInputTokens", "cacheCreationInputTokens", "webSearchRequests", "costUSD"] as const;

/** The running totals the SDK reported in the newest `result` of a live query: what the next result's own part is counted from. */
export interface ResultTotals { cost: number; models: Record<string, Record<string, number>> }

/**
 * With one live query serving the whole conversation, `total_cost_usd` and `modelUsage` of a `result` are running totals of the query (the SDK says so: «cumulative across turns in streaming-input
 * sessions»). This gives the result as the turn's OWN part — the totals minus those of the previous result — and the totals to remember. Without `previous` (the first result of a query, which
 * starts fresh, also when it resumes a conversation) the event is returned as it came. A total that went down (the SDK resets it on `/clear`) is taken as a fresh start, never as a negative.
 */
export function perTurnResult(event: Record<string, any>, previous?: ResultTotals): { event: Record<string, any>; totals: ResultTotals } {
  const cost = typeof event.total_cost_usd === "number" ? event.total_cost_usd : undefined;
  const models: Record<string, Record<string, number>> = event.modelUsage && typeof event.modelUsage === "object" ? event.modelUsage : {};
  const totals: ResultTotals = { cost: cost ?? previous?.cost ?? 0, models };
  if (!previous) return { event, totals };
  const part = (now: number, before: number) => now >= before ? now - before : now;
  const next: Record<string, any> = { ...event };
  if (cost !== undefined) next.total_cost_usd = part(cost, previous.cost);
  next.modelUsage = Object.fromEntries(Object.entries(models).map(([model, usage]) => {
    const before = previous.models[model];
    if (!before) return [model, usage];
    const own: Record<string, number> = { ...usage };
    for (const key of ADDITIVE_USAGE) if (typeof usage[key] === "number" && typeof before[key] === "number") own[key] = part(usage[key]!, before[key]!);
    return [model, own];
  }));
  return { event: next, totals };
}

// Events are external input. Unknown fields and missing counters are not fabricated.
export function updateTelemetry(state: Telemetry, event: Record<string, any>): Telemetry {
  const next = { ...state, quotas: { ...state.quotas } };
  if (event.type === "system" && event.subtype === "init") {
    next.model = event.model;
    next.effort = event.effort;
  }
  if (event.type === "assistant" && !event.parent_tool_use_id) {
    const usage = event.message?.usage;
    if (usage && typeof usage.input_tokens === "number") {
      next.contextTokens = usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.output_tokens ?? 0);
    }
    if (typeof event.message?.model === "string") next.model = event.message.model;
  }
  if (event.type === "rate_limit_event" && event.rate_limit_info) {
    const info = event.rate_limit_info;
    next.quotas[info.rateLimitType ?? "unspecified"] = { ...info, isUsingOverage: info.isUsingOverage ?? info.overageInUse };
  }
  if (event.type === "result") {
    next.estimateUSD = event.total_cost_usd;
    const models = Object.values(event.modelUsage ?? {}) as Record<string, number>[];
    const sum = (key: string) => models.reduce((total, usage) => total + (usage[key] ?? 0), 0);
    if (models.length) {
      next.inputTokens = sum("inputTokens"); next.outputTokens = sum("outputTokens");
      next.cacheRead = sum("cacheReadInputTokens"); next.cacheWrite = sum("cacheCreationInputTokens");
      next.contextWindow = event.modelUsage?.[next.model ?? ""]?.contextWindow;
    }
  }
  return next;
}

/**
 * The lines of `/f614:status`. Each limit shows with the sidebar's plain name, its status in words and its reset in local time
 * (`formatMoment`): never the provider's key (`five_hour`), its raw status (`allowed`) or a machine date. The counters read like Codex's
 * `/status`: the tokens with the thousands separator of the language (`formatCount`), the context compact (`compactNumber`, «20.2k / 258.4k»).
 */
export function telemetryLines(state: Telemetry, locale: Locale = "en"): string[] {
  const t = getCatalog(locale).telemetry;
  const unknown = t.notReported;
  const count = (value: number | undefined) => value === undefined ? unknown : formatCount(value, locale);
  const compact = (value: number | undefined) => value === undefined ? unknown : compactNumber(value);
  return [
    t.modelLine({ model: state.model ?? unknown, effort: state.effort === null ? t.effortNone : state.effort ?? unknown }),
    t.tokensLine({ input: count(state.inputTokens), output: count(state.outputTokens), cacheRead: count(state.cacheRead), cacheWrite: count(state.cacheWrite) }),
    t.contextLine({ used: compact(state.contextTokens), window: compact(state.contextWindow) }),
    t.costLine({ estimate: state.estimateUSD === undefined ? unknown : `$${state.estimateUSD.toFixed(4)}` }),
    ...(["five_hour", "seven_day", ...Object.keys(state.quotas).filter(key => key !== "five_hour" && key !== "seven_day")].map(key => {
      const quota = state.quotas[key];
      const used = quota?.utilization === undefined ? unknown : t.percentUsed({ percent: Math.round(quota.utilization * 100) });
      const resets = quota?.resetsAt ? t.resetsAt({ moment: formatMoment(quota.resetsAt * 1000, locale) }) : t.resetsUnknown;
      return t.quotaLine({ name: limitName(key, locale), used, status: quotaStatusText(quota?.status, locale), resets }) + (quota?.isUsingOverage ? t.extraUsageActive : "");
    })),
  ];
}
