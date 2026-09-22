import { SelectList, Text, matchesKey } from "@earendil-works/pi-tui";
import type { EngramInitDecisions } from "../../contracts/engram-init.ts";
import { MaskedInput } from "./masked-input.ts";
import type { EngramFlowScreen } from "./frame.ts";
import { accent } from "../basic/theme.ts";

export type EngramInitFlowResult =
  | { readonly confirmed: true; readonly decisions: EngramInitDecisions }
  | { readonly confirmed: false };

const plain = (text: string) => text;
const listTheme = { selectedPrefix: accent, selectedText: accent, description: plain, scrollInfo: plain, noMatch: plain };

async function showIntro(screen: EngramFlowScreen): Promise<boolean> {
  const body = new Text([
    "Forge614 Engram stores persistent memory locally on this device.",
    "",
    "Local SQLite + FTS5 storage is always used.",
    "This flow does not create or select a project.",
    "This flow does not detect or configure AI clients.",
  ].join("\n"));
  const list = new SelectList([{ value: "continue", label: "Continue" }], 1, listTheme);
  screen.setScreen("Forge614 Engram — memory initialization", list, { body });
  let finish!: (value: boolean) => void;
  const selection = new Promise<boolean>(resolve => { finish = resolve; });
  list.onSelect = () => finish(true);
  list.onCancel = () => finish(false);
  const unsubscribe = screen.tui.addInputListener(data => {
    if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) { finish(false); return { consume: true }; }
    return undefined;
  });
  const terminate = () => finish(false);
  process.once("SIGTERM", terminate);
  try { return await selection; }
  finally { process.removeListener("SIGTERM", terminate); unsubscribe(); }
}

const CONNECTION_PROMPT = "Enter the PostgreSQL connection string. It is never shown or logged.";

async function askPostgresConnectionString(screen: EngramFlowScreen): Promise<string | undefined> {
  const input = new MaskedInput({ placeholder: "postgres://user:password@host:5432/database" });
  const body = new Text(CONNECTION_PROMPT);
  screen.setScreen("PostgreSQL connection string", input, { body });
  let finish!: (value: string | undefined) => void;
  const submission = new Promise<string | undefined>(resolve => { finish = resolve; });
  input.onSubmit = value => {
    // An empty submission re-asks on the same screen; only Esc/Ctrl+C cancels the flow.
    if (!value.trim()) {
      body.setText(`${CONNECTION_PROMPT}\n\nA connection string is required. Press Esc to cancel instead.`);
      screen.tui.requestRender();
      return;
    }
    finish(value.trim());
  };
  input.onEscape = () => finish(undefined);
  const unsubscribe = screen.tui.addInputListener(data => {
    if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) { finish(undefined); return { consume: true }; }
    return undefined;
  });
  const terminate = () => finish(undefined);
  process.once("SIGTERM", terminate);
  try { return await submission; }
  finally { process.removeListener("SIGTERM", terminate); unsubscribe(); }
}

async function askPostgres(screen: EngramFlowScreen): Promise<{ enabled: boolean; connectionString: string | null } | undefined> {
  const list = new SelectList([
    { value: "no", label: "No" },
    { value: "yes", label: "Yes, configure PostgreSQL synchronization" },
  ], 2, listTheme);
  screen.setScreen("PostgreSQL synchronization", list);
  let finish!: (value: "no" | "yes" | undefined) => void;
  const selection = new Promise<"no" | "yes" | undefined>(resolve => { finish = resolve; });
  list.onSelect = item => finish(item.value as "no" | "yes");
  list.onCancel = () => finish(undefined);
  const unsubscribe = screen.tui.addInputListener(data => {
    if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) { finish(undefined); return { consume: true }; }
    return undefined;
  });
  const terminate = () => finish(undefined);
  process.once("SIGTERM", terminate);
  let choice: "no" | "yes" | undefined;
  try { choice = await selection; }
  finally { process.removeListener("SIGTERM", terminate); unsubscribe(); }
  if (!choice) return undefined;
  if (choice === "no") return { enabled: false, connectionString: null };
  const connectionString = await askPostgresConnectionString(screen);
  return connectionString === undefined ? undefined : { enabled: true, connectionString };
}

async function askReinforcement(screen: EngramFlowScreen): Promise<boolean | undefined> {
  const list = new SelectList([
    { value: "yes", label: "Yes" },
    { value: "no", label: "No" },
  ], 2, listTheme);
  const body = new Text("Reinforcement makes repeated memories rank higher in search results. It does not verify whether a memory is true.");
  screen.setScreen("Memory reinforcement", list, { body });
  let finish!: (value: "yes" | "no" | undefined) => void;
  const selection = new Promise<"yes" | "no" | undefined>(resolve => { finish = resolve; });
  list.onSelect = item => finish(item.value as "yes" | "no");
  list.onCancel = () => finish(undefined);
  const unsubscribe = screen.tui.addInputListener(data => {
    if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) { finish(undefined); return { consume: true }; }
    return undefined;
  });
  const terminate = () => finish(undefined);
  process.once("SIGTERM", terminate);
  try {
    const choice = await selection;
    return choice === undefined ? undefined : choice === "yes";
  } finally { process.removeListener("SIGTERM", terminate); unsubscribe(); }
}

function summaryText(decisions: EngramInitDecisions): string {
  const postgresLine = decisions.postgresUrl !== null ? "PostgreSQL: enabled" : "PostgreSQL: disabled";
  const reinforcementLine = decisions.reinforcement ? "reinforcement: enabled" : "reinforcement: disabled";
  const initCommand = decisions.postgresUrl !== null
    ? "forge614-engram init --json --postgres-url ********"
    : "forge614-engram init --json";
  const commands = decisions.reinforcement ? [initCommand, "forge614-engram reinforcement-enable"] : [initCommand];
  return [
    "local storage: SQLite + FTS5",
    postgresLine,
    reinforcementLine,
    "",
    "Forge614 Engram commands that will run:",
    ...commands,
    "",
    "No AI client, MCP, hook, or project will be configured by this flow.",
  ].join("\n");
}

async function showSummary(screen: EngramFlowScreen, decisions: EngramInitDecisions): Promise<boolean> {
  const body = new Text(summaryText(decisions));
  const list = new SelectList([
    { value: "confirm", label: "Confirm" },
    { value: "cancel", label: "Cancel" },
  ], 2, listTheme);
  screen.setScreen("Summary", list, { body });
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
  try { return await selection; }
  finally { process.removeListener("SIGTERM", terminate); unsubscribe(); }
}

/** Drives the Engram memory-initialization screens end to end, on the shared continuous alt-screen. Makes no Engram command calls. */
export async function runEngramInitFlow(screen: EngramFlowScreen): Promise<EngramInitFlowResult> {
  if (!await showIntro(screen)) return { confirmed: false };
  const postgres = await askPostgres(screen);
  if (!postgres) return { confirmed: false };
  const reinforcement = await askReinforcement(screen);
  if (reinforcement === undefined) return { confirmed: false };
  const decisions: EngramInitDecisions = { postgresUrl: postgres.enabled ? postgres.connectionString : null, reinforcement };
  return (await showSummary(screen, decisions)) ? { confirmed: true, decisions } : { confirmed: false };
}
