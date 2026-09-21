import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { updateInstalledShell } from "../infrastructure/updater.ts";
import { updateEngines, type EnginesUpdateResult } from "../infrastructure/forge614-engines.ts";
import { updateEngram, locateEngramBinary, type EngramUpdateResult, type RunEngram } from "../infrastructure/forge614-engram.ts";

type ShellSpawn = (command: string, args: string[], options?: { stdio?: "inherit" }) => { status: number | null; stderr?: string | Buffer; error?: Error };

export interface RunUpdateOptions {
  readonly home?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Test seam for Shell's own bundled-installer path; production callers omit this. */
  readonly installer?: string;
  /** Test seam for Shell's own installer subprocess; production callers omit this. */
  readonly spawn?: ShellSpawn;
  readonly enginesRun?: RunEngram;
  readonly engramRun?: RunEngram;
  /** Test seam replacing node:fs's existsSync; production callers omit this. */
  readonly engramBinaryExists?: (path: string) => boolean;
}

type UpdateOutcomeStatus = "updated" | "already-up-to-date" | "not-installed" | "failed";

interface UpdateOutcome {
  readonly label: string;
  readonly status: UpdateOutcomeStatus;
  readonly detail?: string;
}

function outcomeLine(outcome: UpdateOutcome): string {
  if (outcome.status === "updated") return `${outcome.label}: updated${outcome.detail ? ` (${outcome.detail})` : ""}`;
  if (outcome.status === "already-up-to-date") return `${outcome.label}: already up to date${outcome.detail ? ` (${outcome.detail})` : ""}`;
  if (outcome.status === "not-installed") return `${outcome.label}: not installed, skipped`;
  return `${outcome.label}: update failed — ${outcome.detail}`;
}

function enginesOutcome(result: EnginesUpdateResult): UpdateOutcome {
  if (!result.updated) return { label: "Forge614 Engines", status: "already-up-to-date", detail: result.latestVersion };
  return { label: "Forge614 Engines", status: "updated", detail: `${result.currentVersion} → ${result.latestVersion}` };
}

function engramOutcome(result: EngramUpdateResult): UpdateOutcome {
  if (!result.updated) return { label: "Forge614 Engram", status: "already-up-to-date", detail: result.installedVersion };
  return { label: "Forge614 Engram", status: "updated", detail: `${result.previousVersion} → ${result.installedVersion}` };
}

/**
 * Refreshes Shell itself, then Forge614 Engines (always — a required Shell dependency), then
 * Forge614 Engram (only if its binary is present — Engram is optional for Shell). Every outcome is
 * reported independently; one failing never hides, skips, or is presented as success for the
 * others. Never invokes anything beyond each product's own `update`/`update --json` command, so no
 * memory, SQLite, `.env`, MCP, or assistant configuration is ever touched here.
 */
export async function runUpdateCommand(options: RunUpdateOptions = {}): Promise<void> {
  const home = options.home ?? homedir();
  const outcomes: UpdateOutcome[] = [];
  let anyFailed = false;

  try {
    await updateInstalledShell({ installer: options.installer, spawn: options.spawn });
    outcomes.push({ label: "Forge614 Shell", status: "updated" });
  } catch (error) {
    anyFailed = true;
    outcomes.push({ label: "Forge614 Shell", status: "failed", detail: error instanceof Error ? error.message : String(error) });
  }

  try {
    const result = await updateEngines({ home: options.home, env: options.env, run: options.enginesRun });
    outcomes.push(enginesOutcome(result));
  } catch (error) {
    anyFailed = true;
    outcomes.push({ label: "Forge614 Engines", status: "failed", detail: error instanceof Error ? error.message : String(error) });
  }

  const engramBinary = locateEngramBinary(home, options.env);
  const engramInstalled = (options.engramBinaryExists ?? existsSync)(engramBinary);
  if (!engramInstalled) {
    outcomes.push({ label: "Forge614 Engram", status: "not-installed" });
  } else {
    try {
      const result = await updateEngram({ home: options.home, env: options.env, run: options.engramRun });
      outcomes.push(engramOutcome(result));
    } catch (error) {
      anyFailed = true;
      outcomes.push({ label: "Forge614 Engram", status: "failed", detail: error instanceof Error ? error.message : String(error) });
    }
  }

  for (const outcome of outcomes) console.log(outcomeLine(outcome));
  if (anyFailed) process.exitCode = 1;
}
