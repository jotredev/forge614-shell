import { ProcessTerminal, SelectList, Text, matchesKey } from "@earendil-works/pi-tui";
import type { Terminal } from "@earendil-works/pi-tui";
import type { McpCapableAgent } from "../../contracts/mcp-agent.ts";
import { MultiSelectList } from "./multi-select.ts";
import { startupFrame } from "./frame.ts";
import { accent, success } from "../basic/theme.ts";

const plain = (text: string) => text;
const listTheme = { selectedPrefix: accent, selectedText: accent, description: plain, scrollInfo: plain, noMatch: plain };
const multiSelectTheme = { cursor: accent, checked: success, plain };

/** Lets the person choose zero or more MCP-capable assistants. Makes no Engines call itself. */
export async function chooseMcpAgents(
  agents: readonly McpCapableAgent[], terminal: Terminal = new ProcessTerminal(),
): Promise<string[] | undefined> {
  const list = new MultiSelectList(agents.map(agent => ({ value: agent.id, label: agent.label })), multiSelectTheme);
  const hint = new Text("Space to toggle · Enter to confirm your selection (zero or more) · Esc to skip MCP setup");
  const body = new Text("Choose which detected AI assistants should get the forge614-engram MCP server.");
  const tui = startupFrame(terminal, "Configure the Engram MCP server", list, hint, body);
  let finish!: (values: string[] | undefined) => void;
  const selection = new Promise<string[] | undefined>(resolve => { finish = resolve; });
  list.onSubmit = values => finish(values);
  list.onCancel = () => finish(undefined);
  tui.addInputListener(data => {
    if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) { finish(undefined); return { consume: true }; }
    return undefined;
  });
  const terminate = () => finish(undefined);
  process.once("SIGTERM", terminate);
  try { tui.start(); return await selection; }
  finally { process.removeListener("SIGTERM", terminate); tui.stop({ preserveScreen: true }); }
}

export interface McpPreviewItem {
  readonly agentLabel: string;
  readonly filePath: string | null;
  readonly status: "pending" | "already-configured" | "blocked";
  readonly detail?: string;
}

function previewLine(item: McpPreviewItem): string {
  if (item.status === "pending") return `${item.agentLabel}: will add MCP "forge614-engram" to ${item.filePath}`;
  if (item.status === "already-configured") return `${item.agentLabel}: already configured (no change)`;
  return `${item.agentLabel}: blocked — ${item.detail}`;
}

function previewText(items: readonly McpPreviewItem[]): string {
  return [
    ...items.map(previewLine),
    "",
    "Confirming applies only the pending assistants above. Nothing is written until you confirm.",
  ].join("\n");
}

/**
 * Shows every selected assistant's outcome so far — pending write, already configured, or
 * blocked — using only the file path Engines reported, never file content. Asks one explicit
 * confirmation, which applies only the pending ones.
 */
export async function showMcpPreviewConfirm(
  items: readonly McpPreviewItem[], terminal: Terminal = new ProcessTerminal(),
): Promise<boolean> {
  const body = new Text(previewText(items));
  const list = new SelectList([
    { value: "confirm", label: "Confirm" },
    { value: "cancel", label: "Cancel" },
  ], 2, listTheme);
  const tui = startupFrame(terminal, "Confirm MCP configuration", list, undefined, body);
  let finish!: (value: boolean) => void;
  const selection = new Promise<boolean>(resolve => { finish = resolve; });
  list.onSelect = item => finish(item.value === "confirm");
  list.onCancel = () => finish(false);
  tui.addInputListener(data => {
    if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) { finish(false); return { consume: true }; }
    return undefined;
  });
  const terminate = () => finish(false);
  process.once("SIGTERM", terminate);
  try { tui.start(); return await selection; }
  finally { process.removeListener("SIGTERM", terminate); tui.stop({ preserveScreen: true }); }
}
