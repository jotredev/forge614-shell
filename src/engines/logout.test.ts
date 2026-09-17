import { expect, test } from "bun:test";
import { confirmedLogout } from "./logout.ts";

test("local logout requires consent and cancellation preserves the connection", async () => {
  for (const decision of ["yes", "no", "stop"] as const) {
    const control = new AbortController(); let calls = 0;
    const result = await confirmedLogout("Test engine", async (warning, signal) => {
      expect(warning).toContain("only in this Forge614-Shell session");
      expect(signal).toBe(control.signal);
      if (decision === "stop") control.abort();
      return decision !== "no";
    }, control.signal, async () => { calls++; });
    expect(calls).toBe(decision === "yes" ? 1 : 0);
    expect(result).toBe(decision === "yes");
  }
});

test("failed logout never claims success or leaks raw engine diagnostics", async () => {
  await expect(confirmedLogout("Test", async () => true, new AbortController().signal, async () => {
    throw new Error("private token diagnostic");
  })).rejects.toThrow("Could not disconnect Shell");
});
