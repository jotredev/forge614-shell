import { expect, test } from "bun:test";
import { ShellState } from "./shell-state.ts";

test("disconnecting clears engine details while preserving no stale usage", () => {
  const state = new ShellState("Codex");
  state.connect({ model: "gpt-5.6", reasoning: "medium", context: { used: 18_000, window: 128_000 }, usage: [{ label: "Weekly", usedPercent: 74, reset: "22h" }] });

  state.disconnect();

  expect(state.snapshot()).toEqual({ account: "disconnected", provider: "Codex" });
});

test("connected state exposes only engine details owned by Shell", () => {
  const state = new ShellState("Claude Code");
  state.connect({ model: "claude-opus", reasoning: "medium" });

  expect(state.snapshot()).toMatchObject({ account: "connected", provider: "Claude Code", model: "claude-opus", reasoning: "medium" });
  expect(state.snapshot().startedAt).toBeLessThanOrEqual(Date.now());
});

test("connected state preserves measured Shell memory without inventing engine memory", () => {
  const state = new ShellState("Codex");
  state.connect({ resources: { shellRssBytes: 48 * 1024 * 1024 } });

  expect(state.snapshot().resources).toEqual({ shellRssBytes: 48 * 1024 * 1024 });
  expect(state.snapshot().resources?.engineRssBytes).toBeUndefined();
});
