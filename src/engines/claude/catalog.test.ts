import { expect, test } from "bun:test";
import { readClaudeCatalog, readPlanUsage } from "./catalog.ts";

const handshake = {
  initializationResult: async () => ({ models: [{ value: "default", displayName: "Default", supportedEffortLevels: ["low", "high"] }], commands: [{ name: "commit", description: "Create a commit", argumentHint: "" }], account: { email: "test@example.com" } }),
  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({ rate_limits_available: false }),
};

test("the catalog is read over the open query with control requests only and the query is left open", async () => {
  let closed = false;
  const result = await readClaudeCatalog({ ...handshake, close() { closed = true; } } as any);
  expect(result.models[0]?.value).toBe("default");
  expect(result.commands).toEqual([{ name: "commit", description: "Create a commit", argumentHint: "" }]);
  expect(result.account.email).toBe("test@example.com");
  expect(result.usage).toEqual([]);
  expect(closed).toBe(false);
});

test("a failed handshake is thrown and does not close the query that serves the conversation", async () => {
  let closed = false;
  await expect(readClaudeCatalog({ initializationResult: async () => { throw new Error("offline"); }, close() { closed = true; } } as any)).rejects.toThrow("offline");
  expect(closed).toBe(false);
});

test("an aborted catalog read stops waiting at once and leaves the query open", async () => {
  let closed = false;
  const controller = new AbortController();
  const reading = readClaudeCatalog({ initializationResult: () => new Promise(() => {}), close() { closed = true; } } as any, controller.signal);
  controller.abort(new Error("stopped"));
  await expect(reading).rejects.toThrow("stopped");
  expect(closed).toBe(false);
});

test("plan usage retains percent units, omits missing counters and tolerates older CLI versions", async () => {
  const usage = await readPlanUsage({ usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({
    rate_limits_available: true, rate_limits: { seven_day: { utilization: 74, resets_at: "2026-09-18T00:00:00Z" }, five_hour: { utilization: null }, seven_day_opus: null },
  }) } as any);
  expect(usage).toEqual([{ label: "seven_day", usedPercent: 74, reset: "2026-09-18T00:00:00Z" }]);
  expect(await readPlanUsage({} as any)).toEqual([]);
});
