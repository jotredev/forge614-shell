import { ProcessTerminal } from "@earendil-works/pi-tui";
import type { Terminal } from "@earendil-works/pi-tui";
import { resolveConfiguredLocale } from "../i18n/index.ts";
import type { Locale } from "../i18n/index.ts";
import { saveLocale } from "../infrastructure/shell-preferences.ts";
import { runLanguageSelector } from "../ui/startup/language-picker.ts";

export interface EnsureLocaleOptions {
  readonly terminal?: Terminal;
  readonly env?: NodeJS.ProcessEnv;
  readonly home?: string;
  readonly version?: string;
  /** Overrides the real TTY check, same convention as `RunInitOptions.interactive`. */
  readonly interactive?: boolean;
}

/**
 * Resolves Shell's locale for this run, in the order `FORGE614_SHELL_LOCALE` (session-only) >
 * `preferences.json` (persistent) > the bilingual first-run selector. Runs before any other TUI or
 * visible text — every interactive entry point (the engine picker, `init --product engram`) calls
 * this before doing anything else. Never called for automation commands (`--help`, `--version`,
 * `update`, `uninstall`); those read `resolveConfiguredLocale` directly and never prompt.
 *
 * Returns `undefined` when the person cancels the selector (Esc/Ctrl-C/Ctrl-D/SIGTERM) — the
 * caller must treat that exactly like cancelling its own flow, not fall back to a default locale.
 */
export async function ensureLocale(options: EnsureLocaleOptions = {}): Promise<Locale | undefined> {
  const configured = resolveConfiguredLocale(options);
  if (configured) return configured;
  const interactive = options.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  // No TTY to prompt with: fall back to English rather than blocking a non-interactive invocation
  // that reached here unexpectedly. The caller's own interactivity gate reports the real error.
  if (!interactive) return "en";
  const terminal = options.terminal ?? new ProcessTerminal();
  const chosen = await runLanguageSelector(terminal, { env: options.env, version: options.version });
  if (chosen === undefined) return undefined;
  saveLocale(chosen, options);
  return chosen;
}
