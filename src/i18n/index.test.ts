import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveLocale } from "../infrastructure/shell-preferences.ts";
import { getCatalog, guessSystemLocaleFocus, isSupportedLocale, resolveConfiguredLocale } from "./index.ts";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "forge614-shell-i18n-"));
}

test("getCatalog returns a distinct, fully-populated catalog for each supported locale", () => {
  expect(getCatalog("en").result.cancelledBody).toBe("Cancelled. No changes were made.");
  expect(getCatalog("es").result.cancelledBody).toBe("Cancelado. No se hicieron cambios.");
});

test("isSupportedLocale accepts only es and en", () => {
  expect(isSupportedLocale("es")).toBe(true);
  expect(isSupportedLocale("en")).toBe(true);
  expect(isSupportedLocale("fr")).toBe(false);
  expect(isSupportedLocale(undefined)).toBe(false);
  expect(isSupportedLocale(1)).toBe(false);
});

test("resolveConfiguredLocale: no env override and no saved preference means no configured locale", () => {
  const home = tempHome();
  try {
    expect(resolveConfiguredLocale({ env: {}, home })).toBeUndefined();
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("resolveConfiguredLocale: a valid FORGE614_SHELL_LOCALE always wins over a saved preference", () => {
  const home = tempHome();
  try {
    saveLocale("en", { home });
    expect(resolveConfiguredLocale({ env: { FORGE614_SHELL_LOCALE: "es" }, home })).toBe("es");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("resolveConfiguredLocale: an invalid FORGE614_SHELL_LOCALE falls back to the saved preference", () => {
  const home = tempHome();
  try {
    saveLocale("en", { home });
    expect(resolveConfiguredLocale({ env: { FORGE614_SHELL_LOCALE: "fr" }, home })).toBe("en");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("resolveConfiguredLocale: a saved preference is used when there is no env override", () => {
  const home = tempHome();
  try {
    saveLocale("es", { home });
    expect(resolveConfiguredLocale({ env: {}, home })).toBe("es");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("guessSystemLocaleFocus: es, es-MX, and es_* variants focus Español", () => {
  expect(guessSystemLocaleFocus({ LANG: "es_MX.UTF-8" })).toBe("es");
  expect(guessSystemLocaleFocus({ LANG: "es" })).toBe("es");
  expect(guessSystemLocaleFocus({ LC_ALL: "es_ES.UTF-8" })).toBe("es");
});

test("guessSystemLocaleFocus: en-US and anything unrecognized or unset focus English", () => {
  expect(guessSystemLocaleFocus({ LANG: "en_US.UTF-8" })).toBe("en");
  expect(guessSystemLocaleFocus({ LANG: "fr_FR.UTF-8" })).toBe("en");
  expect(guessSystemLocaleFocus({})).toBe("en");
});

test("guessSystemLocaleFocus never resolves a locale by itself — it never causes the selector to be skipped", () => {
  // Sanity check on intent: resolveConfiguredLocale must ignore the system locale entirely.
  const home = tempHome();
  try {
    expect(resolveConfiguredLocale({ env: { LANG: "es_MX.UTF-8" }, home })).toBeUndefined();
  } finally { rmSync(home, { recursive: true, force: true }); }
});
