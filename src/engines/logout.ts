import type { Approve } from "./types.ts";

export async function confirmedLogout(engine: string, approve: Approve, signal: AbortSignal, logout: () => Promise<void>): Promise<boolean> {
  if (signal.aborted) return false;
  const allowed = await approve(`Disconnect ${engine} only in this Forge614-Shell session? Your native account, Orca, other terminals and saved chats will not be changed. Use /login here to reconnect with your existing account.`, signal);
  if (!allowed || signal.aborted) return false;
  try { await logout(); }
  catch { throw new Error("Could not disconnect Shell. No native logout was requested."); }
  return true;
}
