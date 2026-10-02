import { expect, test } from "bun:test";
import { emptyTelemetry, perTurnResult, updateTelemetry, telemetryLines } from "./telemetry.ts";

test("telemetry keeps quota separate from tokens and never labels an estimate as a bill", () => {
  let state = emptyTelemetry();
  expect(telemetryLines(state).join("\n")).toContain("not reported");
  state = updateTelemetry(state, { type: "system", subtype: "init", session_id: "session-a", model: "claude-test", effort: "high" });
  state = updateTelemetry(state, { type: "rate_limit_event", rate_limit_info: { rateLimitType: "seven_day", utilization: 0.74, resetsAt: 1800000000, status: "allowed" } });
  state = updateTelemetry(state, { type: "result", total_cost_usd: 0.12, modelUsage: { "claude-test": { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 30, cacheCreationInputTokens: 40, contextWindow: 200000 } } });
  expect(state.model).toBe("claude-test");
  expect(state.effort).toBe("high");
  expect(state.inputTokens).toBe(10);
  expect(state.outputTokens).toBe(20);
  expect(state.quotas.seven_day?.utilization).toBe(0.74);
  expect(telemetryLines(state).join("\n")).toContain("74%");
  expect(telemetryLines(state).join("\n")).toContain("not a bill");
  expect(state.contextTokens).toBeUndefined(); // Totals are not current context occupancy.
});

/**
 * `/f614:status` names the limits like the sidebar and says the status in plain words, in both languages, with no provider key
 * («five_hour», «seven_day», «allowed») and no machine date. It exists because the real-account test of 1.12.0 showed
 * «five_hour (last report): not reported | allowed | resets: …» to the owner.
 */
test("the quota lines of /f614:status use plain names, a translated status and a readable reset moment", () => {
  const reset = new Date(2026, 9, 3, 17, 22, 0).getTime() / 1000;
  let state = updateTelemetry(emptyTelemetry(), { type: "rate_limit_event", rate_limit_info: { rateLimitType: "seven_day", utilization: 0.74, resetsAt: reset, status: "allowed" } });
  state = updateTelemetry(state, { type: "rate_limit_event", rate_limit_info: { rateLimitType: "five_hour", utilization: 0.9, resetsAt: reset, status: "allowed_warning" } });
  const quotaLines = (locale: "en" | "es") => telemetryLines(state, locale).slice(4);
  expect(quotaLines("en")).toEqual([
    "5-hour limit (last report): 90% used | allowed, near the limit | resets Oct 3, 5:22 PM",
    "Weekly limit (last report): 74% used | allowed | resets Oct 3, 5:22 PM",
  ]);
  expect(quotaLines("es")).toEqual([
    "Límite de 5 horas (último reporte): 90% usado | permitido, cerca del límite | se reinicia el 3 oct, 5:22 p.m.",
    "Límite semanal (último reporte): 74% usado | permitido | se reinicia el 3 oct, 5:22 p.m.",
  ]);
  // Nothing reported yet: the two usual limits still show, with «not reported» in place of every value.
  expect(telemetryLines(emptyTelemetry(), "en").slice(4)).toEqual([
    "5-hour limit (last report): not reported | not reported | reset not reported",
    "Weekly limit (last report): not reported | not reported | reset not reported",
  ]);
  expect(telemetryLines(emptyTelemetry(), "es").slice(4)).toEqual([
    "Límite de 5 horas (último reporte): no reportado | no reportado | reinicio no reportado",
    "Límite semanal (último reporte): no reportado | no reportado | reinicio no reportado",
  ]);
  // A limit that is rejected and one the SDK reports in extra usage.
  const blocked = updateTelemetry(emptyTelemetry(), { type: "rate_limit_event", rate_limit_info: { rateLimitType: "overage", status: "rejected", isUsingOverage: true } });
  expect(telemetryLines(blocked, "en").slice(6)).toEqual(["Extra usage (last report): not reported | blocked | reset not reported | EXTRA USAGE ACTIVE (provider account setting)"]);
  for (const locale of ["en", "es"] as const) {
    for (const lines of [telemetryLines(state, locale), telemetryLines(emptyTelemetry(), locale), telemetryLines(blocked, locale)]) {
      expect(lines.join("\n")).not.toMatch(/five_hour|seven_day|allowed_warning|rejected|\d{4}-\d{2}-\d{2}T/);
      if (locale === "es") expect(lines.join("\n")).not.toContain("allowed"); // in English «allowed» is the plain word itself
    }
  }
});

/**
 * `/f614:status` writes the counters like `/status` of Codex does: the tokens of the last query with the thousands separator of each language («20 240» / «20,240»),
 * the context in compact form («20.2k / 258.4k»); a counter Claude Code did not report stays «not reported». It used to print the raw numbers («20240», «258400»).
 */
test("the token and context lines of /f614:status are readable: separator per language and compact context", () => {
  let state = updateTelemetry(emptyTelemetry(), { type: "assistant", parent_tool_use_id: null, message: { model: "claude-test", usage: { input_tokens: 20_000, cache_read_input_tokens: 100, cache_creation_input_tokens: 100, output_tokens: 40 } } });
  state = updateTelemetry(state, { type: "result", total_cost_usd: 0.1, modelUsage: { "claude-test": { inputTokens: 20_240, outputTokens: 1_234_567, cacheReadInputTokens: 700, cacheCreationInputTokens: 2_996, contextWindow: 258_400 } } });
  expect(telemetryLines(state, "en")[1]).toContain("input 20,240 | output 1,234,567 | cache read 700 | cache write 2,996");
  expect(telemetryLines(state, "en")[2]).toBe("Last reported context: 20.2k / 258.4k");
  expect(telemetryLines(state, "es")[1]).toContain("entrada 20 240 | salida 1 234 567 | lectura de caché 700 | escritura de caché 2 996");
  expect(telemetryLines(state, "es")[2]).toBe("Último contexto reportado: 20.2k / 258.4k");
  expect(telemetryLines(emptyTelemetry(), "en")[2]).toBe("Last reported context: not reported / not reported");
});

test("token counters are per query and subagent input is not main context occupancy", () => {
  let state = updateTelemetry(emptyTelemetry(), { type: "assistant", parent_tool_use_id: null, message: { model: "claude-test", usage: { input_tokens: 10, cache_read_input_tokens: 30, cache_creation_input_tokens: 40, output_tokens: 20 } } });
  expect(state.contextTokens).toBe(100);
  state = updateTelemetry(state, { type: "assistant", parent_tool_use_id: "child", message: { usage: { input_tokens: 1000 } } });
  expect(state.contextTokens).toBe(100);
  const result = { type: "result", total_cost_usd: 0.1, modelUsage: { "claude-test": { inputTokens: 5, outputTokens: 8, contextWindow: 200000 } } };
  state = updateTelemetry(updateTelemetry(state, result), result);
  expect(state.inputTokens).toBe(5);
  expect(state.estimateUSD).toBe(0.1);
  expect(state.contextWindow).toBe(200000);
});

/** The SDK's totals are running totals of the live query: each result shows its own part, sizes are not subtracted, and a total that went down is a fresh start. */
test("perTurnResult shows each turn's own part of the running totals and keeps sizes whole", () => {
  const usage = (input: number, output: number) => ({ "claude-test": { inputTokens: input, outputTokens: output, cacheReadInputTokens: 10, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: input / 100, contextWindow: 200000, maxOutputTokens: 32000 } });
  const first = perTurnResult({ type: "result", total_cost_usd: 0.25, modelUsage: usage(100, 40) });
  // The first result of a query is as it came, and its totals are what the next is counted from.
  expect(first.event.total_cost_usd).toBe(0.25);
  expect(first.totals).toEqual({ cost: 0.25, models: usage(100, 40) });
  const second = perTurnResult({ type: "result", total_cost_usd: 0.75, modelUsage: usage(350, 90) }, first.totals);
  expect(second.event.total_cost_usd).toBe(0.5);
  expect(second.event.modelUsage["claude-test"]).toEqual({ inputTokens: 250, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 2.5, contextWindow: 200000, maxOutputTokens: 32000 });
  expect(second.totals.cost).toBe(0.75);
  // A total that went down (the SDK resets it on /clear) is a fresh start, never a negative number.
  const reset = perTurnResult({ type: "result", total_cost_usd: 0.125, modelUsage: usage(20, 5) }, second.totals);
  expect(reset.event.total_cost_usd).toBe(0.125);
  expect(reset.event.modelUsage["claude-test"].inputTokens).toBe(20);
  // A result with no counters (an older Claude Code) passes unchanged.
  expect(perTurnResult({ type: "result" }, second.totals).event).toEqual({ type: "result", modelUsage: {} });
});
