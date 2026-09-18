import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { ActivityCard, chatMessage } from "./transcript.ts";

test("chat messages render a role label separate from their content", () => {
  const message = stripVTControlCharacters(chatMessage("assistant", "I will inspect the workspace."));

  expect(message).toContain("ASSISTANT");
  expect(message).toContain("I will inspect the workspace.");
  expect(message).not.toContain("Claude:");
});

test("tool activity is presented as a compact card", () => {
  const card = new ActivityCard("Read", "3 files · complete");
  const output = stripVTControlCharacters(card.render(56).join("\n"));

  expect(output).toContain("▾");
  expect(output).toContain("Read");
  expect(output).toContain("3 files · complete");
  expect(output).toContain("│");
  expect(card.render(56).join("\n")).toContain("\x1b[48;2;20;31;39m");
  const lines = card.render(56).map(stripVTControlCharacters);
  expect(lines[1]).toStartWith("  │");
  expect(lines[1]!.slice(3).trim()).toBe("");
  expect(lines[2]).toStartWith("  │");
});

test("tool card replaces progress with reported completion details", () => {
  const card = new ActivityCard("Read", "Requested");
  card.update("Completed · 1.2s\nfile contents");
  const output = stripVTControlCharacters(card.render(60).join("\n"));
  expect(output).toContain("Completed · 1.2s"); expect(output).toContain("file contents");
  expect(output).not.toContain("Requested");
});
