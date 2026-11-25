import { expect, test } from "bun:test";
import { parseAgyModelsCliOutput, parseAntigravityCatalog, prettifyAntigravityModelId, resolveAntigravityModelDisplay } from "./models.ts";

/**
 * Parses a real-shaped ACP `session/new` catalog (`models` + `configOptions`) into clean model
 * families with only the reasoning levels valid for each model, leaving fixed-effort slugs and
 * orchestrators without conflicting efforts. Exists because `agy` rejects mismatched slug+effort
 * combinations.
 */
test("parseAntigravityCatalog groups families with valid efforts and keeps fixed-effort models conflict-free", () => {
  const parsed = parseAntigravityCatalog(
    {
      currentModelId: "gemini-4-neon-high",
      availableModels: [
        { modelId: "gemini-4-neon-high", name: "Gemini 4 Neon (High)" },
        { modelId: "gemini-4-neon-xhigh", name: "Gemini 4 Neon (XHigh)" },
        { modelId: "gemini-4-neon-medium", name: "Gemini 4 Neon (Medium)" },
        { modelId: "gemini-4-neon-low", name: "Gemini 4 Neon (Low)" },
        { modelId: "gemini-pro-orchestrator-neon", name: "Orchestrator (Neon)" },
        { modelId: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)" },
        { modelId: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium)" },
        { modelId: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)" },
        { modelId: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" },
      ],
    },
    [
      {
        id: "model",
        category: "model",
        currentValue: "gemini-4-neon",
        options: [
          { value: "gemini-4-neon", name: "Gemini 4 Neon" },
          { value: "gemini-pro-orchestrator-neon", name: "Orchestrator (Neon)" },
          { value: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
          { value: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" },
        ],
      },
      {
        id: "thought_level",
        category: "thought_level",
        currentValue: "high",
        options: [
          { value: "low", name: "Low" },
          { value: "medium", name: "Medium" },
          { value: "high", name: "High" },
          { value: "xhigh", name: "Extra" },
        ],
      },
    ],
  );

  expect(parsed.currentModel).toBe("gemini-4-neon");
  expect(parsed.currentEffort).toBe("high");
  expect(parsed.currentEfforts).toEqual(["low", "medium", "high", "xhigh"]);
  expect(parsed.models).toEqual([
    { id: "gemini-4-neon", name: "Gemini 4 Neon", efforts: ["low", "medium", "high", "xhigh"], defaultEffort: "high" },
    { id: "gemini-pro-orchestrator-neon", name: "Orchestrator (Neon)" },
    { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", efforts: ["low", "medium", "high"], defaultEffort: "high" },
    { id: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" },
  ]);
  expect(resolveAntigravityModelDisplay(parsed, "gemini-4-neon")).toBe("Gemini 4 Neon");
  expect(resolveAntigravityModelDisplay(parsed, "gemini-3.8-flash-high")).toBe("Gemini 3.8 Flash (High)");
  expect(resolveAntigravityModelDisplay(parsed, "unknown-future-model-xhigh")).toBe("Unknown Future Model (XHigh)");
});

/**
 * Verifies `prettifyAntigravityModelId` converts raw technical slugs into readable titles so the
 * sidebar and `/status` never show an unprocessed wire identifier.
 */
test("prettifyAntigravityModelId formats unknown technical model slugs into readable names", () => {
  expect(prettifyAntigravityModelId("gemini-4-neon-high")).toBe("Gemini 4 Neon (High)");
  expect(prettifyAntigravityModelId("claude-opus-5-5")).toBe("Claude Opus 5.5");
  expect(prettifyAntigravityModelId("gpt-oss-120b-medium")).toBe("GPT-OSS 120B (Medium)");
  expect(prettifyAntigravityModelId("gemini-3.8-flash-low")).toBe("Gemini 3.8 Flash (Low)");
});

/**
 * Verifies `parseAgyModelsCliOutput` handles real `agy models` stdout formatting cleanly.
 * Exists so CLI model output stays parseable into Shell's `NativeModel[]` shape.
 */
test("parseAgyModelsCliOutput parses real agy models output lines into grouped models", () => {
  const sample = [
    "gemini-4-neon-high             Gemini 4 Neon (High)",
    "gemini-4-neon-low              Gemini 4 Neon (Low)",
    "gemini-pro-orchestrator-neon   Orchestrator (Neon)",
    "gpt-oss-120b-medium            GPT-OSS 120B (Medium)",
  ].join("\n");
  expect(parseAgyModelsCliOutput(sample)).toEqual([
    { id: "gemini-4-neon", name: "Gemini 4 Neon", efforts: ["low", "high"], defaultEffort: "high" },
    { id: "gemini-pro-orchestrator-neon", name: "Orchestrator (Neon)" },
    { id: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" },
  ]);
});
