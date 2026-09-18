import { ProcessTerminal, SelectList, matchesKey } from "@earendil-works/pi-tui";
import type { Terminal } from "@earendil-works/pi-tui";
import type { InstalledEngine } from "../../engines/discovery.ts";
import { startupFrame } from "./frame.ts";
import { accent } from "../basic/theme.ts";

export async function chooseEngine(
  engines: InstalledEngine[],
  terminal: Terminal = new ProcessTerminal(),
): Promise<InstalledEngine | undefined> {
  if (!engines.length) {
    throw new Error("No installed, supported AI engines found on PATH. Install Claude Code, Codex CLI or Gemini CLI, then restart Forge614-Shell. Claude setup: https://code.claude.com/docs/en/setup");
  }
  const plain = (text: string) => text;
  const list = new SelectList(engines.map(engine => ({ value: engine.id, label: engine.label })), 8, {
    selectedPrefix: accent, selectedText: accent,
    description: plain, scrollInfo: plain, noMatch: plain,
  });
  const tui = startupFrame(terminal, "Choose your AI engine", list);
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
    tui.stop({ preserveScreen: true });
  }
}
