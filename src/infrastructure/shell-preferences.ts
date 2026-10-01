import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export type EngineId = "claude" | "codex";
export interface EnginePreference {
  model?: string;
  effort?: string;
  /** The id of the last work mode used with this assistant, whatever it was (full access included), as its adapter lists it. */
  mode?: string;
  /** The id of the last collaboration mode used with this assistant (Codex: `plan` or `default`), as its adapter lists it. */
  collaborationMode?: string;
}
const ENGINE_IDS: readonly EngineId[] = ["claude", "codex"];

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
  lastEngine?: unknown;
  sidebarWidth?: unknown;
  sidebarHidden?: unknown;
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
  const mode = typeof entry.mode === "string" && entry.mode ? entry.mode : undefined;
  const collaborationMode = typeof entry.collaborationMode === "string" && entry.collaborationMode ? entry.collaborationMode : undefined;
  if (!model && !effort && !mode && !collaborationMode) return undefined;
  return { ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(mode ? { mode } : {}), ...(collaborationMode ? { collaborationMode } : {}) };
}

/**
 * Saves the model and reasoning picked for an assistant. Those two are replaced as a pair (an omitted one
 * is cleared), but the saved work mode and collaboration mode are left exactly as they were: they are saved
 * at other moments (`saveEngineMode`, `saveEngineCollaborationMode`) and a model change must never forget them.
 */
export function saveEnginePreference(engine: EngineId, preference: EnginePreference, options: PreferenceOptions = {}): void {
  const path = preferencesPath(options);
  const all = readAll(options);
  const { mode, collaborationMode } = loadEnginePreference(engine, options) ?? {};
  all[engine] = {
    ...(preference.model ? { model: preference.model } : {}), ...(preference.effort ? { effort: preference.effort } : {}),
    ...(mode ? { mode } : {}), ...(collaborationMode ? { collaborationMode } : {}),
  };
  // Best-effort only — a failed write just means the next session starts from scratch.
  writeAtomic(path, all);
}

/**
 * Saves the last work mode used with an assistant — any mode, the full-access one included — next to its
 * model and reasoning, which stay untouched. Best-effort like the rest: a failed write only means the
 * assistant opens in its default mode next time.
 */
export function saveEngineMode(engine: EngineId, mode: string, options: PreferenceOptions = {}): void {
  const all = readAll(options);
  const current = loadEnginePreference(engine, options) ?? {};
  all[engine] = { ...current, mode };
  writeAtomic(preferencesPath(options), all);
}

/**
 * Saves the last collaboration mode used with an assistant (Codex: Plan or Default) next to its model and work
 * mode, which stay untouched. Best-effort like the rest: a failed write only means it opens in its default next time.
 */
export function saveEngineCollaborationMode(engine: EngineId, collaborationMode: string, options: PreferenceOptions = {}): void {
  const all = readAll(options);
  const current = loadEnginePreference(engine, options) ?? {};
  all[engine] = { ...current, collaborationMode };
  writeAtomic(preferencesPath(options), all);
}

/** The assistant used last time, or none when nothing was saved or the saved value is not an assistant Shell knows. */
export function loadLastEngine(options: PreferenceOptions = {}): EngineId | undefined {
  const value = readAll(options).lastEngine;
  return ENGINE_IDS.find(engine => engine === value);
}

/** Remembers which assistant was used, so the startup picker can mark it. Keeps every other saved field. Best-effort. */
export function saveLastEngine(engine: EngineId, options: PreferenceOptions = {}): void {
  writeAtomic(preferencesPath(options), { ...readAll(options), lastEngine: engine });
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

/** The sidebar's width in columns: what a saved value must fall within, and what it is when none (or an invalid one) is saved. The screen's own layout clamps with the same limits. */
export const SIDEBAR_WIDTH = { min: 28, max: 70, fallback: 36 } as const;

/**
 * The sidebar's remembered width. Anything that is not a number from 28 to 70 (a missing field, a string, a damaged or hand-edited value) is ignored and reads as 36, so a bad
 * file can never leave the screen without its sidebar; a fractional number is rounded to whole columns.
 */
export function loadSidebarWidth(options: PreferenceOptions = {}): number {
  const value = readAll(options).sidebarWidth;
  if (typeof value !== "number" || !Number.isFinite(value)) return SIDEBAR_WIDTH.fallback;
  const columns = Math.round(value);
  return columns >= SIDEBAR_WIDTH.min && columns <= SIDEBAR_WIDTH.max ? columns : SIDEBAR_WIDTH.fallback;
}

/** Remembers the sidebar's width, keeping every other saved field. Best-effort like the rest: a failed write only means the next session starts with 36 columns. */
export function saveSidebarWidth(width: number, options: PreferenceOptions = {}): void {
  writeAtomic(preferencesPath(options), { ...readAll(options), sidebarWidth: width });
}

/** Whether the person hid the sidebar: only an exact `true` counts, anything else (a missing field, another type) reads as shown. */
export function loadSidebarHidden(options: PreferenceOptions = {}): boolean {
  return readAll(options).sidebarHidden === true;
}

/** Remembers whether the sidebar is hidden, keeping every other saved field. Best-effort like the rest. */
export function saveSidebarHidden(hidden: boolean, options: PreferenceOptions = {}): void {
  writeAtomic(preferencesPath(options), { ...readAll(options), sidebarHidden: hidden });
}
