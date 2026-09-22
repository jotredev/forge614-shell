import { stripVTControlCharacters } from "node:util";
import { Container, HStack, ProcessTerminal, ScrollView, Text, TuiAltScreen, VStack, matchesKey } from "@earendil-works/pi-tui";
import type { Terminal } from "@earendil-works/pi-tui";
import { getSessionMessages, listSessions } from "@anthropic-ai/claude-agent-sdk";
import type { EffortLevel, ModelInfo, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { claudeEnvironment, claudeLoginState, findClaude, officialLogin } from "../../engines/claude/auth.ts";
import { confirmedLogout } from "../../engines/logout.ts";
import { ClaudeSession } from "../../engines/claude/session.ts";
import { emptyTelemetry, telemetryLines, updateTelemetry } from "../../engines/claude/telemetry.ts";
import { createComposer } from "./composer.ts";
import { ShellState } from "./shell-state.ts";
import { ShellSidebar } from "./sidebar.ts";
import { readRuntimeResources } from "../../infrastructure/runtime-resources.ts";
import { loadEnginePreference, saveEnginePreference } from "../../infrastructure/shell-preferences.ts";
import { getStartupContext } from "../../infrastructure/forge614-engram.ts";
import { ShellStatusBar } from "./status-bar.ts";
import { effortDescription, effortLabel, isDisplayableUsage } from "./metrics.ts";
import { ActivityCard, chatMessage } from "./transcript.ts";
import { lineDiff } from "./diff.ts";
import { engramToolLabel, parseClaudeMcpToolName } from "../../engines/mcp-labels.ts";
import { ChatText, danger } from "./theme.ts";
import { IndependentScrollView, attachJumpToLatest, workspaceLayout, workspaceTerminal } from "./workspace.ts";

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

export async function startClaudeUI(args: string[], selectedExecutable?: string, terminal?: Terminal, version?: string): Promise<void> {
  if (args.length) throw new Error("Claude mode currently accepts no CLI options. Use the in-chat commands, or --engine pi for Pi options.");
  if (!terminal && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error("Claude chat requires an interactive terminal.");
  const env = claudeEnvironment(process.env);
  const executable = selectedExecutable ?? await findClaude(env);
  const cwd = process.cwd();
  const session = new ClaudeSession({ cwd, env, executable, getStartupContext });
  const surface = workspaceTerminal(terminal ?? new ProcessTerminal());
  const tui = new TuiAltScreen(surface, true, undefined, { mouse: true });
  const transcript = new Container();
  const transcriptScroll = new IndependentScrollView(transcript, { follow: "end", primary: true, scrollbar: "hidden" });
  const composer = createComposer(tui);
  const { input } = composer;
  const shellState = new ShellState("Claude Code");
  shellState.checking();
  const sidebar = new ShellSidebar(() => shellState.snapshot(), cwd);
  const statusBar = new ShellStatusBar(() => shellState.snapshot(), cwd, () => sidebar.projectInfo(), process.env.HOME, version);
  tui.setLayoutRoot(workspaceLayout(transcriptScroll, composer.component, sidebar, statusBar, surface, cwd));
  attachJumpToLatest(tui, transcriptScroll);
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
  let sessions: Awaited<ReturnType<typeof listSessions>> = [];
  let streaming: ChatText | undefined;
  let streamedText = "";
  const tools = new Map<string, { card: ActivityCard; startedAt: number; isEdit: boolean }>();
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
      }
      syncCommandGroups();
    }
    catch { if (!closed && !signal?.aborted) write("Could not load the native model catalog. Use /model to retry. Your account remains connected."); }
  };
  const syncCommandGroups = () => {
    const native = session.commands.map(command => ({ value: `/${command.name}`, label: command.description || command.argumentHint || "Claude Code command" }));
    const names = new Set(native.map(command => command.value));
    const providerControls = [
      ["/model", "Select model"], ["/effort", "Select reasoning"], ["/resume", "Chat history"], ["/new", "New conversation"], ["/login", "Connect account"], ["/logout", "Disconnect locally"], ["/status", "Session details"], ["/stop", "Cancel active turn"],
    ].map(([value, label]) => ({ value: value!, label: label! })).filter(command => !names.has(command.value));
    input.setCommandGroups([
      { title: "CLAUDE CODE", items: [...native, ...providerControls] },
      { title: "FORGE614", items: [{ value: "/refresh", label: "Refresh plan usage" }, { value: "/commands", label: "Browse commands" }, { value: "/quit", label: "Exit Shell" }] },
    ]);
  };

  const write = (text: string): ChatText => {
    const component = new ChatText(clean(text));
    transcript.addChild(component);
    tui.requestRender();
    return component;
  };
  /** Red, so an error reads as an error at a glance instead of blending into a normal reply. */
  const writeError = (text: string): ChatText => {
    const component = new ChatText(clean(text), danger);
    transcript.addChild(component);
    tui.requestRender();
    return component;
  };
  const writeChat = (role: "user" | "assistant" | "system", text: string): ChatText => write(chatMessage(role, clean(text)));
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
        reasoning: effortLabel(telemetry.effort ?? session.effort),
        ...(session.context ? { context: session.context } : telemetry.contextTokens !== undefined && telemetry.contextWindow !== undefined ? { context: { used: telemetry.contextTokens, window: telemetry.contextWindow } } : {}),
        usage: usage.length ? usage : session.usage,
        resources: readRuntimeResources(),
      });
    }
    sidebar.invalidate();
    const elapsed = turnStartedAt ? ` · ${Math.max(0, Math.floor((Date.now() - turnStartedAt) / 1000))}s` : "";
    input.setStatus(commandBusy || session.busy ? `Working${elapsed}` : shellState.snapshot().account === "connected" ? "Ready" : shellState.snapshot().account === "checking" ? "Checking account" : "Connect with /login");
    input.setWorkModeHint(session.workMode());
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
    writeActivity("Permission requested", approval.label, true);
    input.setStatus("Awaiting permission");
    void input.choose("Permission · /yes allow once · /no deny · /stop cancel turn", [
      { value: "/no", label: "Deny" }, { value: "/yes", label: "Allow this call only" },
    ]).then(value => approval.finish(value === "/yes"));
  };
  const approve = (tool: string, value: Record<string, unknown>, signal: AbortSignal): Promise<boolean> => {
    const details = JSON.stringify(value, null, 2);
    if (details.length > 20000) {
      writeError(`Denied ${tool}: permission details are too large to display safely. Ask Claude to split the operation.`);
      return Promise.resolve(false);
    }
    if (tool === "AskUserQuestion") {
      write("Claude requested a questionnaire. This first connector does not support questionnaire forms yet; ask Claude to put its question in the chat.");
      return Promise.resolve(false);
    }
    return new Promise(resolve => {
      const approval = {
        label: `Permission requested: ${tool}\n${details}\n/yes = allow this call · /no = deny`,
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
        streaming.setText(chatMessage("assistant", clean(streamedText)));
      }
    }
    if (event.type === "assistant") {
      const text = event.message.content.filter(block => block.type === "text").map(block => block.text).join("\n");
      if (!event.parent_tool_use_id && text) {
        if (streaming) streaming.setText(chatMessage("assistant", clean(text)));
        else writeChat("assistant", text);
        streaming = undefined; streamedText = "";
      }
      for (const block of event.message.content) if (block.type === "tool_use" && !tools.has(block.id)) {
        const edit = editContent(block.name, block.input);
        const parsed = parseClaudeMcpToolName(block.name);
        const label = (parsed && engramToolLabel(parsed.server, parsed.tool)) ?? (edit?.path ? `${block.name} · ${edit.path.split("/").pop()}` : block.name);
        const card = edit
          ? new ActivityCard(label, "Requested", "", true, lineDiff(edit.before, edit.after))
          : new ActivityCard(label, "Requested", clean(JSON.stringify(block.input, null, 2)).slice(0, 2000));
        tools.set(block.id, { card, startedAt: Date.now(), isEdit: Boolean(edit) }); transcript.addChild(card);
      }
    }
    if (event.type === "tool_progress") {
      const tool = tools.get(event.tool_use_id);
      if (tool) tool.card.update(`Running · ${event.elapsed_time_seconds}s`);
      else writeActivity(event.tool_name, `Running · ${event.elapsed_time_seconds}s`);
    }
    if (event.type === "user" && Array.isArray(event.message.content)) {
      for (const block of event.message.content) if (block.type === "tool_result") {
        const tool = tools.get(block.tool_use_id);
        if (tool) {
          const status = `${block.is_error ? "Failed" : "Completed"} · ${((Date.now() - tool.startedAt) / 1000).toFixed(1)}s`;
          if (tool.isEdit) tool.card.update(status);
          else {
            const detail = typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? "");
            tool.card.update(status, clean(detail).slice(0, 3000));
          }
        }
      }
    }
    if (event.type === "result" && event.is_error) writeError(`Claude error: ${event.subtype === "success" ? event.result : event.errors.join("\n")}`);
    refresh();
  };
  const command = async (value: string) => {
    if (value.trim() === "/refresh") { await sidebar.refreshUsage(); return; }
    const [name, ...rest] = value.trim().split(/\s+/);
    const argument = rest.join(" ");
    // These commands have a Shell picker, but their catalog and selected value
    // remain entirely Claude-native.  Handle them before the general native
    // command forwarding below so `/effort` cannot become a chat turn.
    if (name && !["/model", "/effort", "/thinking"].includes(name) && session.commands.some(command => `/${command.name}` === name || command.aliases?.some(alias => `/${alias}` === name))) {
      if (session.busy) throw new Error("Finish or /stop the current turn first.");
      writeChat("user", value); telemetry = { ...emptyTelemetry(), quotas: telemetry.quotas };
      beginTurn();
      activeTurn = session.send(value, onEvent, approve).catch(error => { writeError(`Turn stopped: ${error instanceof Error ? error.message : String(error)}`); }).finally(() => { activeTurn = undefined; endTurn(); refresh(); });
      refresh(); return;
    }
    if (name === "/yes" || name === "/no") {
      if (!approvals[0]) throw new Error("No permission request is pending.");
      approvals[0].finish(name === "/yes"); return;
    }
    if (name === "/stop") { loginAbort?.abort(); session.stop(); return; }
    if (name === "/quit" || name === "/quit!") {
      if ((session.busy || loginAbort) && name !== "/quit!") write("Work or authentication is active. Use /quit! to stop it and exit, or keep working. Nothing was stopped.");
      else await shutdown();
      return;
    }
    if (name === "/status" || name === "/forge614-status") { write(telemetryLines(telemetry).join("\n")); return; }
    if (name === "/help" || name === "/commands") {
      if (approvals.length) { write("Answer the pending permission with the selector, /yes or /no first."); return; }
      const selected = await input.chooseCommand();
      if (selected) input.onSubmit?.(selected);
      return;
    }
    if (session.busy) throw new Error("Finish or /stop the current turn first.");
    if (name === "/login") {
      loginAbort = new AbortController();
      let suspended = false;
      try {
        write("Checking your Claude account…");
        const connected = await claudeLoginState(executable, env, cwd, undefined, loginAbort.signal);
        if (closed || loginAbort.signal.aborted) return;
        if (connected) {
          disconnected = false; accountConnected = true; accountChecked = true; accountUnknown = false;
          await loadCatalog(loginAbort.signal);
          write("Connected to Claude in Shell using your existing account. No new login is needed."); return;
        }
        write("Claude sign-in is required. Opening the official login flow; return here after completing it.");
        tui.stop({ preserveScreen: true }); suspended = true;
        await officialLogin(executable, env, cwd, loginAbort.signal);
        const verified = await claudeLoginState(executable, env, cwd, undefined, loginAbort.signal);
        if (!closed && !loginAbort.signal.aborted && verified) { disconnected = false; accountConnected = true; accountChecked = true; accountUnknown = false; }
        if (!verified) throw new Error("Login was not verified. Use /login to retry.");
        await loadCatalog(loginAbort.signal);
      } finally { loginAbort = undefined; if (!closed && suspended) { tui.start(); tui.setFocus(input); } }
      write("Login flow finished. Account and billing remain managed by Anthropic.");
    } else if (name === "/logout") {
      loginAbort = new AbortController();
      try {
        const done = await confirmedLogout("Claude Code", (warning, signal) => approve("Sign out", { warning }, signal), loginAbort.signal,
          async () => { disconnected = true; accountConnected = false; accountChecked = true; accountUnknown = false; });
        if (done) {
          session.reset(); session.models = []; session.model = undefined; session.effort = undefined;
          telemetry = emptyTelemetry(); sessions = [];
          write("Disconnected locally from Claude in this Shell session. Your native account and other applications are unchanged. Use /login to reconnect.");
        } else write("Logout cancelled. No account changes were requested.");
      } finally { loginAbort = undefined; }
    } else if (name === "/new") {
      session.reset(); telemetry = emptyTelemetry(); transcript.clear();
    } else if (name === "/model") {
      if (!session.models.length && accountConnected && !disconnected) await loadCatalog();
      if (!argument) {
        if (!session.models.length) write("The engine has not reported its model catalog yet. The official default remains active; no model request was sent.");
        else {
          const selected = await input.choose("Select model", session.models.map(model => ({
            value: model.value,
            display: model.displayName,
            label: model.description ?? "",
          })), session.model);
          if (selected) { session.model = selected; telemetry = { ...telemetry, model: undefined }; persistPreference(); }
        }
      }
      else {
        if (session.models.length && !session.models.some(model => model.value === argument || model.resolvedModel === argument)) throw new Error("Choose a model from /model.");
        session.model = argument; telemetry = { ...telemetry, model: undefined }; persistPreference(); write(`Requested model for next turn: ${argument}`);
      }
    } else if (name === "/effort" || name === "/thinking") {
      if (!session.models.length && accountConnected && !disconnected) await loadCatalog();
      if (!argument) {
        const model = session.models.find(model => model.value === session.model || model.resolvedModel === telemetry.model);
        const levels = model?.supportedEffortLevels;
        if (!levels?.length) write("The engine has not reported reasoning options for this model.");
        else {
          // Claude Code does not report what level "default" actually resolves to ahead of time —
          // only Codex's SDK exposes that. Say so plainly instead of implying we know and hiding it.
          const selected = await input.choose("Select reasoning", ["default", ...levels].map(value => ({
            value, display: value === "default" ? "Default (recommended)" : effortLabel(value),
            label: value === "default" ? "Claude Code decides — shown in the sidebar after you send a message" : effortDescription(value),
          })), session.effort ?? "default");
          if (selected) { session.effort = selected === "default" ? undefined : selected as EffortLevel; telemetry = { ...telemetry, effort: undefined }; persistPreference(); }
        }
      }
      else if (argument === "default") { session.effort = undefined; persistPreference(); }
      else if (["low", "medium", "high", "xhigh", "max"].includes(argument)) {
        const model = session.models.find(model => model.value === session.model || model.resolvedModel === telemetry.model);
        if (model?.supportedEffortLevels && !model.supportedEffortLevels.includes(argument as EffortLevel)) throw new Error("This effort level is not supported by the selected model.");
        session.effort = argument as EffortLevel; persistPreference();
      } else throw new Error("Invalid effort level. Use /effort for options.");
    } else if (name === "/resume") {
      if (!argument) {
        sessions = (await listSessions({ dir: cwd })).filter(item => item.cwd === cwd).slice(0, 30);
        write(sessions.length ? sessions.map((item, i) => `${i + 1}. ${item.summary}`).join("\n") + "\nUse /resume <number>. This loads history and waits for your next message." : "No Claude Code sessions found for this project.");
      } else {
        if (!/^\d+$/.test(argument) || !sessions[Number(argument) - 1]) throw new Error("Use /resume first, then choose a listed number.");
        const selected = sessions[Number(argument) - 1]!;
        const messages = await getSessionMessages(selected.sessionId, { dir: cwd });
        session.resume(selected.sessionId); telemetry = emptyTelemetry(); transcript.clear();
        for (const entry of messages) {
          const message = entry.message as { content?: unknown };
          const content = message?.content;
          const text = typeof content === "string" ? content : Array.isArray(content) ? content.filter(block => block.type === "text").map(block => block.text).join("\n") : "";
          if (text) write(`${entry.type}: ${text}`);
        }
        write("History restored. Waiting for your next message; no work was started.");
      }
    } else throw new Error(`Unknown command: ${name}. Use /help.`);
    refresh();
  };
  sidebar.setRefreshAction(async () => {
    await session.initialize();
    telemetry.quotas = {};
    refresh();
    if (!session.usage.length) return "Usage unavailable from provider";
  }, () => tui.requestRender());
  input.onSubmit = value => {
    if (closed || !value.trim()) return;
    input.setValue("");
    if (["/yes", "/no", "/stop", "/quit", "/quit!", "/status", "/help", "/commands", "/refresh"].includes(value.trim())) {
      void command(value).catch(error => writeError(`Error: ${error.message}`)).finally(refresh); return;
    }
    if (commandBusy) { writeError("Wait for the current operation, or use /stop."); return; }
    if (value.startsWith("/")) {
      commandBusy = true;
      void command(value).catch(error => writeError(`Error: ${error.message}`)).finally(() => { commandBusy = false; refresh(); });
    } else if (disconnected) writeError("Use /login to reconnect this Shell session before sending a message.");
    else if (session.busy) writeError("A turn is already running. Wait, or use /stop.");
    else {
      writeChat("user", value);
      telemetry = { ...emptyTelemetry(), quotas: telemetry.quotas };
      beginTurn();
      activeTurn = session.send(value, onEvent, approve)
        .catch(error => { writeError(`Turn stopped: ${error instanceof Error ? error.message : String(error)}`); })
        .finally(() => { streaming = undefined; endTurn(); refresh(); });
      refresh();
    }
  };
  tui.addInputListener(data => {
    if (matchesKey(data, "shift+tab")) {
      const modes = session.workModes();
      const index = modes.findIndex(mode => mode.id === session.workMode());
      const next = modes[(index + 1) % modes.length]!;
      void session.setWorkMode(next.id).then(refresh).catch(error => writeError(`Error: ${error.message}`));
      return { consume: true };
    }
    if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) {
      void command("/quit");
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
  try {
    commandBusy = true;
    loginAbort = new AbortController();
    const startupAbort = loginAbort;
    refresh();
    tui.start();
    void claudeLoginState(executable, env, cwd, undefined, startupAbort.signal)
      .then(async connected => { if (!closed && !startupAbort.signal.aborted) { accountChecked = true; accountConnected = connected; disconnected = !connected; refresh(); if (connected) await loadCatalog(startupAbort.signal); } })
      .catch(() => { if (!closed) { accountUnknown = true; write("Could not verify your Claude account. Use /login to retry."); } })
      .finally(() => { loginAbort = undefined; commandBusy = false; if (!closed) refresh(); });
    await exited;
  } finally {
    clearInterval(clock);
    process.removeListener("SIGTERM", terminate);
    tui.stop({ preserveScreen: true });
  }
}
