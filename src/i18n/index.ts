import { loadLocale } from "../infrastructure/shell-preferences.ts";
import en from "./en.ts";
import es from "./es.ts";
import type { Catalog, Locale } from "./types.ts";

export type { Catalog, Locale, ShellErrorCode } from "./types.ts";

export const SUPPORTED_LOCALES: readonly Locale[] = ["es", "en"];

const catalogs: Record<Locale, Catalog> = { en, es };

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function getCatalog(locale: Locale): Catalog {
  return catalogs[locale];
}

/**
 * Resolution order: a valid `FORGE614_SHELL_LOCALE` always wins and is session-only (never
 * persisted); otherwise a valid persisted `locale` in preferences.json; otherwise `undefined`,
 * meaning no preference exists yet and the interactive selector must run. Never guesses from the
 * system locale — that is only used to decide which option starts focused in the selector.
 */
export function resolveConfiguredLocale(options: { env?: NodeJS.ProcessEnv; home?: string } = {}): Locale | undefined {
  const env = options.env ?? process.env;
  if (isSupportedLocale(env.FORGE614_SHELL_LOCALE)) return env.FORGE614_SHELL_LOCALE;
  return loadLocale(options);
}

/**
 * Best-effort guess from the system locale (`LC_ALL`/`LC_MESSAGES`/`LANG`/`LANGUAGE`), used only
 * to pick which option starts focused on the first-run language selector. `es`, `es-MX`, `es_*`
 * focus Español; anything else, including unset or unrecognized, focuses English. Never skips the
 * selector — this never resolves a locale by itself.
 */
export function guessSystemLocaleFocus(env: NodeJS.ProcessEnv = process.env): Locale {
  const raw = env.LC_ALL || env.LC_MESSAGES || env.LANG || env.LANGUAGE || "";
  const normalized = raw.split(".")[0]?.replaceAll("_", "-").toLowerCase() ?? "";
  return normalized === "es" || normalized.startsWith("es-") ? "es" : "en";
}
