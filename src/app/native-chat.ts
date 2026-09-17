import { startNativeProcess } from "../engines/process.ts";
import { CodexSession } from "../engines/codex/session.ts";
import { GeminiSession } from "../engines/gemini/session.ts";
import { checkGeminiConfiguration } from "../engines/gemini/config.ts";
import type { NativeId } from "../engines/types.ts";
import { runNativeUI } from "../ui/basic/native.ts";
import { AntigravitySession } from "../engines/antigravity/session.ts";
import { antigravityLogin, antigravityLoginState, antigravityModels, checkAntigravityAccountMode, runAntigravity } from "../engines/antigravity/process.ts";

// Composition root: views render sessions; they do not construct transports.
export async function startNativeUI(id: NativeId, executable: string, args: string[]): Promise<void> {
  if (args.length) throw new Error(`${id} mode accepts no CLI options yet. Use the in-chat commands.`);
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Native chat requires an interactive terminal.");
  const cwd = process.cwd();
  if (id === "gemini") await checkGeminiConfiguration(cwd, process.env);
  if (id === "antigravity") await checkAntigravityAccountMode(process.env);
  await runNativeUI(id, cwd, (emit, approve, withTerminal) => {
    if (id === "antigravity") return new AntigravitySession(emit, {
      checkLogin: signal => antigravityLoginState(executable, cwd, process.env, signal),
      confirmLogout: approve,
      confirmLogin: signal => approve("Google sign-in is required. Antigravity only offers interactive login through native agy. Open it temporarily? Sign in there, then exit agy to return to Shell.", signal),
      models: () => antigravityModels(executable, cwd, process.env),
      login: signal => withTerminal(() => antigravityLogin(executable, cwd, process.env, signal)),
      run: async (args, prompt, event, signal) => {
        await checkAntigravityAccountMode(process.env);
        await runAntigravity(executable, args, prompt, cwd, process.env, event, signal);
      },
    });
    const rpc = startNativeProcess(id, executable, cwd, process.env, text => emit({ type: "text", text }));
    return id === "codex" ? new CodexSession(rpc, cwd, emit, approve)
      : new GeminiSession(rpc, cwd, emit, approve, () => checkGeminiConfiguration(cwd, process.env));
  });
}
