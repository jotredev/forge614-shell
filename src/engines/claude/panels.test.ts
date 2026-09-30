import { expect, test } from "bun:test";
import { claudeHelpLines, claudeStatusLines } from "./panels.ts";
import type { ClaudeStatusInfo } from "./panels.ts";

/** Everything the status can show: an init message of a turn that has run, the account of the catalog and Shell's own state. */
const full: ClaudeStatusInfo = {
  version: "2.1.274", sessionId: "s-1", folder: "/project",
  email: "test@example.com", organization: "Acme", plan: "max", apiKeySource: "none", provider: "firstParty",
  model: "Opus 5", permissionMode: "Manual", memoryByAssistant: false, settingSources: ["user", "project", "local"],
  mcpServers: [{ name: "forge614-engram", status: "connected" }, { name: "github", status: "failed" }],
};

/**
 * Claude Code's `/status` shows the Status panel of its settings: version, session, folder, account or login method, model, permission mode, memory,
 * setting sources and MCP servers. Shell shows each of those it really has, in the person's language; the exact lines are written out for both languages
 * so any change to what is shown, or to a word, appears here.
 */
test("the /status panel lists what Shell knows, word for word in English and Spanish", () => {
  expect(claudeStatusLines(full, "en")).toEqual([
    "Claude Code status",
    "Version: 2.1.274",
    "Session: s-1",
    "Folder: /project",
    "Email: test@example.com",
    "Organization: Acme",
    "Plan: max",
    "API key: none in use",
    "Model: Opus 5",
    "Permission mode: Manual",
    "Memory: Shell pastes it",
    "Setting sources: user, project, local",
    "MCP servers:",
    "  Connected: forge614-engram",
    "  Failed: github",
  ]);
  expect(claudeStatusLines(full, "es")).toEqual([
    "Estado de Claude Code",
    "Versión: 2.1.274",
    "Sesión: s-1",
    "Carpeta: /project",
    "Correo: test@example.com",
    "Organización: Acme",
    "Plan: max",
    "Llave de API: ninguna en uso",
    "Modelo: Opus 5",
    "Modo de permisos: Manual",
    "Memoria: la pega Shell",
    "Fuentes de configuración: usuario, proyecto, local",
    "Servidores MCP:",
    "  Conectados: forge614-engram",
    "  Fallaron: github",
  ]);
});

/**
 * Nothing is invented: before the first message there is no init message, so version, session and MCP servers are left out (not «unknown», not «undefined»),
 * a line says when they appear, and the folder, permission mode, memory and setting sources — which Shell always knows — are still there.
 */
test("the /status panel leaves out what Shell does not have and says when it will appear", () => {
  const bare: ClaudeStatusInfo = { folder: "/project", permissionMode: "Plan", memoryByAssistant: true, settingSources: ["user", "project", "local"] };
  expect(claudeStatusLines(bare, "en")).toEqual([
    "Claude Code status",
    "Folder: /project",
    "Permission mode: Plan",
    "Memory: the assistant delivers it at startup",
    "Setting sources: user, project, local",
    "Some details (version, session and MCP servers) appear after your first message.",
  ]);
  expect(claudeStatusLines(bare, "es")).toEqual([
    "Estado de Claude Code",
    "Carpeta: /project",
    "Modo de permisos: Plan",
    "Memoria: la entrega el asistente al arrancar",
    "Fuentes de configuración: usuario, proyecto, local",
    "Algunos datos (versión, sesión y servidores MCP) aparecen tras el primer mensaje.",
  ]);
  for (const locale of ["en", "es"] as const) expect(claudeStatusLines(bare, locale).join("\n")).not.toMatch(/undefined|null|unknown|desconocid/i);
});

/** Each source of the API key in the SDK's init message (`apiKeySource`) has its own words; an account on another provider names the provider, and a server with no servers says none. */
test("the /status panel words the API key source, a provider other than Anthropic and a session with no MCP servers", () => {
  const line = (info: Partial<ClaudeStatusInfo>, locale: "en" | "es" = "en") => claudeStatusLines({ ...full, ...info }, locale).filter(text => /^(API key|Llave de API|Provider|Proveedor|MCP|Servidores MCP)/.test(text));
  expect(line({ apiKeySource: "ANTHROPIC_API_KEY", provider: undefined, mcpServers: [] })).toEqual(["API key: from ANTHROPIC_API_KEY", "MCP servers: none"]);
  expect(line({ apiKeySource: "apiKeyHelper", provider: undefined })[0]).toBe("API key: from apiKeyHelper");
  expect(line({ apiKeySource: "/login managed key", provider: undefined }, "es")[0]).toBe("Llave de API: creada con /login");
  expect(line({ apiKeySource: "none", provider: "bedrock" }).slice(0, 2)).toEqual(["API key: none in use", "Provider: bedrock"]);
  expect(line({ apiKeySource: "none", provider: "firstParty" }).some(text => text.startsWith("Provider"))).toBe(false);
  // A value the SDK keeps only for compatibility (no current Claude Code emits it) is not shown as if it meant something.
  expect(line({ apiKeySource: "oauth", provider: undefined }).some(text => text.startsWith("API key"))).toBe(false);
});

/**
 * The MCP servers come grouped by state, one group per line with its name in the person's language, always in the same order — connected, connecting, needing sign-in,
 * failed — and a group with no server is left out. A state the panel has no words for (disabled, or one a newer Claude Code adds) is shown after them, never lost: a
 * disabled one in its own group and any other under «Other» with the state as the SDK names it. It exists because 25 servers used to come out as one paragraph.
 */
test("the /status panel groups the MCP servers by state, in a fixed order, in English and Spanish", () => {
  const servers = [
    { name: "w", status: "odd" }, { name: "f1", status: "failed" }, { name: "c1", status: "connected" }, { name: "z", status: "disabled" },
    { name: "n1", status: "needs-auth" }, { name: "p1", status: "pending" }, { name: "c2", status: "connected" }, { name: "n2", status: "needs-auth" },
  ];
  const tail = (locale: "en" | "es") => claudeStatusLines({ ...full, mcpServers: servers }, locale).slice(-7);
  expect(tail("en")).toEqual(["MCP servers:", "  Connected: c1, c2", "  Connecting: p1", "  Need sign-in: n1, n2", "  Failed: f1", "  Disabled: z", "  Other: w (odd)"]);
  expect(tail("es")).toEqual(["Servidores MCP:", "  Conectados: c1, c2", "  Conectando: p1", "  Necesitan iniciar sesión: n1, n2", "  Fallaron: f1", "  Desactivados: z", "  Otros: w (odd)"]);
  expect(claudeStatusLines({ ...full, mcpServers: [{ name: "only", status: "failed" }] }, "en").slice(-2)).toEqual(["MCP servers:", "  Failed: only"]);
});

/**
 * With the width the screen has, a group too long for a line continues on the next one under its first name (the indent is the width of «Connected: »), a line breaks
 * only between names — a name is never cut — and one name wider than the line stays whole on its own line. It exists because 25 servers were one paragraph.
 * The 40-column case has a line that is exactly 40 wide, so the edge is tested too.
 */
test("the /status panel breaks long MCP groups under their first name without cutting a name", () => {
  const names = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"];
  const info = { ...full, mcpServers: names.map(name => ({ name, status: "connected" })) };
  expect(claudeStatusLines(info, "en", 40).slice(-4)).toEqual([
    "MCP servers:",
    "  Connected: alpha, bravo, charlie,",
    "             delta, echo, foxtrot, golf,",
    "             hotel",
  ]);
  expect(claudeStatusLines(info, "en").slice(-2)).toEqual(["MCP servers:", "  Connected: alpha, bravo, charlie, delta, echo, foxtrot, golf, hotel"]);
  const long = "a-server-name-that-is-longer-than-the-whole-line";
  expect(claudeStatusLines({ ...full, mcpServers: [{ name: "one", status: "failed" }, { name: long, status: "failed" }, { name: "two", status: "failed" }] }, "en", 30).slice(-4)).toEqual([
    "MCP servers:",
    "  Failed: one,",
    `          ${long},`,
    "          two",
  ]);
  for (const width of [30, 40, 60]) {
    const groups = claudeStatusLines({ ...full, mcpServers: names.map(name => ({ name, status: "failed" })) }, "es", width).filter(line => line.startsWith(" "));
    expect(groups.length).toBeGreaterThan(0);
    for (const line of groups) expect(line.length).toBeLessThanOrEqual(width);
  }
});

/** Values that come from outside (a session id, a server name, an account) are shown as text: control characters are stripped so they can never move the cursor or repaint the screen. */
test("the /status panel strips control characters from values that come from outside", () => {
  const text = claudeStatusLines({ ...full, organization: "Ac\u001b[31mme\u0001", mcpServers: [{ name: "gi\u001b[2Jthub", status: "connected" }] }, "en").join("\n");
  expect(text).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/);
  expect(text).toContain("Organization: Acme");
  expect(text).toContain("  Connected: github");
});

const rows = [
  { value: "/model", label: "Select model" },
  { value: "/compact", label: "Clear conversation history but keep a summary in context" },
  { value: "/help", label: "Show help and available commands" },
];

/**
 * Claude Code's `/help` lists the commands it has with their description and the shortcuts. Shell's lists exactly the rows it is given — the ones its `/` menu shows —
 * and only the shortcuts Shell itself handles (Enter, Shift+Enter, Shift+Tab, Tab and Esc in the menu, Ctrl+C and Ctrl+D), plus where Shell's own commands are.
 */
test("the /help panel lists the menu's commands and only the shortcuts Shell respects, word for word in English and Spanish", () => {
  expect(claudeHelpLines(rows, "en")).toEqual([
    "Claude Code help",
    "Commands (type / to open the menu):",
    "/model    Select model",
    "/compact  Clear conversation history but keep a summary in context",
    "/help     Show help and available commands",
    "Shell's own commands start with /f614: (/f614:commands opens their menu).",
    "Shortcuts:",
    "Enter          Send the message",
    "Shift+Enter    New line",
    "Shift+Tab      Cycle permission modes",
    "Tab            Accept the highlighted command in the / menu",
    "Esc            Close a menu (on a permission question it answers «No»)",
    "Ctrl+C, Ctrl+D Leave Shell (asks first while work is in progress; with a permission question open, answer it first)",
  ]);
  expect(claudeHelpLines(rows, "es")).toEqual([
    "Ayuda de Claude Code",
    "Comandos (escribe / para abrir el menú):",
    "/model    Select model",
    "/compact  Clear conversation history but keep a summary in context",
    "/help     Show help and available commands",
    "Los comandos propios de Shell empiezan con /f614: (/f614:commands abre su menú).",
    "Atajos:",
    "Enter          Enviar el mensaje",
    "Shift+Enter    Nueva línea",
    "Shift+Tab      Cambiar el modo de permisos",
    "Tab            Aceptar el comando marcado en el menú /",
    "Esc            Cerrar un menú (en una pregunta de permiso responde «No»)",
    "Ctrl+C, Ctrl+D Salir de Shell (pregunta antes si hay trabajo en curso; con una pregunta de permiso abierta, contéstala primero)",
  ]);
});

/** No shortcut of Claude Code that Shell does not handle is listed (Ctrl+R, Ctrl+O, Ctrl+B, Option+P…): a list that promises keys that do nothing is worse than a short one. */
test("the /help panel does not promise shortcuts Shell does not have", () => {
  const text = claudeHelpLines(rows, "en").join("\n");
  for (const key of ["Ctrl+R", "Ctrl+O", "Ctrl+B", "Ctrl+T", "Ctrl+L", "Option+", "Alt+", "Ctrl+G", "Ctrl+V"]) expect(text, key).not.toContain(key);
});

/** A command list with control characters in a description (a skill's own text) is shown clean. */
test("the /help panel strips control characters from command descriptions", () => {
  const text = claudeHelpLines([{ value: "/x", label: "Do\u001b[2J it\u0001" }], "en").join("\n");
  expect(text).toContain("/x  Do it");
  expect(text).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/);
});

/**
 * With the width the screen has, a description that does not fit continues under its own column (a hanging indent) — never at the left edge, which broke the columns —
 * and the same in the shortcuts list. It exists because the rest of a long description («and MCP servers») used to drop flush left under the command names.
 * The 40-column case checks the words of a real row, and every line stays within the width.
 */
test("the /help panel keeps the rest of a long description under its own column, commands and shortcuts", () => {
  const lines = claudeHelpLines(rows, "en", 40);
  expect(lines.join("\n")).toContain("/compact  Clear conversation history but\n          keep a summary in context");
  expect(lines.join("\n")).toContain("/help     Show help and available\n          commands");
  expect(lines.join("\n")).toContain("Tab            Accept the highlighted\n               command in the / menu");
  const leave = lines.findIndex(line => line.startsWith("Ctrl+C, Ctrl+D "));
  expect(leave).toBeGreaterThan(0);
  for (const line of lines.slice(leave + 1)) expect(line.startsWith(" ".repeat(15))).toBe(true);
  for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(40);
  expect(claudeHelpLines(rows, "en")).toEqual(claudeHelpLines(rows, "en", 500));
});

/**
 * When the width is so narrow that the column plus a few words does not fit, the description goes on the line below with a fixed two-space indent, so nothing is squeezed
 * into a sliver. It exists as the fallback of the hanging indent.
 */
test("the /help panel puts the description on the next line with a fixed indent when the column does not fit", () => {
  const lines = claudeHelpLines(rows, "en", 20);
  expect(lines.join("\n")).toContain("/compact\n  Clear conversation\n  history but keep a\n  summary in context");
  expect(lines.join("\n")).toContain("/model\n  Select model");
  for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(20);
});
