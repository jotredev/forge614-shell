import { expect, test } from "bun:test";
import type { Terminal } from "@earendil-works/pi-tui";
import { runLanguageSelector } from "./language-picker.ts";

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

test("shows both languages before any locale is known, and Enter on the focused option selects it", async () => {
  const terminal = new TestTerminal();
  const run = runLanguageSelector(terminal, { env: {} }); // no LANG -> focuses English
  await tick();
  expect(terminal.output).toContain("Español");
  expect(terminal.output).toContain("English");
  terminal.input("\r");
  expect(await run).toBe("en");
});

test("a Spanish-leaning system locale focuses Español, and Enter selects it", async () => {
  const terminal = new TestTerminal();
  const run = runLanguageSelector(terminal, { env: { LANG: "es_MX.UTF-8" } });
  await tick();
  terminal.input("\r");
  expect(await run).toBe("es");
});

test("selecting the other option with arrow keys works regardless of initial focus", async () => {
  const terminal = new TestTerminal();
  const run = runLanguageSelector(terminal, { env: {} }); // focuses English (index 1)
  await tick();
  terminal.input("\x1b[A"); // up -> Español
  terminal.input("\r");
  expect(await run).toBe("es");
});

test("Esc cancels the selector without choosing a language", async () => {
  const terminal = new TestTerminal();
  const run = runLanguageSelector(terminal, { env: {} });
  await tick();
  terminal.input("\x1b");
  expect(await run).toBeUndefined();
});

test("Ctrl-C cancels the selector without choosing a language", async () => {
  const terminal = new TestTerminal();
  const run = runLanguageSelector(terminal, { env: {} });
  await tick();
  terminal.input("\x03");
  expect(await run).toBeUndefined();
});
