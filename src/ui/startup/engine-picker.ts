import { ProcessTerminal, SelectList, Text, TuiMainScreen, matchesKey } from "@earendil-works/pi-tui";
import type { Terminal } from "@earendil-works/pi-tui";
import type { InstalledEngine } from "../../engines/discovery.ts";

export async function chooseEngine(
  engines: InstalledEngine[],
  terminal: Terminal = new ProcessTerminal(),
): Promise<InstalledEngine | undefined> {
  if (!engines.length) {
    throw new Error("No installed, supported AI engines found on PATH. Install Claude Code, Codex CLI or Gemini CLI, then restart Forge614-Shell. Claude setup: https://code.claude.com/docs/en/setup");
  }
  const tui = new TuiMainScreen(terminal);
  const plain = (text: string) => text;
  const list = new SelectList(engines.map(engine => ({ value: engine.id, label: engine.label })), 8, {
    selectedPrefix: plain, selectedText: text => `\x1b[36m${text}\x1b[0m`,
    description: plain, scrollInfo: plain, noMatch: plain,
  });
  tui.addChild(new Text("Forge614-Shell\nChoose your AI engine\n↑/↓ navigate · Enter select · Esc cancel"));
  tui.addChild(list);
  tui.setFocus(list);
  let finish!: (engine?: InstalledEngine) => void;
  const selection = new Promise<InstalledEngine | undefined>(resolve => { finish = resolve; });
  list.onSelect = item => finish(engines.find(engine => engine.id === item.value));
  list.onCancel = () => finish();
  tui.addInputListener(data => {
    if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) {
      finish();
      return { consume: true };
    }
    return undefined;
  });
  const terminate = () => finish();
  process.once("SIGTERM", terminate);
  try {
    tui.start();
    return await selection;
  } finally {
    process.removeListener("SIGTERM", terminate);
    tui.stop();
  }
}
