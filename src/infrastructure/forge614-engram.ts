import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type { EngramInitDecisions } from "../contracts/engram-init.ts";

export type RunEngram = (command: string, args: string[]) => Promise<{ status: number | null; stdout: string; stderr: string }>;

export interface EngramInitApplyResult {
  readonly initResult: unknown;
  readonly reinforcementResult: unknown | null;
}

interface EngramErrorPayload {
  code?: unknown;
  error?: unknown;
}

const defaultRun: RunEngram = async (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

function locateEngramBinary(home: string, env?: NodeJS.ProcessEnv): string {
  const forgeHome = env?.FORGE614_HOME ?? join(home, ".forge614");
  return join(forgeHome, "engram", "bin", "forge614-engram");
}

function parseEngramError(stderr: string): string {
  try {
    const payload = JSON.parse(stderr) as EngramErrorPayload;
    if (typeof payload.error === "string" && payload.error) return payload.error;
  } catch { /* fall through to the generic message below */ }
  return "Forge614 Engram command failed.";
}

/** Masks every literal occurrence of the connection string, matching the summary screen's masking. */
function redactSecret(message: string, secret: string | null): string {
  return secret ? message.split(secret).join("********") : message;
}

async function runEngramCommand(
  command: string,
  args: string[],
  options: { home?: string; env?: NodeJS.ProcessEnv; run?: RunEngram },
): Promise<unknown> {
  const binary = locateEngramBinary(options.home ?? homedir(), options.env);
  const result = await (options.run ?? defaultRun)(binary, args);
  // A null status with nothing on stderr means the binary never ran (missing or not executable).
  if (result.status === null && !result.stderr.trim()) {
    throw new Error(`Forge614 Engram is unavailable at ${binary}. Install or reinstall Forge614 Engram to repair this dependency.`);
  }
  if (result.status !== 0) throw new Error(`forge614-engram ${command} failed: ${parseEngramError(result.stderr)}`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`forge614-engram ${command} returned an invalid result.`);
  }
}

/**
 * Applies confirmed Engram initialization decisions using only its public CLI:
 * `init --json` (optionally with `--postgres-url`), then `reinforcement-enable`
 * when requested. Never touches `~/.forge614/engram/` directly.
 */
export async function applyEngramInit(
  decisions: EngramInitDecisions,
  options: { home?: string; env?: NodeJS.ProcessEnv; run?: RunEngram } = {},
): Promise<EngramInitApplyResult> {
  const initArgs = decisions.postgresUrl !== null
    ? ["init", "--json", "--postgres-url", decisions.postgresUrl]
    : ["init", "--json"];
  let initResult: unknown;
  try {
    initResult = await runEngramCommand("init", initArgs, options);
  } catch (error) {
    // Last line of defence: the connection string must never reach any output, including error text.
    throw new Error(redactSecret(error instanceof Error ? error.message : String(error), decisions.postgresUrl));
  }
  let reinforcementResult: unknown | null = null;
  if (decisions.reinforcement) {
    try {
      reinforcementResult = await runEngramCommand("reinforcement-enable", ["reinforcement-enable"], options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message} Local memory initialization completed successfully; only reinforcement could not be enabled.`);
    }
  }
  return { initResult, reinforcementResult };
}
