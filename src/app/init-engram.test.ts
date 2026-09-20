import { expect, test } from "bun:test";
import { requireEngramProduct } from "./init-engram.ts";

test("requires --product with a value", () => {
  expect(() => requireEngramProduct([])).toThrow("--product <name>");
  expect(() => requireEngramProduct(["--product"])).toThrow("--product <name>");
});

test("rejects an unsupported product", () => {
  expect(() => requireEngramProduct(["--product", "atlas"])).toThrow('"engram" is supported today');
});

test("rejects extra arguments", () => {
  expect(() => requireEngramProduct(["--product", "engram", "extra"])).toThrow("does not accept");
});

test("accepts exactly --product engram", () => {
  expect(() => requireEngramProduct(["--product", "engram"])).not.toThrow();
});

import type { Terminal } from "@earendil-works/pi-tui";
import { readFile } from "node:fs/promises";
import { runInitCommand } from "./init-engram.ts";

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
const tick = () => new Promise(resolve => setTimeout(resolve, 25));

test("rejects a missing product before ever starting the terminal UI", async () => {
  const terminal = new TestTerminal();
  await expect(runInitCommand([], { terminal })).rejects.toThrow("--product <name>");
  expect(terminal.output).toBe("");
});

test("rejects a non-interactive terminal", async () => {
  await expect(runInitCommand(["--product", "engram"])).rejects.toThrow("interactive terminal");
});

test("cancelling makes zero Engram calls and sets exit code 130", async () => {
  const terminal = new TestTerminal();
  const calls: string[][] = [];
  process.exitCode = 0; // Bun's process.exitCode setter ignores `undefined`, so `0` is the actual reset value.
  const run = runInitCommand(["--product", "engram"], {
    terminal,
    run: async (command, args) => { calls.push([command, ...args]); return { status: 0, stdout: "{}", stderr: "" }; },
  });
  await tick();
  terminal.input("\x1b"); // Escape on the intro screen
  await run;
  expect(calls).toEqual([]);
  expect(process.exitCode as number | undefined).toBe(130);
  process.exitCode = 0; // reset so this test's exit code doesn't leak into the overall `bun test` process exit status
});

test("confirming with local storage only runs exactly init --json", async () => {
  const terminal = new TestTerminal();
  const calls: string[][] = [];
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async (command, args) => { calls.push([command, ...args]); return { status: 0, stdout: "{}", stderr: "" }; },
  });
  await tick();
  terminal.input("\r"); await tick(); // Continue
  terminal.input("\r"); await tick(); // PostgreSQL: No (default)
  terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // Reinforcement: No
  terminal.input("\r"); // Summary: Confirm (default)
  await run;
  expect(calls).toEqual([["/Users/tester/.forge614/engram/bin/forge614-engram", "init", "--json"]]);
});

test("confirming with PostgreSQL sends the connection string only to Engram, never to the screen", async () => {
  const terminal = new TestTerminal();
  const calls: string[][] = [];
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async (command, args) => { calls.push([command, ...args]); return { status: 0, stdout: "{}", stderr: "" }; },
  });
  await tick();
  terminal.input("\r"); await tick(); // Continue
  terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // PostgreSQL: Yes
  terminal.input("postgres://user:pw@host/db");
  terminal.input("\r"); await tick(); // submit connection string
  terminal.input("\r"); await tick(); // Reinforcement: Yes (default)
  terminal.input("\r"); // Summary: Confirm
  await run;
  expect(calls).toEqual([
    ["/Users/tester/.forge614/engram/bin/forge614-engram", "init", "--json", "--postgres-url", "postgres://user:pw@host/db"],
    ["/Users/tester/.forge614/engram/bin/forge614-engram", "reinforcement-enable"],
  ]);
  expect(terminal.output).not.toContain("postgres://user:pw@host/db");
});

test("an Engram failure is reported, not swallowed as success", async () => {
  const terminal = new TestTerminal();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 1, stdout: "", stderr: JSON.stringify({ code: "STORAGE_ERROR", error: "No se pudo completar la operación." }) }),
  });
  await tick();
  terminal.input("\r"); await tick(); // Continue
  terminal.input("\r"); await tick(); // PostgreSQL: No (default)
  terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // Reinforcement: No
  terminal.input("\r"); // Summary: Confirm (default)
  await expect(run).rejects.toThrow("No se pudo completar la operación.");
});

test("the init command never imports Shell's normal chat startup modules", async () => {
  const source = await readFile(new URL("./init-engram.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/native-chat|visual-picker|engine-picker/);
});
