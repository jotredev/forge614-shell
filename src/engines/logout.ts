import type { Confirm } from "./types.ts";
import { getCatalog } from "../i18n/index.ts";
import type { Locale } from "../i18n/index.ts";

/**
 * Asks before disconnecting Shell (never the native account) and disconnects only on «Yes». The question is Shell's own — «No, stay connected» first and marked, so Enter alone
 * keeps things as they are — and never the assistant's permission question (`Approve`), whose marked row approves. `loginCommand` is the command the body names for
 * reconnecting: Claude Code's own `/login`, or Shell's `/f614:login` with Codex.
 */
export async function confirmedLogout(engine: string, confirm: Confirm, signal: AbortSignal, logout: () => Promise<void>, locale: Locale = "en", loginCommand = "/login"): Promise<boolean> {
  const t = getCatalog(locale).logout;
  if (signal.aborted) return false;
  const allowed = await confirm({ title: t.confirmTitle({ engine }), no: t.stay, yes: t.disconnect, body: t.confirmBody({ loginCommand }) }, signal);
  if (!allowed || signal.aborted) return false;
  try { await logout(); }
  catch { throw new Error(t.disconnectFailed); }
  return true;
}
