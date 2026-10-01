import { afterAll, beforeAll, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { resetCapabilitiesCache, setCapabilityOverrides } from "@earendil-works/pi-tui";
import { ActivityCard, chatMessage } from "./transcript.ts";
import { ChatText } from "./theme.ts";
import { lineDiff } from "./diff.ts";
import { getCatalog } from "../../i18n/index.ts";

/** These tests read exact RGB codes (the surface and the diff backgrounds), so they pin true color instead of depending on the terminal that runs the suite. */
beforeAll(() => setCapabilityOverrides({ trueColor: true }));
afterAll(() => resetCapabilitiesCache());

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
  expect(card.render(56).join("\n")).not.toContain("\x1b[48;2;24;24;27m"); // no surface block either: only a full card has one
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

test("a permission request still gets the full card, because a decision needs the whole detail", () => {
  const card = new ActivityCard("Permission requested", "", "wants to save a memory", true);
  const output = stripVTControlCharacters(card.render(56).join("\n"));

  expect(output).toContain("▾");
  expect(output).toContain("wants to save a memory");
});

/**
 * The full card (a diff or a permission) is a block of the surface gray with one column of padding on each side and no «│» drawn: each row between the two
 * blank ones is painted edge to edge across the card's width, after the chat's two columns of margin. It exists so the bar that used to run down its left side cannot return.
 */
test("a full card is a block of the surface background with a column of padding on each side and no side bars", () => {
  const rows = new ActivityCard("Permission requested", "", "wants to save a memory", true).render(56);
  expect(rows[0]).toBe(""); expect(rows.at(-1)).toBe("");
  const card = rows.slice(1, -1);
  expect(card.length).toBeGreaterThanOrEqual(3); // padding, title, detail, padding
  for (const row of card) {
    expect(row.startsWith("  \x1b[48;2;24;24;27m")).toBe(true); // two columns of margin on the general background, then the block
    expect(stripVTControlCharacters(row)).not.toContain("│");
    expect(stripVTControlCharacters(row)).toHaveLength(54);
  }
  expect(stripVTControlCharacters(card[1]!)).toStartWith("   ▾ Permission requested"); // margin, one column of padding, then the title
  expect(stripVTControlCharacters(card[0]!).trim()).toBe("");
});

/** A diff keeps the surface behind its rows after the red or green row ends: the added/removed highlight stops at its own text and the rest of the block is surface again. */
test("a diff card keeps the surface block around its added and removed rows", () => {
  const rows = new ActivityCard("Edit · file.ts", "Requested", "", true, lineDiff("a", "b")).render(60);
  const removed = rows.find(row => stripVTControlCharacters(row).includes("- a"))!;
  expect(removed).toContain("\x1b[49m\x1b[48;2;24;24;27m"); // after the red row ends, the surface comes back for the right-hand padding
  expect(stripVTControlCharacters(removed)).not.toContain("│");
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

/** Owner's point 15: grey tool lines used to touch the chat's left edge, further out than the assistant's «ASSISTANT · time» header and text, so they did not read as sub-tasks of that message. They must start further in than both, and the `└` preview further in than the bullet. */
test("tool lines are indented deeper than the assistant header and text they belong to", () => {
  const leading = (line: string) => line.length - line.trimStart().length;
  const message = new ChatText(chatMessage("assistant", "I will inspect the workspace.")).render(60).map(stripVTControlCharacters);
  const header = message.find(line => line.includes("ASSISTANT"))!;
  const body = message.find(line => line.includes("I will inspect"))!;

  const tool = new ActivityCard("Bash", "Completed · 17.7s", "merge=0").render(60).map(stripVTControlCharacters);
  const bullet = tool.find(line => line.includes("• Bash"))!;
  const preview = tool.find(line => line.includes("└ merge=0"))!;

  expect(leading(bullet)).toBeGreaterThan(Math.max(leading(header), leading(body)));
  expect(leading(preview)).toBeGreaterThan(leading(bullet));
});

/** The indent is a chat-only concern: a card asked for `indent = 0` (the narrow sidebar) keeps its bullet at column 0, and no rendered line ever exceeds the width it was given. */
test("an indent of zero keeps the bullet at the edge and indented lines still fit the width", () => {
  expect(stripVTControlCharacters(new ActivityCard("Bash", "ok", "", false, undefined, 0).render(30)[1]!)).toStartWith("• Bash");
  for (const width of [12, 30, 56]) {
    for (const line of new ActivityCard("A very long tool title that needs cutting", "Completed · 17.7s", "a long preview line").render(width)) {
      expect(stripVTControlCharacters(line).length).toBeLessThanOrEqual(width);
    }
  }
});

/**
 * Came out of the real-account test: after `/resume` or `/fork` every old message carried the time of now (12:05 p.m.) instead of
 * its own (11:52…). A message from a saved conversation is drawn with the time the protocol gave for it, and with none when it
 * gave none; only a live message (no time passed) takes the time of now.
 */
test("a message header shows the time it is given, no time when it is unknown, and now only when none is passed", () => {
  const at = new Date(2026, 8, 29, 11, 52).getTime();
  const you = getCatalog("en").chatRoles.you;
  const header = (text: string) => stripVTControlCharacters(text).split("\n")[0];
  expect(header(chatMessage("user", "hello", "en", at))).toBe(`## ${you} · ${new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
  expect(header(chatMessage("user", "hello", "en", at))).toContain("11:52");
  expect(header(chatMessage("user", "hello", "en", null))).toBe(`## ${you}`);
  expect(header(chatMessage("user", "hello", "en"))).toBe(`## ${you} · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
  expect(chatMessage("user", "hello", "en", null)).toBe(`## ${you}\n\nhello`);
});
