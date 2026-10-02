import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { TUI } from "@earendil-works/pi-tui";
import { ForgeComposer, elementRange } from "./composer.ts";
import type { ComposerChoice } from "./composer.ts";
import { getCatalog } from "../../i18n/index.ts";

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

/** Skills as `skills/list` rows: the value typed is `$name`, the label is the skill's own description. */
const skillRows: ComposerChoice[] = [
  { value: "$find-skills", label: "Find a skill" },
  { value: "$frontend-design", label: "Design a screen" },
];

/**
 * Came out of the real-account test: the `$` list was titled «CODEX SKILLS» and its footer said «Comandos · 1–5 de 56» in
 * Spanish, as if the rows were commands. The group title and the footer name what is listed — skills — in each language.
 */
test("the $ list is titled and counted as skills in the person's language, not as commands", () => {
  for (const [locale, group, footer] of [["es", "HABILIDADES DE CODEX", "Habilidades · 1–2 de 2"], ["en", "CODEX SKILLS", "Skills · 1–2 of 2"]] as const) {
    const composer = new ForgeComposer(fakeTui, locale);
    composer.setSkillChoices(skillRows);
    type(composer, "$f");
    const shown = screen(composer);
    expect(shown).toContain(group);
    expect(shown).toContain(footer);
    expect(shown).not.toContain(locale === "es" ? "Comandos" : "Commands");
  }
});

/**
 * Came out of the real-account test: choosing a skill with Enter sent «$find-skills» at once, with none of the message the
 * person meant to write. Like Codex, Enter and Tab put «$name » in the box and the person goes on writing; the next Enter sends it.
 */
test("Enter or Tab on a skill puts «$name » in the box and sends nothing; the next Enter sends the whole message", () => {
  for (const key of ["\r", "\t"]) {
    const composer = new ForgeComposer(fakeTui, "en");
    const sent: string[] = [];
    composer.onSubmit = value => { sent.push(value); };
    composer.setSkillChoices(skillRows);
    type(composer, "$fi");
    composer.handleInput(key);
    expect(sent).toEqual([]);
    expect(composer.getText()).toBe("$find-skills ");
    expect(screen(composer)).not.toContain("Find a skill");
    type(composer, "look for a skill");
    composer.handleInput("\r");
    expect(sent).toEqual(["$find-skills look for a skill"]);
  }
});

/** The `/` menu keeps sending the chosen command on Enter, as before: only the `$` list changed. */
test("Enter on a command in the / menu still sends it at once", () => {
  const composer = new ForgeComposer(fakeTui, "en");
  const sent: string[] = [];
  composer.onSubmit = value => { sent.push(value); };
  composer.setCommandGroups([{ title: "X", items: [{ value: "/f614:stop", label: "Cancel the answer" }] }]);
  type(composer, "/f61");
  composer.handleInput("\r");
  expect(sent).toEqual(["/f614:stop"]);
});

/**
 * Came out of the real-account test: Codex's full-access warning stayed printed in the chat after «Cancel». A question can carry
 * its own explanation (`body`): it is drawn under the question's title, wrapped to the screen, and leaves with the question.
 */
test("a picker's body is drawn wrapped under its title and disappears when the picker closes", () => {
  const body = "When Codex runs with full access, it can edit any file on your computer and run commands with network, without your approval. Exercise caution when enabling full access.";
  const composer = new ForgeComposer(fakeTui, "en");
  void composer.choose("Enable full access?", [{ value: "yes", display: "Yes, continue anyway", label: "" }, { value: "cancel", display: "Cancel", label: "" }], undefined, { body });
  const lines = composer.render(60).map(stripVTControlCharacters);
  expect(lines.every(line => visibleWidth(line) <= 60)).toBe(true);
  expect(lines.filter(line => line.trim() === "Enable full access?")).toHaveLength(1);
  expect(lines.join(" ").replace(/\s+/g, " ")).toContain(body);
  expect(lines.findIndex(line => line.trim() === "Enable full access?")).toBeLessThan(lines.findIndex(line => line.includes("When Codex runs")));
  expect(lines.findIndex(line => line.includes("Exercise caution"))).toBeLessThan(lines.findIndex(line => line.includes("1. Yes, continue anyway")));
  composer.cancelChoice();
  expect(screen(composer, 60)).not.toContain("full access");
});

/**
 * Found while testing `/compact` in Spanish: «Compactando el contexto · Haciendo espacio para continuar · 12s» is wider than the box
 * next to the sidebar, and cutting the end of the line dropped the seconds, the only thing that shows it has not frozen. A busy status
 * that does not fit gives up its middle part first and keeps the label and the time; one that fits is shown whole.
 */
test("a busy status too wide for the box keeps its label and time and drops the middle part", () => {
  const status = "Compactando el contexto · Haciendo espacio para continuar · 12s";
  const composer = new ForgeComposer(fakeTui, "es");
  composer.setStatus(status);
  expect(screen(composer, 160)).toContain(status); // the status shares its row with the mode text now, so «whole» needs a wide screen
  const narrow = screen(composer, 60);
  expect(narrow).toContain("Compactando el contexto · 12s");
  expect(narrow).not.toContain("Haciendo espacio");
});

/**
 * `/feedback` needs a note in the person's own words, and Shell had no way to ask for free text inside a question. `ask` shows the question with its
 * placeholder under the title, gives back what was typed (trimmed) on Enter, nothing on Esc, and an empty note as «» — the person can send no note, as in Codex.
 */
test("a text question shows its title and placeholder, returns the trimmed text on Enter and nothing on Esc", async () => {
  const composer = new ForgeComposer(fakeTui, "en");
  const answer = composer.ask("Tell us more (bug)", "(optional) Write a short description", { body: "Your feedback can be used to improve ChatGPT." });
  const shown = screen(composer);
  expect(shown).toContain("Tell us more (bug)");
  expect(shown).toContain("(optional) Write a short description");
  expect(shown).toContain("Your feedback can be used to improve ChatGPT.");
  type(composer, "  It hangs on start "); composer.handleInput("\r");
  expect(await answer).toBe("It hangs on start");
  expect(screen(composer)).not.toContain("Tell us more");
  const empty = composer.ask("Note", "placeholder");
  composer.handleInput("\r");
  expect(await empty).toBe("");
  const cancelled = composer.ask("Note", "placeholder");
  type(composer, "half"); composer.handleInput("\x1b");
  expect(await cancelled).toBeUndefined();
  expect(composer.getText()).toBe("");
});

/** While a text question is open, a typed «/» is text and not a command: the command menu does not open and Enter does not run anything. */
test("a text question takes «/» as text and does not open the command menu", async () => {
  const composer = new ForgeComposer(fakeTui, "en");
  let submitted = false; composer.onSubmit = () => { submitted = true; };
  const answer = composer.ask("Note", "placeholder");
  type(composer, "/quit"); composer.handleInput("\r");
  expect(await answer).toBe("/quit");
  expect(submitted).toBe(false);
});

/** `cancelChoice` (used when Shell quits) also closes a text question, resolving nothing, so no promise is left waiting. */
test("cancelChoice closes an open text question without an answer", async () => {
  const composer = new ForgeComposer(fakeTui, "en");
  const answer = composer.ask("Note", "placeholder");
  composer.cancelChoice();
  expect(await answer).toBeUndefined();
});

/** `startAt` puts the cursor on a row without marking it with «✓» (which means «current value»): the import list toggles a row and reopens with the cursor still on it. */
test("startAt starts the cursor on the named row without marking it as the current value", async () => {
  const composer = new ForgeComposer(fakeTui, "en");
  const result = composer.choose("Import", items, undefined, { startAt: "c" });
  expect(screen(composer)).not.toContain("✓");
  composer.handleInput("\r");
  expect(await result).toBe("c");
});

/**
 * Came out of the third real-account test (`/plugins` said 5015 above and 5016 in the footer): rows marked `action` are not elements of the list, so the
 * footer's «from–to of total» leaves them out. Exact values for a window at the start, one that ends on the action row, one holding only actions, and no actions at all.
 */
test("the footer range counts elements only and leaves out rows marked as actions", () => {
  const plugins: ComposerChoice[] = [
    ...Array.from({ length: 7 }, (_, i) => ({ value: `p${i}`, label: "" })),
    { value: "@marketplaces", label: "", action: true },
  ];
  expect(elementRange(plugins, 0, 5)).toEqual({ from: 1, to: 5, total: 7 });
  expect(elementRange(plugins, 3, 8)).toEqual({ from: 4, to: 7, total: 7 });
  expect(elementRange(plugins, 7, 8)).toEqual({ from: 7, to: 7, total: 7 });
  expect(elementRange(plugins.slice(0, 7), 0, 5)).toEqual({ from: 1, to: 5, total: 7 });
  expect(elementRange([{ value: "x", label: "", action: true }], 0, 1)).toEqual({ from: 0, to: 0, total: 0 });
});

/**
 * Came out of the third real-account test: while Shell waited for the person (a confirmation, a command's selector, a permission question) the box
 * still said «Working». The box now says «Waiting for your answer» for as long as a selector or a question is open — even if the busy status is set again
 * meanwhile, as the refresh ticker does — and goes back to the assistant's own status when it closes. Exact texts, in both languages.
 */
test("while a selector or a question is open the box says it waits for the person's answer, and goes back to Working after", async () => {
  for (const locale of ["en", "es"] as const) {
    const t = getCatalog(locale).chat;
    const composer = new ForgeComposer(fakeTui, locale);
    composer.setStatus(`${t.statusWorking} · 5s`);
    expect(screen(composer)).toContain(`${t.statusWorking} · 5s`);
    const chosen = composer.choose("Resume", items);
    composer.setStatus(`${t.statusWorking} · 6s`);
    expect(t.awaitingAnswer).toBe(locale === "en" ? "Waiting for your answer" : "Esperando tu respuesta");
    expect(screen(composer)).toContain(t.awaitingAnswer);
    expect(screen(composer)).not.toContain(t.statusWorking);
    composer.handleInput("\x1b"); expect(await chosen).toBeUndefined();
    expect(screen(composer)).toContain(`${t.statusWorking} · 6s`);
    expect(screen(composer)).not.toContain(t.awaitingAnswer);
    const answered = composer.ask("Note", "Write here");
    expect(screen(composer)).toContain(t.awaitingAnswer);
    expect(screen(composer)).not.toContain(t.statusWorking);
    composer.handleInput("\x1b"); expect(await answered).toBeUndefined();
    expect(screen(composer)).toContain(`${t.statusWorking} · 6s`);
  }
});

/** With the assistant idle the box says «Ready» again after the selector closes, not «Waiting for your answer»: the wait belongs to the open question, not to the status. */
test("after a selector closes an idle box says Ready", async () => {
  const composer = new ForgeComposer(fakeTui, "en");
  const chosen = composer.choose("Resume", items);
  expect(screen(composer)).toContain("Waiting for your answer");
  composer.handleInput("\r"); expect(await chosen).toBe("a");
  expect(screen(composer)).toContain("Ready");
  expect(screen(composer)).not.toContain("Waiting for your answer");
});

/**
 * Up-arrow history, as the shells have it: with the box empty (or the cursor at the start of the first line) ↑ brings the last thing sent, ↑ again the one before, ↓ goes back toward the newest and,
 * past it, returns what was being written. The editor already does this once `addToHistory` is called with what was sent.
 */
test("↑ brings the last message sent, ↑ again the one before, ↓ goes forward and past the newest it gives back an empty box", () => {
  const composer = new ForgeComposer(fakeTui, "en");
  composer.addToHistory("uno"); composer.addToHistory("dos");
  composer.render(90);
  composer.handleInput("\x1b[A"); expect(composer.getText()).toBe("dos");
  composer.handleInput("\x1b[A"); expect(composer.getText()).toBe("uno");
  composer.handleInput("\x1b[B"); expect(composer.getText()).toBe("dos");
  composer.handleInput("\x1b[B"); expect(composer.getText()).toBe("");
});

test("with something typed and the cursor at the start of the line, ↑ browses and ↓ at the end gives back what was being written", () => {
  const composer = new ForgeComposer(fakeTui, "en");
  composer.addToHistory("uno"); composer.addToHistory("dos");
  type(composer, "borrador"); composer.render(90);
  // The cursor is at the end of the text: ↑ does not browse (it only moves to the start of the line), as in the shells.
  composer.handleInput("\x1b[A"); expect(composer.getText()).toBe("borrador");
  composer.handleInput("\x1b[A"); expect(composer.getText()).toBe("dos");
  composer.handleInput("\x1b[A"); expect(composer.getText()).toBe("uno");
  composer.handleInput("\x1b[B"); expect(composer.getText()).toBe("dos");
  composer.handleInput("\x1b[B"); expect(composer.getText()).toBe("borrador");
});

/** The menu keeps the arrows while it is open: the history must not steal them from the `/` menu. */
test("with the / menu open the arrows move the menu and the history stays where it was", () => {
  const composer = new ForgeComposer(fakeTui, "en");
  composer.addToHistory("dos");
  composer.render(90);
  type(composer, "/");
  composer.handleInput("\x1b[A"); composer.handleInput("\x1b[B");
  expect(composer.getText()).toBe("/");
});

/** A command recalled from the history puts its whole text in the box; the menu must not open on it, or the next ↑ would move in the menu instead of going on through the history. */
test("a command recalled with ↑ does not open the menu: the next ↑ goes on to the older entry", () => {
  const composer = new ForgeComposer(fakeTui, "en");
  composer.addToHistory("hola"); composer.addToHistory("/f614:refresh");
  composer.render(90);
  composer.handleInput("\x1b[A"); expect(composer.getText()).toBe("/f614:refresh");
  // Only the box shows the command: the menu row that would list it is not drawn.
  expect(screen(composer).split("/f614:refresh")).toHaveLength(2);
  composer.handleInput("\x1b[A"); expect(composer.getText()).toBe("hola");
  composer.handleInput("\x1b[B"); expect(composer.getText()).toBe("/f614:refresh");
  // Writing again brings the menu back: it is only the recall that keeps it closed.
  composer.handleInput("\x7f");
  expect(composer.getText()).toBe("/f614:refres");
  expect(screen(composer)).toContain("/f614:refresh");
});
