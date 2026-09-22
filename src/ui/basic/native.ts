import { stripVTControlCharacters } from "node:util";
import { Container, HStack, ProcessTerminal, ScrollView, Text, TuiAltScreen, VStack, matchesKey } from "@earendil-works/pi-tui";
import type { Terminal } from "@earendil-works/pi-tui";
import type { Approve, Emit, NativeEvent, NativeId, NativeSession } from "../../engines/types.ts";
import { createComposer } from "./composer.ts";
import { ShellState } from "./shell-state.ts";
import { ShellSidebar } from "./sidebar.ts";
import { readRuntimeResources } from "../../infrastructure/runtime-resources.ts";
import { loadEnginePreference, saveEnginePreference } from "../../infrastructure/shell-preferences.ts";
import { ShellStatusBar } from "./status-bar.ts";
import { ActivityCard, chatMessage } from "./transcript.ts";
import { effortDescription, effortLabel } from "./metrics.ts";
import { ChatText, danger } from "./theme.ts";
import { IndependentScrollView, attachJumpToLatest, workspaceLayout, workspaceTerminal } from "./workspace.ts";
import { discoverCodexSkills } from "../../engines/codex/skills.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";
import { describeError } from "../../shell-error.ts";

const clean = (text: string) => stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");

export async function runNativeUI(
  id: NativeId, cwd: string, createSession: (emit: Emit, approve: Approve) => NativeSession,
  terminal: Terminal = new ProcessTerminal(),
  version?: string,
  locale: Locale = "en",
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
  const providerCommands = [
    ["/model", t.commandSelectModel],
    ...(id === "codex" ? [] : [["/effort", t.commandSelectReasoning]]),
    ["/resume", t.commandChatHistory], ["/new", t.commandNewConversation], ["/login", t.commandConnectAccount], ["/logout", t.commandDisconnectLocally], ["/status", t.commandSessionDetails], ["/stop", t.commandCancelActiveTurn],
  ].map(([value, label]) => ({ value: value!, label: label! }));
  input.setCommandGroups([
    { title: engineLabel.toUpperCase(), items: providerCommands },
    { title: "FORGE614", items: [{ value: "/refresh", label: t.commandRefreshPlanUsage }, { value: "/commands", label: t.commandBrowseCommands }, { value: "/quit", label: t.commandExitShell }] },
  ]);
  if (id === "codex") void discoverCodexSkills(cwd).then(skills => input.setSkillChoices(skills));
  let closed = false; let ready = false; let commandBusy = false;
  let finish!: () => void;
  const exited = new Promise<void>(resolve => { finish = resolve; });
  const streaming = new Map<string, { component: ChatText; text: string }>();
  const approvals: { description: string; answer: (allow: boolean) => void }[] = [];
  let sessions: { id: string; title: string }[] = [];
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
    const elapsed = turnStartedAt ? ` · ${Math.max(0, Math.floor((Date.now() - turnStartedAt) / 1000))}s` : "";
    input.setStatus(session.busy || commandBusy ? `${t.statusWorking}${elapsed}` : shellState.snapshot().account === "connected" ? t.statusReady : t.statusConnectWithLogin);
    input.setWorkModeHint(session.workMode?.());
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
  const emit = (event: NativeEvent) => {
    if (closed) return;
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
  const command = async (value: string) => {
    if (value.trim() === "/refresh") { await sidebar.refreshUsage(); return; }
    const [name, ...parts] = value.trim().split(/\s+/); const argument = parts.join(" ");
    if (name === "/quit" || name === "/quit!") {
      if ((session.busy || commandBusy) && name !== "/quit!") writeError(tc.workOrLoginActive);
      else shutdown();
      return;
    }
    if (name === "/yes" || name === "/no") {
      if (!approvals[0]) throw new Error(t.noPermissionPending);
      approvals[0].answer(name === "/yes"); return;
    }
    if (name === "/stop") { await session.cancel(); write(tc.cancellationRequested); return; }
    if (name === "/help" || name === "/commands") {
      if (approvals.length) { write(t.answerPendingPermissionFirst); return; }
      const selected = await input.chooseCommand();
      if (selected) input.onSubmit?.(selected);
      return;
    }
    if (name === "/status") { write(session.status().join("\n")); return; }
    if (!ready || commandBusy || session.busy) throw new Error(tc.waitForEngine);
    commandBusy = true;
    try {
      if (name === "/login") await session.login();
      else if (name === "/logout") {
        if (!session.logout) throw new Error(tc.logoutUnavailable);
        await session.logout();
      }
      else if (name === "/model") {
        if (argument) { await session.setModel(argument); persistPreference(); write(tc.selectedModel({ model: argument })); }
        else if (session.models.length) {
          const selected = await input.choose(t.commandSelectModel, session.models.map(model => ({ value: model.id, display: model.name, label: "" })), session.visual?.().model);
          if (selected) {
            await session.setModel(selected);
            persistPreference();
            const model = session.models.find(item => item.id === selected);
            if (id === "codex" && model?.efforts?.length) {
              const effort = await input.choose(t.commandSelectReasoning, model.efforts.map(value => ({
                value, display: effortLabel(value, locale), label: effortDescription(value, locale),
              })), model.defaultEffort);
              if (effort) { await session.setEffort(effort); persistPreference(); }
            }
          }
        } else write(tc.useLoginForCatalog);
      } else if (name === "/effort" || name === "/thinking") {
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
      } else if (name === "/resume") {
        if (!argument) {
          sessions = await session.listSessions();
          write(sessions.length ? sessions.map((item, i) => `${i + 1}. ${item.title} [${item.id}]`).join("\n") + "\n" + tc.resumeInstruction : tc.noSessionsFound);
        } else {
          const selected = /^\d+$/.test(argument) ? sessions[Number(argument) - 1]?.id : argument;
          if (!selected) throw new Error(tc.chooseSessionOrId);
          await session.resume(selected);
          write(session.resumeNotice ?? t.historyRestored);
        }
      } else if (name === "/new") { session.reset(); transcript.clear(); streaming.clear(); }
      else throw new Error(t.unknownCommand({ name: name ?? "" }));
    } finally { commandBusy = false; refresh(); }
  };
  session = createSession(emit, approve);
  sidebar.setRefreshAction(async () => {
    if (!session.refreshUsage) return tc.refreshNotAvailable;
    await session.refreshUsage(); refresh();
  }, () => tui.requestRender());
  input.onSubmit = value => {
    if (closed || !value.trim()) return;
    input.setValue("");
    if (value.startsWith("/")) void command(value).catch(error => writeError(t.errorPrefixed({ message: describeError(error, locale) })));
    else if (!ready || commandBusy || session.busy) writeError(tc.waitForCurrentOperationToFinish);
    else {
      streaming.clear(); writeChat("user", value);
      beginTurn();
      void session.send(value).catch(error => { if (!closed) writeError(t.turnStopped({ message: describeError(error, locale) })); }).finally(() => { endTurn(); refresh(); });
      refresh();
    }
  };
  const cycleWorkMode = async () => {
    const modes = session.workModes?.() ?? [];
    if (!session.setWorkMode || !modes.length || session.busy || commandBusy) return;
    const current = session.workMode?.();
    const index = modes.findIndex(mode => mode.id === current);
    const next = modes[(index + 1) % modes.length]!;
    await session.setWorkMode(next.id);
    refresh();
  };
  tui.addInputListener(data => {
    if (matchesKey(data, "shift+tab")) { void cycleWorkMode().catch(error => writeError(t.errorPrefixed({ message: describeError(error, locale) }))); return { consume: true }; }
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
      }
      ready = true; refresh();
    }).catch(error => writeError(tc.connectionFailed({ message: describeError(error, locale) })));
    await exited;
  } finally { clearInterval(clock); process.removeListener("SIGTERM", shutdown); session.close(); tui.stop({ preserveScreen: true }); }
}
