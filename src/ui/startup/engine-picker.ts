import { ProcessTerminal, SelectList, matchesKey } from "@earendil-works/pi-tui";
import type { Terminal } from "@earendil-works/pi-tui";
import type { AvailableEngine } from "../../contracts/available-engine.ts";
import { startupFrame } from "./frame.ts";
import { accent } from "../basic/theme.ts";

export async function chooseEngine(
  engines: AvailableEngine[],
  terminal: Terminal = new ProcessTerminal(),
  version?: string,
): Promise<AvailableEngine | undefined> {
  if (!engines.length) {
    throw new Error("Forge614 Engines found no Shell-compatible AI engines. Install Claude Code or Codex, then restart Forge614-Shell.");
  }
  const plain = (text: string) => text;
  const list = new SelectList(engines.map(engine => ({ value: engine.id, label: engine.label })), 8, {
    selectedPrefix: accent, selectedText: accent,
    description: plain, scrollInfo: plain, noMatch: plain,
  });
  const tui = startupFrame(terminal, "Choose your AI engine", list, undefined, undefined, version);
  let finish!: (engine?: AvailableEngine) => void;
  const selection = new Promise<AvailableEngine | undefined>(resolve => { finish = resolve; });
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
