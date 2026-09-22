import { ProcessTerminal, SelectList, Text, matchesKey } from "@earendil-works/pi-tui";
import type { Terminal } from "@earendil-works/pi-tui";
import { startupFrame } from "./frame.ts";
import { accent, muted } from "../basic/theme.ts";
import { getCatalog, guessSystemLocaleFocus } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";

export interface LanguageSelectorOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly version?: string;
}

/**
 * The bilingual first-run language selector. Runs before any other Shell TUI or visible text, in
 * its own short-lived alternate screen handed off to whatever screen runs next. The title and
 * hint are shown in both languages at once, since no locale is known yet. Esc/Ctrl-C/Ctrl-D cancel
 * the selector (and whatever command triggered it) rather than forcing a choice.
 */
export async function runLanguageSelector(
  terminal: Terminal = new ProcessTerminal(), options: LanguageSelectorOptions = {},
): Promise<Locale | undefined> {
  const plain = (text: string) => text;
  const items: { value: Locale; label: string }[] = [
    { value: "es", label: getCatalog("es").languageSelector.spanish },
    { value: "en", label: getCatalog("en").languageSelector.english },
  ];
  const list = new SelectList(items, 2, { selectedPrefix: accent, selectedText: accent, description: plain, scrollInfo: plain, noMatch: plain });
  list.setSelectedIndex(guessSystemLocaleFocus(options.env ?? process.env) === "es" ? 0 : 1);
  const hint = new Text(muted(`${getCatalog("es").languageSelector.hint}\n${getCatalog("en").languageSelector.hint}`));
  // Shown before any locale is known, so the title is bilingual on purpose — not pulled from
  // either catalog, whose own `languageSelector.title` is that locale's single-language phrasing
  // for reuse elsewhere (e.g. a future single-locale confirmation screen).
  const title = "Elige tu idioma / Choose your language";
  const tui = startupFrame(terminal, title, list, hint, undefined, options.version);
  let finish!: (locale: Locale | undefined) => void;
  const selection = new Promise<Locale | undefined>(resolve => { finish = resolve; });
  list.onSelect = item => finish(item.value as Locale);
  list.onCancel = () => finish(undefined);
  const unsubscribe = tui.addInputListener(data => {
    if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) { finish(undefined); return { consume: true }; }
    return undefined;
  });
  const terminate = () => finish(undefined);
  process.once("SIGTERM", terminate);
  try { tui.start(); return await selection; }
  finally { process.removeListener("SIGTERM", terminate); unsubscribe(); tui.stop({ preserveScreen: true }); }
}
