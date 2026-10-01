import { stripVTControlCharacters } from "node:util";
import { Container, HStack, ProcessTerminal, ScrollView, Text, TuiAltScreen, VStack, matchesKey } from "@earendil-works/pi-tui";
import type { Terminal } from "@earendil-works/pi-tui";
import { getSessionMessages, listSessions } from "@anthropic-ai/claude-agent-sdk";
import { claudeResumeEntries, resumeChoice, sortRecentFirst } from "./resume-picker.ts";
import type { ResumeEntry } from "./resume-picker.ts";
import type { EffortLevel, ModelInfo, SDKMessage, SlashCommand } from "@anthropic-ai/claude-agent-sdk";
import { claudeEnvironment, claudeLoginState, findClaude, officialLogin } from "../../engines/claude/auth.ts";
import { confirmedLogout } from "../../engines/logout.ts";
import { ClaudeSession } from "../../engines/claude/session.ts";
import { claudeHelpLines, claudeStatusLines } from "../../engines/claude/panels.ts";
import type { ClaudeStatusInfo } from "../../engines/claude/panels.ts";
import { emptyTelemetry, telemetryLines, updateTelemetry } from "../../engines/claude/telemetry.ts";
import { createComposer } from "./composer.ts";
import { askPermission, askQuit, askShellQuestion } from "./permission-choice.ts";
import { formatClaudePermission } from "../../engines/permission-text.ts";
import { ShellState } from "./shell-state.ts";
import { ShellSidebar } from "./sidebar.ts";
import { loadEnginePreference, saveEngineMode, saveEnginePreference } from "../../infrastructure/shell-preferences.ts";
import { cycleWorkMode, restoreWorkMode } from "../../engines/work-mode.ts";
import { getStartupContext } from "../../infrastructure/forge614-engram.ts";
import { withStartupNotices } from "../../infrastructure/engram-notices.ts";
import { createMemoryHookProbe } from "../../infrastructure/memory-hook.ts";
import { memorySourceLine } from "../../engines/memory-source.ts";
import { ShellStatusBar } from "./status-bar.ts";
import { effortDescription, effortLabel, isDisplayableUsage } from "./metrics.ts";
import { ActivityCard, chatMessage } from "./transcript.ts";
import { lineDiff } from "./diff.ts";
import { engramToolLabel, parseClaudeMcpToolName } from "../../engines/mcp-labels.ts";
import { ChatText, PanelText, danger } from "./theme.ts";
import { nodeWarningRow, takeNodeWarnings } from "./node-warnings.ts";
import { ChatLogo } from "./logo.ts";
import { IndependentScrollView, attachJumpToLatest, workspaceLayout, workspaceTerminal } from "./workspace.ts";
import { createSidebarLayout } from "./sidebar-layout.ts";
import { workingStatus } from "./duration.ts";
import { ToolTracker } from "./tool-tracker.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";
import { describeError } from "../../shell-error.ts";

const clean = (text: string) => stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");

/** Strips a trailing context-window tag like "[1m]" — catalog rows carry it on `resolvedModel` (e.g. "claude-opus-5[1m]") but a live event reports the bare wire id ("claude-opus-5"), so an exact match misses. */
function stripContextTag(id: string): string {
  return id.replace(/\[[^[\]]*\]$/, "");
}

/** Turns an unrecognized wire id into something readable without inventing a name: "claude-opus-5" → "Opus 5". Only used when the catalog genuinely has no matching row — never overrides a real displayName. */
function prettifyModelId(id: string): string {
  const words = id.replace(/^claude-/, "").split("-").filter(Boolean);
  if (!words.length) return id;
  return words.map(word => /^\d/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

/**
 * `selectedModel` (what the person picked in /model) always matches a catalog row exactly — it is
 * literally the same `value` the picker returned. `liveModel` (what the live SDK event reports once
 * a turn has run) does not: the SDK's `resolvedModel` field is optional, not populated for every row,
 * and can carry a context-window tag the live id doesn't. Prefer the person's own explicit pick; only
 * fall back to the live-reported id when they left it on "default" and Claude Code resolved it on its
 * own — and even then, never show the bare technical id if a nicer one can be produced honestly.
 * Exported standalone so this priority order is unit-testable without spinning up a full session.
 */
export function resolveModelDisplay(models: ModelInfo[], selectedModel: string | undefined, liveModel: string | undefined): string | undefined {
  if (selectedModel && selectedModel !== "default") {
    return models.find(model => model.value === selectedModel)?.displayName ?? selectedModel;
  }
  if (!liveModel) return undefined;
  const match = models.find(model =>
    model.resolvedModel === liveModel || model.value === liveModel ||
    (model.resolvedModel !== undefined && stripContextTag(model.resolvedModel) === liveModel));
  return match?.displayName ?? prettifyModelId(liveModel);
}

/**
 * File edits are the one tool call worth showing in full by default: extracts the before/after
 * text straight from the request (no disk read) so the card can render a real diff instead of a
 * JSON dump. `Write` has no "before" available without reading the file, so it renders as pure
 * additions, which is still accurate for a new file and honest (not misleading) for an overwrite.
 */
function editContent(name: string, input: unknown): { before: string; after: string; path?: string } | undefined {
  const record = input as Record<string, unknown> | undefined;
  if (!record) return undefined;
  const path = typeof record.file_path === "string" ? record.file_path : typeof record.notebook_path === "string" ? record.notebook_path : undefined;
  if (name === "Edit" && typeof record.old_string === "string" && typeof record.new_string === "string") return { before: record.old_string, after: record.new_string, path };
  if (name === "Write" && typeof record.content === "string") return { before: "", after: record.content, path };
  return undefined;
}

/**
 * The rows of the `/` menu's CLAUDE CODE group, and of `/help`: first the commands Claude Code reports (each with its own description), then the ones Shell carries
 * out with Claude Code's meaning — `/model`, `/effort`, `/resume`, `/new`, `/login`, `/logout`, `/exit`, `/status` and `/help` — and none twice when Claude Code lists
 * one of them as well. One function for both, so the menu and the help cannot disagree.
 */
export function claudeMenuCommands(commands: SlashCommand[], t: ReturnType<typeof getCatalog>["chat"]): { value: string; label: string }[] {
  const native = commands.map(command => ({ value: `/${command.name}`, label: command.description || command.argumentHint || t.genericCommandLabel }));
  const names = new Set(native.map(command => command.value));
  const providerControls = [
    ["/model", t.commandSelectModel], ["/effort", t.commandSelectReasoning], ["/resume", t.commandChatHistory], ["/new", t.commandNewConversation], ["/login", t.commandConnectAccount], ["/logout", t.commandDisconnectLocally], ["/exit", t.commandExitShell],
    ["/status", t.commandShowStatus], ["/help", t.commandShowHelp],
  ].map(([value, label]) => ({ value: value!, label: label! })).filter(command => !names.has(command.value));
  return [...native, ...providerControls];
}

export async function startClaudeUI(args: string[], selectedExecutable?: string, terminal?: Terminal, version?: string, locale: Locale = "en"): Promise<void> {
  const t = getCatalog(locale).chat;
  const tc = getCatalog(locale).claudeChat;
  if (args.length) throw new Error(tc.cliOptionsUnsupported);
  if (!terminal && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error(tc.requiresInteractiveTerminal);
  const env = claudeEnvironment(process.env);
  const executable = selectedExecutable ?? await findClaude(env);
  const cwd = process.cwd();
  // Engram's notices (a database migration, a folder re-linked, an unreadable project file) reach the
  // person as chat lines; the session itself never knows about them. `write`/`writeError` are
  // declared below and only run when the first turn fetches memory, long after they exist.
  const showNotice = (text: string, isProblem: boolean) => { if (isProblem) writeError(text); else write(text); };
  // The startup hook Engines installs already delivers the memory to Claude Code; Shell only pastes its own block when that is not certain.
  const session = new ClaudeSession({
    cwd, env, executable, getStartupContext: withStartupNotices(getStartupContext, showNotice, locale),
    memoryHookActive: createMemoryHookProbe("claude-code", { env }),
  });
  const surface = workspaceTerminal(terminal ?? new ProcessTerminal());
  const tui = new TuiAltScreen(surface, true, undefined, { mouse: true });
  const composer = createComposer(tui, locale);
  const transcript = new Container();
  let transcriptScroll!: IndependentScrollView;
  const chatLogo = new ChatLogo(() => transcriptScroll.viewportRows, () => (terminal ?? surface).rows);
  transcript.addChild(chatLogo);
  transcriptScroll = new IndependentScrollView(transcript, { follow: "end", primary: true, scrollbar: "hidden" });
  const { input } = composer;
  const shellState = new ShellState("Claude Code");
  shellState.checking();
  const sidebar = new ShellSidebar(() => shellState.snapshot(), cwd, process.env.HOME, locale);
  // The sidebar's width and whether it is hidden come back from the preferences and are saved when the person lets go of the grip or clicks a button; the footer takes the sidebar's data while it is not drawn.
  const sidebarLayout = createSidebarLayout(surface, locale);
  const statusBar = new ShellStatusBar(() => shellState.snapshot(), cwd, () => sidebar.projectInfo(), process.env.HOME, version, locale, () => sidebarLayout.isVisible());
  tui.setLayoutRoot(workspaceLayout(transcriptScroll, composer.component, sidebar, statusBar, surface, sidebarLayout));
  attachJumpToLatest(tui, transcriptScroll, locale, sidebarLayout);
  tui.setFocus(input);
  let telemetry = emptyTelemetry();
  let activeTurn: Promise<void> | undefined;
  let commandBusy = false;
  let loginAbort: AbortController | undefined;
  let closed = false;
  let disconnected = false;
  let accountConnected = false;
  let accountChecked = false;
  let accountUnknown = false;
  let resolveExit!: () => void;
  const exited = new Promise<void>(resolve => { resolveExit = resolve; });
  const approvals: { label: string; finish: (allowed: boolean) => void }[] = [];
  let sessions: ResumeEntry[] = [];
  let streaming: ChatText | undefined;
  let streamedText = "";
  const toolTracker = new ToolTracker(card => { transcript.addChild(card); tui.requestRender(); }, tc);
  // Remembers the person's own /model and /effort picks across Shell restarts — the native `claude`
  // CLI remembers its own picks the same way when used directly; Shell keeps its own copy rather
  // than writing into the native CLI's config file, which Shell does not own.
  let preferenceApplied = false;
  const persistPreference = () => saveEnginePreference("claude", { model: session.model, effort: session.effort }, { env: process.env });
  const loadCatalog = async (signal?: AbortSignal) => {
    try {
      await session.initialize(signal);
      if (!preferenceApplied) {
        preferenceApplied = true;
        const saved = loadEnginePreference("claude", { env: process.env });
        if (saved?.model && session.models.some(model => model.value === saved.model)) session.model = saved.model;
        if (saved?.effort) session.effort = saved.effort as EffortLevel;
        // The last work mode comes back without asking; one Claude Code no longer lists leaves its default.
        await restoreWorkMode(session, saved?.mode);
      }
      syncCommandGroups();
    }
    catch { if (!closed && !signal?.aborted) write(tc.catalogLoadFailed); }
  };
  const syncCommandGroups = () => {
    // Under FORGE614 only Shell's own commands, every one with the `/f614:` prefix.
    input.setCommandGroups([
      { title: "CLAUDE CODE", items: claudeMenuCommands(session.commands, t) },
      { title: "FORGE614", items: [
        { value: "/f614:refresh", label: t.commandRefreshPlanUsage }, { value: "/f614:status", label: t.commandSessionDetails },
        { value: "/f614:commands", label: t.commandBrowseCommands }, { value: "/f614:stop", label: t.commandCancelActiveTurn },
        { value: "/f614:quit", label: t.commandExitShell },
      ] },
    ]);
  };
  syncCommandGroups(); // from the start, so the menu already tells Claude Code's commands from Shell's before the catalog arrives

  const write = (text: string): ChatText => {
    const component = new ChatText(clean(text));
    transcript.addChild(component);
    tui.requestRender();
    return component;
  };
  /** A panel with columns and indents (`/status`, `/help`): its rows are made for the width the chat really has each time it is drawn, so a long line continues under its own column. */
  const writePanel = (lines: (width: number) => string[]): void => {
    transcript.addChild(new PanelText(width => lines(width).map(clean)));
    tui.requestRender();
  };
  /** Red, so an error reads as an error at a glance instead of blending into a normal reply. */
  const writeError = (text: string): ChatText => {
    const component = new ChatText(clean(text), danger);
    transcript.addChild(component);
    tui.requestRender();
    return component;
  };
  /** A Node process warning, as a normal Shell notice: one muted row with the catalog's prefix (see `takeNodeWarnings`). */
  const writeNodeWarning = (message: string): void => {
    transcript.addChild(nodeWarningRow(clean(t.nodeWarning({ message }))));
    tui.requestRender();
  };
  const writeChat = (role: "user" | "assistant" | "system", text: string): ChatText => write(chatMessage(role, clean(text), locale));
  const writeActivity = (title: string, detail: string, expanded = false): ActivityCard => {
    const card = new ActivityCard(title, "", clean(detail), expanded);
    transcript.addChild(card); tui.requestRender();
    return card;
  };
  const modelDisplay = (): string | undefined => resolveModelDisplay(session.models, session.model, telemetry.model);
  const refresh = () => {
    if (accountUnknown) shellState.unknown();
    else if (!accountChecked) shellState.checking();
    else if (disconnected || !accountConnected) shellState.disconnect();
    else {
      const usage = Object.entries(telemetry.quotas)
        .filter(([label, quota]) => isDisplayableUsage(label) && quota.utilization !== undefined)
        .map(([label, quota]) => ({ label, usedPercent: Math.round(quota.utilization! * 100), ...(quota.resetsAt ? { reset: new Date(quota.resetsAt * 1000).toLocaleString() } : {}) }));
      shellState.connect({
        user: session.user, sessionId: session.sessionId,
        inputTokens: telemetry.inputTokens, outputTokens: telemetry.outputTokens, estimateUSD: telemetry.estimateUSD,
        model: modelDisplay(),
        reasoning: effortLabel(telemetry.effort ?? session.effort, locale),
        ...(session.context ? { context: session.context } : telemetry.contextTokens !== undefined && telemetry.contextWindow !== undefined ? { context: { used: telemetry.contextTokens, window: telemetry.contextWindow } } : {}),
        usage: usage.length ? usage : session.usage,
        backgroundActivity: session.backgroundActivity,
        backgroundActivitySupported: true,
      });
    }
    sidebar.invalidate();
    const working = turnStartedAt !== undefined ? workingStatus(t.statusWorking, toolTracker.currentActivity(), (Date.now() - turnStartedAt) / 1000) : t.statusWorking;
    input.setStatus(commandBusy || session.busy ? working : shellState.snapshot().account === "connected" ? t.statusReady : shellState.snapshot().account === "checking" ? tc.statusCheckingAccount : t.statusConnectWithLogin({ command: "/login" }));
    input.setWorkModeHint(session.workModes().find(mode => mode.id === session.workMode()));
    statusBar.invalidate();
    tui.requestRender();
  };
  // Ticks refresh() while a turn is in flight so the elapsed-time counter and spinner actually
  // move — without this the status line only updates when a new SDK event happens to arrive,
  // which can go quiet for a while during tool execution and reads as "it froze".
  let turnStartedAt: number | undefined;
  let turnTicker: ReturnType<typeof setInterval> | undefined;
  const beginTurn = () => {
    turnStartedAt = Date.now();
    clearInterval(turnTicker);
    turnTicker = setInterval(refresh, 500);
    turnTicker.unref?.();
  };
  const endTurn = () => {
    turnStartedAt = undefined;
    toolTracker.endTurn();
    clearInterval(turnTicker);
    turnTicker = undefined;
  };
  const shutdown = async () => {
    if (closed) return;
    closed = true;
    input.cancelChoice();
    loginAbort?.abort();
    session.stop();
    for (const approval of [...approvals]) approval.finish(false);
    await activeTurn;
    endTurn();
    tui.stop({ preserveScreen: true });
    resolveExit();
  };
  const showApproval = () => {
    const approval = approvals[0];
    if (!approval) return;
    writeActivity(t.permissionRequestedTitle, approval.label, true);
    void askPermission(input, locale).then(allowed => approval.finish(allowed));
  };
  /** A tool permission request, shown in plain words (`formatClaudePermission`) instead of the tool's JSON input. */
  const approve = (tool: string, value: Record<string, unknown>, signal: AbortSignal): Promise<boolean> => {
    const details = JSON.stringify(value, null, 2);
    if (details.length > 20000) {
      writeError(tc.permissionTooLarge({ tool }));
      return Promise.resolve(false);
    }
    if (tool === "AskUserQuestion") {
      write(tc.questionnaireUnsupported);
      return Promise.resolve(false);
    }
    return askApproval(formatClaudePermission(tool, value, { locale, cwd }), signal);
  };
  /** Puts `label` (already in words the person reads) in the permission queue and resolves when they answer it; answers one at a time, in order. */
  const askApproval = (label: string, signal: AbortSignal): Promise<boolean> => {
    return new Promise(resolve => {
      const approval = {
        label,
        finish: (allowed: boolean) => {
          const index = approvals.indexOf(approval);
          if (index === -1) return;
          const wasFirst = index === 0;
          approvals.splice(index, 1);
          if (wasFirst) input.cancelChoice();
          signal.removeEventListener("abort", abort);
          resolve(allowed);
          if (wasFirst && approvals[0]) showApproval();
        },
      };
      const abort = () => approval.finish(false);
      approvals.push(approval);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      else if (approvals.length === 1) showApproval();
    });
  };
  const onEvent = (event: SDKMessage) => {
    telemetry = updateTelemetry(telemetry, event);
    if (event.type === "system" && event.subtype === "init") accountConnected = true;
    if (event.type === "system" && event.subtype === "commands_changed") syncCommandGroups();
    if (event.type === "stream_event" && !event.parent_tool_use_id) {
      if (event.event.type === "message_start") { streaming = undefined; streamedText = ""; }
      if (event.event.type === "content_block_delta" && event.event.delta.type === "text_delta") {
        streamedText += event.event.delta.text;
        streaming ??= writeChat("assistant", "");
        streaming.setText(chatMessage("assistant", clean(streamedText), locale));
      }
    }
    if (event.type === "assistant") {
      const text = event.message.content.filter(block => block.type === "text").map(block => block.text).join("\n");
      if (!event.parent_tool_use_id && text) {
        if (streaming) streaming.setText(chatMessage("assistant", clean(text), locale));
        else writeChat("assistant", text);
        streaming = undefined; streamedText = "";
      }
      for (const block of event.message.content) if (block.type === "tool_use") {
        const edit = editContent(block.name, block.input);
        const parsed = parseClaudeMcpToolName(block.name);
        const label = (parsed && engramToolLabel(parsed.server, parsed.tool)) ?? (edit?.path ? `${block.name} · ${edit.path.split("/").pop()}` : block.name);
        const card = edit
          ? new ActivityCard(label, tc.toolRequested, "", true, lineDiff(edit.before, edit.after))
          : new ActivityCard(label, tc.toolRequested, clean(JSON.stringify(block.input, null, 2)).slice(0, 2000));
        const description = (block.input as { description?: unknown } | undefined)?.description;
        if (toolTracker.request(block.id, card, { isEdit: Boolean(edit), title: label, ...(typeof description === "string" && description.trim() ? { activity: description } : {}) })) transcript.addChild(card);
      }
    }
    if (event.type === "tool_progress") toolTracker.progress(event.tool_use_id, event.tool_name, event.elapsed_time_seconds);
    if (event.type === "user" && Array.isArray(event.message.content)) {
      for (const block of event.message.content) if (block.type === "tool_result") {
        const detail = typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? "");
        toolTracker.finished(block.tool_use_id, Boolean(block.is_error), clean(detail).slice(0, 3000));
      }
    }
    if (event.type === "result" && event.is_error) writeError(tc.claudeError({ message: event.subtype === "success" ? event.result : event.errors.join("\n") }));
    refresh();
  };
  /** Whether the «Quit anyway?» question is on screen, so a second Ctrl+C does not open it again. */
  let quitAsking = false;
  /**
   * Leaves Shell — `/f614:quit`, Ctrl+C and Ctrl+D. Idle it leaves at once; while a turn or a login runs it asks «Quit anyway?» with
   * «No» marked (stopping work cannot be undone) and only «Yes» stops it and leaves. With a permission question open it asks to answer
   * that first, so the question is never cancelled (and the permission denied) by accident.
   */
  const quit = async () => {
    if (!(session.busy || loginAbort)) { await shutdown(); return; }
    if (approvals.length) { write(t.answerPendingPermissionFirst); return; }
    if (quitAsking) return;
    quitAsking = true;
    try { if (await askQuit(input, locale)) await shutdown(); } finally { quitAsking = false; }
  };
  /** Claude Code's own `/exit` (alias `/quit`): it leaves when idle and refuses while a turn or a login is in progress, saying that `/f614:quit` leaves. */
  const quitLikeClaude = async () => {
    if (session.busy || loginAbort) write(tc.workOrAuthActive);
    else await shutdown();
  };
  /** What Shell has for Claude Code's `/status` right now: the newest init message, the handshake's account, the model and permission mode as the box shows them, and where the memory comes from. */
  const statusInfo = async (): Promise<ClaudeStatusInfo> => ({
    ...session.initInfo, ...(session.sessionId ? { sessionId: session.sessionId } : {}), folder: cwd,
    ...(session.account?.email ? { email: session.account.email } : {}), ...(session.account?.organization ? { organization: session.account.organization } : {}),
    ...(session.account?.subscriptionType ? { plan: session.account.subscriptionType } : {}), ...(session.account?.apiProvider ? { provider: session.account.apiProvider } : {}),
    ...(modelDisplay() ? { model: modelDisplay()! } : {}), ...(session.workModes().find(mode => mode.id === session.workMode())?.label ? { permissionMode: session.workModes().find(mode => mode.id === session.workMode())!.label } : {}),
    memoryByAssistant: await session.memoryDeliveredByAssistant(), settingSources: session.settingSources,
  });
  const command = async (value: string) => {
    const [name, ...rest] = value.trim().split(/\s+/);
    const argument = rest.join(" ");
    // Every command of Shell's own starts with `/f614:`; without it a name is Claude Code's (or unknown), never a silent alias of Shell's.
    if (name === "/f614:refresh") { await sidebar.refreshUsage(); return; }
    // These commands have a Shell picker, but their catalog and selected value
    // remain entirely Claude-native.  Handle them before the general native
    // command forwarding below so `/effort` cannot become a chat turn.
    if (name && !["/model", "/effort"].includes(name) && session.commands.some(command => `/${command.name}` === name || command.aliases?.some(alias => `/${alias}` === name))) {
      if (session.busy) throw new Error(tc.finishOrStopFirst);
      // A native command sent as a turn is the chat's first turn, like a message: it removes the opening sign (Shell's own `/f614:` commands, and a command refused above, do not).
      chatLogo.dismiss();
      writeChat("user", value); telemetry = { ...emptyTelemetry(), quotas: telemetry.quotas };
      beginTurn();
      activeTurn = session.send(value, onEvent, approve).catch(error => { writeError(t.turnStopped({ message: describeError(error, locale) })); }).finally(() => { activeTurn = undefined; endTurn(); refresh(); });
      refresh(); return;
    }
    if (name === "/f614:yes" || name === "/f614:no") {
      if (!approvals[0]) throw new Error(t.noPermissionPending);
      approvals[0].finish(name === "/f614:yes"); return;
    }
    if (name === "/f614:stop") { loginAbort?.abort(); session.stop(); return; }
    if (name === "/exit" || name === "/quit") { await quitLikeClaude(); return; }
    if (name === "/f614:quit") { await quit(); return; }
    // Shell's own session telemetry.
    if (name === "/f614:status") { write([...telemetryLines(telemetry, locale), memorySourceLine(await session.memoryDeliveredByAssistant(), locale)].join("\n")); return; }
    // Claude Code's own `/status` and `/help`, answered with what Shell has (see `claudeStatusLines` and `claudeHelpLines`); like Claude Code's, they run also while a turn does.
    if (name === "/status") { const info = await statusInfo(); writePanel(width => claudeStatusLines(info, locale, width)); return; }
    if (name === "/help") { const rows = claudeMenuCommands(session.commands, t); writePanel(width => claudeHelpLines(rows, locale, width)); return; }
    if (name === "/f614:help" || name === "/f614:commands") {
      if (approvals.length) { write(t.answerPendingPermissionFirst); return; }
      const selected = await input.chooseCommand();
      if (selected) input.onSubmit?.(selected);
      return;
    }
    if (session.busy) throw new Error(tc.finishOrStopFirst);
    if (name === "/login") {
      loginAbort = new AbortController();
      let suspended = false;
      try {
        write(tc.checkingAccount);
        const connected = await claudeLoginState(executable, env, cwd, undefined, loginAbort.signal);
        if (closed || loginAbort.signal.aborted) return;
        if (connected) {
          disconnected = false; accountConnected = true; accountChecked = true; accountUnknown = false;
          await loadCatalog(loginAbort.signal);
          write(tc.connectedExistingAccount); return;
        }
        write(tc.signInRequired);
        tui.stop({ preserveScreen: true }); suspended = true;
        await officialLogin(executable, env, cwd, loginAbort.signal);
        const verified = await claudeLoginState(executable, env, cwd, undefined, loginAbort.signal);
        if (!closed && !loginAbort.signal.aborted && verified) { disconnected = false; accountConnected = true; accountChecked = true; accountUnknown = false; }
        if (!verified) throw new Error(tc.loginNotVerified);
        await loadCatalog(loginAbort.signal);
      } finally { loginAbort = undefined; if (!closed && suspended) { tui.start(); tui.setFocus(input); } }
      write(tc.loginFlowFinished);
    } else if (name === "/logout") {
      loginAbort = new AbortController();
      try {
        const done = await confirmedLogout("Claude Code", (question, signal) => askShellQuestion(input, question, signal), loginAbort.signal,
          async () => { disconnected = true; accountConnected = false; accountChecked = true; accountUnknown = false; }, locale);
        if (done) {
          // The account goes too, so `/status` does not keep showing the email, organization and plan of the one just disconnected.
          session.reset(); session.models = []; session.model = undefined; session.effort = undefined; session.account = undefined; session.user = undefined;
          telemetry = emptyTelemetry(); sessions = [];
          write(tc.disconnectedLocally);
        } else write(tc.logoutCancelled);
      } finally { loginAbort = undefined; }
    } else if (name === "/new") {
      session.reset(); telemetry = emptyTelemetry(); transcript.clear();
    } else if (name === "/model") {
      if (!session.models.length && accountConnected && !disconnected) await loadCatalog();
      if (!argument) {
        if (!session.models.length) write(tc.catalogNotLoaded);
        else {
          const selected = await input.choose(t.commandSelectModel, session.models.map(model => ({
            value: model.value,
            display: model.displayName,
            label: model.description ?? "",
          })), session.model);
          if (selected) { session.model = selected; telemetry = { ...telemetry, model: undefined }; persistPreference(); }
        }
      }
      else {
        if (session.models.length && !session.models.some(model => model.value === argument || model.resolvedModel === argument)) throw new Error(tc.chooseModelFromCommand);
        session.model = argument; telemetry = { ...telemetry, model: undefined }; persistPreference(); write(tc.requestedModel({ model: argument }));
      }
    } else if (name === "/effort") {
      if (!session.models.length && accountConnected && !disconnected) await loadCatalog();
      if (!argument) {
        const model = session.models.find(model => model.value === session.model || model.resolvedModel === telemetry.model);
        const levels = model?.supportedEffortLevels;
        if (!levels?.length) write(tc.noReasoningOptions);
        else {
          // Claude Code does not report what level "default" actually resolves to ahead of time —
          // only Codex's SDK exposes that. Say so plainly instead of implying we know and hiding it.
          const selected = await input.choose(t.commandSelectReasoning, ["default", ...levels].map(value => ({
            value, display: value === "default" ? tc.defaultRecommended : effortLabel(value, locale),
            label: value === "default" ? tc.defaultResolvesLater : effortDescription(value, locale),
          })), session.effort ?? "default");
          if (selected) { session.effort = selected === "default" ? undefined : selected as EffortLevel; telemetry = { ...telemetry, effort: undefined }; persistPreference(); }
        }
      }
      else if (argument === "default") { session.effort = undefined; persistPreference(); }
      else if (["low", "medium", "high", "xhigh", "max"].includes(argument)) {
        const model = session.models.find(model => model.value === session.model || model.resolvedModel === telemetry.model);
        if (model?.supportedEffortLevels && !model.supportedEffortLevels.includes(argument as EffortLevel)) throw new Error(tc.effortNotSupported);
        session.effort = argument as EffortLevel; persistPreference();
      } else throw new Error(tc.invalidEffort);
    } else if (name === "/resume") {
      let chosen: string | undefined;
      if (!argument) {
        // Newest first; the same order gives the numbers `/resume <number>` has always used.
        sessions = sortRecentFirst(claudeResumeEntries(await listSessions({ dir: cwd }), cwd)).slice(0, 30);
        if (!sessions.length) write(tc.noClaudeSessionsFound);
        else chosen = await input.choose(t.commandChatHistory, sessions.map(item => resumeChoice(item, locale, process.env.HOME)), undefined, { searchable: true });
      } else {
        if (!/^\d+$/.test(argument) || !sessions[Number(argument) - 1]) throw new Error(tc.useResumeFirst);
        chosen = sessions[Number(argument) - 1]!.id;
      }
      if (chosen) {
        const messages = await getSessionMessages(chosen, { dir: cwd });
        session.resume(chosen); telemetry = emptyTelemetry(); transcript.clear();
        for (const entry of messages) {
          const message = entry.message as { content?: unknown };
          const content = message?.content;
          const text = typeof content === "string" ? content : Array.isArray(content) ? content.filter(block => block.type === "text").map(block => block.text).join("\n") : "";
          if (text) write(`${entry.type}: ${text}`);
        }
        write(t.historyRestored);
      }
    } else throw new Error(t.unknownCommand({ name: name ?? "" }));
    refresh();
  };
  sidebar.setRefreshAction(async () => {
    await session.initialize();
    telemetry.quotas = {};
    refresh();
    if (!session.usage.length) return tc.usageUnavailable;
  }, () => tui.requestRender());
  input.onSubmit = value => {
    if (closed || !value.trim()) return;
    input.setValue("");
    if (["/f614:yes", "/f614:no", "/f614:stop", "/exit", "/quit", "/f614:quit", "/status", "/help", "/f614:status", "/f614:help", "/f614:commands", "/f614:refresh"].includes(value.trim())) {
      void command(value).catch(error => writeError(t.errorPrefixed({ message: describeError(error, locale) }))).finally(refresh); return;
    }
    if (commandBusy) { writeError(t.waitForCurrentOperation); return; }
    if (value.startsWith("/")) {
      commandBusy = true;
      void command(value).catch(error => writeError(t.errorPrefixed({ message: describeError(error, locale) }))).finally(() => { commandBusy = false; refresh(); });
    } else if (disconnected) writeError(t.reconnectBeforeMessage);
    else if (session.busy) writeError(t.turnAlreadyRunning);
    else {
      chatLogo.dismiss();
      writeChat("user", value);
      telemetry = { ...emptyTelemetry(), quotas: telemetry.quotas };
      beginTurn();
      activeTurn = session.send(value, onEvent, approve)
        .catch(error => { writeError(t.turnStopped({ message: describeError(error, locale) })); })
        .finally(() => { streaming = undefined; endTurn(); refresh(); });
      refresh();
    }
  };
  tui.addInputListener(data => {
    if (matchesKey(data, "shift+tab")) {
      // Available at any moment — mid-turn or with a permission pending. Claude's live query takes the
      // new mode at once; the mode is saved so it comes back next time, and refresh() runs also on a refusal
      // so the hint shows the mode that stayed.
      void cycleWorkMode(session).then(result => {
        if (!result) return;
        saveEngineMode("claude", result.mode.id, { env: process.env });
        if (result.change === "next-turn") write(t.workModeNextTurn({ mode: result.mode.label }));
      }).catch(error => writeError(t.errorPrefixed({ message: describeError(error, locale) }))).finally(refresh);
      return { consume: true };
    }
    if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) {
      // Ctrl+C and Ctrl+D do what `/f614:quit` does: leave when idle, ask first while work is in progress.
      void quit().catch(error => writeError(t.errorPrefixed({ message: describeError(error, locale) })));
      return { consume: true };
    }
    return undefined;
  });
  const terminate = () => { void shutdown(); };
  let projectPending = false;
  const updateProject = async () => {
    if (projectPending || closed) return;
    projectPending = true;
    try { await sidebar.refreshProject(); if (!closed) refresh(); }
    finally { projectPending = false; }
  };
  const clock = setInterval(() => { void updateProject(); }, 15_000);
  void updateProject();
  process.once("SIGTERM", terminate);
  // While this screen is open no Node warning is written raw on it: the SDK's expected one is ignored, any other shows in the chat (see `takeNodeWarnings`).
  const giveBackNodeWarnings = takeNodeWarnings(writeNodeWarning);
  try {
    commandBusy = true;
    loginAbort = new AbortController();
    const startupAbort = loginAbort;
    refresh();
    tui.start();
    void claudeLoginState(executable, env, cwd, undefined, startupAbort.signal)
      .then(async connected => { if (!closed && !startupAbort.signal.aborted) { accountChecked = true; accountConnected = connected; disconnected = !connected; refresh(); if (connected) await loadCatalog(startupAbort.signal); } })
      .catch(() => { if (!closed) { accountUnknown = true; write(tc.couldNotVerifyAccount); } })
      .finally(() => { loginAbort = undefined; commandBusy = false; if (!closed) refresh(); });
    await exited;
  } finally {
    clearInterval(clock);
    process.removeListener("SIGTERM", terminate);
    tui.stop({ preserveScreen: true });
    giveBackNodeWarnings();
  }
}
