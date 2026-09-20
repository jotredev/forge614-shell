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

async function runEngramCommand(
  args: string[],
  options: { home?: string; env?: NodeJS.ProcessEnv; run?: RunEngram },
): Promise<unknown> {
  const binary = locateEngramBinary(options.home ?? homedir(), options.env);
  const result = await (options.run ?? defaultRun)(binary, args);
  if (result.status !== 0) throw new Error(parseEngramError(result.stderr));
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("Forge614 Engram returned an invalid result.");
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
  const initResult = await runEngramCommand(initArgs, options);
  const reinforcementResult = decisions.reinforcement
    ? await runEngramCommand(["reinforcement-enable"], options)
    : null;
  return { initResult, reinforcementResult };
}
