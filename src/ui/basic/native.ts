import { stripVTControlCharacters } from "node:util";
import { Container, HStack, ProcessTerminal, ScrollView, Text, VStack, matchesKey } from "@earendil-works/pi-tui";
import type { Terminal } from "@earendil-works/pi-tui";
import type { Approve, Emit, NativeEvent, NativeId, NativeSession, NativeSessionInfo } from "../../engines/types.ts";
import { createComposer } from "./composer.ts";
import { askPermission, askQuit, askShellQuestion } from "./permission-choice.ts";
import { resumeChoice, sortRecentFirst } from "./resume-picker.ts";
import { ShellState } from "./shell-state.ts";
import { ShellSidebar } from "./sidebar.ts";
import { loadEnginePreference, saveEngineCollaborationMode, saveEngineMode, saveEnginePreference } from "../../infrastructure/shell-preferences.ts";
import { attachInputHistory } from "../../infrastructure/input-history.ts";
import { gitBranches, gitCommits, gitCurrentBranch, gitDiff } from "../../infrastructure/git-local.ts";
import { copyToClipboard, saveNewFile } from "../../infrastructure/clipboard.ts";
import { openLink } from "../../infrastructure/browser.ts";
import { cycleWorkMode, restoreWorkMode } from "../../engines/work-mode.ts";
import { memorySourceLine } from "../../engines/memory-source.ts";
import type { WorkModeControl } from "../../engines/work-mode.ts";
import { ShellStatusBar } from "./status-bar.ts";
import { StatusPanels, attachStatusPanels } from "./status-panel.ts";
import type { EcosystemVersions } from "../../infrastructure/ecosystem-versions.ts";
import { ActivityCard, chatMessage } from "./transcript.ts";
import { effortDescription, effortLabel } from "./metrics.ts";
import { ChatText, danger, warning } from "./theme.ts";
import { ChatLinks, enableTerminalLinks, realChatLinkTools } from "./chat-links.ts";
import type { ChatLinkTools } from "./chat-links.ts";
import { nodeWarningRow, takeNodeWarnings } from "./node-warnings.ts";
import { ChatLogo } from "./logo.ts";
import { IndependentScrollView, attachJumpToLatest, chatScreen, workspaceLayout } from "./workspace.ts";
import { createSidebarLayout } from "./sidebar-layout.ts";
import { codexMenuCommands, findCodexCommand } from "../../engines/codex/commands.ts";
import { codexCommandHandlers, skillChoices } from "./codex-commands.ts";
import type { CodexLocalTools } from "./codex-commands.ts";
import { PLAN_IMPLEMENTATION_CLEAR_CONTEXT_PREFIX, PLAN_IMPLEMENTATION_CODING_MESSAGE } from "../../engines/codex/prompts.ts";
import { planContextUsage } from "../../engines/codex/transcript.ts";
import { workingStatus } from "./duration.ts";
import { detourHeader, detourStatus, detourTitle } from "./detour.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";
import { describeError } from "../../shell-error.ts";

const clean = (text: string) => stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");

/** The real local tools behind Codex's `/diff`, `/review`, `/copy`, `/export` and `/apps`: read-only git, the clipboard, a new file, the browser. */
const realLocalTools: CodexLocalTools = {
  gitDiff, gitBranches, gitCurrentBranch, gitCommits,
  copyText: text => copyToClipboard(text), saveNewFile, openLink: url => openLink(url),
};

export async function runNativeUI(
  id: NativeId, cwd: string, createSession: (emit: Emit, approve: Approve) => NativeSession,
  terminal: Terminal = new ProcessTerminal(),
  version?: string,
  locale: Locale = "en",
  local: CodexLocalTools = realLocalTools,
  linkTools: ChatLinkTools = realChatLinkTools,
  /** Reads the Engines and Engram versions the Forge614 panel shows: called once, in the background, when the screen opens (the composition root gives the real reader; without one the panel shows none). */
  readVersions?: () => Promise<EcosystemVersions>,
): Promise<void> {
  const t = getCatalog(locale).chat;
  const tc = getCatalog(locale).codexChat;
  // A click on a link or a path opens it; `writeWarning` is declared below and only runs when a click fails, long after it exists.
  enableTerminalLinks(process.env);
  const links = new ChatLinks({ cwd, home: process.env.HOME, tools: linkTools, onFailure: target => writeWarning(t.linkOpenFailed({ target })) });
  // The two panels the bottom bar opens: the MCP servers' and Forge614's (Shell's version, the two read once in the background, and whether Engram's memory reached this session).
  // The data is asked when a panel is drawn, so `shellState` and `session` need only exist by then.
  let versions: EcosystemVersions | undefined;
  const panels = new StatusPanels({
    mcp: () => shellState.snapshot().mcpServers,
    forge614: () => {
      const memoryInUse = session?.memoryInUse?.();
      return { ...(version ? { shell: version } : {}), ...versions, ...(memoryInUse === undefined ? {} : { memoryInUse }) };
    },
  }, locale);
  const { surface, tui } = chatScreen(terminal, links, panels, { locale });
  const composer = createComposer(tui, locale);
  const transcript = new Container();
  let transcriptScroll!: IndependentScrollView;
  const chatLogo = new ChatLogo(() => transcriptScroll.viewportRows, () => terminal.rows);
  transcript.addChild(chatLogo);
  transcriptScroll = new IndependentScrollView(transcript, { follow: "end", primary: true, scrollbar: "hidden" });
  const { input } = composer;
  // ↑/↓ bring back what the person sent, kept between runs for this project folder; `rememberInput` is called with each message or command sent (never with the answer to a question).
  const rememberInput = attachInputHistory(input, cwd, { env: process.env });
  const engineLabel = "Codex";
  // Codex has no `/login`: Shell's own `/f614:login` connects the account, and it is the command every «not connected» text names.
  const shellState = new ShellState(engineLabel, "/f614:login");
  const sidebar = new ShellSidebar(() => shellState.snapshot(), cwd, process.env.HOME, locale);
  // The sidebar's width and whether it is hidden come back from the preferences and are saved when the person lets go of the grip or clicks a button; the footer takes the sidebar's data while it is not drawn.
  const sidebarLayout = createSidebarLayout(surface, locale);
  links.pointerHeldElsewhere = () => sidebarLayout.holdsPointer();
  const statusBar = new ShellStatusBar(() => shellState.snapshot(), cwd, () => sidebar.projectInfo(), process.env.HOME, version, locale, () => sidebarLayout.isVisible(), panels);
  tui.setLayoutRoot(workspaceLayout(transcriptScroll, composer.component, sidebar, statusBar, surface, sidebarLayout));
  attachJumpToLatest(tui, transcriptScroll, locale, sidebarLayout);
  attachStatusPanels(tui, panels, { chatWidth: () => sidebarLayout.chatWidth() });
  tui.setFocus(input);
  // With Codex the menu is Codex's own list (names, descriptions and order as its terminal shows them on macOS);
  // what is Shell's own sits apart under FORGE614, every one of them with the `/f614:` prefix (a command without it is Codex's).
  // `/f614:stop` cancels the answer in progress (`/stop` is Codex's) and `/f614:quit` leaves Shell, asking first if work is running (`/quit` is Codex's).
  input.setCommandGroups([
    { title: engineLabel.toUpperCase(), items: codexMenuCommands() },
    { title: "FORGE614", items: [
      { value: "/f614:login", label: t.commandConnectAccount }, { value: "/f614:refresh", label: t.commandRefreshPlanUsage },
      { value: "/f614:commands", label: t.commandBrowseCommands }, { value: "/f614:stop", label: t.commandCancelActiveTurn },
      { value: "/f614:quit", label: t.commandExitShell },
    ] },
  ]);
  let closed = false; let ready = false; let commandBusy = false;
  let finish!: () => void;
  const exited = new Promise<void>(resolve => { finish = resolve; });
  const streaming = new Map<string, { component: ChatText; text: string }>();
  const approvals: { description: string; answer: (allow: boolean) => void }[] = [];
  let sessions: NativeSessionInfo[] = [];
  let session: NativeSession;
  const write = (text: string) => { const component = new ChatText(clean(text), undefined, links); transcript.addChild(component); tui.requestRender(); return component; };
  /** Red, so an error reads as an error at a glance instead of blending into a normal reply. */
  const writeError = (text: string) => { const component = new ChatText(clean(text), danger, links); transcript.addChild(component); tui.requestRender(); return component; };
  /** Yellow, for a line that says something did not work without being an error of the conversation (a click on a link that could not be opened). */
  const writeWarning = (text: string) => { const component = new ChatText(clean(text), warning, links); transcript.addChild(component); tui.requestRender(); return component; };
  /** A Node process warning, as a normal Shell notice: one muted row with the catalog's prefix (see `takeNodeWarnings`). */
  const writeNodeWarning = (message: string) => { transcript.addChild(nodeWarningRow(clean(t.nodeWarning({ message })))); tui.requestRender(); };
  /** `at` is the time of a message replayed from history (`null`: unknown, no time shown); a live message leaves it out and takes the time of now. */
  const writeChat = (role: "user" | "assistant" | "system", text: string, at?: number | null) => write(chatMessage(role, clean(text), locale, at));
  const writeActivity = (title: string, detail: string, expanded = false) => {
    const card = new ActivityCard(title, "", clean(detail), expanded, undefined, undefined, undefined, links);
    transcript.addChild(card); tui.requestRender();
    return card;
  };
  const writeEngineText = (text: string, at?: number | null) => {
    if (text.startsWith("You: ")) writeChat("user", text.slice(5), at);
    else if (text.startsWith("Tool:")) {
      const [title, ...detail] = text.slice(5).trim().split("\n");
      writeActivity(title || tc.toolFallbackTitle, detail.join("\n") || tc.toolFallbackDetail);
    } else writeChat("assistant", text, at);
  };
  const refresh = () => {
    if (!session || closed) return;
    const visual = session.visual?.();
    const mcpServers = session.mcpStatus?.();
    if (visual) {
      if (visual.account === "disconnected") shellState.disconnect();
      else shellState.connect({
        user: visual.user, sessionId: session.sessionId,
        ...(mcpServers ? { mcpServers } : {}),
        model: session.models.find(model => model.id === visual.model)?.name ?? visual.model,
        reasoning: effortLabel(visual.reasoning, locale), context: visual.context, usage: visual.usage,
        backgroundActivity: session.backgroundActivity?.() ?? [],
        backgroundActivitySupported: typeof session.backgroundActivity === "function",
      });
    } else {
      const status = session.status().join(" ");
      if (/disconnected|login required|sign-in required|not logged in|not checked|could not be verified/i.test(status)) shellState.disconnect();
      else shellState.connect({
        ...(mcpServers ? { mcpServers } : {}),
        backgroundActivity: session.backgroundActivity?.() ?? [],
        backgroundActivitySupported: typeof session.backgroundActivity === "function",
      });
    }
    sidebar.invalidate();
    const elapsed = turnStartedAt !== undefined ? (Date.now() - turnStartedAt) / 1000 : 0;
    // A conversation apart from the main one (a side conversation, a watched subagent) is always named in the box: where the person is and how to leave.
    const detour = session.detour?.();
    // `/compact` shows Codex's own words for it (title, detail, time) from the moment it is typed; Codex reports no real progress, so there is no bar. `/recap` does the same with its own title.
    const working = commandLabel ? workingStatus(commandLabel.title, commandLabel.detail, elapsed)
      : compacting ? workingStatus(tc.compactingTitle, tc.compactingDetail, elapsed)
      : turnStartedAt !== undefined ? workingStatus(t.statusWorking, detour ? detourTitle(detour, locale) : session.currentActivity?.(), elapsed) : t.statusWorking;
    const idle = detour ? detourStatus(detour, locale) : shellState.snapshot().account === "connected" ? t.statusReady : t.statusConnectWithLogin({ command: "/f614:login" });
    input.setStatus(session.busy || commandBusy ? working : idle);
    const collaborationModes = session.collaborationModes?.() ?? [];
    input.setWorkModeHint(session.workModes?.().find(mode => mode.id === session.workMode?.()), collaborationModes.length ? { modes: collaborationModes, active: session.collaborationMode?.() } : undefined);
    statusBar.invalidate();
    tui.requestRender();
  };
  // See claude.ts for why this ticker exists: without it the status line only moves when an SDK
  // event happens to arrive, which can go quiet during tool execution and reads as "it froze".
  let turnStartedAt: number | undefined;
  /** Whether `/compact` is running, so the status line names it instead of the generic «Working». */
  let compacting = false;
  /** What a command that waits (`/recap`) shows on the status line instead of the generic «Working», until it ends. */
  let commandLabel: { title: string; detail?: string } | undefined;
  let turnTicker: ReturnType<typeof setInterval> | undefined;
  const beginTurn = () => {
    turnStartedAt = Date.now();
    clearInterval(turnTicker);
    turnTicker = setInterval(refresh, 500);
    turnTicker.unref?.();
  };
  const endTurn = () => {
    turnStartedAt = undefined;
    clearInterval(turnTicker);
    turnTicker = undefined;
  };
  /** A plan Codex proposed in the turn that just ended in Plan mode, waiting for «Implement this plan?». */
  let pendingPlan: string | undefined;
  /**
   * The main conversation's view, kept aside while the screen shows another one (a side conversation or a watched subagent): what was on screen and the answers still being
   * written. It comes back untouched when the person returns; whatever the main conversation said meanwhile is told after it, in order.
   */
  let mainView: { children: typeof transcript.children; streaming: typeof streaming } | undefined;
  const enterDetour = () => {
    const detour = session.detour?.();
    if (!detour) return;
    mainView = { children: [...transcript.children], streaming: new Map(streaming) };
    transcript.clear(); streaming.clear();
    write(detourHeader(detour, locale));
  };
  const leaveDetourView = () => {
    if (!mainView) return;
    transcript.clear();
    for (const child of mainView.children) transcript.addChild(child);
    streaming.clear();
    for (const [key, entry] of mainView.streaming) streaming.set(key, entry);
    mainView = undefined;
    tui.requestRender();
  };
  const emit = (event: NativeEvent) => {
    if (closed) return;
    if (event.type === "detourStart") { enterDetour(); refresh(); return; }
    if (event.type === "detourEnd") { leaveDetourView(); refresh(); return; }
    if (event.type === "planReady") { pendingPlan = event.text; return; }
    if (event.type === "reset") { transcript.clear(); streaming.clear(); }
    else if (event.type === "text") writeEngineText(event.text, event.at);
    else if (event.type === "delta") {
      const key = event.id ?? "message";
      let entry = streaming.get(key);
      if (!entry) { entry = { component: writeChat("assistant", ""), text: "" }; streaming.set(key, entry); }
      entry.text += event.text; entry.component.setText(chatMessage("assistant", clean(entry.text), locale));
    }
    refresh();
  };
  const showApproval = () => {
    const item = approvals[0];
    if (!item) return;
    transcript.addChild(new ActivityCard(t.permissionRequestedTitle, "", clean(item.description), true, undefined, undefined, undefined, links));
    tui.requestRender();
    void askPermission(input, locale).then(allowed => item.answer(allowed));
  };
  const approve: Approve = (description, signal) => new Promise(resolve => {
    if (closed || signal.aborted) { resolve(false); return; }
    const item = {
      description,
      answer: (allow: boolean) => {
        const index = approvals.indexOf(item); if (index < 0) return;
        approvals.splice(index, 1); signal.removeEventListener("abort", abort);
        if (index === 0) input.cancelChoice();
        resolve(allow && !signal.aborted);
        if (index === 0 && approvals[0]) showApproval();
      },
    };
    const abort = () => item.answer(false);
    approvals.push(item); signal.addEventListener("abort", abort, { once: true });
    if (approvals.length === 1) showApproval();
  });
  const shutdown = () => {
    if (closed) return;
    closed = true;
    input.cancelChoice();
    for (const approval of [...approvals]) approval.answer(false);
    endTurn();
    session.close(); tui.stop({ preserveScreen: true }); finish();
  };
  // Remembers the person's own /model and /effort picks across Shell restarts — see claude.ts for
  // why this lives in Shell's own preferences file rather than the native CLI's config.
  const persistPreference = () => {
    if (id !== "codex") return;
    const visual = session.visual?.();
    saveEnginePreference("codex", { model: visual?.model, effort: visual?.reasoning }, { env: process.env });
  };
  /** The session seen only as far as work modes go, so the shared cycle/restore steps know nothing about Codex. */
  const workModeControl = (): WorkModeControl | undefined => session.workModes && session.setWorkMode
    ? { workModes: () => session.workModes!(), workMode: () => session.workMode?.(), setWorkMode: modeId => session.setWorkMode!(modeId) }
    : undefined;
  /** The collaboration modes seen through the same shape, so Shift+Tab reuses the shared cycle step (Codex's `next_mask`: the next one in the list's order). */
  const collaborationControl = (): WorkModeControl | undefined => session.collaborationModes && session.setCollaborationMode
    ? { workModes: () => session.collaborationModes!(), workMode: () => session.collaborationMode?.(), setWorkMode: modeId => session.setCollaborationMode!(modeId) }
    : undefined;
  /** Sends a message of the person (typed, or sent for them by `/init` and `/plan text`) and, when the turn ends with a plan, offers to implement it. */
  const sendMessage = (value: string) => {
    chatLogo.dismiss();
    streaming.clear(); writeChat("user", value);
    beginTurn();
    void session.send(value).catch(error => { if (!closed) writeError(t.turnStopped({ message: describeError(error, locale) })); })
      .finally(() => { endTurn(); refresh(); offerPlan(); });
    refresh();
  };
  /**
   * «Implement this plan?» after a turn that ended in Plan with a plan, with Codex's three options and words
   * (`chatwidget/plan_implementation.rs`): implement in Default («Implement the plan.»), start a fresh thread with
   * the plan, or stay in Plan. Without a Default mode the first two only say why they cannot run.
   */
  const offerPlan = () => {
    const plan = pendingPlan; pendingPlan = undefined;
    if (!plan || closed) return;
    const nt = getCatalog(locale).codexNative;
    const hasDefault = Boolean(session.collaborationModes?.().some(mode => mode.id === "default"));
    const usage = planContextUsage(session.visual?.()?.context);
    void input.choose(nt.planTitle, [
      { value: "implement", display: nt.planYes, label: hasDefault ? nt.planYesDescription : nt.planDefaultUnavailable },
      { value: "clear", display: nt.planClear, label: hasDefault ? (usage ? nt.planClearUsage({ label: usage }) : nt.planClearFresh) : nt.planDefaultUnavailable },
      { value: "stay", display: nt.planNo, label: nt.planNoDescription },
    ]).then(async choice => {
      if (choice !== "implement" && choice !== "clear") return;
      if (!hasDefault) { write(nt.planDefaultUnavailable); return; }
      await session.setCollaborationMode?.("default");
      saveEngineCollaborationMode("codex", "default", { env: process.env });
      if (choice === "clear") {
        await session.clearThread?.();
        transcript.clear(); streaming.clear();
        sendMessage(`${PLAN_IMPLEMENTATION_CLEAR_CONTEXT_PREFIX}\n\n${plan}`);
      } else sendMessage(PLAN_IMPLEMENTATION_CODING_MESSAGE);
    }).catch(error => writeError(t.errorPrefixed({ message: describeError(error, locale) })));
  };
  /** `/model`: Codex lets it run while it works (`available_during_task`); a change made then applies from the next turn, and Shell says so. */
  const chooseModel = async (argument: string) => {
    const applies = () => { if (session.busy) write(t.workModeNextTurn({ mode: session.visual?.()?.model ?? argument })); };
    if (argument) { await session.setModel(argument); persistPreference(); write(tc.selectedModel({ model: argument })); applies(); return; }
    if (!session.models.length) { write(tc.useLoginForCatalog); return; }
    const selected = await input.choose(t.commandSelectModel, session.models.map(model => ({ value: model.id, display: model.name, label: "" })), session.visual?.().model);
    if (!selected) return;
    await session.setModel(selected);
    persistPreference();
    const model = session.models.find(item => item.id === selected);
    if (id === "codex" && model?.efforts?.length) {
      const effort = await input.choose(t.commandSelectReasoning, model.efforts.map(value => ({
        value, display: effortLabel(value, locale), label: effortDescription(value, locale),
      })), model.defaultEffort);
      if (effort) { await session.setEffort(effort); persistPreference(); }
    }
    applies();
  };
  /** `/resume`: also allowed while Codex works (`available_during_task`); the view moves to the chosen conversation. */
  const chooseSession = async (argument: string) => {
    if (!argument) {
      // Newest first; the same order gives the numbers `/resume <number>` has always used.
      sessions = sortRecentFirst(await session.listSessions());
      if (!sessions.length) { write(tc.noSessionsFound); return; }
      const picked = await input.choose(t.commandChatHistory, sessions.map(item => resumeChoice(item, locale, process.env.HOME)), undefined, { searchable: true });
      if (picked) { await session.resume(picked); write(session.resumeNotice ?? t.historyRestored); }
      return;
    }
    const selected = /^\d+$/.test(argument) ? sessions[Number(argument) - 1]?.id : argument;
    if (!selected) throw new Error(tc.chooseSessionOrId);
    await session.resume(selected);
    write(session.resumeNotice ?? t.historyRestored);
  };
  /** Whether the «Quit anyway?» question is on screen, so a second Ctrl+C does not open it again. */
  let quitAsking = false;
  /**
   * Leaves Shell — `/f614:quit`, Ctrl+C and Ctrl+D. Idle it leaves at once; while a turn, a login or a command runs it asks «Quit anyway?»
   * with «No» marked (stopping work cannot be undone) and only «Yes» stops it and leaves. With a permission question open it asks
   * to answer that first, so the question is never cancelled (and the permission denied) by accident.
   */
  const quit = async () => {
    // The main conversation counts even when a side conversation is on screen: leaving would stop its work too.
    if (!(session.busy || commandBusy || session.mainBusy?.())) { shutdown(); return; }
    if (approvals.length) { write(t.answerPendingPermissionFirst); return; }
    if (quitAsking) return;
    quitAsking = true;
    try { if (await askQuit(input, locale)) shutdown(); } finally { quitAsking = false; }
  };
  /** Codex's own `/quit` and `/exit` (the same command, «exit Codex»): they leave when idle and refuse while work or a login is in progress, saying that `/f614:quit` leaves. */
  const quitLikeCodex = () => {
    if (session.busy || commandBusy) writeError(tc.workOrLoginActive);
    else shutdown();
  };
  const command = async (value: string) => {
    const [name, ...parts] = value.trim().split(/\s+/); const argument = parts.join(" ");
    const official = findCodexCommand((name ?? "").slice(1));
    // With a side conversation on screen only the commands Codex keeps there work (`available_in_side_conversation`); the others answer honestly, and Ctrl+C returns to the main thread.
    // A watched subagent follows the same rule, and `/subagents` is how the person goes back or to another one. Shell's own `/f614:` commands are not Codex's and are never held back.
    const detour = session.detour?.();
    if (detour && official && !official.availableInSideConversation && !(detour.kind === "agent" && official.name === "subagents")) {
      const nt = getCatalog(locale).codexNative;
      writeError(detour.kind === "side" ? nt.sideUnavailableCommand({ name: `/${official.name}` }) : nt.agentUnavailableCommand({ name: `/${official.name}` }));
      return;
    }
    // Every command of Shell's own starts with `/f614:`; without it a name is Codex's (or unknown), never a silent alias of Shell's.
    if (name === "/f614:refresh") { await sidebar.refreshUsage(); return; }
    if (name === "/quit" || name === "/exit") { quitLikeCodex(); return; }
    if (name === "/f614:quit") { await quit(); return; }
    if (name === "/f614:yes" || name === "/f614:no") {
      if (!approvals[0]) throw new Error(t.noPermissionPending);
      approvals[0].answer(name === "/f614:yes"); return;
    }
    // Shell's own «cancel the answer in progress». Plain `/stop` is Codex's «stop all background terminals».
    // When Codex did not confirm, the session already told the person (once) that Shell ended the turn on its side: «requested» would be untrue.
    if (name === "/f614:stop") { const outcome = await session.cancel(); if (!outcome || outcome === "requested") write(tc.cancellationRequested); return; }
    if (name === "/f614:help" || name === "/f614:commands") {
      if (approvals.length) { write(t.answerPendingPermissionFirst); return; }
      const selected = await input.chooseCommand();
      if (selected) input.onSubmit?.(selected);
      return;
    }
    // Codex's own `/status`: the account, model, quotas, folder, work mode and conversation, as Codex reports them.
    if (name === "/status") {
      const memory = session.memoryDeliveredByAssistant ? [memorySourceLine(await session.memoryDeliveredByAssistant(), locale)] : [];
      write([...session.status(), ...memory].join("\n")); return;
    }
    // Codex's own commands that Shell has connected: Codex says which of them may run while it works.
    // A command of Codex's own screen (keyboard, window, desktop, debug) has no app-server method: say exactly that.
    if (official?.screenOnly) { write(getCatalog(locale).codexCommands.screenOnly({ name: name ?? "" })); return; }
    if (name === "/model" || name === "/resume") {
      if (!ready) throw new Error(tc.waitForEngine);
      await (name === "/model" ? chooseModel(argument) : chooseSession(argument));
      refresh();
      return;
    }
    const handler = official ? handlers[official.name] : undefined;
    if (official && handler) {
      if (!ready) throw new Error(tc.waitForEngine);
      if (official.availableDuringTask) { await handler(argument); return; }
      if (commandBusy || session.busy) throw new Error(tc.waitForEngine);
      commandBusy = true;
      try { await handler(argument); } finally { commandBusy = false; refresh(); }
      return;
    }
    if (!ready || commandBusy || session.busy) throw new Error(tc.waitForEngine);
    commandBusy = true;
    try {
      // Codex has no `/login`: connecting the account is Shell's own `/f614:login`. `/logout` is Codex's.
      // There is no `/effort` either: with Codex the reasoning effort is chosen inside `/model`.
      if (name === "/f614:login") await session.login();
      else if (name === "/logout") {
        if (!session.logout) throw new Error(tc.logoutUnavailable);
        await session.logout((question, signal) => askShellQuestion(input, question, signal));
      }
      else if (name === "/compact") {
        if (!session.compact) write(tc.commandNotAllowed({ name }));
        else {
          compacting = true; beginTurn(); refresh();
          try { await session.compact(); write(tc.compacted); }
          finally { compacting = false; endTurn(); }
        }
      } else if (name === "/new") { session.reset(); transcript.clear(); streaming.clear(); }
      // A command on Codex's list that Shell has not connected yet: say so honestly, not «unknown». A name that is not Codex's at all is unknown.
      else if (official) write(tc.commandNotAllowed({ name: name ?? "" }));
      else throw new Error(t.unknownCommand({ name: name ?? "" }));
    } finally { commandBusy = false; refresh(); }
  };
  session = createSession(emit, approve);
  const handlers = codexCommandHandlers({
    session, cwd, locale, local,
    write: text => { write(text); },
    clearView: () => { transcript.clear(); streaming.clear(); },
    confirm: (title, no, yes, body) => askShellQuestion(input, { title, no, yes, ...(body ? { body } : {}) }),
    ask: (title, placeholder, body) => input.ask(title, placeholder, body ? { body } : {}),
    choose: (title, items, current, options) => input.choose(title, items, current, options),
    setSkillChoices: skills => input.setSkillChoices(skills),
    submit: text => sendMessage(text),
    dismissLogo: () => chatLogo.dismiss(),
    setComposerText: text => input.setValue(text),
    rememberWorkMode: modeId => saveEngineMode("codex", modeId, { env: process.env }),
    rememberCollaborationMode: modeId => saveEngineCollaborationMode("codex", modeId, { env: process.env }),
    refresh: () => refresh(),
    working: (title, detail) => {
      commandLabel = { title, ...(detail ? { detail } : {}) }; beginTurn(); refresh();
      return () => { commandLabel = undefined; endTurn(); refresh(); };
    },
  });
  // `@` searches the folder's files with Codex's own search, when the session has one.
  input.setFileSearch(session.searchFiles ? query => session.searchFiles!(query) : undefined);
  /** Fills the `$` autocomplete from Codex's own catalog (`skills/list`); if Codex cannot list them the autocomplete stays empty and typed `$name` still works as text. */
  const loadSkillChoices = () => { void session.skills?.().then(skills => input.setSkillChoices(skillChoices(skills))).catch(() => {}); };
  sidebar.setRefreshAction(async () => {
    if (!session.refreshUsage) return tc.refreshNotAvailable;
    await session.refreshUsage(); refresh();
  }, () => tui.requestRender());
  input.onSubmit = value => {
    if (closed || !value.trim()) return;
    input.setValue("");
    rememberInput(value);
    if (value.startsWith("/")) void command(value).catch(error => writeError(t.errorPrefixed({ message: describeError(error, locale) })));
    // A subagent being watched takes no messages: say so before anything is written or sent.
    else if (session.detour?.()?.readOnly) writeError(getCatalog(locale).errors["codex-agent-read-only"]({}));
    else if (!ready || commandBusy || session.busy) writeError(tc.waitForCurrentOperationToFinish);
    else sendMessage(value);
  };
  /**
   * Shift+Tab: available at any moment — mid-turn, during a command or with a permission pending. With Codex it
   * is Codex's own Shift+Tab (`chatwidget/interaction.rs`): it switches the collaboration mode (Default ↔ Plan, in
   * the order `collaborationMode/list` gives) and never the permissions, which `/permissions` changes; if Codex
   * lists no collaboration modes it does nothing, like Codex. A session with no collaboration modes at all keeps
   * cycling its work modes. The choice is saved and, when it can only apply from the next turn, Shell says so.
   */
  const changeWorkMode = async () => {
    const collaboration = collaborationControl();
    const control = collaboration ?? workModeControl();
    const result = control ? await cycleWorkMode(control) : undefined;
    if (!result) return;
    if (collaboration) saveEngineCollaborationMode("codex", result.mode.id, { env: process.env });
    else {
      const modeId = session.workMode?.();
      if (modeId) saveEngineMode("codex", modeId, { env: process.env });
    }
    if (result.change === "next-turn") write(t.workModeNextTurn({ mode: result.mode.label }));
    refresh();
  };
  tui.addInputListener(data => {
    if (matchesKey(data, "shift+tab")) { void changeWorkMode().catch(error => writeError(t.errorPrefixed({ message: describeError(error, locale) }))); return { consume: true }; }
    // With a side conversation or a watched subagent on screen, Ctrl+C returns to the main thread (as in Codex): the side conversation is discarded, the subagent is left running.
    if (matchesKey(data, "ctrl+c") && session.detour?.()) { void session.leaveDetour?.().catch(() => {}); return { consume: true }; }
    // Ctrl+C and Ctrl+D do what `/f614:quit` does: leave when idle, ask first while work is in progress.
    if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) { void quit().catch(error => writeError(t.errorPrefixed({ message: describeError(error, locale) }))); return { consume: true }; }
    return undefined;
  });
  process.once("SIGTERM", shutdown);
  let projectPending = false;
  const updateProject = async () => {
    if (projectPending || closed) return;
    projectPending = true;
    try { await sidebar.refreshProject(); if (!closed) refresh(); }
    finally { projectPending = false; }
  };
  const clock = setInterval(() => { void updateProject(); }, 15_000);
  void updateProject();
  // Engines' and Engram's versions are read once, in the background: the screen does not wait for them, and a failed reading leaves the panel without them.
  if (readVersions) void readVersions().then(read => { versions = read; if (!closed) refresh(); }).catch(() => {});
  // While this screen is open no Node warning is written raw on it: the SDK's expected one is ignored, any other shows in the chat (see `takeNodeWarnings`).
  const giveBackNodeWarnings = takeNodeWarnings(writeNodeWarning);
  try {
    refresh(); tui.start();
    void session.initialize().then(async () => {
      if (id === "codex") {
        const saved = loadEnginePreference("codex", { env: process.env });
        const model = saved?.model && session.models.some(item => item.id === saved.model) ? saved.model : undefined;
        if (model) {
          try {
            await session.setModel(model);
            if (saved?.effort) await session.setEffort(saved.effort);
          } catch { /* stale preference from an older catalog — ignore, keep the engine's own default */ }
        }
        // The last work mode comes back without asking. One Codex no longer offers (Read Only on macOS) comes back as
        // «Ask for approval», said once: the replacement is saved, so the next opening restores it silently.
        const control = workModeControl();
        if (control && !await restoreWorkMode(control, saved?.mode) && saved?.mode) {
          const fallback = session.fallbackWorkMode?.();
          if (fallback && await restoreWorkMode(control, fallback)) {
            saveEngineMode("codex", fallback, { env: process.env });
            write(getCatalog(locale).codexCommands.retiredModeReplaced({ mode: control.workModes().find(mode => mode.id === fallback)?.label ?? fallback }));
          }
        }
        // The collaboration mode (Plan / Default) comes back too; one Codex no longer lists leaves Default.
        const collaboration = collaborationControl();
        if (collaboration) await restoreWorkMode(collaboration, saved?.collaborationMode);
      }
      ready = true; refresh(); loadSkillChoices();
      // The conversation opens in the background first (Codex only starts its MCP servers then), and the MCP servers' states for the bottom bar are read once right after, with its id; after that only the assistant's own
      // notices change them (never after each message). When it cannot be opened the list is asked the same, without a conversation.
      void (async () => { await session.openConversation?.(); await session.loadMcpStatus?.(); })();
    }).catch(error => writeError(tc.connectionFailed({ message: describeError(error, locale) })));
    await exited;
  } finally { clearInterval(clock); process.removeListener("SIGTERM", shutdown); session.close(); tui.stop({ preserveScreen: true }); giveBackNodeWarnings(); }
}
