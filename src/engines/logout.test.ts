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

/**
 * The question tells the person how to reconnect with the command their assistant has: Claude Code's own `/login` by default,
 * and Shell's `/f614:login` when the caller says so (Codex has no `/login`). It exists because the sentence used to name
 * `/login` for every assistant.
 */
test("the logout question names the login command of the assistant, in both languages", async () => {
  const asked: string[] = [];
  const ask = async (warning: string) => { asked.push(warning); return false; };
  const signal = new AbortController().signal;
  await confirmedLogout("Claude Code", ask, signal, async () => {});
  await confirmedLogout("Codex", ask, signal, async () => {}, "en", "/f614:login");
  await confirmedLogout("Codex", ask, signal, async () => {}, "es", "/f614:login");
  expect(asked.map(text => text.slice(Math.max(text.indexOf("Use /"), text.indexOf("Usa /"))))).toEqual([
    "Use /login here to reconnect with your existing account.",
    "Use /f614:login here to reconnect with your existing account.",
    "Usa /f614:login aquí para reconectar con tu cuenta existente.",
  ]);
});
