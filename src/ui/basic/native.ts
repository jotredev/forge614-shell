import { stripVTControlCharacters } from "node:util";
import { Container, HStack, ProcessTerminal, ScrollView, Text, TuiAltScreen, VStack, matchesKey } from "@earendil-works/pi-tui";
import type { Terminal } from "@earendil-works/pi-tui";
import type { Approve, Emit, NativeEvent, NativeId, NativeSession, NativeSessionInfo } from "../../engines/types.ts";
import { createComposer } from "./composer.ts";
import { resumeChoice, sortRecentFirst } from "./resume-picker.ts";
import { ShellState } from "./shell-state.ts";
import { ShellSidebar } from "./sidebar.ts";
import { readRuntimeResources } from "../../infrastructure/runtime-resources.ts";
import { loadEnginePreference, saveEngineCollaborationMode, saveEngineMode, saveEnginePreference } from "../../infrastructure/shell-preferences.ts";
import { gitBranches, gitCommits, gitCurrentBranch, gitDiff } from "../../infrastructure/git-local.ts";
import { copyToClipboard, saveNewFile } from "../../infrastructure/clipboard.ts";
import { openLink } from "../../infrastructure/browser.ts";
import { cycleWorkMode, restoreWorkMode } from "../../engines/work-mode.ts";
import type { WorkModeControl } from "../../engines/work-mode.ts";
import { ShellStatusBar } from "./status-bar.ts";
import { ActivityCard, chatMessage } from "./transcript.ts";
import { effortDescription, effortLabel } from "./metrics.ts";
import { ChatText, danger } from "./theme.ts";
import { IndependentScrollView, attachJumpToLatest, workspaceLayout, workspaceTerminal } from "./workspace.ts";
import { codexMenuCommands, findCodexCommand } from "../../engines/codex/commands.ts";
import { codexCommandHandlers, skillChoices } from "./codex-commands.ts";
import type { CodexLocalTools } from "./codex-commands.ts";
import { PLAN_IMPLEMENTATION_CLEAR_CONTEXT_PREFIX, PLAN_IMPLEMENTATION_CODING_MESSAGE } from "../../engines/codex/prompts.ts";
import { planContextUsage } from "../../engines/codex/transcript.ts";
import { workingStatus } from "./duration.ts";
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
): Promise<void> {
  const t = getCatalog(locale).chat;
  const tc = getCatalog(locale).codexChat;
  const surface = workspaceTerminal(terminal);
  const tui = new TuiAltScreen(surface, true, undefined, { mouse: true });
  const transcript = new Container();
  const transcriptScroll = new IndependentScrollView(transcript, { follow: "end", primary: true, scrollbar: "hidden" });
  const composer = createComposer(tui, locale);
  const { input } = composer;
  const engineLabel = "Codex";
  const shellState = new ShellState(engineLabel);
  const sidebar = new ShellSidebar(() => shellState.snapshot(), cwd, process.env.HOME, locale);
  const statusBar = new ShellStatusBar(() => shellState.snapshot(), cwd, () => sidebar.projectInfo(), process.env.HOME, version, locale);
  tui.setLayoutRoot(workspaceLayout(transcriptScroll, composer.component, sidebar, statusBar, surface, cwd));
  attachJumpToLatest(tui, transcriptScroll, locale);
  tui.setFocus(input);
  // With Codex the menu is Codex's own list (names, descriptions and order as its terminal shows them on macOS);
  // what is Shell's own sits apart under FORGE614. `/f614:stop` cancels the answer in progress: `/stop` is Codex's.
  input.setCommandGroups([
    { title: engineLabel.toUpperCase(), items: codexMenuCommands() },
    { title: "FORGE614", items: [
      { value: "/login", label: t.commandConnectAccount }, { value: "/refresh", label: t.commandRefreshPlanUsage },
      { value: "/commands", label: t.commandBrowseCommands }, { value: "/f614:stop", label: t.commandCancelActiveTurn },
    ] },
  ]);
  let closed = false; let ready = false; let commandBusy = false;
  let finish!: () => void;
  const exited = new Promise<void>(resolve => { finish = resolve; });
  const streaming = new Map<string, { component: ChatText; text: string }>();
  const approvals: { description: string; answer: (allow: boolean) => void }[] = [];
  let sessions: NativeSessionInfo[] = [];
  let session: NativeSession;
  const write = (text: string) => { const component = new ChatText(clean(text)); transcript.addChild(component); tui.requestRender(); return component; };
  /** Red, so an error reads as an error at a glance instead of blending into a normal reply. */
  const writeError = (text: string) => { const component = new ChatText(clean(text), danger); transcript.addChild(component); tui.requestRender(); return component; };
  const writeChat = (role: "user" | "assistant" | "system", text: string) => write(chatMessage(role, clean(text), locale));
  const writeActivity = (title: string, detail: string, expanded = false) => {
    const card = new ActivityCard(title, "", clean(detail), expanded);
    transcript.addChild(card); tui.requestRender();
    return card;
  };
  const writeEngineText = (text: string) => {
    if (text.startsWith("You: ")) writeChat("user", text.slice(5));
    else if (text.startsWith("Tool:")) {
      const [title, ...detail] = text.slice(5).trim().split("\n");
      writeActivity(title || tc.toolFallbackTitle, detail.join("\n") || tc.toolFallbackDetail);
    } else writeChat("assistant", text);
  };
  const refresh = () => {
    if (!session || closed) return;
    const visual = session.visual?.();
    if (visual) {
      if (visual.account === "disconnected") shellState.disconnect();
      else shellState.connect({
        user: visual.user, sessionId: session.sessionId,
        model: session.models.find(model => model.id === visual.model)?.name ?? visual.model,
        reasoning: effortLabel(visual.reasoning, locale), context: visual.context, usage: visual.usage, resources: readRuntimeResources(),
        backgroundActivity: session.backgroundActivity?.() ?? [],
        backgroundActivitySupported: typeof session.backgroundActivity === "function",
      });
    } else {
      const status = session.status().join(" ");
      if (/disconnected|login required|sign-in required|not logged in|not checked|could not be verified/i.test(status)) shellState.disconnect();
      else shellState.connect({
        resources: readRuntimeResources(),
        backgroundActivity: session.backgroundActivity?.() ?? [],
        backgroundActivitySupported: typeof session.backgroundActivity === "function",
      });
    }
    sidebar.invalidate();
    const working = turnStartedAt !== undefined ? workingStatus(t.statusWorking, session.currentActivity?.(), (Date.now() - turnStartedAt) / 1000) : t.statusWorking;
    input.setStatus(session.busy || commandBusy ? working : shellState.snapshot().account === "connected" ? t.statusReady : t.statusConnectWithLogin);
    const collaborationModes = session.collaborationModes?.() ?? [];
    input.setWorkModeHint(session.workModes?.().find(mode => mode.id === session.workMode?.()), collaborationModes.length ? { modes: collaborationModes, active: session.collaborationMode?.() } : undefined);
    statusBar.invalidate();
    tui.requestRender();
  };
  // See claude.ts for why this ticker exists: without it the status line only moves when an SDK
  // event happens to arrive, which can go quiet during tool execution and reads as "it froze".
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
    clearInterval(turnTicker);
    turnTicker = undefined;
  };
  /** A plan Codex proposed in the turn that just ended in Plan mode, waiting for «Implement this plan?». */
  let pendingPlan: string | undefined;
  const emit = (event: NativeEvent) => {
    if (closed) return;
    if (event.type === "planReady") { pendingPlan = event.text; return; }
    if (event.type === "reset") { transcript.clear(); streaming.clear(); }
    else if (event.type === "text") writeEngineText(event.text);
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
    write(item.description);
    input.setStatus(t.awaitingPermission);
    void input.choose(t.permissionFooter, [
      { value: "/no", label: t.denyLabel }, { value: "/yes", label: t.allowOnceLabel },
    ]).then(value => item.answer(value === "/yes"));
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
  const command = async (value: string) => {
    if (value.trim() === "/refresh") { await sidebar.refreshUsage(); return; }
    const [name, ...parts] = value.trim().split(/\s+/); const argument = parts.join(" ");
    // In Codex `/exit` and `/quit` are the same command («exit Codex»): `/exit` and `/exit!` do what `/quit` and `/quit!` do.
    if (name === "/quit" || name === "/quit!" || name === "/exit" || name === "/exit!") {
      if ((session.busy || commandBusy) && !name.endsWith("!")) writeError(tc.workOrLoginActive);
      else shutdown();
      return;
    }
    if (name === "/yes" || name === "/no") {
      if (!approvals[0]) throw new Error(t.noPermissionPending);
      approvals[0].answer(name === "/yes"); return;
    }
    // Shell's own «cancel the answer in progress». Plain `/stop` is Codex's «stop all background terminals».
    if (name === "/f614:stop") { await session.cancel(); write(tc.cancellationRequested); return; }
    if (name === "/help" || name === "/commands") {
      if (approvals.length) { write(t.answerPendingPermissionFirst); return; }
      const selected = await input.chooseCommand();
      if (selected) input.onSubmit?.(selected);
      return;
    }
    if (name === "/status") { write(session.status().join("\n")); return; }
    // Codex's own commands that Shell has connected: Codex says which of them may run while it works.
    const official = findCodexCommand((name ?? "").slice(1));
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
      if (name === "/login") await session.login();
      else if (name === "/logout") {
        if (!session.logout) throw new Error(tc.logoutUnavailable);
        await session.logout();
      }
      else if (name === "/effort" || name === "/thinking") {
        if (argument) { await session.setEffort(argument); persistPreference(); }
        else {
          const visual = session.visual?.();
          const levels = session.models.find(model => model.id === visual?.model)?.efforts;
          if (levels?.length) {
            const selected = await input.choose(t.commandSelectReasoning, levels.map(value => ({
              value, display: effortLabel(value, locale), label: effortDescription(value, locale),
            })), visual?.reasoning);
            if (selected) { await session.setEffort(selected); persistPreference(); }
          } else write(tc.noReasoningOptionsForModel);
        }
      } else if (name === "/compact") {
        if (!session.compact) write(tc.commandNotAllowed({ name }));
        else { await session.compact(); write(tc.compacted); }
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
    confirm: async (title, no, yes) => await input.choose(title, [{ value: "no", display: no, label: "" }, { value: "yes", display: yes, label: "" }]) === "yes",
    choose: (title, items, current, options) => input.choose(title, items, current, options),
    setSkillChoices: skills => input.setSkillChoices(skills),
    submit: text => sendMessage(text),
    setComposerText: text => input.setValue(text),
    rememberWorkMode: modeId => saveEngineMode("codex", modeId, { env: process.env }),
    rememberCollaborationMode: modeId => saveEngineCollaborationMode("codex", modeId, { env: process.env }),
    refresh: () => refresh(),
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
    if (value.startsWith("/")) void command(value).catch(error => writeError(t.errorPrefixed({ message: describeError(error, locale) })));
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
    if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) { void command("/quit"); return { consume: true }; }
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
    }).catch(error => writeError(tc.connectionFailed({ message: describeError(error, locale) })));
    await exited;
  } finally { clearInterval(clock); process.removeListener("SIGTERM", shutdown); session.close(); tui.stop({ preserveScreen: true }); }
}
