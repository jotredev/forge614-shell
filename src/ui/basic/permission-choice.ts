import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";
import { normalizeSearch } from "./composer.ts";
import type { ForgeComposer } from "./composer.ts";

/**
 * The permission question of both assistants: two rows with words — «Sí» and «No» (or «Yes» and «No») — the approving
 * one first and marked, so Enter alone approves; the arrow (or the row's first letter) picks «No», and so does Esc. No
 * numbers, no slash commands, and one footer that says how to cancel the turn. Resolves `true` only for «Sí»; every
 * other way out (Esc, a typed `/no`, the turn being cancelled) is `false`. Typed `/yes` and `/no` still answer through
 * the chat's own command handling, which is not part of this selector.
 */
export async function askPermission(input: ForgeComposer, locale: Locale): Promise<boolean> {
  const t = getCatalog(locale).permission;
  const row = (value: string, display: string) => ({ value, display, label: "", key: normalizeSearch(display).charAt(0) });
  const choice = await input.choose(t.question, [row("yes", t.yes), row("no", t.no)], undefined, { numbered: false, footer: t.footer });
  return choice === "yes";
}
