import type { Approve } from "./types.ts";
import { getCatalog } from "../i18n/index.ts";
import type { Locale } from "../i18n/index.ts";

export async function confirmedLogout(engine: string, approve: Approve, signal: AbortSignal, logout: () => Promise<void>, locale: Locale = "en"): Promise<boolean> {
  const t = getCatalog(locale).logout;
  if (signal.aborted) return false;
  const allowed = await approve(t.confirmPrompt({ engine }), signal);
  if (!allowed || signal.aborted) return false;
  try { await logout(); }
  catch { throw new Error(t.disconnectFailed); }
  return true;
}
