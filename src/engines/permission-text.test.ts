import { expect, test } from "bun:test";
import { formatClaudePermission, formatCodexPermission } from "./permission-text.ts";
import type { Locale } from "../i18n/index.ts";

/** What must never reach the screen from a permission request: the protocol's own JSON. */
const INTERNAL = ["{", "\"type\"", "pluginId", "null", "undefined"];
const noInternals = (text: string) => { for (const piece of INTERNAL) expect(text).not.toContain(piece); };

type Case = { name: string; tool: string; input: Record<string, unknown>; cwd?: string; es: string; en: string };

/**
 * Claude Code's `canUseTool(toolName, input)`: the inputs below have the shape of the SDK's tool input types
 * (`node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts`: `BashInput`, `FileEditInput`, `FileWriteInput`,
 * `FileReadInput`, `GlobInput`, `GrepInput`, `NotebookEditInput`, `WebFetchInput`, `WebSearchInput`). MCP tools come as
 * `mcp__<server>__<tool>`; every other tool has an open `Record<string, unknown>` input.
 */
const claudeCases: Case[] = [
  {
    name: "Bash with the assistant's description: the description says what, then where, then the command in its own block",
    tool: "Bash", cwd: "/project",
    input: { command: "rtk grep -rn changelog .", description: "Buscar el changelog de Engram en este repositorio" },
    es: "Buscar el changelog de Engram en este repositorio\n\nCarpeta: /project\n\n    rtk grep -rn changelog .",
    en: "Buscar el changelog de Engram en este repositorio\n\nFolder: /project\n\n    rtk grep -rn changelog .",
  },
  {
    name: "Bash without a description falls back to a sentence built from the kind of action",
    tool: "Bash", cwd: "/project", input: { command: "git status" },
    es: "Ejecutar un comando\n\nCarpeta: /project\n\n    git status",
    en: "Run a command\n\nFolder: /project\n\n    git status",
  },
  {
    name: "Bash keeps every line of a multi-line command and its quotes exactly as written, with no escaping",
    tool: "Bash", cwd: "/project", input: { command: "cd /project\ngit commit -m \"fix: x\"" },
    es: "Ejecutar un comando\n\nCarpeta: /project\n\n    cd /project\n    git commit -m \"fix: x\"",
    en: "Run a command\n\nFolder: /project\n\n    cd /project\n    git commit -m \"fix: x\"",
  },
  {
    name: "Bash without a known folder leaves the folder line out",
    tool: "Bash", input: { command: "ls" },
    es: "Ejecutar un comando\n\n    ls",
    en: "Run a command\n\n    ls",
  },
  {
    name: "Edit names the file",
    tool: "Edit", input: { file_path: "/project/src/a.ts", old_string: "a", new_string: "b" },
    es: "Editar un archivo\n\nArchivo: /project/src/a.ts",
    en: "Edit a file\n\nFile: /project/src/a.ts",
  },
  {
    name: "Write names the file",
    tool: "Write", input: { file_path: "/project/notes.md", content: "hello" },
    es: "Escribir un archivo\n\nArchivo: /project/notes.md",
    en: "Write a file\n\nFile: /project/notes.md",
  },
  {
    name: "MultiEdit reads its file the same way as Edit",
    tool: "MultiEdit", input: { file_path: "/project/src/b.ts", edits: [{ old_string: "a", new_string: "b" }] },
    es: "Editar un archivo\n\nArchivo: /project/src/b.ts",
    en: "Edit a file\n\nFile: /project/src/b.ts",
  },
  {
    name: "NotebookEdit names the notebook",
    tool: "NotebookEdit", input: { notebook_path: "/project/a.ipynb", new_source: "print(1)" },
    es: "Editar un cuaderno\n\nArchivo: /project/a.ipynb",
    en: "Edit a notebook\n\nFile: /project/a.ipynb",
  },
  {
    name: "Read names the file",
    tool: "Read", input: { file_path: "/project/README.md", limit: 50 },
    es: "Leer un archivo\n\nArchivo: /project/README.md",
    en: "Read a file\n\nFile: /project/README.md",
  },
  {
    name: "Glob says what it looks for and where",
    tool: "Glob", input: { pattern: "src/**/*.ts", path: "/project" },
    es: "Buscar archivos por nombre\n\nPatrón: src/**/*.ts\nEn: /project",
    en: "Find files by name\n\nPattern: src/**/*.ts\nIn: /project",
  },
  {
    name: "Grep says the text, where and the file filter",
    tool: "Grep", input: { pattern: "TODO", path: "/project/src", glob: "*.ts", output_mode: "content" },
    es: "Buscar texto en archivos\n\nTexto: TODO\nEn: /project/src\nFiltro: *.ts",
    en: "Search text in files\n\nText: TODO\nIn: /project/src\nFilter: *.ts",
  },
  {
    name: "Grep without a path searches the session folder",
    tool: "Grep", cwd: "/project", input: { pattern: "TODO" },
    es: "Buscar texto en archivos\n\nTexto: TODO\nEn: /project",
    en: "Search text in files\n\nText: TODO\nIn: /project",
  },
  {
    name: "WebFetch shows the address, not the prompt",
    tool: "WebFetch", input: { url: "https://example.com/docs", prompt: "summarize" },
    es: "Leer una página web\n\nDirección: https://example.com/docs",
    en: "Read a web page\n\nAddress: https://example.com/docs",
  },
  {
    name: "WebSearch shows the search",
    tool: "WebSearch", input: { query: "bun test docs" },
    es: "Buscar en la web\n\nBúsqueda: bun test docs",
    en: "Search the web\n\nSearch: bun test docs",
  },
  {
    name: "an MCP tool is the tool of a server, with its fields as «field: value» lines",
    tool: "mcp__forge614-engram__memory_search", input: { query: "decisions", limit: 5, scope: "project" },
    es: "Usar la herramienta memory_search del servidor forge614-engram de MCP\n\nquery: decisions\nlimit: 5\nscope: project",
    en: "Use the memory_search tool of the forge614-engram MCP server\n\nquery: decisions\nlimit: 5\nscope: project",
  },
  {
    name: "any other tool gets its name and its main fields, each value short",
    tool: "Task", input: { description: "Explore the code", subagent_type: "Explore", prompt: "x".repeat(300) },
    es: `Usar la herramienta Task\n\ndescription: Explore the code\nsubagent_type: Explore\nprompt: ${"x".repeat(119)}…`,
    en: `Use the Task tool\n\ndescription: Explore the code\nsubagent_type: Explore\nprompt: ${"x".repeat(119)}…`,
  },
  {
    name: "nested values become plain words: a list is its items, an object is its keys, empty values are left out",
    tool: "Custom", input: { options: { a: 1, b: 2 }, list: ["x", "y"], flag: true, count: 3, none: null },
    es: "Usar la herramienta Custom\n\noptions: (a, b)\nlist: x, y\nflag: true\ncount: 3",
    en: "Use the Custom tool\n\noptions: (a, b)\nlist: x, y\nflag: true\ncount: 3",
  },
  {
    name: "more than five fields keep the first five and end with «…»",
    tool: "Custom", input: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 },
    es: "Usar la herramienta Custom\n\na: 1\nb: 2\nc: 3\nd: 4\ne: 5\n…",
    en: "Use the Custom tool\n\na: 1\nb: 2\nc: 3\nd: 4\ne: 5\n…",
  },
];

for (const item of claudeCases) {
  /**
   * The exact words a person reads for one kind of Claude Code permission request, in Spanish and in English, and
   * that none of the internal JSON (braces, `"type"`, `null`) leaks into them. It exists because the request used to be
   * printed as `Bash { "command": …, "description": … }`.
   */
  test(`Claude permission text: ${item.name}`, () => {
    const es = formatClaudePermission(item.tool, item.input, { locale: "es", cwd: item.cwd });
    const en = formatClaudePermission(item.tool, item.input, { locale: "en", cwd: item.cwd });
    expect(es).toBe(item.es);
    expect(en).toBe(item.en);
    noInternals(es); noInternals(en);
  });
}

/** A description longer than the limit is cut at 300 characters with «…»; the person still reads the start of what the assistant wants. */
test("Claude permission text cuts a very long description at 300 characters with an ellipsis", () => {
  const text = formatClaudePermission("Bash", { command: "ls", description: "a".repeat(400) }, { locale: "es", cwd: "/project" });
  expect(text).toBe(`${"a".repeat(299)}…\n\nCarpeta: /project\n\n    ls`);
});

/**
 * The command is shown whole (as `permissionTooLarge` allows: the request is denied above 20000 characters, so
 * anything that reaches the formatter fits). A 3000-character command must not be shortened: shortening a command
 * the person is about to approve would hide part of what will run.
 */
test("Claude permission text shows a 3000-character command whole", () => {
  const command = `echo ${"z".repeat(2995)}`;
  const text = formatClaudePermission("Bash", { command }, { locale: "en" });
  expect(text).toBe(`Run a command\n\n    ${command}`);
});

/** A request with no usable fields (nothing to show under the sentence) still names the kind of action instead of coming out empty. */
test("Claude permission text of an empty request still says what kind of action it is", () => {
  expect(formatClaudePermission("Bash", {}, { locale: "es" })).toBe("Ejecutar un comando");
  expect(formatClaudePermission("Read", {}, { locale: "en" })).toBe("Read a file");
});

/** The Codex request shapes below come from the generated protocol (`codex app-server generate-ts`, codex-cli 0.159.0). */
const commandParams = {
  kind: "command", threadId: "t", turnId: "u", itemId: "i", startedAtMs: 1790000000000, approvalId: null, environmentId: null,
  reason: null, networkApprovalContext: null, command: "touch example", cwd: "/project",
  commandActions: [{ type: "unknown", command: "touch example" }], proposedExecpolicyAmendment: null, proposedNetworkPolicyAmendments: null,
};
/** `v2/ThreadItem.ts` `commandExecution`, as Codex reports it in `item/started`. */
const commandItem = {
  type: "commandExecution", id: "i", command: "touch example", cwd: "/project", processId: null, source: "agent", status: "inProgress",
  commandActions: [{ type: "unknown", command: "touch example" }], aggregatedOutput: null, exitCode: null, durationMs: null, pluginId: null,
};
const fileItem = (changes: { path: string; kind: object }[]) => ({
  type: "fileChange", id: "i", status: "inProgress", changes: changes.map(change => ({ ...change, diff: "@@ -1 +1 @@\n-a\n+b" })),
});
/** `v2/FileChangeRequestApprovalParams.ts`. */
const fileParams = { threadId: "t", turnId: "u", itemId: "i", startedAtMs: 1790000000000, reason: null, grantRoot: null };
const update = { type: "update", move_path: null };

type CodexCase = { name: string; method: string; params: Record<string, unknown>; item?: Record<string, unknown>; es: string; en: string };
const codexCases: CodexCase[] = [
  {
    name: "commandExecution with Codex's reason: the reason says what, then the folder, then the command",
    method: "item/commandExecution/requestApproval", params: { ...commandParams, reason: "Necesita crear un archivo" }, item: commandItem,
    es: "Necesita crear un archivo\n\nCarpeta: /project\n\n    touch example",
    en: "Necesita crear un archivo\n\nFolder: /project\n\n    touch example",
  },
  {
    name: "commandExecution without a reason falls back to «run a command»",
    method: "item/commandExecution/requestApproval", params: commandParams, item: commandItem,
    es: "Ejecutar un comando\n\nCarpeta: /project\n\n    touch example",
    en: "Run a command\n\nFolder: /project\n\n    touch example",
  },
  {
    name: "commandExecution takes the command and folder from the started item when the request leaves them out",
    method: "item/commandExecution/requestApproval", params: { ...commandParams, command: null, cwd: null }, item: commandItem,
    es: "Ejecutar un comando\n\nCarpeta: /project\n\n    touch example",
    en: "Run a command\n\nFolder: /project\n\n    touch example",
  },
  {
    name: "commandExecution with nothing known still says what kind of action it is",
    method: "item/commandExecution/requestApproval", params: { ...commandParams, command: null, cwd: null }, item: undefined,
    es: "Ejecutar un comando", en: "Run a command",
  },
  {
    name: "fileChange of one edited file",
    method: "item/fileChange/requestApproval", params: fileParams, item: fileItem([{ path: "/project/a.ts", kind: update }]),
    es: "Editar un archivo\n\nArchivo: /project/a.ts", en: "Edit a file\n\nFile: /project/a.ts",
  },
  {
    name: "fileChange of one created file",
    method: "item/fileChange/requestApproval", params: fileParams, item: fileItem([{ path: "/project/new.ts", kind: { type: "add" } }]),
    es: "Crear un archivo\n\nArchivo: /project/new.ts", en: "Create a file\n\nFile: /project/new.ts",
  },
  {
    name: "fileChange of one deleted file",
    method: "item/fileChange/requestApproval", params: fileParams, item: fileItem([{ path: "/project/old.ts", kind: { type: "delete" } }]),
    es: "Borrar un archivo\n\nArchivo: /project/old.ts", en: "Delete a file\n\nFile: /project/old.ts",
  },
  {
    name: "fileChange of one moved file says where it goes",
    method: "item/fileChange/requestApproval", params: fileParams, item: fileItem([{ path: "/project/a.ts", kind: { type: "update", move_path: "/project/b.ts" } }]),
    es: "Editar un archivo\n\nArchivo: /project/a.ts (movido a /project/b.ts)", en: "Edit a file\n\nFile: /project/a.ts (moved to /project/b.ts)",
  },
  {
    name: "fileChange of two edited files counts them and lists each with its change",
    method: "item/fileChange/requestApproval", params: fileParams,
    item: fileItem([{ path: "/project/a.ts", kind: update }, { path: "/project/b.ts", kind: update }]),
    es: "Editar 2 archivos\n\nArchivos:\n- Editar: /project/a.ts\n- Editar: /project/b.ts",
    en: "Edit 2 files\n\nFiles:\n- Edit: /project/a.ts\n- Edit: /project/b.ts",
  },
  {
    name: "fileChange of two created files",
    method: "item/fileChange/requestApproval", params: fileParams,
    item: fileItem([{ path: "/project/a.ts", kind: { type: "add" } }, { path: "/project/b.ts", kind: { type: "add" } }]),
    es: "Crear 2 archivos\n\nArchivos:\n- Crear: /project/a.ts\n- Crear: /project/b.ts",
    en: "Create 2 files\n\nFiles:\n- Create: /project/a.ts\n- Create: /project/b.ts",
  },
  {
    name: "fileChange of two deleted files",
    method: "item/fileChange/requestApproval", params: fileParams,
    item: fileItem([{ path: "/project/a.ts", kind: { type: "delete" } }, { path: "/project/b.ts", kind: { type: "delete" } }]),
    es: "Borrar 2 archivos\n\nArchivos:\n- Borrar: /project/a.ts\n- Borrar: /project/b.ts",
    en: "Delete 2 files\n\nFiles:\n- Delete: /project/a.ts\n- Delete: /project/b.ts",
  },
  {
    name: "fileChange mixing edits and creations is «change N files»",
    method: "item/fileChange/requestApproval", params: fileParams,
    item: fileItem([{ path: "/project/a.ts", kind: update }, { path: "/project/b.ts", kind: { type: "add" } }]),
    es: "Cambiar 2 archivos\n\nArchivos:\n- Editar: /project/a.ts\n- Crear: /project/b.ts",
    en: "Change 2 files\n\nFiles:\n- Edit: /project/a.ts\n- Create: /project/b.ts",
  },
  {
    name: "fileChange with Codex's reason uses it as the sentence",
    method: "item/fileChange/requestApproval", params: { ...fileParams, reason: "Actualizar el módulo" },
    item: fileItem([{ path: "/project/a.ts", kind: update }, { path: "/project/b.ts", kind: update }]),
    es: "Actualizar el módulo\n\nArchivos:\n- Editar: /project/a.ts\n- Editar: /project/b.ts",
    en: "Actualizar el módulo\n\nFiles:\n- Edit: /project/a.ts\n- Edit: /project/b.ts",
  },
  {
    name: "fileChange lists at most ten files and counts the rest",
    method: "item/fileChange/requestApproval", params: fileParams,
    item: fileItem(Array.from({ length: 12 }, (_, index) => ({ path: `/project/f${index + 1}.ts`, kind: update }))),
    es: `Editar 12 archivos\n\nArchivos:\n${Array.from({ length: 10 }, (_, index) => `- Editar: /project/f${index + 1}.ts`).join("\n")}\n- … y 2 más`,
    en: `Edit 12 files\n\nFiles:\n${Array.from({ length: 10 }, (_, index) => `- Edit: /project/f${index + 1}.ts`).join("\n")}\n- … and 2 more`,
  },
  {
    name: "fileChange whose item was never seen still says it is a file change",
    method: "item/fileChange/requestApproval", params: fileParams, item: undefined,
    es: "Cambiar archivos", en: "Change files",
  },
];

for (const item of codexCases) {
  /**
   * The exact words a person reads for one kind of Codex permission request, in both languages, and that none of the
   * event's JSON (`"type": "commandExecution"`, `"pluginId": null`, `"aggregatedOutput": null`…) reaches them. It exists because
   * `session.ts` used to hand the whole event to the screen with `JSON.stringify`.
   */
  test(`Codex permission text: ${item.name}`, () => {
    const es = formatCodexPermission(item.method, item.params, item.item, "es");
    const en = formatCodexPermission(item.method, item.params, item.item, "en");
    expect(es).toBe(item.es);
    expect(en).toBe(item.en);
    noInternals(es); noInternals(en);
  });
}

/** A text the person's assistant wrote (reason, description) is shown as it came, in either language: only Shell's own words are translated. */
test("the same request reads in each language with Shell's words translated and the assistant's words untouched", () => {
  const locales: Locale[] = ["es", "en"];
  const texts = locales.map(locale => formatCodexPermission("item/commandExecution/requestApproval", { ...commandParams, reason: "Because it needs network" }, commandItem, locale));
  expect(texts).toEqual([
    "Because it needs network\n\nCarpeta: /project\n\n    touch example",
    "Because it needs network\n\nFolder: /project\n\n    touch example",
  ]);
});

/**
 * Came out of the real-account test: a long «Carpeta:» path was broken in the middle of a folder name by the card that draws
 * it. The manual (05) says long paths are cut with «…»: a folder longer than 48 characters keeps its last folders, whole,
 * behind «…» (the end is what tells projects apart); one that fits is left as it is. Same for Claude Code and Codex.
 */
test("a folder longer than 48 characters keeps its last whole folders behind an ellipsis, for Claude Code and for Codex", () => {
  const segment = "abcdefghij";
  const long = `/${[segment, segment, segment, segment, segment, segment, "last"].join("/")}`;
  expect(long).toHaveLength(71);
  const cut = `…/${[segment, segment, segment, "last"].join("/")}`;
  expect(formatClaudePermission("Bash", { command: "ls" }, { locale: "en", cwd: long })).toBe(`Run a command\n\nFolder: ${cut}\n\n    ls`);
  expect(formatClaudePermission("Bash", { command: "ls" }, { locale: "es", cwd: long })).toBe(`Ejecutar un comando\n\nCarpeta: ${cut}\n\n    ls`);
  expect(formatCodexPermission("item/commandExecution/requestApproval", { ...commandParams, cwd: long }, commandItem, "en")).toBe(`Run a command\n\nFolder: ${cut}\n\n    touch example`);
  const exact = `/${"x".repeat(47)}`;
  expect(exact).toHaveLength(48);
  expect(formatClaudePermission("Bash", { command: "ls" }, { locale: "en", cwd: exact })).toBe(`Run a command\n\nFolder: ${exact}\n\n    ls`);
  const oneName = `/${"y".repeat(60)}`;
  expect(formatClaudePermission("Bash", { command: "ls" }, { locale: "en", cwd: oneName })).toBe(`Run a command\n\nFolder: …${"y".repeat(47)}\n\n    ls`);
});
