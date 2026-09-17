import { expect, test } from "bun:test";
import type { Terminal } from "@earendil-works/pi-tui";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startClaudeUI } from "./claude.ts";

class TestTerminal implements Terminal {
  columns = 120; rows = 50; kittyProtocolActive = false;
  input: (data: string) => void = () => {}; output = "";
  start(input: (data: string) => void) { this.input = input; }
  stop() {} async drainInput() {} write(data: string) { this.output += data; }
  moveBy() {} hideCursor() {} showCursor() {} clearLine() {} clearFromCursor() {} clearScreen() {} setTitle() {} setProgress() {}
}
const tick = () => new Promise(resolve => setTimeout(resolve, 35));

test.skipIf(process.platform === "win32")("Claude UI accepts logout consent and stop while auth is pending, without sending a model message", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-logout-ui-"));
  const executable = join(root, "claude"); const marker = join(root, "calls");
  const terminal = new TestTerminal(); let ui: Promise<void> | undefined;
  const enter = (text: string) => { terminal.input(text); terminal.input("\r"); };
  try {
    await writeFile(executable, `#!${process.execPath}\nconst fs=require('fs');fs.appendFileSync(${JSON.stringify(marker)},process.argv.slice(2).join(' ')+'\\n');console.log('{"loggedIn":true,"authMethod":"claude.ai"}');`, { mode: 0o755 });
    ui = startClaudeUI([], executable, terminal); await tick();
    enter("/logout"); await tick();
    expect(terminal.output).toContain("only in this Forge614-Shell session");
    enter("/no"); await tick();
    await expect(readFile(marker, "utf8")).rejects.toThrow();
    enter("/logout"); await tick(); enter("/stop"); await tick();
    await expect(readFile(marker, "utf8")).rejects.toThrow();
    enter("/logout"); await tick(); enter("/yes");
    await tick();
    expect(terminal.output).toContain("Disconnected locally");
    enter("/new"); await tick(); enter("hello"); await tick();
    await expect(readFile(marker, "utf8")).rejects.toThrow();
    expect(terminal.output).toContain("Use /login");
    enter("/login");
    for (let i = 0; i < 30 && !terminal.output.includes("Connected to Claude in Shell"); i++) await tick();
    expect(await readFile(marker, "utf8")).toBe("auth status --json\n");
    expect(terminal.output).toContain("Connected to Claude in Shell");
  } finally { enter("/quit!"); await ui; await rm(root, { recursive: true, force: true }); }
});
