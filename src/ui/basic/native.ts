import { stripVTControlCharacters } from "node:util";
import { Container, Input, ProcessTerminal, Text, TuiMainScreen, matchesKey } from "@earendil-works/pi-tui";
import type { Terminal } from "@earendil-works/pi-tui";
import type { Approve, Emit, NativeEvent, NativeId, NativeSession } from "../../engines/types.ts";

const clean = (text: string) => stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
const help = "/login · /logout · /model [id] · /effort [level] · /resume [number or id] · /new · /status · /stop · /quit";

export async function runNativeUI(
  id: NativeId, cwd: string, createSession: (emit: Emit, approve: Approve, withTerminal: (action: () => Promise<void>) => Promise<void>) => NativeSession,
  terminal: Terminal = new ProcessTerminal(),
): Promise<void> {
  const tui = new TuiMainScreen(terminal);
  const transcript = new Container(); const status = new Text("");
  const input = new Input({ prompt: "> ", placeholder: `Message ${id} or type /help` });
  tui.addChild(new Text(`Forge614-Shell\nOfficial ${id === "codex" ? "Codex App Server" : id === "antigravity" ? "Antigravity CLI (stream-json)" : "Gemini CLI (ACP)"} engine · Pi terminal components\n${help}`));
  tui.addChild(transcript); tui.addChild(status); tui.addChild(input); tui.setFocus(input);
  let closed = false; let ready = false; let commandBusy = false;
  let finish!: () => void;
  const exited = new Promise<void>(resolve => { finish = resolve; });
  const streaming = new Map<string, { component: Text; text: string }>();
  const approvals: { description: string; answer: (allow: boolean) => void }[] = [];
  let sessions: { id: string; title: string }[] = [];
  let session: NativeSession;
  const write = (text: string) => { const component = new Text(clean(text)); transcript.addChild(component); tui.requestRender(); return component; };
  const refresh = () => {
    if (!session || closed) return;
    status.setText(clean(`\n${cwd}\n${ready ? session.busy ? "Working" : commandBusy ? "Connecting" : "Ready" : "Connecting to engine"} | ${session.sessionId ?? "New chat"}\n${session.status().join("\n")}\n`));
    tui.requestRender();
  };
  const emit = (event: NativeEvent) => {
    if (closed) return;
    if (event.type === "reset") { transcript.clear(); streaming.clear(); }
    else if (event.type === "text") write(event.text);
    else if (event.type === "delta") {
      const key = event.id ?? "message";
      let entry = streaming.get(key);
      if (!entry) { entry = { component: write(`${id}: `), text: "" }; streaming.set(key, entry); }
      entry.text += event.text; entry.component.setText(clean(`${id}: ${entry.text}`));
    }
    refresh();
  };
  const approve: Approve = (description, signal) => new Promise(resolve => {
    if (closed || signal.aborted) { resolve(false); return; }
    const item = {
      description,
      answer: (allow: boolean) => {
        const index = approvals.indexOf(item); if (index < 0) return;
        approvals.splice(index, 1); signal.removeEventListener("abort", abort);
        resolve(allow && !signal.aborted);
        if (index === 0 && approvals[0]) write(approvals[0].description + "\n/yes = allow once · /no = deny");
      },
    };
    const abort = () => item.answer(false);
    approvals.push(item); signal.addEventListener("abort", abort, { once: true });
    if (approvals.length === 1) write(description + "\n/yes = allow once · /no = deny");
  });
  const shutdown = () => {
    if (closed) return;
    closed = true;
    for (const approval of [...approvals]) approval.answer(false);
    session.close(); tui.stop(); finish();
  };
  const command = async (value: string) => {
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
    if (name === "/help") { write(help); return; }
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
        else write(session.models.length ? session.models.map(model => `${model.id}: ${model.name}${model.efforts ? ` | reasoning: ${model.efforts.join(", ")}` : ""}`).join("\n") : "Use /login to load the native model catalog.");
      } else if (name === "/effort" || name === "/thinking") {
        if (argument) await session.setEffort(argument);
        else write(session.models.some(model => model.efforts?.length) ? "Use /effort <level> with one of the levels shown in /model." : "This engine does not expose a reasoning selector through this connector.");
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
    tui.stop();
    process.stdout.write("\nOpening native Antigravity for account login. After signing in, exit agy to return to Shell. No chat message is sent automatically.\n");
    try { await action(); }
    finally { if (!closed) { tui.start(); tui.requestRender(); } }
  });
  input.onSubmit = value => {
    if (closed || !value.trim()) return;
    input.setValue("");
    if (value.startsWith("/")) void command(value).catch(error => write(`Error: ${error.message}`));
    else if (!ready || commandBusy || session.busy) write("Wait for the current operation to finish, or use /stop.");
    else {
      streaming.clear(); write(`You: ${value}`);
      void session.send(value).catch(error => { if (!closed) write(`Turn stopped: ${error.message}`); }).finally(refresh);
      refresh();
    }
  };
  tui.addInputListener(data => {
    if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) { void command("/quit"); return { consume: true }; }
    return undefined;
  });
  process.once("SIGTERM", shutdown);
  try {
    write("Native account login; no API-key fallback. Engine project settings and permission rules apply.");
    refresh(); tui.start();
    void session.initialize().then(() => { ready = true; refresh(); }).catch(error => write(`Connection failed: ${error.message}\nUse /quit, verify the native CLI installation, and reopen Shell.`));
    await exited;
  } finally { process.removeListener("SIGTERM", shutdown); session.close(); tui.stop(); }
}
