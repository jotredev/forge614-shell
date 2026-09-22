import { SelectList, Text, matchesKey } from "@earendil-works/pi-tui";
import type { EngramInitDecisions } from "../../contracts/engram-init.ts";
import { MaskedInput } from "./masked-input.ts";
import type { EngramFlowScreen } from "./frame.ts";
import { accent } from "../basic/theme.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Catalog, Locale } from "../../i18n/index.ts";

export type EngramInitFlowResult =
  | { readonly confirmed: true; readonly decisions: EngramInitDecisions }
  | { readonly confirmed: false };

const plain = (text: string) => text;
const listTheme = { selectedPrefix: accent, selectedText: accent, description: plain, scrollInfo: plain, noMatch: plain };

/**
 * Wires a screen's abort-on-signal behavior identically to its existing SIGTERM handling: calling
 * `terminate` once, synchronously if the signal is already aborted (e.g. stdin closed for real
 * while nothing was listening yet), or the first time it fires. Returns an unsubscribe function for
 * the caller's `finally`, matching the existing SIGTERM cleanup pattern.
 */
export function bindAbort(signal: AbortSignal | undefined, terminate: () => void): () => void {
  if (!signal) return () => {};
  if (signal.aborted) { terminate(); return () => {}; }
  signal.addEventListener("abort", terminate, { once: true });
  return () => signal.removeEventListener("abort", terminate);
}

async function showIntro(screen: EngramFlowScreen, t: Catalog["engramInit"], signal?: AbortSignal): Promise<boolean> {
  const body = new Text(t.introBody);
  const list = new SelectList([{ value: "continue", label: t.continueLabel }], 1, listTheme);
  screen.setScreen(t.introTitle, list, { body });
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
  const unbindAbort = bindAbort(signal, terminate);
  try { return await selection; }
  finally { process.removeListener("SIGTERM", terminate); unsubscribe(); unbindAbort(); }
}

async function askPostgresConnectionString(screen: EngramFlowScreen, t: Catalog["engramInit"], signal?: AbortSignal): Promise<string | undefined> {
  const input = new MaskedInput({ placeholder: "postgres://user:password@host:5432/database" });
  const body = new Text(t.postgresConnectionPrompt);
  screen.setScreen(t.postgresConnectionTitle, input, { body });
  let finish!: (value: string | undefined) => void;
  const submission = new Promise<string | undefined>(resolve => { finish = resolve; });
  input.onSubmit = value => {
    // An empty submission re-asks on the same screen; only Esc/Ctrl+C cancels the flow.
    if (!value.trim()) {
      body.setText(`${t.postgresConnectionPrompt}\n\n${t.postgresConnectionRequired}`);
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
  const unbindAbort = bindAbort(signal, terminate);
  try { return await submission; }
  finally { process.removeListener("SIGTERM", terminate); unsubscribe(); unbindAbort(); }
}

async function askPostgres(screen: EngramFlowScreen, t: Catalog["engramInit"], signal?: AbortSignal): Promise<{ enabled: boolean; connectionString: string | null } | undefined> {
  const list = new SelectList([
    { value: "no", label: t.postgresNo },
    { value: "yes", label: t.postgresYes },
  ], 2, listTheme);
  screen.setScreen(t.postgresTitle, list);
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
  const unbindAbort = bindAbort(signal, terminate);
  let choice: "no" | "yes" | undefined;
  try { choice = await selection; }
  finally { process.removeListener("SIGTERM", terminate); unsubscribe(); unbindAbort(); }
  if (!choice || signal?.aborted) return undefined;
  if (choice === "no") return { enabled: false, connectionString: null };
  const connectionString = await askPostgresConnectionString(screen, t, signal);
  return connectionString === undefined ? undefined : { enabled: true, connectionString };
}

async function askReinforcement(screen: EngramFlowScreen, t: Catalog["engramInit"], signal?: AbortSignal): Promise<boolean | undefined> {
  const list = new SelectList([
    { value: "yes", label: t.yesLabel },
    { value: "no", label: t.noLabel },
  ], 2, listTheme);
  const body = new Text(t.reinforcementBody);
  screen.setScreen(t.reinforcementTitle, list, { body });
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
  const unbindAbort = bindAbort(signal, terminate);
  try {
    const choice = await selection;
    return choice === undefined ? undefined : choice === "yes";
  } finally { process.removeListener("SIGTERM", terminate); unsubscribe(); unbindAbort(); }
}

function summaryText(decisions: EngramInitDecisions, t: Catalog["engramInit"]): string {
  const postgresLine = decisions.postgresUrl !== null ? t.summaryPostgresEnabled : t.summaryPostgresDisabled;
  const reinforcementLine = decisions.reinforcement ? t.summaryReinforcementEnabled : t.summaryReinforcementDisabled;
  const initCommand = decisions.postgresUrl !== null
    ? "forge614-engram init --json --postgres-url ********"
    : "forge614-engram init --json";
  const commands = decisions.reinforcement ? [initCommand, "forge614-engram reinforcement-enable"] : [initCommand];
  return [
    t.summaryLocalStorage,
    postgresLine,
    reinforcementLine,
    "",
    t.summaryCommandsHeading,
    ...commands,
    "",
    t.summaryNoAgentNotice,
  ].join("\n");
}

async function showSummary(screen: EngramFlowScreen, decisions: EngramInitDecisions, t: Catalog["engramInit"], signal?: AbortSignal): Promise<boolean> {
  const body = new Text(summaryText(decisions, t));
  const list = new SelectList([
    { value: "confirm", label: t.confirmLabel },
    { value: "cancel", label: t.cancelLabel },
  ], 2, listTheme);
  screen.setScreen(t.summaryTitle, list, { body });
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

/**
 * Drives the Engram memory-initialization screens end to end, on the shared continuous alt-screen.
 * Makes no Engram command calls. When `signal` aborts (stdin closing for real), every pending
 * screen resolves immediately like a cancel, and no further screen is ever shown — the caller
 * checks `signal.aborted` on return to tell an abort apart from a genuine confirm/cancel.
 */
export async function runEngramInitFlow(screen: EngramFlowScreen, locale: Locale = "en", signal?: AbortSignal): Promise<EngramInitFlowResult> {
  const t = getCatalog(locale).engramInit;
  if (signal?.aborted) return { confirmed: false };
  if (!await showIntro(screen, t, signal) || signal?.aborted) return { confirmed: false };
  const postgres = await askPostgres(screen, t, signal);
  if (!postgres || signal?.aborted) return { confirmed: false };
  const reinforcement = await askReinforcement(screen, t, signal);
  if (reinforcement === undefined || signal?.aborted) return { confirmed: false };
  const decisions: EngramInitDecisions = { postgresUrl: postgres.enabled ? postgres.connectionString : null, reinforcement };
  return (await showSummary(screen, decisions, t, signal)) && !signal?.aborted ? { confirmed: true, decisions } : { confirmed: false };
}
