import { ProcessTerminal, SelectList, Text, matchesKey } from "@earendil-works/pi-tui";
import type { Terminal } from "@earendil-works/pi-tui";
import type { AvailableEngine } from "../../contracts/available-engine.ts";
import { chooseEngine } from "./engine-picker.ts";
import { startupFrame } from "./frame.ts";
import { accent, muted } from "../basic/theme.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";

async function chooseVisual(terminal: Terminal, version: string | undefined, locale: Locale): Promise<"basic" | undefined> {
  const t = getCatalog(locale).visualPicker;
  const plain = (text: string) => text;
  const list = new SelectList([
    { value: "basic", label: t.basicLabel },
    { value: "full", label: t.fullLabel },
  ], 4, {
    selectedPrefix: accent,
    selectedText: text => text === t.fullLabel ? muted(text) : accent(text),
    description: plain, scrollInfo: plain, noMatch: plain,
  });
  const hint = new Text(t.hint);
  const tui = startupFrame(terminal, t.title, list, hint, undefined, version);
  let finish!: (mode?: "basic") => void;
  const selection = new Promise<"basic" | undefined>(resolve => { finish = resolve; });
  list.onSelect = item => {
    if (item.value === "basic") finish("basic");
    else { hint.setText(t.fullDisabledHint); tui.requestRender(); }
  };
  list.onCancel = () => finish();
  tui.addInputListener(data => {
    if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) { finish(); return { consume: true }; }
    return undefined;
  });
  const terminate = () => finish();
  process.once("SIGTERM", terminate);
  try { tui.start(); return await selection; }
  finally { process.removeListener("SIGTERM", terminate); tui.stop({ preserveScreen: true }); }
}

// No stored defaults: each interactive launch has two explicit selections.
export async function chooseStartup(
  engines: AvailableEngine[], terminal: Terminal = new ProcessTerminal(), version?: string, locale: Locale = "en",
): Promise<AvailableEngine | undefined> {
  if (!await chooseVisual(terminal, version, locale)) return undefined;
  return chooseEngine(engines, terminal, version, locale);
}
