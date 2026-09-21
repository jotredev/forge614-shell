import { ProcessTerminal, SelectList, Text, matchesKey } from "@earendil-works/pi-tui";
import type { Terminal } from "@earendil-works/pi-tui";
import type { McpCapableAgent } from "../../contracts/mcp-agent.ts";
import type { MemoryComponentStatus, MemoryOverallStatus } from "../../infrastructure/forge614-engines.ts";
import { MultiSelectList } from "./multi-select.ts";
import { startupFrame } from "./frame.ts";
import { accent, success } from "../basic/theme.ts";

const plain = (text: string) => text;
const listTheme = { selectedPrefix: accent, selectedText: accent, description: plain, scrollInfo: plain, noMatch: plain };
const multiSelectTheme = { cursor: accent, checked: success, plain };

/** Lets the person choose zero or more assistants to configure with Engram's memory integration (MCP + instructions). Makes no Engines call itself. */
export async function chooseMemoryAgents(
  agents: readonly McpCapableAgent[], terminal: Terminal = new ProcessTerminal(),
): Promise<string[] | undefined> {
  const list = new MultiSelectList(agents.map(agent => ({ value: agent.id, label: agent.label })), multiSelectTheme);
  const hint = new Text("Space to toggle · Enter to confirm your selection (zero or more) · Esc to skip memory setup");
  const body = new Text("Choose which detected AI assistants should get Forge614 Engram's memory integration: the forge614-engram MCP server and its universal memory instructions.");
  const tui = startupFrame(terminal, "Configure Engram memory integration", list, hint, body);
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

export type MemoryPreviewItem =
  | {
      readonly agentLabel: string;
      readonly kind: "pending";
      readonly mcpPath: string;
      readonly instructionsPaths: string[];
      readonly mcp: MemoryComponentStatus;
      readonly instructions: MemoryComponentStatus;
      readonly overallStatus: MemoryOverallStatus;
    }
  | {
      readonly agentLabel: string;
      readonly kind: "resolved";
      readonly mcp: MemoryComponentStatus;
      readonly instructions: MemoryComponentStatus;
      readonly overallStatus: MemoryOverallStatus;
    }
  | { readonly agentLabel: string; readonly kind: "blocked"; readonly detail: string };

// MCP is never reported "unsupported": Engines only reaches the planning stage for agents whose
// capabilities already confirmed MCP support, so this component's status is always noop/write/blocked.
function mcpStatusLabel(status: MemoryComponentStatus): string {
  if (status.kind === "write") return "will add";
  if (status.kind === "noop") return "already configured";
  return `blocked — ${(status as { details: string }).details}`;
}

function instructionsStatusLabel(status: MemoryComponentStatus): string {
  if (status.kind === "write") return "will add";
  if (status.kind === "noop") return "already present";
  if (status.kind === "unsupported") return `not supported by this assistant — ${status.reason}`;
  return `blocked — ${status.details}`;
}

function previewLine(item: MemoryPreviewItem): string {
  if (item.kind === "blocked") return `${item.agentLabel}: blocked — ${item.detail}`;
  const paths = item.kind === "pending"
    ? [...(item.mcp.kind === "write" ? [item.mcpPath] : []), ...(item.instructions.kind === "write" ? item.instructionsPaths : [])]
    : [];
  const lines = [
    `${item.agentLabel}:`,
    `  paths to change: ${paths.length ? paths.join(", ") : "(none)"}`,
    `  MCP forge614-engram: ${mcpStatusLabel(item.mcp)}`,
  ];
  // Put unsupported reason on a separate line to avoid word-wrapping
  if (item.instructions.kind === "unsupported") {
    lines.push(`  memory instructions: not supported by this assistant`);
    lines.push(`    ${item.instructions.reason}`);
  } else {
    lines.push(`  memory instructions: ${instructionsStatusLabel(item.instructions)}`);
  }
  lines.push(`  overall: ${item.overallStatus}`);
  return lines.join("\n");
}

function previewText(items: readonly MemoryPreviewItem[]): string {
  return [...items.map(previewLine), "Nothing has been changed yet. Confirming applies only the pending assistants above."].join("\n\n");
}

/**
 * Shows every selected assistant's memory-integration plan — paths, MCP status, instructions
 * status, and overall status — using only what Engines reported, never file content. Asks one
 * explicit confirmation, which applies only the pending (non-noop) plans.
 */
export async function showMemoryPreviewConfirm(
  items: readonly MemoryPreviewItem[], terminal: Terminal = new ProcessTerminal(),
): Promise<boolean> {
  const body = new Text(previewText(items));
  const list = new SelectList([
    { value: "confirm", label: "Confirm" },
    { value: "cancel", label: "Cancel" },
  ], 2, listTheme);
  const tui = startupFrame(terminal, "Confirm memory integration", list, undefined, body);
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
