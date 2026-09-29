import type { Approve } from "./types.ts";
import { getCatalog } from "../i18n/index.ts";
import type { Locale } from "../i18n/index.ts";

/** Asks before disconnecting Shell (never the native account); `loginCommand` is the command the question names for reconnecting: Claude Code's own `/login`, or Shell's `/f614:login` with Codex. */
export async function confirmedLogout(engine: string, approve: Approve, signal: AbortSignal, logout: () => Promise<void>, locale: Locale = "en", loginCommand = "/login"): Promise<boolean> {
  const t = getCatalog(locale).logout;
  if (signal.aborted) return false;
  const allowed = await approve(t.confirmPrompt({ engine, loginCommand }), signal);
  if (!allowed || signal.aborted) return false;
  try { await logout(); }
  catch { throw new Error(t.disconnectFailed); }
  return true;
}
