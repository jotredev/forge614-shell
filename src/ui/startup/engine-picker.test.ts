import { expect, test } from "bun:test";
import type { Terminal } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";
import { chooseEngine } from "./engine-picker.ts";

class TestTerminal implements Terminal {
  columns = 100; rows = 30; kittyProtocolActive = false;
  input: (data: string) => void = () => {};
  output = "";
  stopped = false;
  start(input: (data: string) => void) { this.input = input; }
  stop() { this.stopped = true; }
  async drainInput() {}
  write(data: string) { this.output += data; }
  moveBy() {} hideCursor() {} showCursor() {} clearLine() {}
  clearFromCursor() {} clearScreen() {} setTitle() {} setProgress() {}
}
const installed = { id: "claude" as const, label: "Claude Code", executable: "/bin/claude" };

test("one installed engine still waits for Enter instead of launching automatically", async () => {
  const terminal = new TestTerminal();
  let settled = false;
  const selected = chooseEngine([installed], terminal).then(value => { settled = true; return value; });
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(settled).toBe(false);
  expect(terminal.output).toContain("Claude Code");
  expect(terminal.output).not.toContain("Codex");
  terminal.input("\r");
  expect(await selected).toEqual(installed);
  expect(terminal.stopped).toBe(true);
});

test("Escape cancels startup without choosing an engine", async () => {
  const terminal = new TestTerminal();
  const selected = chooseEngine([installed], terminal);
  terminal.input("\x1b");
  expect(await selected).toBeUndefined();
  expect(terminal.stopped).toBe(true);
});

const codex = { id: "codex" as const, label: "Codex", executable: "/bin/codex" };

/** Idea 7: the assistant used last time comes marked and highlighted, so Enter alone reopens it. */
test("the last used engine is marked and Enter accepts it", async () => {
  const terminal = new TestTerminal();
  const selected = chooseEngine([installed, codex], terminal, undefined, "en", "codex");
  await new Promise(resolve => setTimeout(resolve, 20));
  // The test terminal joins the whole frame into one string, so the rows are told apart by position (last frame drawn).
  const text = stripVTControlCharacters(terminal.output);
  const claudeAt = text.lastIndexOf("Claude Code"); const codexAt = text.lastIndexOf("Codex"); const markAt = text.lastIndexOf("last used");
  expect(codexAt).toBeGreaterThan(claudeAt);
  expect(markAt).toBeGreaterThan(codexAt);
  expect(text.slice(claudeAt, codexAt)).not.toContain("last used");
  terminal.input("\r");
  expect(await selected).toEqual(codex);
});

/** Spanish text for the same mark, from the catalog (Shell shows one language at a time). */
test("the last used mark is shown in Spanish when the language is Spanish", async () => {
  const terminal = new TestTerminal();
  const selected = chooseEngine([installed, codex], terminal, undefined, "es", "claude");
  await new Promise(resolve => setTimeout(resolve, 20));
  const text = stripVTControlCharacters(terminal.output);
  const claudeAt = text.lastIndexOf("Claude Code"); const codexAt = text.lastIndexOf("Codex"); const markAt = text.lastIndexOf("último usado");
  expect(markAt).toBeGreaterThan(claudeAt);
  expect(markAt).toBeLessThan(codexAt);
  expect(text).not.toContain("last used");
  terminal.input("\r");
  expect(await selected).toEqual(installed);
});

/** With no last engine (first run) or one that is no longer installed, nothing is marked and the first row is highlighted as before. */
test("with no usable last engine nothing is marked and the first engine is highlighted", async () => {
  for (const last of [undefined, "claude" as const]) {
    const terminal = new TestTerminal();
    const selected = chooseEngine([codex], terminal, undefined, "en", last);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(stripVTControlCharacters(terminal.output)).not.toContain("last used");
    terminal.input("\r");
    expect(await selected).toEqual(codex);
  }
});

test("an empty Engines result gives installation guidance instead of a broken menu", async () => {
  const terminal = new TestTerminal();
  await expect(chooseEngine([], terminal)).rejects.toThrow("Forge614 Engines found no Shell-compatible AI engines");
  expect(terminal.output).toBe("");
});
