import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { startTerminalSpinner } from "./startup-spinner.ts";

function fakeStream(isTTY: boolean) {
  const writes: string[] = [];
  return { isTTY, write: (text: string) => { writes.push(text); return true; }, writes } as unknown as NodeJS.WriteStream & { writes: string[] };
}

test("on a real terminal, the spinner animates immediately and clears the line on stop", async () => {
  const stream = fakeStream(true);
  const stop = startTerminalSpinner("Detecting installed AI engines…", stream, 5);
  expect(stream.writes.length).toBeGreaterThan(0);
  expect(stripVTControlCharacters(stream.writes[0]!)).toContain("Detecting installed AI engines…");
  await new Promise(resolve => setTimeout(resolve, 20));
  const framesSeen = stream.writes.length;
  expect(framesSeen).toBeGreaterThan(1); // it animated, not just a single static print
  stop();
  const cleared = stream.writes.at(-1)!;
  expect(stripVTControlCharacters(cleared).trim()).toBe("");
  const writesAfterStop = stream.writes.length;
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(stream.writes.length).toBe(writesAfterStop); // stop() actually cancels the interval
});

test("stop() is safe to call more than once", () => {
  const stream = fakeStream(true);
  const stop = startTerminalSpinner("Working…", stream, 5);
  expect(() => { stop(); stop(); }).not.toThrow();
});

test("on a non-interactive stream (piped output, CI), it prints one plain line instead of animating", () => {
  const stream = fakeStream(false);
  const stop = startTerminalSpinner("Detecting installed AI engines…", stream);
  expect(stream.writes).toEqual(["Detecting installed AI engines…\n"]);
  expect(() => stop()).not.toThrow();
  expect(stream.writes).toEqual(["Detecting installed AI engines…\n"]); // stop is a no-op, nothing left to clear
});
