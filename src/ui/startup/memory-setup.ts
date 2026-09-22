import { SelectList, Text, matchesKey } from "@earendil-works/pi-tui";
import type { McpCapableAgent } from "../../contracts/mcp-agent.ts";
import type { MemoryComponentStatus, MemoryOverallStatus } from "../../infrastructure/forge614-engines.ts";
import { MultiSelectList } from "./multi-select.ts";
import type { EngramFlowScreen } from "./frame.ts";
import { accent, success } from "../basic/theme.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Catalog, Locale } from "../../i18n/index.ts";
import { bindAbort } from "./engram-init.ts";

const plain = (text: string) => text;
const listTheme = { selectedPrefix: accent, selectedText: accent, description: plain, scrollInfo: plain, noMatch: plain };
const multiSelectTheme = { cursor: accent, checked: success, plain };

/**
 * Lets the person choose zero or more assistants to configure with Engram's memory integration
 * (MCP + instructions). Makes no Engines call itself. When `signal` aborts, resolves immediately
 * like Esc/Ctrl-D (no selection) instead of leaving the picker waiting forever.
 */
export async function chooseMemoryAgents(
  agents: readonly McpCapableAgent[], screen: EngramFlowScreen, locale: Locale = "en", signal?: AbortSignal,
): Promise<string[] | undefined> {
  const t = getCatalog(locale).memoryPicker;
  const list = new MultiSelectList(agents.map(agent => ({ value: agent.id, label: agent.label })), multiSelectTheme);
  const hint = new Text(t.hint);
  const body = new Text(t.body);
  screen.setScreen(t.title, list, { hint, body });
  let finish!: (values: string[] | undefined) => void;
  const selection = new Promise<string[] | undefined>(resolve => { finish = resolve; });
  list.onSubmit = values => finish(values);
  list.onCancel = () => finish(undefined);
  const unsubscribe = screen.tui.addInputListener(data => {
    if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) { finish(undefined); return { consume: true }; }
    return undefined;
  });
  const terminate = () => finish(undefined);
  process.once("SIGTERM", terminate);
  const unbindAbort = bindAbort(signal, terminate);
  try { return await selection; }
  finally { process.removeListener("SIGTERM", terminate); unsubscribe(); unbindAbort(); }
}

export type MemoryPreviewItem =
  | {
      readonly agentLabel: string;
      readonly kind: "pending";
      readonly mcpPath: string;
      readonly instructionsPaths: string[];
      readonly hookPath: string;
      readonly mcp: MemoryComponentStatus;
      readonly instructions: MemoryComponentStatus;
      readonly hook: MemoryComponentStatus;
      readonly overallStatus: MemoryOverallStatus;
    }
  | {
      readonly agentLabel: string;
      readonly kind: "resolved";
      readonly mcp: MemoryComponentStatus;
      readonly instructions: MemoryComponentStatus;
      readonly hook: MemoryComponentStatus;
      readonly overallStatus: MemoryOverallStatus;
    }
  | { readonly agentLabel: string; readonly kind: "blocked"; readonly detail: string };

// Every status label is a short phrase with no embedded explanation: Engines' own message (a
// blocked component's `details`, an unsupported one's `reason`) is rendered by `previewLine` on a
// line of its own, so pi-tui's word wrap never splits it mid-sentence.
//
// MCP is never reported "unsupported": Engines only reaches the planning stage for agents whose
// capabilities already confirmed MCP support, so that branch is purely defensive.
function mcpStatusLabel(status: MemoryComponentStatus, t: Catalog["memoryPreview"]): string {
  switch (status.kind) {
    case "write": return t.statusWillAdd;
    case "noop": return t.statusAlreadyConfigured;
    case "blocked": return t.statusBlocked;
    case "unsupported": return t.statusUnsupportedMcp;
  }
}

function instructionsStatusLabel(status: MemoryComponentStatus, t: Catalog["memoryPreview"]): string {
  switch (status.kind) {
    case "write": return t.statusWillAdd;
    case "noop": return t.statusAlreadyPresent;
    case "blocked": return t.statusBlocked;
    case "unsupported": return t.statusNotSupported;
  }
}

function hookStatusLabel(status: MemoryComponentStatus, t: Catalog["memoryPreview"]): string {
  switch (status.kind) {
    case "write": return t.statusWillAdd;
    case "noop": return t.statusAlreadyInstalled;
    case "blocked": return t.statusBlocked;
    case "unsupported": return t.statusNotSupported;
  }
}

/** Engines' own explanation for a status, when it has one. Always rendered on its own line. */
function statusDetail(status: MemoryComponentStatus): string | undefined {
  if (status.kind === "blocked") return status.details;
  if (status.kind === "unsupported") return status.reason;
  return undefined;
}

/**
 * Three lines per assistant (plus one detail line per explained status), so a preview covering
 * several assistants still fits on a standard 80×24 terminal — the alt-screen renderer clips from
 * the top, and nobody should be able to confirm a screen whose header scrolled away unseen.
 */
function previewLine(item: MemoryPreviewItem, t: Catalog["memoryPreview"]): string {
  if (item.kind === "blocked") return t.blockedLine({ agent: item.agentLabel, detail: item.detail });
  const paths = item.kind === "pending"
    ? [
        ...(item.mcp.kind === "write" ? [item.mcpPath] : []),
        ...(item.instructions.kind === "write" ? item.instructionsPaths : []),
        ...(item.hook.kind === "write" ? [item.hookPath] : []),
      ]
    : [];
  const lines = [
    t.overallLine({ agent: item.agentLabel, status: item.overallStatus }),
    `  ${t.pathsToChangeLabel}: ${paths.length ? paths.join(", ") : t.noneLabel}`,
    `  ${t.mcpAndInstructionsLine({ mcp: mcpStatusLabel(item.mcp, t), instructions: instructionsStatusLabel(item.instructions, t) })}`,
    `  ${t.hookLine({ hook: hookStatusLabel(item.hook, t) })}`,
  ];
  const mcpDetail = statusDetail(item.mcp);
  if (mcpDetail) lines.push(`    ${mcpDetail}`);
  const instructionsDetail = statusDetail(item.instructions);
  if (instructionsDetail) lines.push(`    ${instructionsDetail}`);
  const hookDetail = statusDetail(item.hook);
  if (hookDetail) lines.push(`    ${hookDetail}`);
  return lines.join("\n");
}

function previewText(items: readonly MemoryPreviewItem[], t: Catalog["memoryPreview"]): string {
  return [...items.map(item => previewLine(item, t)), t.nothingChangedYet].join("\n\n");
}

/**
 * Shows every selected assistant's memory-integration plan — paths, MCP status, instructions
 * status, and overall status — using only what Engines reported, never file content. Asks one
 * explicit confirmation, which applies only the pending (non-noop) plans.
 */
export async function showMemoryPreviewConfirm(
  items: readonly MemoryPreviewItem[], screen: EngramFlowScreen, locale: Locale = "en", signal?: AbortSignal,
): Promise<boolean> {
  const t = getCatalog(locale).memoryPreview;
  const body = new Text(previewText(items, t));
  const list = new SelectList([
    { value: "confirm", label: t.confirmLabel },
    { value: "cancel", label: t.cancelLabel },
  ], 2, listTheme);
  screen.setScreen(t.title, list, { body });
  let finish!: (value: boolean) => void;
  const selection = new Promise<boolean>(resolve => { finish = resolve; });
  list.onSelect = item => finish(item.value === "confirm");
  list.onCancel = () => finish(false);
  const unsubscribe = screen.tui.addInputListener(data => {
    if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) { finish(false); return { consume: true }; }
    return undefined;
  });
  const terminate = () => finish(false);
  process.once("SIGTERM", terminate);
  const unbindAbort = bindAbort(signal, terminate);
  try { return await selection; }
  finally { process.removeListener("SIGTERM", terminate); unsubscribe(); unbindAbort(); }
}
