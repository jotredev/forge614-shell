import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Terminal } from "@earendil-works/pi-tui";
import { runLanguageCommand } from "./language-command.ts";
import { loadLocale, saveLocale } from "../infrastructure/shell-preferences.ts";

class TestTerminal implements Terminal {
  columns = 400; rows = 30; kittyProtocolActive = false;
  input: (data: string) => void = () => {}; output = "";
  start(input: (data: string) => void) { this.input = input; }
  stop() {}
  async drainInput() {}
  write(data: string) { this.output += data; }
  moveBy() {} hideCursor() {} showCursor() {} clearLine() {}
  clearFromCursor() {} clearScreen() {} setTitle() {} setProgress() {}
}
const tick = () => new Promise(resolve => setTimeout(resolve, 25));

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "forge614-shell-lang-cmd-"));
}

test("forge614-shell language es saves and confirms in Spanish", async () => {
  const home = tempHome();
  const logs: string[] = [];
  try {
    await runLanguageCommand(["es"], { home, env: {}, log: line => logs.push(line) });
    expect(loadLocale({ home })).toBe("es");
    expect(logs).toEqual(["Idioma configurado en es."]);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("forge614-shell language en saves and confirms in English", async () => {
  const home = tempHome();
  const logs: string[] = [];
  try {
    await runLanguageCommand(["en"], { home, env: {}, log: line => logs.push(line) });
    expect(loadLocale({ home })).toBe("en");
    expect(logs).toEqual(["Language set to en."]);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("an invalid locale value changes nothing and reports a clear error", async () => {
  const home = tempHome();
  try {
    saveLocale("en", { home });
    await expect(runLanguageCommand(["fr"], { home, env: {} })).rejects.toThrow(/not a supported language/i);
    expect(loadLocale({ home })).toBe("en"); // unchanged
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("more than one argument is rejected with a clear usage error", async () => {
  const home = tempHome();
  try {
    await expect(runLanguageCommand(["es", "extra"], { home, env: {} })).rejects.toThrow(/at most one argument/i);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("with no argument, it shows the interactive selector and saves the choice", async () => {
  const home = tempHome();
  const logs: string[] = [];
  const terminal = new TestTerminal();
  try {
    const run = runLanguageCommand([], { home, env: {}, terminal, interactive: true, log: line => logs.push(line) });
    await tick();
    expect(terminal.output).toContain("Español");
    terminal.input("\r"); // English is focused with no LANG set
    await run;
    expect(loadLocale({ home })).toBe("en");
    expect(logs).toEqual(["Language set to en."]);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("cancelling the interactive selector exits non-zero and saves nothing", async () => {
  const home = tempHome();
  const terminal = new TestTerminal();
  process.exitCode = 0;
  try {
    const run = runLanguageCommand([], { home, env: {}, terminal, interactive: true });
    await tick();
    terminal.input("\x1b");
    await run;
    expect(process.exitCode as number | undefined).toBe(130);
    expect(loadLocale({ home })).toBeUndefined();
  } finally { rmSync(home, { recursive: true, force: true }); process.exitCode = 0; }
});
