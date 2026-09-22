import { spawn } from "node:child_process";

export type SpawnHandoff = (executable: string, cwd: string, env: NodeJS.ProcessEnv) => Promise<void>;

/**
 * Hands the real terminal to a native AI client's own binary — never Shell's own SDK/RPC-driven
 * chat adapters. Those talk to Codex over `app-server` JSON-RPC, which has no way to surface
 * Codex's native `/hooks` trust prompt, and drive Claude through the Agent SDK rather than the
 * plain interactive CLI. This is the only way to guarantee the client's own real SessionStart
 * fires and, for Codex, that any hook-trust prompt is the user's own client asking the user
 * directly. Resolves once the client exits, whatever the exit code — the caller decides success
 * by asking Engines to `verify` again afterward, never from this function's return value alone.
 */
export const runInteractiveHandoff: SpawnHandoff = (executable, cwd, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, [], { cwd, env, stdio: "inherit", windowsHide: false });
    child.once("error", error => reject(new Error(`${executable} could not be started: ${error.message}`)));
    child.once("exit", () => resolve());
  });
