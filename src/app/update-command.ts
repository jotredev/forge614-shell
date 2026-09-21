import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { updateInstalledShell } from "../infrastructure/updater.ts";
import { updateEngines, type EnginesUpdateResult, type DetectRun } from "../infrastructure/forge614-engines.ts";
import { updateEngram, locateEngramBinary, type EngramUpdateResult } from "../infrastructure/forge614-engram.ts";

export type ShellSpawn = (command: string, args: string[], options?: { stdio?: "inherit" }) => { status: number | null; stderr?: string | Buffer; error?: Error };

export interface RunUpdateOptions {
  readonly home?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Test seam for Shell's own bundled-installer path; production callers omit this. */
  readonly installer?: string;
  /** Test seam for Shell's own installer subprocess; production callers omit this. */
  readonly spawn?: ShellSpawn;
  readonly enginesRun?: DetectRun;
  readonly engramRun?: DetectRun;
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
  return `${outcome.label}: update failed — ${outcome.detail || "no details were reported."}`;
}

/** Prints an outcome the instant it's known, never buffered, so a later step's crash can never
 * discard an earlier step's already-decided result. Failures go to stderr, matching this command's
 * pre-existing convention; every other outcome goes to stdout. */
function report(outcome: UpdateOutcome): void {
  if (outcome.status === "failed") console.error(outcomeLine(outcome));
  else console.log(outcomeLine(outcome));
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
 * printed the instant it's known, not buffered, so the "one failure never hides another" guarantee
 * holds by construction, not only when nothing after a given step happens to throw. Never invokes
 * anything beyond each product's own `update`/`update --json` command, so no memory, SQLite, `.env`,
 * MCP, or assistant configuration is ever touched here.
 */
export async function runUpdateCommand(options: RunUpdateOptions = {}): Promise<void> {
  const home = options.home ?? homedir();
  let anyFailed = false;

  try {
    await updateInstalledShell({ installer: options.installer, spawn: options.spawn });
    report({ label: "Forge614 Shell", status: "updated" });
  } catch (error) {
    anyFailed = true;
    report({ label: "Forge614 Shell", status: "failed", detail: error instanceof Error ? error.message : String(error) });
  }

  try {
    const result = await updateEngines({ home: options.home, env: options.env, run: options.enginesRun });
    report(enginesOutcome(result));
  } catch (error) {
    anyFailed = true;
    report({ label: "Forge614 Engines", status: "failed", detail: error instanceof Error ? error.message : String(error) });
  }

  try {
    const engramBinary = locateEngramBinary(home, options.env);
    const engramInstalled = (options.engramBinaryExists ?? existsSync)(engramBinary);
    if (!engramInstalled) {
      report({ label: "Forge614 Engram", status: "not-installed" });
    } else {
      const result = await updateEngram({ home: options.home, env: options.env, run: options.engramRun });
      report(engramOutcome(result));
    }
  } catch (error) {
    anyFailed = true;
    report({ label: "Forge614 Engram", status: "failed", detail: error instanceof Error ? error.message : String(error) });
  }

  if (anyFailed) process.exitCode = 1;
}
