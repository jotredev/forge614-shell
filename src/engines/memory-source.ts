import { getCatalog } from "../i18n/index.ts";
import type { Locale } from "../i18n/index.ts";

/**
 * The status line that says where Engram's memory comes from, for `/f614:status` (Claude Code) and `/status` (Codex): the assistant's own
 * startup hook delivers it (`byAssistant`), or Shell pastes its block as a fallback. It lets the person check it without asking the model.
 */
export function memorySourceLine(byAssistant: boolean, locale: Locale): string {
  const t = getCatalog(locale).memorySource;
  return byAssistant ? t.byAssistant : t.byShell;
}
