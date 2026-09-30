import { stripVTControlCharacters } from "node:util";
import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";
import { memorySourceLine } from "../memory-source.ts";

/** Text that comes from outside (the SDK, an account, a skill) shown as plain text: escape sequences and control characters cannot move the cursor or repaint the screen. */
const clean = (text: string): string => stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");

/**
 * Puts `words` after `prefix` and breaks the line before a word that would pass `width`; every continuation line starts with as many spaces as `prefix` has, so the words stay
 * under the first one (a hanging indent). Without a `width` it is one line. A word wider than the room is kept whole on its own line unless `cutLong` says to cut it (a
 * description, not a name).
 */
function hang(prefix: string, words: string[], width?: number, cutLong = false): string[] {
  if (!width) return [prefix + words.join(" ")];
  const indent = " ".repeat(prefix.length);
  const room = Math.max(1, width - indent.length);
  const lines: string[] = []; let current = prefix; let empty = true;
  for (let word of words) {
    while (cutLong && word.length > width) {
      if (!empty) { lines.push(current); current = indent; empty = true; }
      lines.push(current + word.slice(0, width)); current = indent; word = word.slice(width);
    }
    if (!empty && current.length + 1 + word.length > width) { lines.push(current); current = indent + word; }
    else { current += (empty ? "" : " ") + word; }
    empty = false;
  }
  lines.push(current);
  return lines.filter((line, index) => index === 0 || line.trim() !== "");
}

/** Plain text (a title, a sentence) broken by words to `width`, with no indent; without a `width` it stays as it is. */
const wrapPlain = (text: string, width?: number): string[] => hang("", text.split(" "), width, true);

/**
 * One row of a two-column list (a command and its description, a key and what it does). When the description fits after the column it is one line; when it does not, the rest
 * goes below its own column (hanging indent). When the column leaves fewer than `MIN_DESCRIPTION` columns for the words, the description goes on the next lines with a fixed
 * two-space indent instead of being squeezed into a sliver.
 */
const MIN_DESCRIPTION = 12;
function columns(name: string, column: number, description: string, width?: number): string[] {
  if (!width) return [`${name.padEnd(column)}${description}`];
  if (column + MIN_DESCRIPTION > width) return [name, ...hang("  ", description.split(" "), width, true)];
  return hang(name.padEnd(column), description.split(" "), width, true);
}

/**
 * What Shell really has to answer Claude Code's `/status`. Every field but the folder, the memory source and the setting sources is optional: an init message only
 * arrives with the first turn, and the account only after the catalog loads. What is missing is left out of the panel, never written as «unknown».
 */
export interface ClaudeStatusInfo {
  /** `claude_code_version` of the SDK's `init` message. */
  version?: string;
  sessionId?: string;
  folder: string;
  /** The account the catalog handshake reported (`AccountInfo`). */
  email?: string;
  organization?: string;
  plan?: string;
  provider?: string;
  /** `apiKeySource` of the `init` message. */
  apiKeySource?: string;
  /** The model as the sidebar names it. */
  model?: string;
  /** The permission mode as Shift+Tab shows it («Manual», «Plan»…). */
  permissionMode?: string;
  /** Whether Claude Code's own startup hook delivers Engram's memory (otherwise Shell pastes it). */
  memoryByAssistant: boolean;
  /** The `settingSources` Shell asks Claude Code to load, as the SDK names them. */
  settingSources: readonly string[];
  /** `mcp_servers` of the `init` message; none listed means the session has none. */
  mcpServers?: { name: string; status: string }[];
}

/**
 * The lines of Claude Code's `/status` — the Status panel of its settings (version, session, folder, account or login method, model, permission mode, memory,
 * setting sources and MCP servers) — with each line only when Shell has the data, in the person's language. The API key line has words for the sources the
 * SDK documents for `apiKeySource`; a value kept only for compatibility says nothing and is left out. MCP servers come grouped by state, one group per line (see `mcpGroupLines`).
 * With `width` (the columns the text has) a long group continues under its first name; without it every line is whole.
 */
export function claudeStatusLines(info: ClaudeStatusInfo, locale: Locale = "en", width?: number): string[] {
  const t = getCatalog(locale).claudePanels;
  const line = (label: string, value: string) => `${label}: ${clean(value)}`;
  const apiKey: Record<string, string> = { ANTHROPIC_API_KEY: t.apiKeyFromEnvironment, apiKeyHelper: t.apiKeyFromHelper, "/login managed key": t.apiKeyFromLogin, none: t.apiKeyNone };
  const sources: Record<string, string> = { user: t.settingSourceUser, project: t.settingSourceProject, local: t.settingSourceLocal };
  const lines = [t.statusTitle];
  if (info.version) lines.push(line(t.labelVersion, info.version));
  if (info.sessionId) lines.push(line(t.labelSession, info.sessionId));
  lines.push(line(t.labelFolder, info.folder));
  if (info.email) lines.push(line(t.labelEmail, info.email));
  if (info.organization) lines.push(line(t.labelOrganization, info.organization));
  if (info.plan) lines.push(line(t.labelPlan, info.plan));
  const apiKeyText = info.apiKeySource ? apiKey[info.apiKeySource] : undefined;
  if (apiKeyText) lines.push(line(t.labelApiKey, apiKeyText));
  if (info.provider && info.provider !== "firstParty") lines.push(line(t.labelProvider, info.provider));
  if (info.model) lines.push(line(t.labelModel, info.model));
  if (info.permissionMode) lines.push(line(t.labelPermissionMode, info.permissionMode));
  lines.push(memorySourceLine(info.memoryByAssistant, locale));
  lines.push(line(t.labelSettingSources, info.settingSources.map(source => sources[source] ?? source).join(", ")));
  if (info.mcpServers) {
    if (!info.mcpServers.length) lines.push(line(t.labelMcpServers, t.mcpNone));
    else lines.push(`${t.labelMcpServers}:`, ...mcpGroupLines(info.mcpServers, locale, width));
  }
  if (!info.version) lines.push(t.statusAfterFirstMessage);
  return lines;
}

/**
 * The MCP servers one group per state, each on its own line with the group's name in the person's language — connected, connecting, needing sign-in, failed, then disabled and
 * any state Shell has no words for (its own group, the state written after the name so nothing is lost) — and a group with no server left out. Names keep the order the SDK
 * gave them. With `width` a long group breaks between names and continues under the first one; a name is never cut.
 */
function mcpGroupLines(servers: { name: string; status: string }[], locale: Locale, width?: number): string[] {
  const t = getCatalog(locale).claudePanels;
  const groups: [string[], string][] = [[["connected"], t.mcpGroupConnected], [["pending"], t.mcpGroupConnecting], [["needs-auth"], t.mcpGroupNeedsSignIn], [["failed"], t.mcpGroupFailed], [["disabled"], t.mcpGroupDisabled]];
  const known = new Set(groups.flatMap(([states]) => states));
  const named = (list: { name: string; status: string }[], withStatus: boolean) => list.map((server, index) => `${clean(server.name)}${withStatus ? ` (${clean(server.status)})` : ""}${index < list.length - 1 ? "," : ""}`);
  const lines: string[] = [];
  for (const [states, label] of groups) {
    const list = servers.filter(server => states.includes(server.status));
    if (list.length) lines.push(...hang(`  ${label}: `, named(list, false), width));
  }
  const other = servers.filter(server => !known.has(server.status));
  if (other.length) lines.push(...hang(`  ${t.mcpGroupOther}: `, named(other, true), width));
  return lines;
}

/**
 * The lines of Claude Code's `/help`: the commands it has with their description — exactly the rows Shell's `/` menu lists — and the shortcuts. Only shortcuts
 * Shell handles itself are listed (Enter, Shift+Enter, Shift+Tab, Tab and Esc in the `/` menu, Ctrl+C and Ctrl+D); Claude Code's others (Ctrl+R, Ctrl+O, Ctrl+B,
 * Option+P…) are not, because a key that does nothing here would be a promise Shell cannot keep. One line says where Shell's own `/f614:` commands are.
 * With `width` (the columns the text has) a description that does not fit continues under its own column, in both lists (see `columns`); without it every row is one line.
 */
export function claudeHelpLines(commands: { value: string; label: string }[], locale: Locale = "en", width?: number): string[] {
  const t = getCatalog(locale).claudePanels;
  const column = Math.max(0, ...commands.map(command => clean(command.value).length)) + 2;
  const keys: [string, string][] = [
    ["Enter", t.keySend], ["Shift+Enter", t.keyNewLine], ["Shift+Tab", t.keyCycleModes], ["Tab", t.keyAcceptCommand], ["Esc", t.keyCloseMenu], ["Ctrl+C, Ctrl+D", t.keyLeave],
  ];
  const keyWidth = Math.max(...keys.map(([key]) => key.length)) + 1;
  return [
    ...wrapPlain(t.helpTitle, width),
    ...wrapPlain(t.helpCommands, width),
    ...commands.flatMap(command => columns(clean(command.value), column, clean(command.label), width)),
    ...wrapPlain(t.helpShellCommands, width),
    ...wrapPlain(t.helpShortcuts, width),
    ...keys.flatMap(([key, text]) => columns(key, keyWidth, text, width)),
  ];
}
