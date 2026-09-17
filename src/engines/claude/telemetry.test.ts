import { expect, test } from "bun:test";
import { emptyTelemetry, updateTelemetry, telemetryLines } from "./telemetry.ts";

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
