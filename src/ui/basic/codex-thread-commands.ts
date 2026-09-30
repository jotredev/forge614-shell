import type { NativeSideStart, NativeSubagent } from "../../engines/types.ts";
import { describeError } from "../../shell-error.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Catalog } from "../../i18n/index.ts";
import type { ComposerChoice } from "./composer.ts";
import type { CodexCommandHandler, CodexCommandScreen } from "./codex-commands.ts";

/**
 * Codex's commands that work with other conversations than the one on screen: `/recap` (a temporary conversation that summarizes this one), `/side` and `/btw` (a temporary
 * branch to ask on the side), `/subagents` (watch the subagents of this conversation) and `/agents` (the shared-agents board). Each shows Codex's own selectors and words
 * (translated); the screen switching itself is done by the events the session sends (`detourStart` and `detourEnd`), not here.
 */
export function threadCommandHandlers(screen: CodexCommandScreen): Record<string, CodexCommandHandler> {
  return {
    recap: () => recap(screen),
    side: argument => side(screen, "side", argument),
    btw: argument => side(screen, "btw", argument),
    subagents: () => subagents(screen),
    agents: async () => { agents(screen); },
  };
}

/** The honest «not from Shell yet» answer, for a session that has no such method (another assistant). */
const notAllowed = (screen: CodexCommandScreen, name: string) => screen.write(getCatalog(screen.locale).codexChat.commandNotAllowed({ name: `/${name}` }));

/**
 * `/recap`: while the temporary conversation works the box shows Codex's «Generating conversation recap»; then the summary comes in its «↳ Recap:» frame with the next action
 * when there is one, or Codex's message for what went wrong (nothing to summarize, one already running, the recap could not be made).
 */
async function recap(screen: CodexCommandScreen): Promise<void> {
  const { session, write, locale } = screen;
  const nt = getCatalog(locale).codexNative;
  if (!session.recap) { notAllowed(screen, "recap"); return; }
  const done = screen.working(getCatalog(locale).codexChat.recapLoadingTitle);
  let result;
  try { result = await session.recap(); } finally { done(); }
  switch (result.status) {
    case "ok": write([nt.recapLine({ summary: result.summary }), ...(result.nextAction ? [nt.recapNextLine({ action: result.nextAction })] : [])].join("\n")); return;
    case "empty": write(nt.recapEmpty); return;
    case "busy": write(nt.recapBusy); return;
    case "failed": write(nt.recapFailed); return;
  }
}

/** Codex's words for why a side conversation could not open (`SIDE_NO_STARTED_CONVERSATION_MESSAGE`, `SIDE_ALREADY_OPEN_MESSAGE` and the failure and review messages). */
function sideRefusal(nt: Catalog["codexNative"], result: Exclude<NativeSideStart, { status: "started" }>, name: string): string {
  switch (result.status) {
    case "no-conversation": return nt.sideNoConversation;
    case "already-open": return nt.sideAlreadyOpen;
    case "reviewing": return nt.sideReviewing({ name: `/${name}` });
    case "failed": return result.stage === "start" ? nt.sideStartFailed({ error: result.error }) : nt.sidePrepareFailed({ error: result.error });
  }
}

/**
 * `/side` and `/btw` (the same command in Codex's list): opens a side conversation and, when there is a question after the command, sends it as its first message — after the
 * conversation is open, so it is written in the side view. If it cannot open, Codex says why and the question goes back to the box (`restore_side_user_message`).
 */
async function side(screen: CodexCommandScreen, name: string, argument: string): Promise<void> {
  const { session, write, locale } = screen;
  if (!session.startSide) { notAllowed(screen, name); return; }
  const question = argument.trim();
  const result = await session.startSide();
  if (result.status === "started") { if (question) screen.submit(question); return; }
  write(sideRefusal(getCatalog(locale).codexNative, result, name));
  if (question) screen.setComposerText(question);
}

/** The name a picker row shows: the assistant's name for the subagent, else its first message, else a generic word (the main conversation has Codex's own «Main [default]»). */
function subagentTitle(nt: Catalog["codexNative"], agent: NativeSubagent): string {
  if (agent.main) return nt.subagentMain;
  return agent.name || agent.preview?.replace(/\s+/g, " ").slice(0, 80) || nt.subagentAgent;
}

/** The state of a row in words; Codex shows it only as a colored dot. */
function subagentState(nt: Catalog["codexNative"], state: NativeSubagent["state"]): string {
  return state === "running" ? nt.subagentRunning : state === "closed" ? nt.subagentClosed : nt.subagentIdle;
}

/**
 * `/subagents`: Codex's picker (`agent_picker_selection_view_params`) — the main conversation first, then each subagent by its name, with its state and id and the one on
 * screen marked — and the answers around it: «No agents available yet.» when there are none, and, when the feature is off and there are none, Codex's «Enable subagents?».
 * Choosing a subagent shows it read only; choosing Main from a watched one goes back.
 */
async function subagents(screen: CodexCommandScreen): Promise<void> {
  const { session, write, locale } = screen;
  const nt = getCatalog(locale).codexNative;
  if (!session.subagents) { notAllowed(screen, "subagents"); return; }
  const { enabled, agents: rows } = await session.subagents();
  const others = rows.filter(row => !row.main);
  if (!enabled && others.length === 0) { await enableSubagents(screen); return; }
  if (others.length === 0) { write(nt.subagentsNone); return; }
  const items: ComposerChoice[] = rows.map(row => ({
    value: row.id, display: `• ${subagentTitle(nt, row)}`, label: `${subagentState(nt, row.state)} · ${row.id}`,
    search: `${subagentTitle(nt, row)} ${row.preview ?? ""} ${row.id}`,
  }));
  const picked = await screen.choose(nt.subagentsTitle, items, rows.find(row => row.current)?.id, { searchable: true, body: nt.subagentsSubtitle });
  const chosen = rows.find(row => row.id === picked);
  if (!chosen || chosen.current) return;
  if (chosen.main) { await session.leaveDetour?.(); return; }
  if (!session.watchSubagent) { notAllowed(screen, "subagents"); return; }
  try { await session.watchSubagent(chosen.id); }
  catch (error) { write(nt.subagentOpenFailed({ error: describeError(error, locale) })); }
}

/**
 * Codex's «Enable subagents?» (`open_feature_enable_prompt`): «Yes, enable» first and marked, as Codex has it, and «Not now». Saving writes into the person's Codex
 * configuration, so the question says so in its body (which goes away with it); only «Yes» writes, and how it went is told in Codex's words.
 */
async function enableSubagents(screen: CodexCommandScreen): Promise<void> {
  const { session, write, locale } = screen;
  const nt = getCatalog(locale).codexNative;
  const answer = await screen.choose(nt.subagentsEnableTitle, [
    { value: "yes", display: nt.enableYes, label: nt.subagentsEnableYesDescription },
    { value: "no", display: nt.enableNo, label: nt.subagentsEnableNoDescription },
  ], undefined, { body: `${nt.subagentsEnableSubtitle}\n${nt.subagentsEnableWrites}` });
  if (answer !== "yes" || !session.enableSubagents) return;
  try {
    const result = await session.enableSubagents();
    write(result.status === "ok" ? nt.subagentsEnabled : nt.subagentsEnableOverridden({ message: result.message ?? nt.overriddenFallback }));
  } catch (error) { write(nt.subagentsEnableFailed({ error: describeError(error, locale) })); }
}

/**
 * `/agents` with the embedded server, which is Shell's case (`open_agents_overview`): Codex's «Shared agents unavailable» and why. Codex would offer to start a background
 * server; Shell does not connect one, so it says that instead and offers nothing to start (and leaves out Codex's note about starting one, which only confused).
 */
function agents(screen: CodexCommandScreen): void {
  const nt = getCatalog(screen.locale).codexNative;
  screen.write([nt.agentsUnavailableTitle, nt.agentsUnavailableSubtitle, nt.agentsNoServer].join("\n"));
}
