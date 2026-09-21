import { expect, test } from "bun:test";
import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import { resolveModelDisplay } from "./claude.ts";

const models: ModelInfo[] = [
  { value: "default", displayName: "Default (recommended)", description: "Native default" },
  // Reproduces the real bug: this row's value has no relation to the live wire id at all.
  { value: "opus[1m]", displayName: "Opus (1M context)", description: "Best for everyday, complex tasks" },
  { value: "sonnet", displayName: "Sonnet", description: "Efficient for routine tasks", resolvedModel: "claude-sonnet-5" },
  // Reproduces the other real bug: resolvedModel carries a context-window tag the live event doesn't.
  { value: "fable[1m]", displayName: "Fable (1M context)", description: "Most capable", resolvedModel: "claude-fable-5-1[1m]" },
];

test("an explicit model pick always resolves to its friendly name, even when the live event's id shares nothing with the catalog", () => {
  expect(resolveModelDisplay(models, "opus[1m]", "claude-opus-5")).toBe("Opus (1M context)");
});

test("a clean alias with a matching resolvedModel still resolves through the live event", () => {
  expect(resolveModelDisplay(models, "default", "claude-sonnet-5")).toBe("Sonnet");
});

test("left on default, a resolvedModel that only differs by its context-window tag still matches", () => {
  expect(resolveModelDisplay(models, "default", "claude-fable-5-1")).toBe("Fable (1M context)");
});

test("left on default with no turn run yet, there is nothing to show — not a guess", () => {
  expect(resolveModelDisplay(models, "default", undefined)).toBeUndefined();
  expect(resolveModelDisplay(models, undefined, undefined)).toBeUndefined();
});

test("an id the catalog truly does not recognize is prettified instead of shown as a raw technical string", () => {
  expect(resolveModelDisplay(models, "default", "claude-opus-5")).toBe("Opus 5");
  expect(resolveModelDisplay(models, "default", "claude-some-future-model")).toBe("Some Future Model");
});
