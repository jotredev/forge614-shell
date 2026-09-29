import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { TUI } from "@earendil-works/pi-tui";
import { ForgeComposer } from "./composer.ts";
import type { ComposerChoice } from "./composer.ts";

const fakeTui = { requestRender() {}, terminal: { rows: 40, columns: 100 } } as unknown as TUI;
const items: ComposerChoice[] = [
  { value: "a", display: "Alpha", label: "first", search: "Alpha first" },
  { value: "b", display: "Beta", label: "second", search: "Beta second Café" },
  { value: "c", display: "Gamma", label: "third", search: "Gamma third" },
];
const type = (composer: ForgeComposer, text: string) => { for (const char of text) composer.handleInput(char); };
const screen = (composer: ForgeComposer, width = 90) => stripVTControlCharacters(composer.render(width).join("\n"));

/** Enter has to hand back the highlighted row, and the arrows have to move it: this is the selector's core contract. */
test("a searchable picker moves with the arrows and Enter returns the chosen row", async () => {
  const composer = new ForgeComposer(fakeTui, "en");
  const result = composer.choose("Resume", items, undefined, { searchable: true });
  composer.handleInput("\x1b[B"); composer.handleInput("\r");
  expect(await result).toBe("b");
});

/** Esc must cancel without choosing anything, even in the middle of a search; otherwise a stray Esc would resume the wrong conversation. */
test("Esc resolves nothing, also after typing a search", async () => {
  const composer = new ForgeComposer(fakeTui, "en");
  const result = composer.choose("Resume", items, undefined, { searchable: true });
  type(composer, "gam"); composer.handleInput("\x1b");
  expect(await result).toBeUndefined();
});

/** Typing narrows the visible rows (accents and case ignored) and Enter picks from the narrowed list, not from the full one. */
test("typing filters the rows and Enter picks from what is left", async () => {
  const composer = new ForgeComposer(fakeTui, "en");
  const result = composer.choose("Resume", items, undefined, { searchable: true });
  type(composer, "CAFE");
  const shown = screen(composer);
  expect(shown).toContain("Beta");
  expect(shown).not.toContain("Alpha");
  expect(shown).not.toContain("Gamma");
  composer.handleInput("\r");
  expect(await result).toBe("b");
});

/** Backspace must widen the search again, and a search with no match must say so and ignore Enter instead of returning something. */
test("Backspace widens the search and Enter does nothing while nothing matches", async () => {
  const composer = new ForgeComposer(fakeTui, "en");
  let settled = false;
  const result = composer.choose("Resume", items, undefined, { searchable: true }).then(value => { settled = true; return value; });
  type(composer, "zzz");
  expect(screen(composer)).toContain("No matches");
  composer.handleInput("\r");
  await Promise.resolve();
  expect(settled).toBe(false);
  for (let i = 0; i < 3; i++) composer.handleInput("\x7f");
  expect(screen(composer)).toContain("Gamma");
  composer.handleInput("\r");
  expect(await result).toBe("a");
});

/** /model and /effort share `choose`; typing there must stay ignored exactly as before, so adding search cannot change them. */
test("a picker that is not searchable ignores typed letters", async () => {
  const composer = new ForgeComposer(fakeTui, "en");
  const result = composer.choose("Model", items);
  type(composer, "gam");
  expect(screen(composer)).toContain("Alpha");
  composer.handleInput("\r");
  expect(await result).toBe("a");
});

/** Long titles and first messages must be cut to the screen: no row may be wider than the terminal, whatever the width. */
test("no picker row is wider than the screen", () => {
  const composer = new ForgeComposer(fakeTui, "en");
  const long = "x".repeat(300);
  void composer.choose("Resume", [
    { value: "a", display: `Title ${long}`, label: `12/31/26, 10:00 PM · ~/some/folder · ${long}`, search: long },
    { value: "b", display: "Short", label: "note", search: "short" },
  ], undefined, { searchable: true });
  for (const width of [90, 60, 40, 24]) {
    for (const line of composer.render(width)) expect({ width, columns: visibleWidth(line) <= width }).toEqual({ width, columns: true });
  }
});

/** Names that hold «:», «-», digits or «.» — `/f614:stop`, `/setup-default-sandbox`, a plugin skill `$plug:helper.v2` — must keep autocompleting while they are typed; before, the menu vanished at the first such character. */
test("the / and $ menus keep suggesting through digits, hyphens, colons and dots", () => {
  const composer = new ForgeComposer(fakeTui, "en");
  composer.setCommandGroups([{ title: "X", items: [{ value: "/f614:stop", label: "Cancel the answer" }, { value: "/setup-default-sandbox", label: "set up sandbox" }] }]);
  composer.setSkillChoices([{ value: "$plug:helper.v2", label: "Plugin skill" }]);
  type(composer, "/f614:s");
  expect(screen(composer)).toContain("Cancel the answer");
  for (let i = 0; i < 7; i++) composer.handleInput("\x7f");
  type(composer, "/setup-d");
  expect(screen(composer)).toContain("set up sandbox");
  for (let i = 0; i < 8; i++) composer.handleInput("\x7f");
  type(composer, "$plug:h");
  expect(screen(composer)).toContain("Plugin skill");
});
