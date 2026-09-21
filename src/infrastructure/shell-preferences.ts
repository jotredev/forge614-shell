import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type EngineId = "claude" | "codex";
export interface EnginePreference {
  model?: string;
  effort?: string;
}

interface PreferenceOptions {
  home?: string;
  env?: NodeJS.ProcessEnv;
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

function readAll(options: PreferenceOptions = {}): Partial<Record<EngineId, EnginePreference>> {
  try {
    const raw = JSON.parse(readFileSync(preferencesPath(options), "utf8"));
    if (!raw || typeof raw !== "object") return {};
    return raw as Partial<Record<EngineId, EnginePreference>>;
  } catch {
    return {};
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
  try {
    const path = preferencesPath(options);
    const all = readAll(options);
    all[engine] = { ...(preference.model ? { model: preference.model } : {}), ...(preference.effort ? { effort: preference.effort } : {}) };
    const dir = join(path, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(all, null, 2));
  } catch {
    // Best-effort only — a failed write just means the next session starts from scratch.
  }
}
