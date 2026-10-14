import { expect, test } from "bun:test";
import type { TUI } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";
import { ForgeComposer } from "./composer.ts";
import { askAgentQuestions } from "./agent-questions.ts";

const tui = { requestRender() {}, terminal: { rows: 40, columns: 100 } } as unknown as TUI;
const shown = (input: ForgeComposer) => stripVTControlCharacters(input.render(90).join("\n"));

test("an assistant's choice question is visible and returns the selected label", async () => {
  const input = new ForgeComposer(tui, "es");
  const pending = askAgentQuestions(input, [{ id: "roof", header: "Techo", question: "¿Qué hago con la nave?", options: [
    { label: "Crecer", description: "Ampliar el techo" }, { label: "Girarla", description: "Cambiar orientación" },
  ] }], new AbortController().signal, "es");
  expect(shown(input)).toContain("¿Qué hago con la nave?");
  expect(shown(input)).toContain("Crecer");
  input.handleInput("\x1b[B"); input.handleInput("\r");
  expect(await pending).toEqual({ roof: ["Girarla"] });
});

test("a free-text question accepts the answer and Escape cancels without sending a partial batch", async () => {
  const input = new ForgeComposer(tui, "en");
  const pending = askAgentQuestions(input, [{ id: "name", header: "Name", question: "What name?", options: null }], new AbortController().signal, "en");
  expect(shown(input)).toContain("What name?");
  for (const character of "North warehouse") input.handleInput(character);
  input.handleInput("\r");
  expect(await pending).toEqual({ name: ["North warehouse"] });

  const cancelled = askAgentQuestions(input, [{ id: "again", header: "Again", question: "Try again?", options: null }], new AbortController().signal, "en");
  input.handleInput("\x1b");
  expect(await cancelled).toBeUndefined();
});

test("a multiple-selection question returns every selected option", async () => {
  const input = new ForgeComposer(tui, "en");
  const pending = askAgentQuestions(input, [{ id: "features", header: "Features", question: "Which features?", multiSelect: true, options: [
    { label: "A", description: "First" }, { label: "B", description: "Second" },
  ] }], new AbortController().signal, "en");
  input.handleInput("\r");
  await Promise.resolve();
  expect(shown(input)).toContain("A ✓");
  input.handleInput("\x1b[B"); input.handleInput("\r");
  await Promise.resolve();
  input.handleInput("\x1b[B"); input.handleInput("\x1b[B"); input.handleInput("\r");
  expect(await pending).toEqual({ features: ["A", "B"] });
});

test("a secret free-text answer is not drawn while the person types it", async () => {
  const input = new ForgeComposer(tui, "en");
  const pending = askAgentQuestions(input, [{ id: "secret", header: "Secret", question: "Enter a secret", isSecret: true, options: null }], new AbortController().signal, "en");
  for (const character of "swordfish") input.handleInput(character);
  expect(shown(input)).not.toContain("swordfish");
  input.handleInput("\r");
  expect(await pending).toEqual({ secret: ["swordfish"] });
});

test("cancelling the second question discards the first answer", async () => {
  const input = new ForgeComposer(tui, "es");
  const pending = askAgentQuestions(input, [
    { id: "shape", header: "Forma", question: "¿Qué forma?", options: [{ label: "Larga", description: "Nave larga" }, { label: "Ancha", description: "Nave ancha" }] },
    { id: "color", header: "Color", question: "¿Qué color?", options: null },
  ], new AbortController().signal, "es");
  input.handleInput("\r");
  await Promise.resolve();
  expect(shown(input)).toContain("¿Qué color?");
  input.handleInput("\x1b");
  expect(await pending).toBeUndefined();
});
