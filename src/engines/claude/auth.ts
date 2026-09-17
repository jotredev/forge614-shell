import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { discoverEngines } from "../discovery.ts";

const exec = promisify(execFile);

// Refuse conflicting routing; never read, copy, print or refresh account tokens.
export function claudeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const conflicts = Object.keys(env).filter(key => env[key] && (
    /^(ANTHROPIC_(API_KEY|AUTH_TOKEN|BASE_URL|CUSTOM_HEADERS|PROFILE)|CLAUDE_CODE_(OAUTH_TOKEN|API_KEY|API_KEY_HELPER|USE_.*|BASE_URL))$/i.test(key)
  ));
  if (conflicts.length) throw new Error(`Subscription mode cannot start with these overrides: ${conflicts.join(", ")}. Use a clean terminal; no account settings were changed.`);
  return { ...env };
}

export function requireSubscription(status: { loggedIn?: boolean; authMethod?: string }): void {
  if (!status.loggedIn) throw new Error("Please use /login to sign in through official Claude Code.");
  if (status.authMethod !== "claude.ai") throw new Error("This connector requires a Claude subscription login, not API or cloud authentication. Use /login.");
}

export async function findClaude(env: NodeJS.ProcessEnv): Promise<string> {
  const engine = (await discoverEngines(env)).find(engine => engine.id === "claude");
  if (engine) return engine.executable;
  throw new Error("Official Claude Code was not found on PATH. Install Claude Code first. Automatic installation is not available in this delivery.");
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
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Claude Code login exited with code ${code}.`)));
  });
}
