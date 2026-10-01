import { afterAll, beforeAll, expect, test } from "bun:test";
import { resetCapabilitiesCache, setCapabilityOverrides } from "@earendil-works/pi-tui";
import type { Terminal } from "@earendil-works/pi-tui";
import { chooseStartup } from "./visual-picker.ts";

/** The startup screens read the exact background code they paint, so the tests pin true color instead of depending on the terminal that runs the suite. */
beforeAll(() => setCapabilityOverrides({ trueColor: true }));
afterAll(() => resetCapabilitiesCache());

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
    expect(terminal.output).toContain("\x1b[?1049h");
    expect(terminal.output).toContain("48;2;10;10;11");
    expect(terminal.output).not.toContain("─"); // the rule under «FORGE614 / SHELL» is a blank row now
    expect(terminal.output).toContain("Full — Coming later");
    expect(terminal.output).not.toContain("Choose your AI engine");
    expect(settled).toBe(false);
    terminal.input("\r"); await tick();
    expect(terminal.output).toContain("Choose your AI engine");
    expect(settled).toBe(false);
    terminal.input("\r");
    expect(await result).toEqual(engines[0]);
    // Leaving the alternate screen must not print the selector into shell history.
    for (const segment of terminal.output.split("\x1b[?1049l").slice(1)) {
      const mainScreen = segment.split("\x1b[?1049h")[0]!;
      expect(mainScreen).not.toContain("Choose your");
      expect(mainScreen).not.toContain("Claude Code");
    }
  }
});

/**
 * On a terminal without true color the startup screen's base background and text are the 256-color indexes of the neutral grays (232 and 254), never RGB codes:
 * a terminal that cannot show them would draw a wrong tint over the whole screen.
 */
test("without true color the startup screen paints its base colors with 256-color codes", async () => {
  setCapabilityOverrides({ trueColor: false });
  try {
    const terminal = new TestTerminal();
    const result = chooseStartup(engines, terminal);
    await tick();
    expect(terminal.output).toContain("\x1b[48;5;232m\x1b[38;5;254m");
    expect(terminal.output).not.toMatch(/\x1b\[[34]8;2;/);
    terminal.input("\x1b");
    await result;
  } finally { setCapabilityOverrides({ trueColor: true }); }
});

/** Idea 7: the last used assistant given to the startup flow reaches the engine picker (marked, Enter accepts it) and the two explicit steps stay. */
test("the startup flow passes the last used engine to the engine picker", async () => {
  const both = [engines[0]!, { id: "codex" as const, label: "Codex", executable: "/bin/codex" }];
  const terminal = new TestTerminal();
  const result = chooseStartup(both, terminal, undefined, "en", "codex");
  await tick(); terminal.input("\r"); await tick();
  expect(terminal.output).toContain("last used");
  terminal.input("\r");
  expect(await result).toEqual(both[1]);
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
