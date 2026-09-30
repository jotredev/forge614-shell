import { expect, test } from "bun:test";
import { confirmedLogout } from "./logout.ts";
import type { ShellQuestion } from "./types.ts";

/**
 * Cancelling never disconnects: only «Yes» calls `logout`, and «No» (also Esc, which the screen turns into «No») or a stop that
 * arrives while the question is open leave the connection as it was. The question is Shell's own (`Confirm`), never the assistant's
 * permission one, so it exists to keep the disconnect from being asked in the shape of a tool permission.
 */
test("local logout requires consent and cancellation preserves the connection", async () => {
  for (const decision of ["yes", "no", "stop"] as const) {
    const control = new AbortController(); let calls = 0;
    const result = await confirmedLogout("Test engine", async (question, signal) => {
      expect(question.body).toContain("only in this Forge614-Shell session");
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
 * The body tells the person how to reconnect with the command their assistant has: Claude Code's own `/login` by default,
 * and Shell's `/f614:login` when the caller says so (Codex has no `/login`). It exists because the sentence used to name
 * `/login` for every assistant.
 */
test("the logout question names the login command of the assistant, in both languages", async () => {
  const asked: string[] = [];
  const ask = async (question: ShellQuestion) => { asked.push(question.body ?? ""); return false; };
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

/**
 * The owner's rule: a question of Shell's own that disconnects goes out with «No» first (the screen marks the first row, so Enter alone
 * keeps things as they are) and with its own words, never with the permission question's «Yes / No». The exact texts, word for word
 * in both languages and for both assistants, so any change to a word shows up here.
 */
test("the logout question has its own title and «No» first, word for word in English and Spanish", async () => {
  const asked: ShellQuestion[] = [];
  const ask = async (question: ShellQuestion) => { asked.push(question); return false; };
  const signal = new AbortController().signal;
  await confirmedLogout("Claude Code", ask, signal, async () => {}, "en");
  await confirmedLogout("Codex", ask, signal, async () => {}, "en", "/f614:login");
  await confirmedLogout("Claude Code", ask, signal, async () => {}, "es");
  await confirmedLogout("Codex", ask, signal, async () => {}, "es", "/f614:login");
  expect(asked).toEqual([
    { title: "Disconnect Claude Code from this Shell?", no: "No, stay connected", yes: "Yes, disconnect",
      body: "Disconnects only in this Forge614-Shell session. Your native account, Orca, other terminals and saved chats will not be changed. Use /login here to reconnect with your existing account." },
    { title: "Disconnect Codex from this Shell?", no: "No, stay connected", yes: "Yes, disconnect",
      body: "Disconnects only in this Forge614-Shell session. Your native account, Orca, other terminals and saved chats will not be changed. Use /f614:login here to reconnect with your existing account." },
    { title: "¿Desconectar Claude Code de esta Shell?", no: "No, seguir conectado", yes: "Sí, desconectar",
      body: "Se desconecta solo en esta sesión de Forge614-Shell. Tu cuenta nativa, Orca, otras terminales y los chats guardados no cambiarán. Usa /login aquí para reconectar con tu cuenta existente." },
    { title: "¿Desconectar Codex de esta Shell?", no: "No, seguir conectado", yes: "Sí, desconectar",
      body: "Se desconecta solo en esta sesión de Forge614-Shell. Tu cuenta nativa, Orca, otras terminales y los chats guardados no cambiarán. Usa /f614:login aquí para reconectar con tu cuenta existente." },
  ]);
});
