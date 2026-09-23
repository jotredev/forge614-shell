import { expect, test } from "bun:test";
import type { Terminal } from "@earendil-works/pi-tui";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import type { EngramGroup } from "../../contracts/engram-group.ts";
import { chooseGroup, GroupSelectList } from "./group-picker.ts";
import { getCatalog } from "../../i18n/index.ts";
import { EngramFlowScreen } from "./frame.ts";

class TestTerminal implements Terminal {
  columns = 80; rows = 30; kittyProtocolActive = false;
  input: (data: string) => void = () => {}; output = "";
  start(input: (data: string) => void) { this.input = input; }
  stop() {}
  async drainInput() {}
  write(data: string) { this.output += data; }
  moveBy() {} hideCursor() {} showCursor() {} clearLine() {}
  clearFromCursor() {} clearScreen() {} setTitle() {} setProgress() {}
}
const tick = () => new Promise(resolve => setTimeout(resolve, 25));
const DOWN = "\x1b[B"; const UP = "\x1b[A"; const ENTER = "\r"; const ESC = "\x1b";

const groups: EngramGroup[] = [
  { id: "g1", name: "mi-tienda", projects: [{ projectId: "p1", name: "frontend" }, { projectId: "p2", name: "api" }] },
  { id: "g2", name: "forge614", projects: [] },
];

function setup(list: readonly EngramGroup[] = groups, locale: "es" | "en" = "es", signal?: AbortSignal) {
  const terminal = new TestTerminal();
  const screen = new EngramFlowScreen(terminal, undefined, locale);
  screen.start();
  const result = chooseGroup(list, screen, locale, signal);
  return { terminal, result };
}
/** The last full frame as plain text: what the person actually sees. */
const visible = (terminal: TestTerminal) => stripTerminalSequences(terminal.output);

const plainTheme = { cursor: (x: string) => x, heading: (x: string) => x, description: (x: string) => x, divider: (x: string) => x };
const renderList = (list: readonly EngramGroup[], locale: "es" | "en" = "es", width = 80) =>
  new GroupSelectList(list, getCatalog(locale).groupPicker, plainTheme).render(width);

test("with existing groups the list shows the heading, each group with its projects, a divider, then the two actions (es)", () => {
  expect(renderList(groups)).toEqual([
    "Grupos existentes",
    "> mi-tienda",
    "    Proyectos: frontend, api",
    "  forge614",
    "    Aún sin proyectos",
    "─".repeat(40),
    "  Crear un grupo nuevo…",
    "  Es un proyecto suelto (sin grupo)",
  ]);
});

test("the screen title is the exact sentence from the design", async () => {
  const { terminal, result } = setup();
  await tick();
  expect(visible(terminal)).toContain("Este repositorio aún no pertenece a ningún grupo.");
  terminal.input(ESC);
  await result;
});

test("in English the same screen is fully translated", async () => {
  const { terminal, result } = setup(groups, "en");
  await tick();
  const text = visible(terminal);
  expect(text).toContain("This repository does not belong to any group yet.");
  expect(text).toContain("Existing groups");
  expect(text).toContain("Projects: frontend, api");
  expect(text).toContain("Create a new group…");
  expect(text).toContain("It is a standalone project (no group)");
  expect(text).not.toContain("Grupos existentes");
  terminal.input(ESC);
  await result;
});

test("Enter on the first group chooses that existing group", async () => {
  const { terminal, result } = setup();
  await tick();
  terminal.input(ENTER);
  expect(await result).toEqual({ kind: "existing", group: groups[0]! });
});

test("the arrows move between groups and actions; the second group is reachable, and the cursor stops at the ends", async () => {
  const { terminal, result } = setup();
  await tick();
  terminal.input(UP); terminal.input(DOWN); terminal.input(ENTER);
  expect(await result).toEqual({ kind: "existing", group: groups[1]! });
});

test("the standalone-project action returns loose", async () => {
  const { terminal, result } = setup();
  await tick();
  terminal.input(DOWN); terminal.input(DOWN); terminal.input(DOWN); terminal.input(ENTER);
  expect(await result).toEqual({ kind: "loose" });
});

test("with no groups the first section and the divider do not appear, only the two actions", () => {
  expect(renderList([])).toEqual(["> Crear un grupo nuevo…", "  Es un proyecto suelto (sin grupo)"]);
});

test("with no groups, Down then Enter chooses the standalone project", async () => {
  const { terminal, result } = setup([]);
  await tick();
  terminal.input(DOWN); terminal.input(ENTER);
  expect(await result).toEqual({ kind: "loose" });
});

test("Escape, Ctrl+C and Ctrl+D cancel the choice (nothing is applied)", async () => {
  for (const key of [ESC, "\x03", "\x04"]) {
    const { terminal, result } = setup();
    await tick();
    terminal.input(key);
    expect(await result).toBeUndefined();
  }
});

test("an already-aborted signal resolves immediately without showing the screen", async () => {
  const controller = new AbortController();
  controller.abort();
  const { terminal, result } = setup(groups, "es", controller.signal);
  expect(await result).toBeUndefined();
  expect(visible(terminal)).not.toContain("Grupos existentes");
});

test("aborting while the list is showing resolves like a cancel", async () => {
  const controller = new AbortController();
  const { result } = setup(groups, "es", controller.signal);
  await tick();
  controller.abort();
  expect(await result).toBeUndefined();
});

// --- creating a new group ---

async function toNamePrompt(list: readonly EngramGroup[] = groups) {
  const setupResult = setup(list);
  await tick();
  // Creating a group is the first action after the groups (or the first item with no groups).
  for (let i = 0; i < list.length; i++) setupResult.terminal.input(DOWN);
  setupResult.terminal.input(ENTER);
  await tick();
  return setupResult;
}

test("choosing to create a group asks for a name, and a valid one is returned", async () => {
  const { terminal, result } = await toNamePrompt();
  expect(visible(terminal)).toContain("Nombre del grupo nuevo");
  terminal.input("nueva-tienda"); terminal.input(ENTER);
  expect(await result).toEqual({ kind: "new", name: "nueva-tienda" });
});

test.each([
  ["empty", ""],
  ["capital letters", "Mi-Tienda"],
  ["spaces", "mi tienda"],
  ["a double hyphen", "mi--tienda"],
  ["a leading hyphen", "-tienda"],
  ["a trailing hyphen", "tienda-"],
  ["an underscore", "mi_tienda"],
  ["more than 64 characters", "a".repeat(65)],
])("a name with %s is refused with a clear message and the prompt stays open", async (_label, name) => {
  const { terminal, result } = await toNamePrompt();
  if (name) terminal.input(name);
  terminal.input(ENTER);
  await tick();
  expect(visible(terminal)).toContain("El nombre del grupo solo puede llevar");
  terminal.input(ESC); // back to the list
  await tick();
  terminal.input(ESC); // cancel
  expect(await result).toBeUndefined();
});

test("a 64-character name is accepted", async () => {
  const { terminal, result } = await toNamePrompt();
  terminal.input("a".repeat(64)); terminal.input(ENTER);
  expect(await result).toEqual({ kind: "new", name: "a".repeat(64) });
});

test("a name that already exists (any casing) is refused without choosing anything", async () => {
  const { terminal, result } = await toNamePrompt();
  terminal.input("mi-tienda"); terminal.input(ENTER);
  await tick();
  expect(visible(terminal)).toContain('Ya existe un grupo llamado "mi-tienda"');
  terminal.input(ESC); await tick(); terminal.input(ESC);
  expect(await result).toBeUndefined();
});

test("Escape on the name prompt goes back to the list instead of cancelling everything", async () => {
  const { terminal, result } = await toNamePrompt();
  terminal.input(ESC);
  await tick();
  expect(visible(terminal).lastIndexOf("Grupos existentes")).toBeGreaterThan(visible(terminal).lastIndexOf("Nombre del grupo nuevo"));
  terminal.input(ENTER); // first group again
  expect(await result).toEqual({ kind: "existing", group: groups[0]! });
});

test("with no groups, creating one goes straight to the name prompt", async () => {
  const { terminal, result } = await toNamePrompt([]);
  expect(visible(terminal)).toContain("Nombre del grupo nuevo");
  terminal.input("solo"); terminal.input(ENTER);
  expect(await result).toEqual({ kind: "new", name: "solo" });
});

test("a very long project list is shortened to the terminal width with an ellipsis", () => {
  const many: EngramGroup = { id: "g", name: "grande", projects: Array.from({ length: 40 }, (_, i) => ({ projectId: `p${i}`, name: `proyecto-numero-${i}` })) };
  const lines = renderList([many], "es", 60).map(line => stripTerminalSequences(line));
  for (const line of lines) expect(line.length).toBeLessThanOrEqual(60);
  expect(lines.find(line => line.includes("Proyectos:"))!.endsWith("…")).toBe(true);
});

test("many groups are windowed with a position counter so the header never scrolls away", () => {
  const many: EngramGroup[] = Array.from({ length: 12 }, (_, i) => ({ id: `g${i}`, name: `grupo-${i}`, projects: [] }));
  const list = new GroupSelectList(many, getCatalog("es").groupPicker, plainTheme);
  const first = list.render(80);
  expect(first[0]).toBe("Grupos existentes (1/12)");
  expect(first.join("\n")).toContain("grupo-0");
  expect(first.join("\n")).not.toContain("grupo-11");
  expect(first.join("\n")).toContain("Crear un grupo nuevo…");
  // Walk to the last group: the window follows the cursor and the counter tracks it.
  for (let i = 0; i < 11; i++) list.handleInput(DOWN);
  const last = list.render(80);
  expect(last[0]).toBe("Grupos existentes (12/12)");
  expect(last.join("\n")).toContain("> grupo-11");
  expect(last.join("\n")).not.toContain("grupo-0\n");
  expect(last.length).toBeLessThanOrEqual(1 + 4 * 2 + 1 + 2);
});
