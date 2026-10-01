import { afterAll, beforeAll, expect, test } from "bun:test";
import { resetCapabilitiesCache, setCapabilityOverrides } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";
import { ChatText, PanelText, accent, addedBackground, danger, elevated, faint, foreground, muted, nearestAnsi256, palette, surface, workspaceColors } from "./theme.ts";

/** These tests state which color mode they check; the terminal the suite happens to run in must not decide it. */
beforeAll(() => setCapabilityOverrides({ trueColor: true }));
afterAll(() => resetCapabilitiesCache());

/**
 * Runs `body` as a terminal without true color (Terminal.app, a plain `xterm-256color`): theme.ts asks pi-tui's `getCapabilities().trueColor` every time it paints,
 * so flipping the override here is what a person's terminal does for real. It restores true color afterwards so the neighbours keep their own mode.
 */
function withoutTrueColor<T>(body: () => T): T {
  setCapabilityOverrides({ trueColor: false });
  try { return body(); } finally { setCapabilityOverrides({ trueColor: true }); }
}

/**
 * The one conversion from RGB to the 256-color palette (6×6×6 cube from index 16, 24-step gray ramp from 232) gives exactly these indexes. The
 * values were worked out by hand from the xterm levels (cube 0/95/135/175/215/255, grays 8 + 10·i), not read back from the function: black and white
 * are the cube's corners, each neutral gray of the palette lands on the nearest ramp step, and the cyan accent on a cube cell.
 */
test("RGB converts to the nearest of the 256 colors, with exact indexes for black, white, every neutral gray and the accent", () => {
  expect(nearestAnsi256([0, 0, 0])).toBe(16);
  expect(nearestAnsi256([255, 255, 255])).toBe(231);
  expect(nearestAnsi256([255, 0, 0])).toBe(196);
  expect(nearestAnsi256([128, 128, 128])).toBe(244);
  expect(nearestAnsi256(palette.background)).toBe(232);
  expect(nearestAnsi256(palette.surface)).toBe(234);
  expect(nearestAnsi256(palette.elevated)).toBe(235);
  expect(nearestAnsi256(palette.foreground)).toBe(254);
  expect(nearestAnsi256(palette.muted)).toBe(248);
  expect(nearestAnsi256(palette.faint)).toBe(238);
  expect(nearestAnsi256(palette.accent)).toBe(80);
});

/** The owner's neutral grays, exactly: no blue tint (the three channels differ by at most 9) and each zone one step lighter than the one before. */
test("the palette is the neutral gray set the owner chose", () => {
  expect(palette.background).toEqual([10, 10, 11]);
  expect(palette.surface).toEqual([24, 24, 27]);
  expect(palette.elevated).toEqual([39, 39, 42]);
  expect(palette.foreground).toEqual([228, 228, 231]);
  expect(palette.muted).toEqual([161, 161, 170]);
  expect(palette.faint).toEqual([63, 63, 70]);
  expect(palette.accent).toEqual([70, 222, 224]);
});

/** With true color the codes are the plain `38;2` / `48;2` RGB ones, as before the redesign. */
test("with true color the painters emit 38;2 and 48;2", () => {
  expect(foreground("x")).toBe("\x1b[38;2;228;228;231mx\x1b[39m");
  expect(surface("x")).toBe("\x1b[48;2;24;24;27mx\x1b[49m");
  expect(elevated("x")).toBe("\x1b[48;2;39;39;42mx\x1b[49m");
  expect(workspaceColors()).toBe("\x1b[48;2;10;10;11m\x1b[38;2;228;228;231m");
});

/** Without true color every painter — foreground, background and the workspace's own base colors — asks for the 256-color index and never for an RGB one; it exists so a terminal without true color does not draw a wrong tint. */
test("without true color the painters emit 38;5 and 48;5 and never 38;2 or 48;2", () => {
  withoutTrueColor(() => {
    expect(foreground("x")).toBe("\x1b[38;5;254mx\x1b[39m");
    expect(muted("x")).toBe("\x1b[38;5;248mx\x1b[39m");
    expect(faint("x")).toBe("\x1b[38;5;238mx\x1b[39m");
    expect(accent("x")).toBe("\x1b[38;5;80mx\x1b[39m");
    expect(surface("x")).toBe("\x1b[48;5;234mx\x1b[49m");
    expect(elevated("x")).toBe("\x1b[48;5;235mx\x1b[49m");
    expect(workspaceColors()).toBe("\x1b[48;5;232m\x1b[38;5;254m");
    const everything = [foreground, muted, faint, accent, danger, surface, elevated, addedBackground].map(paint => paint("x")).join("") + workspaceColors()
      + new ChatText("# Title\n\n```ts\nconst a = 1;\n```\n\n---\n").render(40).join("\n");
    expect(everything).not.toMatch(/\x1b\[[34]8;2;/);
    expect(everything).toMatch(/\x1b\[[34]8;5;/);
  });
});

/** A background block is not cut short by a reset inside it: pi-tui's own pieces (the editor's cursor, wrapped text) end with `\x1b[0m`, and the row must keep its background after it. */
test("a background keeps painting after a reset or a background change inside the text", () => {
  expect(surface("ab\x1b[0mcd")).toBe("\x1b[48;2;24;24;27mab\x1b[0m\x1b[48;2;24;24;27mcd\x1b[49m");
  expect(surface(`a${addedBackground("b")}c`)).toContain("\x1b[49m\x1b[48;2;24;24;27mc");
});

/**
 * A fenced code block has no «───» line: the opening row keeps only the language (if any) in the secondary gray and the closing row is empty, and the code itself
 * sits on the surface color. The Markdown component of pi-tui only hands the theme the text of those two rows, so they cannot be filled across the width.
 */
test("a code block in the chat has no border line; its code sits on the surface background", () => {
  const rows = new ChatText("```ts\nconst a = 1;\n```").render(40);
  const plain = rows.map(stripVTControlCharacters);
  expect(plain.join("\n")).not.toContain("─");
  expect(plain.join("\n")).not.toContain("```");
  expect(plain.some(row => row.includes("ts"))).toBe(true);
  const code = rows.find(row => stripVTControlCharacters(row).includes("const a = 1;"))!;
  expect(code).toContain("\x1b[48;2;24;24;27m");
});

/** The Markdown rule is drawn in the faint gray (the one left for rules), not in the old blue-gray border color. */
test("a Markdown rule is drawn in the faint gray", () => {
  const rule = new ChatText("above\n\n---\n\nbelow").render(40).find(row => stripVTControlCharacters(row).includes("─"))!;
  expect(rule).toContain("\x1b[38;2;63;63;70m");
});

test("ChatText defaults to the normal chat color, but takes an override so an error reads red instead of blending in", () => {
  const normal = new ChatText("Something happened").render(40).join("\n");
  const error = new ChatText("Something happened", danger).render(40).join("\n");

  expect(normal).toContain(foreground("Something happened"));
  expect(error).toContain(danger("Something happened"));
  expect(error).not.toBe(normal);
});

/**
 * A panel asks its rows for the width the text really has — the width it is drawn at minus the four columns of side margin — every time it is drawn, keeps a blank line above and
 * below like `ChatText`, and keeps the row's own spaces (the indent under a column). It exists so `/help` and `/status` can break a long row at the real width.
 */
test("PanelText asks its rows for the width the text has and keeps their indent", () => {
  const asked: number[] = [];
  const panel = new PanelText(width => { asked.push(width); return ["name  first part", "      second part"]; });
  expect(panel.render(40)).toEqual(["", `  ${foreground("name  first part")}`, `  ${foreground("      second part")}`, ""]);
  panel.render(24);
  expect(asked).toEqual([36, 20]);
});

/** A row that still does not fit (one word wider than the whole width) is broken instead of overflowing the box, so it can never push the layout. */
test("PanelText never draws a row wider than the box", () => {
  const rows = new PanelText(() => ["x".repeat(50)]).render(24);
  for (const row of rows) expect(row.replace(/\x1b\[[0-9;]*m/g, "").length).toBeLessThanOrEqual(24);
});
