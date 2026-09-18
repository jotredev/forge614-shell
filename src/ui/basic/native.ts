import { stripVTControlCharacters } from "node:util";
import { Container, HStack, ProcessTerminal, ScrollView, Text, TuiAltScreen, VStack, matchesKey } from "@earendil-works/pi-tui";
import type { Terminal } from "@earendil-works/pi-tui";
import type { Approve, Emit, NativeEvent, NativeId, NativeSession } from "../../engines/types.ts";
import { createComposer } from "./composer.ts";
import { ShellState } from "./shell-state.ts";
import { ShellSidebar } from "./sidebar.ts";
import { readRuntimeResources } from "../../infrastructure/runtime-resources.ts";
import { ShellStatusBar } from "./status-bar.ts";
import { ActivityCard, chatMessage } from "./transcript.ts";
import { ChatText } from "./theme.ts";
import { workspaceLayout, workspaceTerminal } from "./workspace.ts";
import { discoverCodexSkills } from "../../engines/codex/skills.ts";

const clean = (text: string) => stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");

export async function runNativeUI(
  id: NativeId, cwd: string, createSession: (emit: Emit, approve: Approve, withTerminal: (action: () => Promise<void>) => Promise<void>) => NativeSession,
  terminal: Terminal = new ProcessTerminal(),
  version?: string,
): Promise<void> {
  const surface = workspaceTerminal(terminal);
  const tui = new TuiAltScreen(surface, true, undefined, { mouse: true });
  const transcript = new Container();
  const composer = createComposer(tui);
  const { input } = composer;
  const engineLabel = id === "codex" ? "Codex" : id === "antigravity" ? "Antigravity" : "Gemini CLI";
  const shellState = new ShellState(engineLabel);
  const sidebar = new ShellSidebar(() => shellState.snapshot(), cwd);
  const statusBar = new ShellStatusBar(() => shellState.snapshot(), cwd, () => sidebar.projectInfo(), process.env.HOME, version);
  tui.setLayoutRoot(workspaceLayout(transcript, composer.component, sidebar, statusBar, surface, cwd));
  tui.setFocus(input);
  const providerCommands = [
    ["/model", "Select model"],
    ...(id === "codex" ? [] : [["/effort", "Select reasoning"]]),
    ["/resume", "Chat history"], ["/new", "New conversation"], ["/login", "Connect account"], ["/logout", "Disconnect locally"], ["/status", "Session details"], ["/stop", "Cancel active turn"],
  ].map(([value, label]) => ({ value: value!, label: label! }));
  input.setCommandGroups([
    { title: engineLabel.toUpperCase(), items: providerCommands },
    { title: "FORGE614", items: [{ value: "/refresh", label: "Refresh plan usage" }, { value: "/commands", label: "Browse commands" }, { value: "/quit", label: "Exit Shell" }] },
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
  const writeChat = (role: "user" | "assistant" | "system", text: string) => write(chatMessage(role, clean(text)));
  const writeActivity = (title: string, detail: string) => { transcript.addChild(new ActivityCard(title, clean(detail))); tui.requestRender(); };
  const writeEngineText = (text: string) => {
    if (text.startsWith("You: ")) writeChat("user", text.slice(5));
    else if (text.startsWith("Tool:")) {
      const [title, ...detail] = text.slice(5).trim().split("\n");
      writeActivity(title || "Tool", detail.join("\n") || "Working");
    } else writeChat("assistant", text);
  };
  const refresh = () => {
    if (!session || closed) return;
    const visual = session.visual?.();
    if (visual) {
      if (visual.account === "disconnected") shellState.disconnect();
      else shellState.connect({ user: visual.user, sessionId: session.sessionId, model: visual.model, reasoning: visual.reasoning, context: visual.context, usage: visual.usage, resources: readRuntimeResources() });
    } else {
      const status = session.status().join(" ");
      if (/disconnected|login required|sign-in required|not logged in|not checked|could not be verified/i.test(status)) shellState.disconnect();
      else shellState.connect({ resources: readRuntimeResources() });
    }
    sidebar.invalidate();
    input.setStatus(session.busy || commandBusy ? "Working" : shellState.snapshot().account === "connected" ? "Ready" : "Connect with /login");
    input.setWorkModeHint(session.workMode?.());
    statusBar.invalidate();
    tui.requestRender();
  };
  const emit = (event: NativeEvent) => {
    if (closed) return;
    if (event.type === "reset") { transcript.clear(); streaming.clear(); }
    else if (event.type === "text") writeEngineText(event.text);
    else if (event.type === "delta") {
      const key = event.id ?? "message";
      let entry = streaming.get(key);
      if (!entry) { entry = { component: writeChat("assistant", ""), text: "" }; streaming.set(key, entry); }
      entry.text += event.text; entry.component.setText(chatMessage("assistant", clean(entry.text)));
    }
    refresh();
  };
  const showApproval = () => {
    const item = approvals[0];
    if (!item) return;
    write(item.description);
    input.setStatus("Awaiting permission");
    void input.choose("Permission · /yes allow once · /no deny · /stop cancel turn", [
      { value: "/no", label: "Deny" }, { value: "/yes", label: "Allow this call only" },
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
    session.close(); tui.stop({ preserveScreen: true }); finish();
  };
  const command = async (value: string) => {
    if (value.trim() === "/refresh") { await sidebar.refreshUsage(); return; }
    const [name, ...parts] = value.trim().split(/\s+/); const argument = parts.join(" ");
    if (name === "/quit" || name === "/quit!") {
      if ((session.busy || commandBusy) && name !== "/quit!") write("Work or login is active. Use /quit! to stop it and exit. Nothing was stopped.");
      else shutdown();
      return;
    }
    if (name === "/yes" || name === "/no") {
      if (!approvals[0]) throw new Error("No permission request is pending.");
      approvals[0].answer(name === "/yes"); return;
    }
    if (name === "/stop") { await session.cancel(); write("Cancellation requested. Use /quit! if the engine does not respond."); return; }
    if (name === "/help" || name === "/commands") {
      if (approvals.length) { write("Answer the pending permission with the selector, /yes or /no first."); return; }
      const selected = await input.chooseCommand();
      if (selected) input.onSubmit?.(selected);
      return;
    }
    if (name === "/status") { write(session.status().join("\n")); return; }
    if (!ready || commandBusy || session.busy) throw new Error("Wait for the engine, or finish /stop the active operation first.");
    commandBusy = true;
    try {
      if (name === "/login") await session.login();
      else if (name === "/logout") {
        if (!session.logout) throw new Error("Logout is unavailable for this connector.");
        await session.logout();
      }
      else if (name === "/model") {
        if (argument) { await session.setModel(argument); write(`Selected model: ${argument}`); }
        else if (session.models.length) {
          const selected = await input.choose("Select model", session.models.map(model => ({ value: model.id, label: model.name })), session.visual?.().model);
          if (selected) {
            await session.setModel(selected);
            const model = session.models.find(item => item.id === selected);
            if (id === "codex" && model?.efforts?.length) {
              const effort = await input.choose("Select reasoning", model.efforts.map(value => ({ value, label: "" })), model.defaultEffort);
              if (effort) await session.setEffort(effort);
            }
          }
        } else write("Use /login to load the native model catalog.");
      } else if (name === "/effort" || name === "/thinking") {
        if (argument) await session.setEffort(argument);
        else {
          const visual = session.visual?.();
          const levels = session.models.find(model => model.id === visual?.model)?.efforts;
          if (levels?.length) {
            const selected = await input.choose("Select reasoning", levels.map(value => ({ value, label: "" })), visual?.reasoning);
            if (selected) await session.setEffort(selected);
          } else write("This engine has not reported reasoning options for the selected model.");
        }
      } else if (name === "/resume") {
        if (!argument) {
          sessions = await session.listSessions();
          write(sessions.length ? sessions.map((item, i) => `${i + 1}. ${item.title} [${item.id}]`).join("\n") + "\nUse /resume <number>." : "No sessions found for this project.");
        } else {
          const selected = /^\d+$/.test(argument) ? sessions[Number(argument) - 1]?.id : argument;
          if (!selected) throw new Error("Choose a listed session number or provide its native ID.");
          await session.resume(selected);
          write(session.resumeNotice ?? "History restored. Waiting for your next message; no work was started.");
        }
      } else if (name === "/new") { session.reset(); transcript.clear(); streaming.clear(); }
      else throw new Error(`Unknown command: ${name}. Use /help.`);
    } finally { commandBusy = false; refresh(); }
  };
  session = createSession(emit, approve, async action => {
    tui.stop({ preserveScreen: true });
    process.stdout.write("\nOpening native Antigravity for account login. After signing in, exit agy to return to Shell. No chat message is sent automatically.\n");
    try { await action(); }
    finally { if (!closed) { tui.start(); tui.requestRender(); } }
  });
  sidebar.setRefreshAction(async () => {
    if (!session.refreshUsage) return "Not available from this engine";
    await session.refreshUsage(); refresh();
  }, () => tui.requestRender());
  input.onSubmit = value => {
    if (closed || !value.trim()) return;
    input.setValue("");
    if (value.startsWith("/")) void command(value).catch(error => write(`Error: ${error.message}`));
    else if (!ready || commandBusy || session.busy) write("Wait for the current operation to finish, or use /stop.");
    else {
      streaming.clear(); writeChat("user", value);
      void session.send(value).catch(error => { if (!closed) write(`Turn stopped: ${error.message}`); }).finally(refresh);
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
    if (matchesKey(data, "shift+tab")) { void cycleWorkMode().catch(error => write(`Error: ${error.message}`)); return { consume: true }; }
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
    void session.initialize().then(() => { ready = true; refresh(); }).catch(error => write(`Connection failed: ${error.message}\nUse /quit, verify the native CLI installation, and reopen Shell.`));
    await exited;
  } finally { clearInterval(clock); process.removeListener("SIGTERM", shutdown); session.close(); tui.stop({ preserveScreen: true }); }
}
