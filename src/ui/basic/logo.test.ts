import { afterAll, beforeAll, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { resetCapabilitiesCache, setCapabilityOverrides } from "@earendil-works/pi-tui";
import { Container } from "@earendil-works/pi-tui";
import { ChatLogo, helpLogo, renderLogo } from "./logo.ts";

/** These exact RGB assertions need true color instead of whichever terminal runs the suite. */
beforeAll(() => setCapabilityOverrides({ trueColor: true }));
afterAll(() => resetCapabilitiesCache());

/** The letter data is a public visual contract: the double-size sign must use its five approved rows at 82 columns. */
test("the double-size FORGE614 sign has the owner-approved five rows without terminal color codes", () => {
  expect(renderLogo(82, 20, false)).toEqual([
    "████████  ████████  ██████    ████████  ████████    ████████  ████    ██    ██",
    "██        ██    ██  ██    ██  ██        ██          ██          ██    ██    ██",
    "██████    ██    ██  ██    ██  ██  ████  ██████      ████████    ██    ████████",
    "██        ██    ██  ██████    ██    ██  ██          ██    ██    ██          ██",
    "██        ████████  ██    ██  ████████  ████████    ████████  ██████        ██",
  ]);
  expect(renderLogo(82, 20).every(line => !line.includes("\x1b[48;"))).toBe(true);
});

/** The 82-column threshold must not steal the existing 43–81-column side-by-side sign. */
test("the normal FORGE614 sign remains side by side at 81 columns", () => {
  expect(renderLogo(81, 20, false)).toEqual([
    "█▀▀▀ █▀▀█ █▀▀▄ █▀▀▀ █▀▀▀  █▀▀▀ ▀█  █  █",
    "█▀▀  █  █ █▄▄▀ █ ▀█ █▀▀   █▀▀█  █  ▀▀▀█",
    "▀    ▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀▀▀▀  ▀▀▀▀ ▀▀▀    ▀",
  ]);
});

/** Width chooses the compact layout before drawing, so the sign never overflows a narrow chat. */
test("the sign stacks at 42 columns and becomes F614 at 25 columns", () => {
  expect(renderLogo(42, 20, false)).toEqual([
    "█▀▀▀ █▀▀█ █▀▀▄ █▀▀▀ █▀▀▀",
    "█▀▀  █  █ █▄▄▀ █ ▀█ █▀▀ ",
    "▀    ▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀▀▀▀",
    "",
    "█▀▀▀ ▀█  █  █",
    "█▀▀█  █  ▀▀▀█",
    "▀▀▀▀ ▀▀▀    ▀",
  ]);
  expect(renderLogo(25, 20, false)).toEqual([
    "█▀▀▀ █▀▀▀ ▀█  █  █",
    "█▀▀  █▀▀█  █  ▀▀▀█",
    "▀    ▀▀▀▀ ▀▀▀    ▀",
  ]);
});

/** A sign that cannot fit, or would crowd a short terminal, must reserve no chat rows at all. */
test("the sign is absent below its width or height limits", () => {
  expect(renderLogo(17, 20, false)).toEqual([]);
  expect(renderLogo(43, 11, false)).toEqual([]);
});

/** The two halves keep OpenCode's visual hierarchy: muted normal text then bold foreground text. */
test("the colored sign paints FORGE muted without bold and 614 foreground in bold", () => {
  const rows = renderLogo(43, 20);
  expect(rows[0]).toContain("\x1b[38;2;161;161;170m█▀▀▀\x1b[39m");
  expect(rows[0]).not.toContain("\x1b[1m█▀▀▀\x1b[22m");
  expect(rows[0]).toContain("\x1b[1m\x1b[38;2;228;228;231m█▀▀▀\x1b[39m\x1b[22m");
});

/** Hollow letter markers are ordinary spaces now, so no responsive size may emit a background escape sequence. */
test("no sign size paints a shadow background", () => {
  for (const columns of [18, 26, 43, 82]) for (const line of renderLogo(columns, 20)) expect(line).not.toContain("\x1b[48;");
});

/** Help shares the renderer: terminals get color and sizing, while pipes get the stable plain wide form. */
test("help starts with the colored terminal sign and the uncolored wide sign for a pipe", () => {
  expect(helpLogo({ isTTY: true, columns: 25 })[0]).toContain("\x1b[38;2;161;161;170m");
  expect(helpLogo({ isTTY: false, columns: 17 })).toEqual([
    "█▀▀▀ █▀▀█ █▀▀▄ █▀▀▀ █▀▀▀  █▀▀▀ ▀█  █  █",
    "█▀▀  █  █ █▄▄▀ █ ▀█ █▀▀   █▀▀█  █  ▀▀▀█",
    "▀    ▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀▀▀▀  ▀▀▀▀ ▀▀▀    ▀",
  ]);
});

/** The chat sign uses the visible chat rows, centered vertically and horizontally, so notices remain below it. */
test("the chat sign centers in its visible rows and stays absent after the first message and new chat", () => {
  const logo = new ChatLogo(() => 11);
  const notice = { invalidate() {}, render: () => ["Engram notice"] };
  const transcript = new Container();
  transcript.addChild(logo); transcript.addChild(notice);
  expect(transcript.render(81)).toEqual(["", "", "", "", ...renderLogo(81, 40).map(line => " ".repeat(21) + line), "Engram notice"]);
  logo.dismiss();
  expect(transcript.render(43)).toEqual(["Engram notice"]);
  transcript.clear(); transcript.addChild(logo); transcript.addChild(notice);
  expect(transcript.render(43)).toEqual(["Engram notice"]);
  expect(stripVTControlCharacters(renderLogo(43, 40).join("\n"))).toContain("█▀▀▄");
});

/**
 * A chat too narrow (under 18 columns) or a terminal too short (under 12 rows) for the sign must not reserve any rows for it: before this, the centering padding
 * was added even though there was no sign, so with 20 visible rows ten empty rows pushed the notices to the middle of the chat. Both cases return nothing, and a
 * notice written before the sign ends up on the first row of the chat.
 */
test("the chat sign returns no rows at all, not even padding, when it does not fit", () => {
  expect(new ChatLogo(() => 20, () => 40).render(15)).toEqual([]);
  expect(new ChatLogo(() => 20, () => 10).render(100)).toEqual([]);
  const notice = { invalidate() {}, render: () => ["Engram notice"] };
  for (const [width, terminalRows] of [[15, 40], [100, 10]] as const) {
    const transcript = new Container();
    transcript.addChild(new ChatLogo(() => 20, () => terminalRows)); transcript.addChild(notice);
    expect(transcript.render(width)).toEqual(["Engram notice"]);
  }
});
