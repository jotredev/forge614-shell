import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { discoverSelectableEngines } from "../../infrastructure/forge614-engines.ts";
import { ShellError } from "../../shell-error.ts";

const exec = promisify(execFile);

// Refuse conflicting routing; never read, copy, print or refresh account tokens.
export function claudeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const conflicts = Object.keys(env).filter(key => env[key] && (
    /^(ANTHROPIC_(API_KEY|AUTH_TOKEN|BASE_URL|CUSTOM_HEADERS|PROFILE)|CLAUDE_CODE_(OAUTH_TOKEN|API_KEY|API_KEY_HELPER|USE_.*|BASE_URL))$/i.test(key)
  ));
  if (conflicts.length) throw new ShellError("claude-env-conflict", { keys: conflicts.join(", ") });
  return { ...env };
}

export function requireSubscription(status: { loggedIn?: boolean; authMethod?: string }): void {
  if (!status.loggedIn) throw new ShellError("claude-login-required");
  if (status.authMethod !== "claude.ai") throw new ShellError("claude-subscription-required");
}

export async function findClaude(env: NodeJS.ProcessEnv): Promise<string> {
  const engine = (await discoverSelectableEngines({ env })).find(engine => engine.id === "claude");
  if (engine) return engine.executable;
  throw new ShellError("claude-not-found");
}

export async function checkAuthentication(executable: string, env: NodeJS.ProcessEnv, cwd: string): Promise<void> {
  const { stdout } = await exec(executable, ["auth", "status", "--json"], {
    env: claudeEnvironment(env), cwd, timeout: 15_000, maxBuffer: 64 * 1024,
  });
  requireSubscription(JSON.parse(stdout));
}

export async function claudeLoginState(executable: string, env: NodeJS.ProcessEnv, cwd: string, run: (file: string, args: string[], options: object) => Promise<{ stdout: string }> = exec, signal?: AbortSignal): Promise<boolean> {
  let stdout: string;
  const options = { env: claudeEnvironment(env), cwd, timeout: 15000, maxBuffer: 65536, signal };
  try { stdout = (await run(executable, ["auth", "status", "--json"], options)).stdout; }
  catch (error) {
    // Claude may exit nonzero while returning a valid signed-out status.
    const output = (error as { stdout?: string }).stdout;
    if (!output) throw error;
    stdout = output;
  }
  signal?.throwIfAborted();
  const status = JSON.parse(stdout);
  if (status.loggedIn === false) return false;
  requireSubscription(status);
  return true;
}

export async function officialLogin(executable: string, env: NodeJS.ProcessEnv, cwd: string, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ["auth", "login"], { env: claudeEnvironment(env), cwd, stdio: "inherit", signal });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new ShellError("claude-login-exit-code", { code: String(code) })));
  });
}
