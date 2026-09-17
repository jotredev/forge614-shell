import { expect, test } from "bun:test";
import type { Terminal } from "@earendil-works/pi-tui";
import { chooseStartup } from "./visual-picker.ts";

class TestTerminal implements Terminal {
  columns = 100; rows = 30; kittyProtocolActive = false;
  input: (data: string) => void = () => {}; output = "";
  start(input: (data: string) => void) { this.input = input; }
  stop() {}
  async drainInput() {}
  write(data: string) { this.output += data; }
  moveBy() {} hideCursor() {} showCursor() {} clearLine() {}
  clearFromCursor() {} clearScreen() {} setTitle() {} setProgress() {}
}
const engines = [{ id: "claude" as const, label: "Claude Code", executable: "/bin/claude" }];
const tick = () => new Promise(resolve => setTimeout(resolve, 25));

test("every startup waits for Basic then separately waits for an AI selection", async () => {
  for (let run = 0; run < 2; run++) {
    const terminal = new TestTerminal(); let settled = false;
    const result = chooseStartup(engines, terminal).then(value => { settled = true; return value; });
    await tick();
    expect(terminal.output).toContain("Choose your visual interface");
    expect(terminal.output).toContain("Full — Coming later");
    expect(terminal.output).not.toContain("Choose your AI engine");
    expect(settled).toBe(false);
    terminal.input("\r"); await tick();
    expect(terminal.output).toContain("Choose your AI engine");
    expect(settled).toBe(false);
    terminal.input("\r");
    expect(await result).toEqual(engines[0]);
  }
});

test("Full cannot start a chat or advance to the engine picker", async () => {
  const terminal = new TestTerminal(); let settled = false;
  const result = chooseStartup(engines, terminal).then(value => { settled = true; return value; });
  terminal.input("\x1b[B"); terminal.input("\r"); await tick();
  expect(settled).toBe(false);
  expect(terminal.output).not.toContain("Choose your AI engine");
  terminal.input("\x1b");
  expect(await result).toBeUndefined();
});

test("cancelling the visual picker never opens the AI picker", async () => {
  const terminal = new TestTerminal();
  const result = chooseStartup(engines, terminal);
  terminal.input("\x03");
  expect(await result).toBeUndefined();
  expect(terminal.output).not.toContain("Choose your AI engine");
});
