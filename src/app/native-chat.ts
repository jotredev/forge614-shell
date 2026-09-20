import { startNativeProcess } from "../engines/process.ts";
import { CodexSession } from "../engines/codex/session.ts";
import type { NativeId } from "../engines/types.ts";
import { runNativeUI } from "../ui/basic/native.ts";

// Composition root: views render sessions; they do not construct transports.
export async function startNativeUI(id: NativeId, executable: string, args: string[], version?: string): Promise<void> {
  if (args.length) throw new Error(`${id} mode accepts no CLI options yet. Use the in-chat commands.`);
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Native chat requires an interactive terminal.");
  const cwd = process.cwd();
  await runNativeUI(id, cwd, (emit, approve) => {
    const rpc = startNativeProcess(id, executable, cwd, process.env, text => emit({ type: "text", text }));
    return new CodexSession(rpc, cwd, emit, approve);
  }, undefined, version);
}
