// Render the actual terminal frame into an inspectable HTML artifact, using an
// external xterm/headless installation supplied by the caller. No engine runs.
import { Container, TuiAltScreen } from "@earendil-works/pi-tui";
import { createComposer } from "../../src/ui/basic/composer.ts";
import { ShellSidebar } from "../../src/ui/basic/sidebar.ts";
import { ShellStatusBar } from "../../src/ui/basic/status-bar.ts";
import { ChatText } from "../../src/ui/basic/theme.ts";
import { ActivityCard, chatMessage } from "../../src/ui/basic/transcript.ts";
import { workspaceLayout, workspaceTerminal } from "../../src/ui/basic/workspace.ts";
const { Terminal: Headless } = await import(process.argv[2]!);
const cols = Number(process.argv[3] ?? 140), rows = Number(process.argv[4] ?? 40);
let output = "";
const terminal = { columns: cols, rows, kittyProtocolActive: false,
  start() {}, stop() {}, async drainInput() {}, write(data: string) { output += data; },
  moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {},
};
const surface = workspaceTerminal(terminal);
const tui = new TuiAltScreen(surface);
const transcript = new Container();
transcript.addChild(new ChatText(chatMessage("user", "Review the logout behavior and explain what changes in this workspace.")));
transcript.addChild(new ChatText(chatMessage("assistant", "I will inspect the connector and its tests. Your other terminal sessions keep their existing accounts.")));
transcript.addChild(new ActivityCard("Read · session.ts", "Inspected the local disconnect handler and account verification."));
transcript.addChild(new ChatText(chatMessage("assistant", "**Local logout is scoped to Shell.** The startup account check now runs before your first message.\n\n```ts\nawait verifyNativeAccount();\nrenderWorkspace();\n```\n\nThe existing account is reused through the native engine.")));
const snapshot = () => ({ account: "connected" as const, provider: "Claude Code", model: "claude-opus-5", reasoning: "medium", context: { used: 18000, window: 128000 }, usage: [{ label: "Weekly", usedPercent: 74 }] });
const { input } = createComposer(tui);
tui.setLayoutRoot(workspaceLayout(transcript, input, new ShellSidebar(snapshot), new ShellStatusBar(snapshot), surface, "/project/forge614-shell"));
tui.setFocus(input); tui.start();
await new Promise(resolve => setTimeout(resolve, 40));
const frame = output; tui.stop();
const term = new Headless({ cols, rows, allowProposedApi: true });
await new Promise<void>(resolve => term.write(frame, resolve));
const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
let html = "";
for (let y = 0; y < rows; y++) {
  const line = term.buffer.active.getLine(y);
  for (let x = 0; x < cols; x++) {
    const cell = line.getCell(x); if (!cell.getWidth()) continue;
    const fg = cell.isFgRGB() ? "#" + cell.getFgColor().toString(16).padStart(6, "0") : "#dce6eb";
    const bg = cell.isBgRGB() ? "#" + cell.getBgColor().toString(16).padStart(6, "0") : "#0c1318";
    html += `<span style="color:${fg};background:${bg};${cell.isBold() ? "font-weight:bold;" : ""}">${escape(cell.getChars() || " ")}</span>`;
  }
  html += "\n";
}
const page = `<!doctype html><meta charset="utf-8"><title>Forge614 — rendered terminal frame</title><style>body{margin:0;background:#0c1318}pre{font:14px/22px Menlo,monospace;margin:12px;white-space:pre}</style><pre>${html}</pre>`;
const server = Bun.serve({ port: 43187, hostname: "127.0.0.1", fetch: () => new Response(page, { headers: { "Content-Type": "text/html" } }) });
console.log(`Actual terminal render: ${server.url}`);
