import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export type EngineId = "claude" | "codex";
export interface EnginePreference {
  model?: string;
  effort?: string;
}

/** The only locale values Shell's i18n layer currently ships a catalog for. */
export type Locale = "es" | "en";
const SUPPORTED_LOCALES: readonly Locale[] = ["es", "en"];
const CURRENT_FORMAT = 1;

interface PreferenceOptions {
  home?: string;
  env?: NodeJS.ProcessEnv;
}

interface PreferencesFile {
  format?: unknown;
  locale?: unknown;
  claude?: EnginePreference;
  codex?: EnginePreference;
}

function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Shell's own remembered model/reasoning choice per engine — separate from each native CLI's own
 * config. The native `claude`/`codex` CLIs remember a picked default themselves when used directly;
 * Shell picks through its own UI and stores its own pick here rather than writing into the native
 * config files it does not own. Never crashes Shell: preferences are a convenience, not a dependency.
 */
function preferencesPath(options: PreferenceOptions = {}): string {
  const home = options.home ?? homedir();
  const forgeHome = options.env?.FORGE614_HOME ?? join(home, ".forge614");
  return join(forgeHome, "shell", "preferences.json");
}

function readAll(options: PreferenceOptions = {}): PreferencesFile {
  try {
    const raw = JSON.parse(readFileSync(preferencesPath(options), "utf8"));
    if (!raw || typeof raw !== "object") return {};
    return raw as PreferencesFile;
  } catch {
    return {};
  }
}

/**
 * Writes JSON to `path` atomically: a temp file in the same directory, then a rename over the
 * target. A crash or concurrent read can never observe a partially-written file this way. Returns
 * `false` instead of throwing — persistence here is always secondary to Shell staying usable.
 */
function writeAtomic(path: string, data: unknown): boolean {
  try {
    const dir = join(path, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmpPath = join(dir, `.preferences.${randomUUID()}.tmp`);
    writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    renameSync(tmpPath, path);
    return true;
  } catch {
    return false;
  }
}

export function loadEnginePreference(engine: EngineId, options: PreferenceOptions = {}): EnginePreference | undefined {
  const entry = readAll(options)[engine];
  if (!entry || typeof entry !== "object") return undefined;
  const model = typeof entry.model === "string" && entry.model ? entry.model : undefined;
  const effort = typeof entry.effort === "string" && entry.effort ? entry.effort : undefined;
  if (!model && !effort) return undefined;
  return { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
}

export function saveEnginePreference(engine: EngineId, preference: EnginePreference, options: PreferenceOptions = {}): void {
  const path = preferencesPath(options);
  const all = readAll(options);
  all[engine] = { ...(preference.model ? { model: preference.model } : {}), ...(preference.effort ? { effort: preference.effort } : {}) };
  // Best-effort only — a failed write just means the next session starts from scratch.
  writeAtomic(path, all);
}

/**
 * Shell's own persistent language choice, read from the same file as the model/reasoning
 * preferences. Never throws: a missing file, corrupt JSON, an unrecognized `format`, or an
 * unsupported `locale` value are all treated identically as "no preference" rather than an error.
 */
export function loadLocale(options: PreferenceOptions = {}): Locale | undefined {
  const all = readAll(options);
  if (all.format !== undefined && all.format !== CURRENT_FORMAT) return undefined;
  return isSupportedLocale(all.locale) ? all.locale : undefined;
}

/**
 * Persists the chosen locale, preserving any existing Claude/Codex preferences already in the
 * file. Returns whether the write actually succeeded — unlike `saveEnginePreference`, a caller
 * here (the language selector, the `language` command) is expected to warn the person when it
 * returns `false`, rather than silently continuing as if it were saved.
 */
export function saveLocale(locale: Locale, options: PreferenceOptions = {}): boolean {
  if (!isSupportedLocale(locale)) return false;
  const path = preferencesPath(options);
  const all = readAll(options);
  const next: PreferencesFile = { ...all, format: CURRENT_FORMAT, locale };
  return writeAtomic(path, next);
}
