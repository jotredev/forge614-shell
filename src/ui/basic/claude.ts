import { stripVTControlCharacters } from "node:util";
import { Container, Input, ProcessTerminal, Text, TuiMainScreen, matchesKey } from "@earendil-works/pi-tui";
import type { Terminal } from "@earendil-works/pi-tui";
import { getSessionMessages, listSessions } from "@anthropic-ai/claude-agent-sdk";
import type { EffortLevel, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { claudeEnvironment, claudeLoginState, findClaude, officialLogin } from "../../engines/claude/auth.ts";
import { confirmedLogout } from "../../engines/logout.ts";
import { ClaudeSession } from "../../engines/claude/session.ts";
import { emptyTelemetry, telemetryLines, updateTelemetry } from "../../engines/claude/telemetry.ts";

const clean = (text: string) => stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
const help = "Commands: /login · /logout · /model [id] · /effort [level] · /resume [number] · /new · /status · /stop · /quit";

export async function startClaudeUI(args: string[], selectedExecutable?: string, terminal?: Terminal): Promise<void> {
  if (args.length) throw new Error("Claude mode currently accepts no CLI options. Use the in-chat commands, or --engine pi for Pi options.");
  if (!terminal && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error("Claude chat requires an interactive terminal.");
  const env = claudeEnvironment(process.env);
  const executable = selectedExecutable ?? await findClaude(env);
  const cwd = process.cwd();
  const session = new ClaudeSession({ cwd, env, executable });
  const tui = new TuiMainScreen(terminal ?? new ProcessTerminal());
  const transcript = new Container();
  const status = new Text("");
  const input = new Input({ prompt: "> ", placeholder: "Message Claude Code or type /help" });
  tui.addChild(new Text("Forge614-Shell\nOfficial Claude Code engine · Pi terminal components\n" + help));
  tui.addChild(transcript);
  tui.addChild(status);
  tui.addChild(input);
  tui.setFocus(input);
  let telemetry = emptyTelemetry();
  let activeTurn: Promise<void> | undefined;
  let commandBusy = false;
  let loginAbort: AbortController | undefined;
  let closed = false;
  let disconnected = false;
  let resolveExit!: () => void;
  const exited = new Promise<void>(resolve => { resolveExit = resolve; });
  const approvals: { label: string; finish: (allowed: boolean) => void }[] = [];
  let sessions: Awaited<ReturnType<typeof listSessions>> = [];
  let streaming: Text | undefined;
  let streamedText = "";

  const write = (text: string): Text => {
    const component = new Text(clean(text));
    transcript.addChild(component);
    tui.requestRender();
    return component;
  };
  const refresh = () => {
    if (disconnected) {
      status.setText("Disconnected locally · use /login to reconnect Shell. Native account unchanged.");
      tui.requestRender(); return;
    }
    status.setText(clean(`\n${cwd}\n${session.busy ? "Working" : "Ready"} | ${session.sessionId ?? "New chat"}\n${telemetryLines(telemetry).join("\n")}\nRequested effort: ${session.effort ?? "engine default"}\n`));
    tui.requestRender();
  };
  const shutdown = async () => {
    if (closed) return;
    closed = true;
    loginAbort?.abort();
    session.stop();
    for (const approval of [...approvals]) approval.finish(false);
    await activeTurn;
    tui.stop();
    resolveExit();
  };
  const approve = (tool: string, value: Record<string, unknown>, signal: AbortSignal): Promise<boolean> => {
    const details = JSON.stringify(value, null, 2);
    if (details.length > 20000) {
      write(`Denied ${tool}: permission details are too large to display safely. Ask Claude to split the operation.`);
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
          signal.removeEventListener("abort", abort);
          resolve(allowed);
          if (wasFirst && approvals[0]) write(approvals[0].label);
        },
      };
      const abort = () => approval.finish(false);
      approvals.push(approval);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      else if (approvals.length === 1) write(approval.label);
    });
  };
  const onEvent = (event: SDKMessage) => {
    telemetry = updateTelemetry(telemetry, event);
    if (event.type === "stream_event" && !event.parent_tool_use_id) {
      if (event.event.type === "message_start") { streaming = undefined; streamedText = ""; }
      if (event.event.type === "content_block_delta" && event.event.delta.type === "text_delta") {
        streamedText += event.event.delta.text;
        streaming ??= write("Claude: ");
        streaming.setText(clean(`Claude: ${streamedText}`));
      }
    }
    if (event.type === "assistant") {
      const text = event.message.content.filter(block => block.type === "text").map(block => block.text).join("\n");
      if (!event.parent_tool_use_id && text) {
        if (streaming) streaming.setText(clean(`Claude: ${text}`));
        else write(`Claude: ${text}`);
        streaming = undefined; streamedText = "";
      }
      for (const block of event.message.content) if (block.type === "tool_use") write(`Tool: ${block.name}`);
    }
    if (event.type === "tool_progress") write(`Tool running: ${event.tool_name} (${event.elapsed_time_seconds}s)`);
    if (event.type === "result" && event.is_error) write(`Claude error: ${event.subtype === "success" ? event.result : event.errors.join("\n")}`);
    refresh();
  };
  const command = async (value: string) => {
    const [name, ...rest] = value.trim().split(/\s+/);
    const argument = rest.join(" ");
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
    if (name === "/help") { write(help); return; }
    if (session.busy) throw new Error("Finish or /stop the current turn first.");
    if (name === "/login") {
      loginAbort = new AbortController();
      let suspended = false;
      try {
        write("Checking your Claude account…");
        const connected = await claudeLoginState(executable, env, cwd, undefined, loginAbort.signal);
        if (closed || loginAbort.signal.aborted) return;
        if (connected) {
          disconnected = false;
          write("Connected to Claude in Shell using your existing account. No new login is needed."); return;
        }
        write("Claude sign-in is required. Opening the official login flow; return here after completing it.");
        tui.stop(); suspended = true;
        await officialLogin(executable, env, cwd, loginAbort.signal);
        const verified = await claudeLoginState(executable, env, cwd, undefined, loginAbort.signal);
        if (!closed && !loginAbort.signal.aborted && verified) disconnected = false;
        if (!verified) throw new Error("Login was not verified. Use /login to retry.");
      } finally { loginAbort = undefined; if (!closed && suspended) { tui.start(); tui.setFocus(input); } }
      write("Login flow finished. Account and billing remain managed by Anthropic.");
    } else if (name === "/logout") {
      loginAbort = new AbortController();
      try {
        const done = await confirmedLogout("Claude Code", (warning, signal) => approve("Sign out", { warning }, signal), loginAbort.signal,
          async () => { disconnected = true; });
        if (done) {
          session.reset(); session.models = []; session.model = undefined; session.effort = undefined;
          telemetry = emptyTelemetry(); sessions = [];
          write("Disconnected locally from Claude in this Shell session. Your native account and other applications are unchanged. Use /login to reconnect.");
        } else write("Logout cancelled. No account changes were requested.");
      } finally { loginAbort = undefined; }
    } else if (name === "/new") {
      session.reset(); telemetry = emptyTelemetry(); transcript.clear();
    } else if (name === "/model") {
      if (!argument) write(session.models.length
        ? session.models.map(model => `${model.value}: ${model.displayName} | effort: ${model.supportedEffortLevels?.join(", ") ?? "not reported"}`).join("\n")
        : "Model catalog becomes available after the first turn. Use /model <id> to request a model, or leave the official default.");
      else {
        if (session.models.length && !session.models.some(model => model.value === argument || model.resolvedModel === argument)) throw new Error("Choose a model from /model.");
        session.model = argument; write(`Requested model for next turn: ${argument}`);
      }
    } else if (name === "/effort" || name === "/thinking") {
      if (!argument) write("Use /effort low|medium|high|xhigh|max|default. Model support and account policies apply.");
      else if (argument === "default") session.effort = undefined;
      else if (["low", "medium", "high", "xhigh", "max"].includes(argument)) {
        const model = session.models.find(model => model.value === session.model || model.resolvedModel === telemetry.model);
        if (model?.supportedEffortLevels && !model.supportedEffortLevels.includes(argument as EffortLevel)) throw new Error("This effort level is not supported by the selected model.");
        session.effort = argument as EffortLevel;
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
  input.onSubmit = value => {
    if (closed || !value.trim()) return;
    input.setValue("");
    if (["/yes", "/no", "/stop", "/quit", "/quit!", "/status", "/help"].includes(value.trim())) {
      void command(value).catch(error => write(`Error: ${error.message}`)).finally(refresh); return;
    }
    if (commandBusy) { write("Wait for the current operation, or use /stop."); return; }
    if (value.startsWith("/")) {
      commandBusy = true;
      void command(value).catch(error => write(`Error: ${error.message}`)).finally(() => { commandBusy = false; refresh(); });
    } else if (disconnected) write("Use /login to reconnect this Shell session before sending a message.");
    else if (session.busy) write("A turn is already running. Wait, or use /stop.");
    else {
      write(`You: ${value}`);
      telemetry = { ...emptyTelemetry(), quotas: telemetry.quotas };
      activeTurn = session.send(value, onEvent, approve)
        .catch(error => { write(`Turn stopped: ${error instanceof Error ? error.message : String(error)}`); })
        .finally(() => { streaming = undefined; refresh(); });
      refresh();
    }
  };
  tui.addInputListener(data => {
    if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) {
      void command("/quit");
      return { consume: true };
    }
    return undefined;
  });
  const terminate = () => { void shutdown(); };
  process.once("SIGTERM", terminate);
  try {
    write("Authentication stays with official Claude Code. Use /login if needed.\nClaude's own project settings, tools and permissions apply. This is not a sandbox.");
    refresh(); tui.start(); await exited;
  } finally {
    process.removeListener("SIGTERM", terminate);
    tui.stop();
  }
}
