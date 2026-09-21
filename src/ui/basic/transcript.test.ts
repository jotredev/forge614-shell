import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { ActivityCard, chatMessage } from "./transcript.ts";
import { lineDiff } from "./diff.ts";

test("chat messages render a role label separate from their content", () => {
  const message = stripVTControlCharacters(chatMessage("assistant", "I will inspect the workspace."));

  expect(message).toContain("ASSISTANT");
  expect(message).toContain("I will inspect the workspace.");
  expect(message).not.toContain("Claude:");
});

test("routine tool activity is a plain bullet line — no border, no background, nothing to click", () => {
  const card = new ActivityCard("Read", "3 files · complete");
  const output = stripVTControlCharacters(card.render(56).join("\n"));

  expect(output).toContain("• Read · 3 files · complete");
  expect(output).not.toContain("│");
  expect(output).not.toContain("▾"); expect(output).not.toContain("▸");
  expect(card.render(56).join("\n")).not.toContain("\x1b[48;2;20;31;39m");
  expect((card as unknown as Record<string, unknown>).handleMouse).toBeUndefined();
});

test("a one-line preview sits under the title when there is meaningful detail to show, with no interaction needed to see it", () => {
  const card = new ActivityCard("🧠 memory search", "Completed · 1.3s", '{"query":"favorite color"}');
  const output = stripVTControlCharacters(card.render(56).join("\n"));
  expect(output).toContain("• 🧠 memory search · Completed · 1.3s");
  expect(output).toContain('└ {"query":"favorite color"}');
});

test("consecutive activity lines stay tight against each other instead of each carrying its own blank padding", () => {
  const a = new ActivityCard("Bash", "Completed · 1.7s").render(56);
  const b = new ActivityCard("memory search", "Completed · 1.3s").render(56);
  // Each card contributes exactly one leading blank line for separation from what came before —
  // not a trailing one too, which would double up into a full empty line between two cards.
  expect(a[0]).toBe(""); expect(a.at(-1)).not.toBe("");
  expect(b[0]).toBe(""); expect(b.at(-1)).not.toBe("");
});

test("a permission request still gets the full bordered box, because a decision needs the whole detail", () => {
  const card = new ActivityCard("Permission requested", "", "wants to save a memory", true);
  const output = stripVTControlCharacters(card.render(56).join("\n"));

  expect(output).toContain("▾");
  expect(output).toContain("wants to save a memory");
});

test("a file edit renders as a colored diff, not a JSON dump", () => {
  const diff = lineDiff("const x = 1;\nkeep me", "const x = 2;\nkeep me");
  const card = new ActivityCard("Edit · file.ts", "Requested", "", true, diff);
  const rendered = card.render(60).join("\n");
  const plain = stripVTControlCharacters(rendered);

  expect(plain).toContain("- const x = 1;");
  expect(plain).toContain("+ const x = 2;");
  expect(plain).toContain("keep me");
  expect(rendered).toContain("\x1b[48;2;51;23;29m"); // removed-line background
  expect(rendered).toContain("\x1b[48;2;21;48;36m"); // added-line background
  expect(rendered).not.toContain("old_string");
});

test("tool card replaces progress with reported completion details", () => {
  const card = new ActivityCard("Read", "Requested", "", true);
  card.update("Completed · 1.2s", "file contents");
  const output = stripVTControlCharacters(card.render(60).join("\n"));
  expect(output).toContain("Completed · 1.2s"); expect(output).toContain("file contents");
  expect(output).not.toContain("Requested");
});
