import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { updateInstalledShell } from "../infrastructure/updater.ts";
import { updateEngines, type EnginesUpdateResult, type DetectRun } from "../infrastructure/forge614-engines.ts";
import { updateEngram, locateEngramBinary, type EngramUpdateResult } from "../infrastructure/forge614-engram.ts";
import { getCatalog, resolveConfiguredLocale } from "../i18n/index.ts";
import type { Locale } from "../i18n/index.ts";
import { describeError } from "../shell-error.ts";

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
  /** Never prompts (this command never opens the language selector); resolved by the caller from
   * FORGE614_SHELL_LOCALE / preferences.json when omitted, defaulting to English. */
  readonly locale?: Locale;
}

type UpdateOutcomeStatus = "updated" | "already-up-to-date" | "not-installed" | "failed";

interface UpdateOutcome {
  readonly label: string;
  readonly status: UpdateOutcomeStatus;
  readonly detail?: string;
}

function outcomeLine(outcome: UpdateOutcome, locale: Locale): string {
  const t = getCatalog(locale).update;
  if (outcome.status === "updated") return t.updated({ label: outcome.label, detail: outcome.detail });
  if (outcome.status === "already-up-to-date") return t.alreadyUpToDate({ label: outcome.label, detail: outcome.detail });
  if (outcome.status === "not-installed") return t.notInstalled({ label: outcome.label });
  return t.failed({ label: outcome.label, detail: outcome.detail || t.noDetailsReported });
}

/** Prints an outcome the instant it's known, never buffered, so a later step's crash can never
 * discard an earlier step's already-decided result. Failures go to stderr, matching this command's
 * pre-existing convention; every other outcome goes to stdout. */
function report(outcome: UpdateOutcome, locale: Locale): void {
  if (outcome.status === "failed") console.error(outcomeLine(outcome, locale));
  else console.log(outcomeLine(outcome, locale));
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
  const locale = options.locale ?? resolveConfiguredLocale({ env: options.env, home: options.home }) ?? "en";
  let anyFailed = false;

  try {
    await updateInstalledShell({ installer: options.installer, spawn: options.spawn, locale, env: options.env });
    report({ label: "Forge614 Shell", status: "updated" }, locale);
  } catch (error) {
    anyFailed = true;
    report({ label: "Forge614 Shell", status: "failed", detail: describeError(error, locale) }, locale);
  }

  try {
    const result = await updateEngines({ home: options.home, env: options.env, run: options.enginesRun });
    report(enginesOutcome(result), locale);
  } catch (error) {
    anyFailed = true;
    report({ label: "Forge614 Engines", status: "failed", detail: describeError(error, locale) }, locale);
  }

  try {
    const engramBinary = locateEngramBinary(home, options.env);
    const engramInstalled = (options.engramBinaryExists ?? existsSync)(engramBinary);
    if (!engramInstalled) {
      report({ label: "Forge614 Engram", status: "not-installed" }, locale);
    } else {
      const result = await updateEngram({ home: options.home, env: options.env, run: options.engramRun });
      report(engramOutcome(result), locale);
    }
  } catch (error) {
    anyFailed = true;
    report({ label: "Forge614 Engram", status: "failed", detail: describeError(error, locale) }, locale);
  }

  if (anyFailed) process.exitCode = 1;
}
