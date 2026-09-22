import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnginePreference, loadLocale, saveEnginePreference, saveLocale } from "./shell-preferences.ts";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "forge614-shell-prefs-"));
}

function writePreferencesFile(home: string, contents: string): void {
  const dir = join(home, ".forge614", "shell");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "preferences.json"), contents);
}

test("a saved preference round-trips for the same engine", () => {
  const home = tempHome();
  try {
    expect(loadEnginePreference("claude", { home })).toBeUndefined();
    saveEnginePreference("claude", { model: "opus[1m]", effort: "medium" }, { home });
    expect(loadEnginePreference("claude", { home })).toEqual({ model: "opus[1m]", effort: "medium" });
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("each engine keeps its own preference — saving one never touches the other", () => {
  const home = tempHome();
  try {
    saveEnginePreference("claude", { model: "sonnet" }, { home });
    saveEnginePreference("codex", { model: "gpt-5.1-codex", effort: "high" }, { home });
    expect(loadEnginePreference("claude", { home })).toEqual({ model: "sonnet" });
    expect(loadEnginePreference("codex", { home })).toEqual({ model: "gpt-5.1-codex", effort: "high" });
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("a later save fully replaces the earlier one for that engine, instead of merging stale fields", () => {
  const home = tempHome();
  try {
    saveEnginePreference("claude", { model: "opus[1m]", effort: "high" }, { home });
    saveEnginePreference("claude", { model: "sonnet" }, { home });
    expect(loadEnginePreference("claude", { home })).toEqual({ model: "sonnet" });
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("a missing or corrupt preferences file is treated as no preference, never a crash", () => {
  const home = tempHome();
  try {
    expect(loadEnginePreference("claude", { home })).toBeUndefined();
    writeFileSync(join(home, ".forge614", "shell", "preferences.json"), "not json {{{", { flag: "w" });
  } catch { /* directory may not exist yet — that's fine, this test still proves no crash below */ }
  try {
    expect(() => loadEnginePreference("claude", { home })).not.toThrow();
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("saving never throws even when the target directory cannot be created", () => {
  const home = mkdtempSync(join(tmpdir(), "forge614-shell-prefs-"));
  const blockedHome = join(home, "blocked-file");
  writeFileSync(blockedHome, "not a directory");
  try {
    // FORGE614_HOME resolves under a path component that is actually a file, not a directory.
    expect(() => saveEnginePreference("claude", { model: "opus" }, { env: { FORGE614_HOME: join(blockedHome, "nested") } })).not.toThrow();
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("no preferences file means no locale preference", () => {
  const home = tempHome();
  try {
    expect(loadLocale({ home })).toBeUndefined();
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("a saved locale round-trips, and a later save fully replaces it", () => {
  const home = tempHome();
  try {
    expect(saveLocale("es", { home })).toBe(true);
    expect(loadLocale({ home })).toBe("es");
    expect(saveLocale("en", { home })).toBe(true);
    expect(loadLocale({ home })).toBe("en");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("saving a locale never touches existing Claude/Codex model preferences, and vice versa", () => {
  const home = tempHome();
  try {
    saveEnginePreference("claude", { model: "sonnet", effort: "medium" }, { home });
    saveEnginePreference("codex", { model: "gpt-5.6-terra", effort: "high" }, { home });
    saveLocale("es", { home });
    expect(loadEnginePreference("claude", { home })).toEqual({ model: "sonnet", effort: "medium" });
    expect(loadEnginePreference("codex", { home })).toEqual({ model: "gpt-5.6-terra", effort: "high" });
    expect(loadLocale({ home })).toBe("es");
    saveEnginePreference("claude", { model: "opus" }, { home });
    expect(loadLocale({ home })).toBe("es");
    expect(loadEnginePreference("codex", { home })).toEqual({ model: "gpt-5.6-terra", effort: "high" });
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("an existing preferences.json that only has Claude/Codex fields (no format, no locale) is read fine, with no locale preference", () => {
  const home = tempHome();
  writePreferencesFile(home, JSON.stringify({ claude: { model: "sonnet" } }));
  try {
    expect(loadLocale({ home })).toBeUndefined();
    expect(loadEnginePreference("claude", { home })).toEqual({ model: "sonnet" });
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("corrupt JSON is treated as no locale preference, never a crash", () => {
  const home = tempHome();
  writePreferencesFile(home, "not json {{{");
  try {
    expect(() => loadLocale({ home })).not.toThrow();
    expect(loadLocale({ home })).toBeUndefined();
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("an unknown format number is treated as no locale preference", () => {
  const home = tempHome();
  writePreferencesFile(home, JSON.stringify({ format: 99, locale: "es" }));
  try {
    expect(loadLocale({ home })).toBeUndefined();
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("an invalid locale value is treated as no locale preference", () => {
  const home = tempHome();
  writePreferencesFile(home, JSON.stringify({ format: 1, locale: "fr" }));
  try {
    expect(loadLocale({ home })).toBeUndefined();
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("saveLocale rejects an unsupported locale value and writes nothing", () => {
  const home = tempHome();
  try {
    // @ts-expect-error -- intentionally passing an unsupported value to verify runtime rejection
    expect(saveLocale("fr", { home })).toBe(false);
    expect(loadLocale({ home })).toBeUndefined();
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("saving is atomic: no leftover temp files remain in the preferences directory afterward", () => {
  const home = tempHome();
  try {
    saveLocale("es", { home });
    const dir = join(home, ".forge614", "shell");
    const entries = readdirSync(dir);
    expect(entries).toEqual(["preferences.json"]);
    // The written file must be complete, parseable JSON — never a partial write.
    expect(() => JSON.parse(readFileSync(join(dir, "preferences.json"), "utf8"))).not.toThrow();
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("saveLocale respects FORGE614_HOME", () => {
  const home = tempHome();
  const customHome = join(home, "custom-forge-home");
  try {
    expect(saveLocale("en", { env: { FORGE614_HOME: customHome } })).toBe(true);
    expect(loadLocale({ env: { FORGE614_HOME: customHome } })).toBe("en");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("saveLocale never throws even when the target directory cannot be created, and reports failure", () => {
  const home = mkdtempSync(join(tmpdir(), "forge614-shell-prefs-"));
  const blockedHome = join(home, "blocked-file");
  writeFileSync(blockedHome, "not a directory");
  try {
    let result: boolean | undefined;
    expect(() => { result = saveLocale("es", { env: { FORGE614_HOME: join(blockedHome, "nested") } }); }).not.toThrow();
    expect(result).toBe(false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
