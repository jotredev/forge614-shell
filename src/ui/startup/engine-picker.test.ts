import { expect, test } from "bun:test";
import type { Terminal } from "@earendil-works/pi-tui";
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

test("an empty Engines result gives installation guidance instead of a broken menu", async () => {
  const terminal = new TestTerminal();
  await expect(chooseEngine([], terminal)).rejects.toThrow("Forge614 Engines found no Shell-compatible AI engines");
  expect(terminal.output).toBe("");
});
