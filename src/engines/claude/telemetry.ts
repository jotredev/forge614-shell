import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";

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

export function telemetryLines(state: Telemetry, locale: Locale = "en"): string[] {
  const t = getCatalog(locale).telemetry;
  const unknown = t.notReported;
  return [
    t.modelLine({ model: state.model ?? unknown, effort: state.effort === null ? t.effortNone : state.effort ?? unknown }),
    t.tokensLine({
      input: String(state.inputTokens ?? unknown), output: String(state.outputTokens ?? unknown),
      cacheRead: String(state.cacheRead ?? unknown), cacheWrite: String(state.cacheWrite ?? unknown),
    }),
    t.contextLine({ used: String(state.contextTokens ?? unknown), window: String(state.contextWindow ?? unknown) }),
    t.costLine({ estimate: state.estimateUSD === undefined ? unknown : `$${state.estimateUSD.toFixed(4)}` }),
    ...(["five_hour", "seven_day", ...Object.keys(state.quotas).filter(key => key !== "five_hour" && key !== "seven_day")].map(key => {
      const quota = state.quotas[key];
      const used = quota?.utilization === undefined ? unknown : t.percentUsed({ percent: Math.round(quota.utilization * 100) });
      const resets = quota?.resetsAt ? new Date(quota.resetsAt * 1000).toLocaleString() : unknown;
      return t.quotaLine({ key, used, status: quota?.status ?? unknown, resets }) + (quota?.isUsingOverage ? t.extraUsageActive : "");
    })),
  ];
}
