import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Terminal } from "@earendil-works/pi-tui";
import { ensureLocale } from "./language-gate.ts";
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
  return mkdtempSync(join(tmpdir(), "forge614-shell-lang-gate-"));
}

test("a valid FORGE614_SHELL_LOCALE resolves immediately, with no selector and no write to preferences.json", async () => {
  const home = tempHome();
  try {
    const locale = await ensureLocale({ env: { FORGE614_SHELL_LOCALE: "es" }, home, interactive: true });
    expect(locale).toBe("es");
    expect(loadLocale({ home })).toBeUndefined(); // session-only: never persisted
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("an already-saved locale resolves immediately, with no selector shown", async () => {
  const home = tempHome();
  try {
    saveLocale("es", { home });
    const terminal = new TestTerminal();
    const locale = await ensureLocale({ env: {}, home, terminal, interactive: true });
    expect(locale).toBe("es");
    expect(terminal.output).toBe(""); // the selector never ran
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("with nothing configured, the selector runs and the choice is persisted", async () => {
  const home = tempHome();
  try {
    const terminal = new TestTerminal();
    const run = ensureLocale({ env: {}, home, terminal, interactive: true });
    await tick();
    expect(terminal.output).toContain("Español");
    terminal.input("\r"); // Enter on the focused (English, no LANG set) option
    expect(await run).toBe("en");
    expect(loadLocale({ home })).toBe("en");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("cancelling the selector returns undefined and persists nothing", async () => {
  const home = tempHome();
  try {
    const terminal = new TestTerminal();
    const run = ensureLocale({ env: {}, home, terminal, interactive: true });
    await tick();
    terminal.input("\x1b");
    expect(await run).toBeUndefined();
    expect(loadLocale({ home })).toBeUndefined();
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("with nothing configured and no interactive terminal, it falls back to English without blocking", async () => {
  const home = tempHome();
  try {
    const locale = await ensureLocale({ env: {}, home, interactive: false });
    expect(locale).toBe("en");
  } finally { rmSync(home, { recursive: true, force: true }); }
});
