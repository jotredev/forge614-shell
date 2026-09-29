import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { createComposer } from "./composer.ts";
import { askPermission } from "./permission-choice.ts";
import type { Locale } from "../../i18n/index.ts";

const ENTER = "\r"; const ESCAPE = "\x1b"; const DOWN = "\x1b[B"; const UP = "\x1b[A";
const screen = (input: ReturnType<typeof createComposer>["input"]) => input.render(100).map(line => stripVTControlCharacters(line).trim());

/** The words each language shows on the two options, the marked one first, and the footer exactly as the person reads it. */
const words: Record<Locale, { question: string; yes: string; no: string; footer: string; stop: string }> = {
  es: { question: "¿Permitir?", yes: "Sí", no: "No", footer: "↑/↓ mover · Enter elegir · S Sí · N No · Esc = No · /f614:stop cancelar turno", stop: "/f614:stop cancelar turno" },
  en: { question: "Allow?", yes: "Yes", no: "No", footer: "↑/↓ move · Enter choose · Y Yes · N No · Esc = No · /f614:stop cancel turn", stop: "/f614:stop cancel turn" },
};

for (const locale of ["es", "en"] as const) {
  /**
   * The permission question shows exactly two rows with words — «Sí»/«No» in Spanish, «Yes»/«No» in English — with the
   * approving one first and marked, no numbers and no slash commands, and a footer that appears once, says how to
   * cancel the turn and never mentions `/yes` or `/no`. It exists because the question used to offer «1. /no Denegar»
   * (marked) and «2. /yes Permitir solo esta llamada», with the same footer repeated.
   */
  test(`permission question (${locale}): two rows, ${words[locale].yes} first and marked, no numbers or slashes, one footer`, () => {
    const { input } = createComposer(undefined, locale);
    void askPermission(input, locale);
    const lines = screen(input);
    const { question, yes, no, footer, stop } = words[locale];
    expect(lines.slice(lines.indexOf(question) + 1, lines.indexOf(footer))).toEqual([`› ${yes}`, no]);
    expect(lines.filter(line => line.includes(stop))).toEqual([footer]);
    const all = lines.join("\n");
    expect(all).not.toContain("/yes");
    expect(all).not.toContain("/no");
    expect(all).not.toContain("1.");
    expect(all).not.toContain("2.");
    input.cancelChoice();
  });
}

/** The marked row moves with the arrows and wraps, so «No» is one arrow away and the way back is one arrow too. */
test("permission question: the arrow moves the mark from «Sí» to «No» and back", () => {
  const { input } = createComposer(undefined, "es");
  void askPermission(input, "es");
  const rows = () => { const lines = screen(input); return lines.slice(lines.indexOf(words.es.question) + 1, lines.indexOf(words.es.footer)); };
  input.handleInput(DOWN);
  expect(rows()).toEqual(["Sí", "› No"]);
  input.handleInput(UP);
  expect(rows()).toEqual(["› Sí", "No"]);
  input.cancelChoice();
});

const cases: { name: string; locale: Locale; keys: string[]; allowed: boolean }[] = [
  { name: "Enter alone approves (Sí is marked from the start)", locale: "es", keys: [ENTER], allowed: true },
  { name: "Enter alone approves (Yes is marked from the start)", locale: "en", keys: [ENTER], allowed: true },
  { name: "Esc is No", locale: "es", keys: [ESCAPE], allowed: false },
  { name: "Esc is No in English too", locale: "en", keys: [ESCAPE], allowed: false },
  { name: "the down arrow and Enter is No", locale: "es", keys: [DOWN, ENTER], allowed: false },
  { name: "the N key is No", locale: "es", keys: ["n"], allowed: false },
  { name: "the N key is No in English", locale: "en", keys: ["n"], allowed: false },
  { name: "an uppercase N is No", locale: "es", keys: ["N"], allowed: false },
  { name: "the S key is Sí", locale: "es", keys: ["s"], allowed: true },
  { name: "the Y key is Yes", locale: "en", keys: ["y"], allowed: true },
];
for (const item of cases) {
  /** What each key does on the permission question, exactly: only an approving key returns true; every other way out is a No. */
  test(`permission question: ${item.name}`, async () => {
    const { input } = createComposer(undefined, item.locale);
    const answer = askPermission(input, item.locale);
    for (const key of item.keys) input.handleInput(key);
    expect(await answer).toBe(item.allowed);
  });
}

/** A key that is not one of the answers must not answer: «x» leaves the question open and Enter then still approves. */
test("permission question: an unrelated key does not answer it", async () => {
  const { input } = createComposer(undefined, "es");
  let settled: boolean | undefined;
  const answer = askPermission(input, "es").then(value => { settled = value; return value; });
  input.handleInput("x");
  await Promise.resolve();
  expect(settled).toBeUndefined();
  input.handleInput(ENTER);
  expect(await answer).toBe(true);
});
