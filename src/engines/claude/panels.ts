import { stripVTControlCharacters } from "node:util";
import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";
import { memorySourceLine } from "../memory-source.ts";

/** Text that comes from outside (the SDK, an account, a skill) shown as plain text: escape sequences and control characters cannot move the cursor or repaint the screen. */
const clean = (text: string): string => stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");

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
 * SDK documents for `apiKeySource`; a value kept only for compatibility says nothing and is left out.
 */
export function claudeStatusLines(info: ClaudeStatusInfo, locale: Locale = "en"): string[] {
  const t = getCatalog(locale).claudePanels;
  const line = (label: string, value: string) => `${label}: ${clean(value)}`;
  const apiKey: Record<string, string> = { ANTHROPIC_API_KEY: t.apiKeyFromEnvironment, apiKeyHelper: t.apiKeyFromHelper, "/login managed key": t.apiKeyFromLogin, none: t.apiKeyNone };
  const sources: Record<string, string> = { user: t.settingSourceUser, project: t.settingSourceProject, local: t.settingSourceLocal };
  const serverStatus: Record<string, string> = { connected: t.mcpConnected, failed: t.mcpFailed, "needs-auth": t.mcpNeedsSignIn, pending: t.mcpConnecting, disabled: t.mcpDisabled };
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
    const servers = info.mcpServers.map(server => `${clean(server.name)} (${clean(serverStatus[server.status] ?? server.status)})`);
    lines.push(line(t.labelMcpServers, servers.length ? servers.join(", ") : t.mcpNone));
  }
  if (!info.version) lines.push(t.statusAfterFirstMessage);
  return lines;
}

/**
 * The lines of Claude Code's `/help`: the commands it has with their description — exactly the rows Shell's `/` menu lists — and the shortcuts. Only shortcuts
 * Shell handles itself are listed (Enter, Shift+Enter, Shift+Tab, Tab and Esc in the `/` menu, Ctrl+C and Ctrl+D); Claude Code's others (Ctrl+R, Ctrl+O, Ctrl+B,
 * Option+P…) are not, because a key that does nothing here would be a promise Shell cannot keep. One line says where Shell's own `/f614:` commands are.
 */
export function claudeHelpLines(commands: { value: string; label: string }[], locale: Locale = "en"): string[] {
  const t = getCatalog(locale).claudePanels;
  const width = Math.max(0, ...commands.map(command => clean(command.value).length)) + 2;
  const keys: [string, string][] = [
    ["Enter", t.keySend], ["Shift+Enter", t.keyNewLine], ["Shift+Tab", t.keyCycleModes], ["Tab", t.keyAcceptCommand], ["Esc", t.keyCloseMenu], ["Ctrl+C, Ctrl+D", t.keyLeave],
  ];
  const keyWidth = Math.max(...keys.map(([key]) => key.length)) + 1;
  return [
    t.helpTitle,
    t.helpCommands,
    ...commands.map(command => `${clean(command.value).padEnd(width)}${clean(command.label)}`),
    t.helpShellCommands,
    t.helpShortcuts,
    ...keys.map(([key, text]) => `${key.padEnd(keyWidth)}${text}`),
  ];
}
