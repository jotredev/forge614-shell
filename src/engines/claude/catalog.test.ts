import { expect, test } from "bun:test";
import { loadClaudeCatalog, readPlanUsage } from "./catalog.ts";

test("catalog initializes with an open input that yields no model prompts and always closes", async () => {
  let closed = false; let yielded = false;
  const result = await loadClaudeCatalog({ cwd: "/tmp", executable: "claude", env: {} }, undefined, ((input: any) => {
    void (async () => { for await (const _ of input.prompt) yielded = true; })();
    return {
      initializationResult: async () => ({ models: [{ value: "default", displayName: "Default", supportedEffortLevels: ["low", "high"] }], commands: [{ name: "commit", description: "Create a commit", argumentHint: "" }], account: { email: "test@example.com" } }),
      close() { closed = true; },
    };
  }) as any);
  expect(result.models[0]?.value).toBe("default");
  expect(result.commands).toEqual([{ name: "commit", description: "Create a commit", argumentHint: "" }]);
  expect(result.account.email).toBe("test@example.com");
  expect(yielded).toBe(false); expect(closed).toBe(true);
});

test("catalog closes on failed initialization", async () => {
  let closed = false;
  await expect(loadClaudeCatalog({ cwd: "/tmp", executable: "claude", env: {} }, undefined, (() => ({
    initializationResult: async () => { throw new Error("offline"); }, close() { closed = true; },
  })) as any)).rejects.toThrow("offline");
  expect(closed).toBe(true);
});

test("plan usage retains percent units, omits missing counters and tolerates older CLI versions", async () => {
  const usage = await readPlanUsage({ usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({
    rate_limits_available: true, rate_limits: { seven_day: { utilization: 74, resets_at: "2026-09-18T00:00:00Z" }, five_hour: { utilization: null }, seven_day_opus: null },
  }) } as any);
  expect(usage).toEqual([{ label: "seven_day", usedPercent: 74, reset: "2026-09-18T00:00:00Z" }]);
  expect(await readPlanUsage({} as any)).toEqual([]);
});
