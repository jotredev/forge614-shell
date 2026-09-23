import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Terminal } from "@earendil-works/pi-tui";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { runInitCommand } from "./init-engram.ts";
import type { RunEngram } from "../infrastructure/forge614-engram.ts";

class TestTerminal implements Terminal {
  columns = 100; rows = 40; kittyProtocolActive = false;
  input: (data: string) => void = () => {}; output = "";
  start(input: (data: string) => void) { this.input = input; }
  stop() {}
  async drainInput() {}
  write(data: string) { this.output += data; }
  moveBy() {} hideCursor() {} showCursor() {} clearLine() {}
  clearFromCursor() {} clearScreen() {} setTitle() {} setProgress() {}
}
const ENTER = "\r"; const DOWN = "\x1b[B"; const ESC = "\x1b";
const visible = (terminal: TestTerminal) => stripTerminalSequences(terminal.output);
/** The final result as one line of text: what the person is left with (long lines wrap on screen). */
const finalResult = (terminal: TestTerminal) => visible(terminal).slice(visible(terminal).lastIndexOf("Resultado")).replace(/\s+/g, " ");
const created: string[] = [];
afterEach(() => { process.exitCode = 0; for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true }); });

async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 4000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function temp(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "forge614-shell-init-groups-")));
  created.push(dir);
  return dir;
}
function repo(): string {
  const dir = temp();
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

interface Scenario {
  groups?: unknown[];
  createNotices?: unknown[];
  failOn?: string;
}

/** A recording stand-in for Engram's CLI: never touches the disk, exactly like the real read-only commands. */
function engramStub(scenario: Scenario = {}) {
  const calls: string[][] = [];
  const run: RunEngram = async (_binary, args) => {
    calls.push(args);
    const json = (value: unknown) => ({ status: 0, stdout: JSON.stringify(value), stderr: "" });
    if (scenario.failOn === args[0]) return { status: 1, stdout: "", stderr: JSON.stringify({ schemaVersion: 1, code: "GROUP_EXISTS", error: "Ya existe un grupo con ese nombre." }) };
    if (args[0] === "init" && args.includes("--directory")) return json({ project: { projectId: "proj-1", directory: args[args.indexOf("--directory") + 1], source: "path" } });
    if (args[0] === "group-list") return json({ schemaVersion: 1, groups: scenario.groups ?? [] });
    if (args[0] === "group-create") return json({ schemaVersion: 1, group: { id: "g-new", name: args[2] }, ...(scenario.createNotices ? { notices: scenario.createNotices } : {}) });
    if (args[0] === "group-bind") return json({ schemaVersion: 1, projectId: args[2], changed: true });
    return json({ initialized: true });
  };
  return { calls, run };
}
const enginesRun: RunEngram = async () => ({ status: 0, stdout: JSON.stringify({ schemaVersion: 1, agents: [] }), stderr: "" });
const groupCalls = (calls: string[][]) => calls.filter(args => args[0]?.startsWith("group-") || (args[0] === "init" && args.includes("--directory")));

const existingGroup = { id: "g-1", name: "mi-tienda", projects: [{ projectId: "p9", name: "frontend" }] };

function start(cwd: string, scenario: Scenario, extra: { locale?: "es" | "en"; interactive?: boolean; stdin?: { on(e: "end" | "close", l: () => void): void; off(e: "end" | "close", l: () => void): void } } = {}) {
  const terminal = new TestTerminal();
  const engram = engramStub(scenario);
  const done = runInitCommand(["--product", "engram"], {
    terminal, cwd, run: engram.run, enginesRun, home: "/nonexistent-home", env: { FORGE614_HOME: "/nonexistent-forge614" },
    locale: extra.locale ?? "es", interactive: extra.interactive, ...(extra.stdin ? { stdin: extra.stdin } : {}),
  });
  /** Answers the four fixed init screens (intro, PostgreSQL No, reinforcement Yes, confirm). */
  const confirmInit = async () => {
    for (const expected of ["Forge614 Engram", "PostgreSQL", "refuerzo", "Resumen"]) {
      await until(() => visible(terminal).includes(expected), expected);
      terminal.input(ENTER);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  };
  return { terminal, engram, done, confirmInit };
}

test("an existing group: init, then group-list, then folder bound and put in that group by id", async () => {
  const cwd = repo();
  const { terminal, engram, done, confirmInit } = start(cwd, { groups: [existingGroup] });
  await confirmInit();
  await until(() => visible(terminal).includes("Este repositorio aún no pertenece a ningún grupo."), "group screen");
  expect(visible(terminal)).toContain("Grupos existentes");
  expect(visible(terminal)).toContain("Proyectos: frontend");
  terminal.input(ENTER); // first group
  await done;
  expect(engram.calls[0]).toEqual(["init", "--json"]);
  expect(groupCalls(engram.calls)).toEqual([
    ["group-list"],
    ["init", "--json", "--directory", cwd],
    ["group-bind", "--project-id", "proj-1", "--group", "g-1"],
  ]);
  expect(visible(terminal)).toContain('Grupo: este proyecto quedó en el grupo "mi-tienda".');
});

test("no groups yet: the first section is absent; creating one runs group-create, then the folder, then group-bind", async () => {
  const cwd = repo();
  const { terminal, engram, done, confirmInit } = start(cwd, { groups: [] });
  await confirmInit();
  await until(() => visible(terminal).includes("Este repositorio aún no pertenece a ningún grupo."), "group screen");
  expect(visible(terminal)).not.toContain("Grupos existentes");
  terminal.input(ENTER); // "Crear un grupo nuevo…" is first with no groups
  await until(() => visible(terminal).includes("Nombre del grupo nuevo"), "name prompt");
  terminal.input("nueva-tienda"); terminal.input(ENTER);
  await done;
  expect(groupCalls(engram.calls)).toEqual([
    ["group-list"],
    ["group-create", "--name", "nueva-tienda"],
    ["init", "--json", "--directory", cwd],
    ["group-bind", "--project-id", "proj-1", "--group", "g-new"],
  ]);
  expect(visible(terminal)).toContain('Grupo: se creó "nueva-tienda" y este proyecto quedó dentro.');
});

test("choosing 'standalone project' writes the identity through Engram only", async () => {
  const cwd = repo();
  const { terminal, engram, done, confirmInit } = start(cwd, { groups: [existingGroup] });
  await confirmInit();
  await until(() => visible(terminal).includes("Grupos existentes"), "group screen");
  terminal.input(DOWN); terminal.input(DOWN); terminal.input(ENTER);
  await done;
  // The list is [group, create, loose]: the first Down reaches "create", the second reaches "loose".
  expect(groupCalls(engram.calls)).toEqual([["group-list"], ["init", "--json", "--directory", cwd]]);
  expect(visible(terminal)).toContain("Grupo: este proyecto quedó como proyecto suelto (sin grupo).");
});

test("an identity file that already exists means no question at all, and group-list is never called", async () => {
  const cwd = repo();
  mkdirSync(join(cwd, ".forge614"));
  writeFileSync(join(cwd, ".forge614", "project.json"), '{"schemaVersion":1,"ecosystem":null}');
  const { terminal, engram, done, confirmInit } = start(cwd, { groups: [existingGroup] });
  await confirmInit();
  await done;
  expect(visible(terminal)).not.toContain("Este repositorio aún no pertenece");
  expect(groupCalls(engram.calls)).toEqual([]);
});

test("a folder that is not a project (no Git, no manifest) is never asked", async () => {
  const { terminal, engram, done, confirmInit } = start(temp(), { groups: [existingGroup] });
  await confirmInit();
  await done;
  expect(visible(terminal)).not.toContain("Este repositorio aún no pertenece");
  expect(groupCalls(engram.calls)).toEqual([]);
});

test("without an interactive terminal init refuses before calling Engram at all (there is no --yes mode)", async () => {
  const cwd = repo();
  const engram = engramStub();
  await expect(runInitCommand(["--product", "engram"], { cwd, run: engram.run, enginesRun, interactive: false, locale: "es" })).rejects.toThrow();
  expect(engram.calls).toEqual([]);
});

test("Escape on the group screen skips the question, applies nothing, and the flow still finishes", async () => {
  const cwd = repo();
  const { terminal, engram, done, confirmInit } = start(cwd, { groups: [existingGroup] });
  await confirmInit();
  await until(() => visible(terminal).includes("Grupos existentes"), "group screen");
  terminal.input(ESC);
  await done;
  expect(groupCalls(engram.calls)).toEqual([["group-list"]]);
  expect(visible(terminal)).toContain("Grupo: no elegiste ninguno; Shell volverá a preguntar la próxima vez.");
  expect(visible(terminal)).toContain("La inicialización de memoria de Forge614 Engram se completó.");
  expect(Number(process.exitCode ?? 0)).toBe(0);
});

test("a failure applying the group is reported with Engram's own message and never fails the init that already succeeded", async () => {
  const cwd = repo();
  const { terminal, engram, done, confirmInit } = start(cwd, { groups: [], failOn: "group-create" });
  await confirmInit();
  await until(() => visible(terminal).includes("Este repositorio aún no pertenece a ningún grupo."), "group screen");
  terminal.input(ENTER);
  await until(() => visible(terminal).includes("Nombre del grupo nuevo"), "name prompt");
  terminal.input("nueva-tienda"); terminal.input(ENTER);
  await done;
  expect(finalResult(terminal)).toContain("Ya existe un grupo con ese nombre.");
  expect(finalResult(terminal)).toContain("La inicialización de la memoria sí se completó.");
  // The failure happened before the folder was linked: nothing was written, so it asks again next time.
  expect(groupCalls(engram.calls)).toEqual([["group-list"], ["group-create", "--name", "nueva-tienda"]]);
  expect(Number(process.exitCode ?? 0)).toBe(0);
});

test("a failing group-list is reported and the flow continues without asking", async () => {
  const cwd = repo();
  const { terminal, done, confirmInit } = start(cwd, { failOn: "group-list" });
  await confirmInit();
  await done;
  expect(visible(terminal)).toContain("Grupo: no se pudo aplicar");
  expect(visible(terminal)).not.toContain("Este repositorio aún no pertenece");
});

test("the first group creation migrates Engram's database: the notice appears once, with the backup path", async () => {
  const cwd = repo();
  const backup = "/Users/tester/.forge614/engram/engram.db.v7-pre-ecosystem.bak";
  const { terminal, done, confirmInit } = start(cwd, { groups: [], createNotices: [{ code: "DATABASE_MIGRATED", message: "x", backup }] });
  await confirmInit();
  await until(() => visible(terminal).includes("Este repositorio aún no pertenece a ningún grupo."), "group screen");
  terminal.input(ENTER);
  await until(() => visible(terminal).includes("Nombre del grupo nuevo"), "name prompt");
  terminal.input("nueva-tienda"); terminal.input(ENTER);
  await done;
  const text = finalResult(terminal);
  expect(text.split("actualizó su base de datos para poder usar grupos")).toHaveLength(2);
  expect(text.replace(/ /g, "")).toContain(backup);
});

test("in English the group step and its result are fully translated", async () => {
  const cwd = repo();
  const { terminal, done } = start(cwd, { groups: [existingGroup] }, { locale: "en" });
  for (const expected of ["Forge614 Engram", "PostgreSQL", "reinforcement", "Summary"]) {
    await until(() => visible(terminal).includes(expected), expected);
    terminal.input(ENTER);
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  await until(() => visible(terminal).includes("This repository does not belong to any group yet."), "group screen");
  terminal.input(ENTER);
  await done;
  expect(visible(terminal)).toContain('Group: this project is now in the group "mi-tienda".');
});

test("stdin closing while the group screen waits aborts without applying anything or calling Engram again", async () => {
  const cwd = repo();
  const listeners: Record<string, (() => void)[]> = { end: [], close: [] };
  const stdin = { on: (event: "end" | "close", listener: () => void) => { listeners[event]!.push(listener); }, off: () => {} };
  const { terminal, engram, done, confirmInit } = start(cwd, { groups: [existingGroup] }, { stdin });
  await confirmInit();
  await until(() => visible(terminal).includes("Grupos existentes"), "group screen");
  for (const listener of listeners.end!) listener();
  await done;
  expect(groupCalls(engram.calls)).toEqual([["group-list"]]);
  expect(process.exitCode).toBe(1);
});

test("Shell never writes into the project folder: it is byte-for-byte the same after the whole flow", async () => {
  const cwd = repo();
  const before = readdirSync(cwd, { recursive: true }).map(String).filter(name => !name.startsWith(".git")).sort();
  const { terminal, done, confirmInit } = start(cwd, { groups: [existingGroup] });
  await confirmInit();
  await until(() => visible(terminal).includes("Grupos existentes"), "group screen");
  terminal.input(ENTER);
  await done;
  expect(readdirSync(cwd, { recursive: true }).map(String).filter(name => !name.startsWith(".git")).sort()).toEqual(before);
});
