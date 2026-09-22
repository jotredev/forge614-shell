import { expect, test } from "bun:test";
import type { Terminal } from "@earendil-works/pi-tui";
import { runEngramInitFlow } from "./engram-init.ts";
import { EngramFlowScreen } from "./frame.ts";

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

test("Enter on every screen accepts the defaults: PostgreSQL No, reinforcement Yes", async () => {
  const terminal = new TestTerminal();
  const screen = new EngramFlowScreen(terminal);
  screen.start();
  const result = runEngramInitFlow(screen);
  await tick();
  expect(terminal.output).toContain("Forge614 Engram stores persistent memory locally on this device.");
  terminal.input("\r"); await tick(); // Continue
  expect(terminal.output).toContain("PostgreSQL synchronization");
  terminal.input("\r"); await tick(); // PostgreSQL: No (default)
  expect(terminal.output).toContain("Memory reinforcement");
  terminal.input("\r"); await tick(); // Reinforcement: Yes (default)
  expect(terminal.output).toContain("Summary");
  expect(terminal.output).toContain("PostgreSQL: disabled");
  expect(terminal.output).toContain("reinforcement: enabled");
  expect(terminal.output).toContain("forge614-engram init --json");
  terminal.input("\r"); // Summary: Confirm (default)
  expect(await result).toEqual({ confirmed: true, decisions: { postgresUrl: null, reinforcement: true } });
});

test("choosing No for reinforcement is honored", async () => {
  const terminal = new TestTerminal();
  const screen = new EngramFlowScreen(terminal);
  screen.start();
  const result = runEngramInitFlow(screen);
  await tick();
  terminal.input("\r"); await tick(); // Continue
  terminal.input("\r"); await tick(); // PostgreSQL: No
  terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // Reinforcement: No
  terminal.input("\r"); // Summary: Confirm
  expect(await result).toEqual({ confirmed: true, decisions: { postgresUrl: null, reinforcement: false } });
});

test("choosing Yes for PostgreSQL asks for a connection string, masks it everywhere, and reports it enabled", async () => {
  const terminal = new TestTerminal();
  const screen = new EngramFlowScreen(terminal);
  screen.start();
  const result = runEngramInitFlow(screen);
  await tick();
  terminal.input("\r"); await tick(); // Continue
  terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // PostgreSQL: Yes
  expect(terminal.output).toContain("PostgreSQL connection string");
  terminal.input("postgres://user:pw@host/db");
  terminal.input("\r"); await tick(); // submit connection string
  terminal.input("\r"); await tick(); // Reinforcement: Yes (default)
  expect(terminal.output).toContain("PostgreSQL: enabled");
  expect(terminal.output).toContain("********");
  terminal.input("\r"); // Summary: Confirm
  expect(await result).toEqual({ confirmed: true, decisions: { postgresUrl: "postgres://user:pw@host/db", reinforcement: true } });
  expect(terminal.output).not.toContain("postgres://user:pw@host/db");
});

test("submitting an empty connection string re-asks instead of cancelling the flow", async () => {
  const terminal = new TestTerminal();
  const screen = new EngramFlowScreen(terminal);
  screen.start();
  const result = runEngramInitFlow(screen);
  await tick();
  terminal.input("\r"); await tick(); // Continue
  terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // PostgreSQL: Yes
  terminal.input("\r"); await tick(); // submit nothing
  expect(terminal.output).toContain("A connection string is required.");
  expect(terminal.output).not.toContain("Memory reinforcement");
  terminal.input("postgres://user:pw@host/db");
  terminal.input("\r"); await tick(); // submit a real value
  expect(terminal.output).toContain("Memory reinforcement");
  terminal.input("\r"); await tick(); // Reinforcement: Yes (default)
  terminal.input("\r"); // Summary: Confirm
  expect(await result).toEqual({ confirmed: true, decisions: { postgresUrl: "postgres://user:pw@host/db", reinforcement: true } });
});

test("a bracketed paste on the connection-string screen reaches Engram intact and is never shown", async () => {
  const terminal = new TestTerminal();
  const screen = new EngramFlowScreen(terminal);
  screen.start();
  const result = runEngramInitFlow(screen);
  await tick();
  terminal.input("\r"); await tick(); // Continue
  terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // PostgreSQL: Yes
  terminal.input("\x1b[200~postgres://user:pw@host:5432/db\x1b[201~");
  terminal.input("\r"); await tick(); // submit the pasted value
  terminal.input("\r"); await tick(); // Reinforcement: Yes (default)
  terminal.input("\r"); // Summary: Confirm
  expect(await result).toEqual({ confirmed: true, decisions: { postgresUrl: "postgres://user:pw@host:5432/db", reinforcement: true } });
  expect(terminal.output).not.toContain("postgres://user:pw@host:5432/db");
});

test("a pasted connection string with a trailing newline is trimmed before being submitted", async () => {
  const terminal = new TestTerminal();
  const screen = new EngramFlowScreen(terminal);
  screen.start();
  const result = runEngramInitFlow(screen);
  await tick();
  terminal.input("\r"); await tick(); // Continue
  terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // PostgreSQL: Yes
  terminal.input("\x1b[200~postgres://user:pw@host/db\n\x1b[201~");
  terminal.input("\r"); await tick(); // submit the pasted value (with trailing newline)
  terminal.input("\r"); await tick(); // Reinforcement: Yes (default)
  terminal.input("\r"); // Summary: Confirm
  expect(await result).toEqual({ confirmed: true, decisions: { postgresUrl: "postgres://user:pw@host/db", reinforcement: true } });
});

test("Escape at the intro screen cancels before any other screen is shown", async () => {
  const terminal = new TestTerminal();
  const screen = new EngramFlowScreen(terminal);
  screen.start();
  const result = runEngramInitFlow(screen);
  await tick();
  terminal.input("\x1b");
  expect(await result).toEqual({ confirmed: false });
  expect(terminal.output).not.toContain("PostgreSQL synchronization");
});

test("Ctrl+C while entering the PostgreSQL connection string cancels the whole flow", async () => {
  const terminal = new TestTerminal();
  const screen = new EngramFlowScreen(terminal);
  screen.start();
  const result = runEngramInitFlow(screen);
  await tick();
  terminal.input("\r"); await tick(); // Continue
  terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // PostgreSQL: Yes
  terminal.input("\x03"); // Ctrl+C on the connection-string screen
  expect(await result).toEqual({ confirmed: false });
  expect(terminal.output).not.toContain("Memory reinforcement");
});

test("Cancel on the summary screen reports no confirmation", async () => {
  const terminal = new TestTerminal();
  const screen = new EngramFlowScreen(terminal);
  screen.start();
  const result = runEngramInitFlow(screen);
  await tick();
  terminal.input("\r"); await tick(); // Continue
  terminal.input("\r"); await tick(); // PostgreSQL: No
  terminal.input("\r"); await tick(); // Reinforcement: Yes
  terminal.input("\x1b[B"); terminal.input("\r"); // Summary: Cancel
  expect(await result).toEqual({ confirmed: false });
});
