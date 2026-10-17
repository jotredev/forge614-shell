import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { updateInstalledShell } from "../infrastructure/updater.ts";
import { updateEngines, type EnginesUpdateResult, type DetectRun } from "../infrastructure/forge614-engines.ts";
import { updateEngram, locateEngramBinary, type EngramUpdateResult } from "../infrastructure/forge614-engram.ts";
import { getCatalog, resolveConfiguredLocale } from "../i18n/index.ts";
import type { Locale } from "../i18n/index.ts";
import { describeError } from "../shell-error.ts";

export type ShellSpawn = (command: string, args: string[], options?: { stdio?: "inherit" | "pipe"; env?: NodeJS.ProcessEnv; windowsHide?: boolean }) => { status: number | null; stdout?: string | Buffer; stderr?: string | Buffer; error?: Error };

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
  readonly version?: string;
  readonly currentVersion?: string;
  readonly json?: boolean;
}

type UpdateOutcomeStatus = "updated" | "already-up-to-date" | "pending" | "not-installed" | "failed";

interface UpdateOutcome {
  readonly label: string;
  readonly status: UpdateOutcomeStatus;
  readonly detail?: string;
  readonly installedVersion?: string;
  readonly pendingVersion?: string;
}

function outcomeLine(outcome: UpdateOutcome, locale: Locale): string {
  const t = getCatalog(locale).update;
  if (outcome.status === "updated") return t.updated({ label: outcome.label, detail: outcome.detail });
  if (outcome.status === "already-up-to-date") return t.alreadyUpToDate({ label: outcome.label, detail: outcome.detail });
  if (outcome.status === "pending") {
    return t.pending({
      label: outcome.label,
      pendingVersion: outcome.pendingVersion ?? "",
      installedVersion: outcome.installedVersion,
    });
  }
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

function jsonOutcome(outcome: UpdateOutcome, locale: Locale): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = { status: outcome.status };
  if (outcome.installedVersion !== undefined) result.installedVersion = outcome.installedVersion;
  if (outcome.pendingVersion !== undefined) result.pendingVersion = outcome.pendingVersion;
  if (outcome.status === "failed") result.error = outcome.detail || getCatalog(locale).update.noDetailsReported;
  return result;
}

function enginesOutcome(result: EnginesUpdateResult): UpdateOutcome {
  if (!result.updated) return { label: "Forge614 Engines", status: "already-up-to-date", detail: result.latestVersion };
  return { label: "Forge614 Engines", status: "updated", detail: `${result.currentVersion} → ${result.latestVersion}` };
}

function engramOutcome(result: EngramUpdateResult): UpdateOutcome {
  if (result.pendingVersion !== undefined) {
    return {
      label: "Forge614 Engram",
      status: "pending",
      installedVersion: result.installedVersion,
      pendingVersion: result.pendingVersion,
    };
  }
  if (!result.updated) return { label: "Forge614 Engram", status: "already-up-to-date", detail: result.installedVersion };
  return { label: "Forge614 Engram", status: "updated", detail: `${result.previousVersion} → ${result.installedVersion}` };
}

/**
 * Refreshes Shell itself, then Forge614 Engines (always — a required Shell dependency), then
 * Forge614 Engram (only if its binary is present — Engram is optional for Shell). Human-readable
 * outcomes print as soon as each step completes; JSON mode gathers the three outcomes into one
 * object. Never invokes
 * anything beyond each product's own `update`/`update --json` command, so no memory, SQLite, `.env`,
 * MCP, or assistant configuration is ever touched here.
 */
export async function runUpdateCommand(options: RunUpdateOptions = {}): Promise<void> {
  const home = options.home ?? homedir();
  const locale = options.locale ?? resolveConfiguredLocale({ env: options.env, home: options.home }) ?? "en";
  let anyFailed = false;
  const jsonResults: Record<string, unknown> = {};
  const failures: string[] = [];

  try {
    const result = await updateInstalledShell({
      installer: options.installer,
      spawn: options.spawn,
      locale,
      env: options.env,
      version: options.version,
      currentVersion: options.currentVersion,
    });
    const outcome: UpdateOutcome = { label: "Forge614 Shell", status: result.updated ? "updated" : "already-up-to-date", installedVersion: result.installedVersion };
    if (options.json) jsonResults.shell = { ...jsonOutcome(outcome, locale), previousVersion: result.previousVersion, installedVersion: result.installedVersion };
    else report(outcome, locale);
  } catch (error) {
    anyFailed = true;
    const detail = describeError(error, locale);
    const outcome: UpdateOutcome = { label: "Forge614 Shell", status: "failed", detail };
    if (options.json) jsonResults.shell = jsonOutcome(outcome, locale);
    failures.push(getCatalog(locale).cli.updateFailed({ message: detail }));
  }

  try {
    const result = await updateEngines({ home: options.home, env: options.env, run: options.enginesRun });
    const outcome = enginesOutcome(result);
    if (options.json) jsonResults.engines = { ...jsonOutcome(outcome, locale), currentVersion: result.currentVersion, latestVersion: result.latestVersion, ...(result.note === undefined ? {} : { note: result.note }) };
    else report(outcome, locale);
  } catch (error) {
    anyFailed = true;
    const outcome: UpdateOutcome = { label: "Forge614 Engines", status: "failed", detail: describeError(error, locale) };
    if (options.json) jsonResults.engines = jsonOutcome(outcome, locale);
    failures.push(outcomeLine(outcome, locale));
  }

  try {
    const engramBinary = locateEngramBinary(home, options.env);
    const engramInstalled = (options.engramBinaryExists ?? existsSync)(engramBinary);
    if (!engramInstalled) {
      const outcome: UpdateOutcome = { label: "Forge614 Engram", status: "not-installed" };
      if (options.json) jsonResults.engram = jsonOutcome(outcome, locale);
      else report(outcome, locale);
    } else {
      const result = await updateEngram({ home: options.home, env: options.env, run: options.engramRun });
      const outcome = engramOutcome(result);
      if (options.json) jsonResults.engram = { ...jsonOutcome(outcome, locale), previousVersion: result.previousVersion, installedVersion: result.installedVersion, ...(result.pendingVersion === undefined ? {} : { pendingVersion: result.pendingVersion }) };
      else report(outcome, locale);
    }
  } catch (error) {
    anyFailed = true;
    const outcome: UpdateOutcome = { label: "Forge614 Engram", status: "failed", detail: describeError(error, locale) };
    if (options.json) jsonResults.engram = jsonOutcome(outcome, locale);
    failures.push(outcomeLine(outcome, locale));
  }

  if (options.json) {
    console.log(JSON.stringify({ schemaVersion: 1, result: jsonResults }));
  }
  if (anyFailed) {
    console.error(JSON.stringify({ schemaVersion: 1, code: "UPDATE_FAILED", error: failures.join("; ") }));
    process.exitCode = 1;
  }
}
