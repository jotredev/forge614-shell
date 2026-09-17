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

export function telemetryLines(state: Telemetry): string[] {
  const unknown = "not reported";
  return [
    `Model: ${state.model ?? unknown} | Applied effort: ${state.effort === null ? "none" : state.effort ?? unknown}`,
    `Last query tokens: input ${state.inputTokens ?? unknown} | output ${state.outputTokens ?? unknown} | cache read ${state.cacheRead ?? unknown} | cache write ${state.cacheWrite ?? unknown}`,
    `Last reported context: ${state.contextTokens ?? unknown} / ${state.contextWindow ?? unknown}`,
    `Last query API-price estimate: ${state.estimateUSD === undefined ? unknown : `$${state.estimateUSD.toFixed(4)}`} — not a bill`,
    ...(["five_hour", "seven_day", ...Object.keys(state.quotas).filter(key => key !== "five_hour" && key !== "seven_day")].map(key => {
      const quota = state.quotas[key];
      return `${key} (last report): ${quota?.utilization === undefined ? unknown : `${Math.round(quota.utilization * 100)}% used`} | ${quota?.status ?? unknown} | resets: ${quota?.resetsAt ? new Date(quota.resetsAt * 1000).toLocaleString() : unknown}${quota?.isUsingOverage ? " | EXTRA USAGE ACTIVE (provider account setting)" : ""}`;
    })),
  ];
}
