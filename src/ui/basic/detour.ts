import type { NativeDetour } from "../../engines/types.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";

/**
 * The words the screen uses to show that what is on it is not the main conversation: a side conversation (what is written there goes to that branch) or a subagent being
 * watched (read only). Shell's own text, in both languages — Codex's own screen has a context label («Side from main thread · ctrl+c to close») and these say the same.
 */

/** What the watched subagent is called on screen: the assistant's name for it, or a generic word when it gave none. */
const agentName = (detour: NativeDetour, locale: Locale) => detour.name || getCatalog(locale).codexNative.subagentAgent;

/** The line at the top of the detour's view. */
export function detourHeader(detour: NativeDetour, locale: Locale): string {
  const nt = getCatalog(locale).codexNative;
  return detour.kind === "side" ? nt.sideHeader : nt.agentHeader({ name: agentName(detour, locale) });
}

/** The short name of the detour, for the busy line («Working · Side conversation · 12s»). */
export function detourTitle(detour: NativeDetour, locale: Locale): string {
  const nt = getCatalog(locale).codexNative;
  return detour.kind === "side" ? nt.sideTitle : nt.agentTitle({ name: agentName(detour, locale) });
}

/** The fixed line in the box while the detour is on screen: where the person is, what happens to what they write and how to leave. */
export function detourStatus(detour: NativeDetour, locale: Locale): string {
  const nt = getCatalog(locale).codexNative;
  if (detour.kind === "agent") return [detourTitle(detour, locale), nt.agentReadOnly, nt.agentReturnHint].join(" · ");
  return [nt.sideTitle, nt.sideFromMain, ...(detour.mainNeedsApproval ? [nt.sideMainNeedsApproval] : []), nt.sideCloseHint].join(" · ");
}
