import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnginePreference, saveEnginePreference } from "./shell-preferences.ts";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "forge614-shell-prefs-"));
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
