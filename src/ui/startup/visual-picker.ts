import { ProcessTerminal, SelectList, Text, TuiMainScreen, matchesKey } from "@earendil-works/pi-tui";
import type { Terminal } from "@earendil-works/pi-tui";
import type { InstalledEngine } from "../../engines/discovery.ts";
import { chooseEngine } from "./engine-picker.ts";

async function chooseVisual(terminal: Terminal): Promise<"basic" | undefined> {
  const tui = new TuiMainScreen(terminal);
  const plain = (text: string) => text;
  const list = new SelectList([
    { value: "basic", label: "Basic — Minimal interface" },
    { value: "full", label: "Full — Coming later (disabled)" },
  ], 4, {
    selectedPrefix: plain,
    selectedText: text => text.startsWith("Full") ? `\x1b[90m${text}\x1b[0m` : `\x1b[36m${text}\x1b[0m`,
    description: plain, scrollInfo: plain, noMatch: plain,
  });
  const hint = new Text("Choose Basic to continue. Full is not available yet.");
  tui.addChild(new Text("Forge614-Shell\nChoose your visual interface\n↑/↓ navigate · Enter select · Esc cancel"));
  tui.addChild(list); tui.addChild(hint); tui.setFocus(list);
  let finish!: (mode?: "basic") => void;
  const selection = new Promise<"basic" | undefined>(resolve => { finish = resolve; });
  list.onSelect = item => {
    if (item.value === "basic") finish("basic");
    else { hint.setText("Full is coming later and cannot be selected. Choose Basic to continue."); tui.requestRender(); }
  };
  list.onCancel = () => finish();
  tui.addInputListener(data => {
    if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) { finish(); return { consume: true }; }
    return undefined;
  });
  const terminate = () => finish();
  process.once("SIGTERM", terminate);
  try { tui.start(); return await selection; }
  finally { process.removeListener("SIGTERM", terminate); tui.stop(); }
}

// No stored defaults: each interactive launch has two explicit selections.
export async function chooseStartup(
  engines: InstalledEngine[], terminal: Terminal = new ProcessTerminal(),
): Promise<InstalledEngine | undefined> {
  if (!await chooseVisual(terminal)) return undefined;
  return chooseEngine(engines, terminal);
}
