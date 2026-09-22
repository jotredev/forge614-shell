import { ProcessTerminal } from "@earendil-works/pi-tui";
import type { Terminal } from "@earendil-works/pi-tui";
import { getCatalog, isSupportedLocale, resolveConfiguredLocale } from "../i18n/index.ts";
import type { Locale } from "../i18n/index.ts";
import { saveLocale } from "../infrastructure/shell-preferences.ts";
import { runLanguageSelector } from "../ui/startup/language-picker.ts";

export interface RunLanguageCommandOptions {
  readonly terminal?: Terminal;
  readonly env?: NodeJS.ProcessEnv;
  readonly home?: string;
  readonly version?: string;
  /** Overrides the real TTY check, same convention as `RunInitOptions.interactive`. */
  readonly interactive?: boolean;
  readonly log?: (line: string) => void;
  readonly logError?: (line: string) => void;
}

function saveWarning(locale: Locale): string {
  return locale === "es"
    ? "No se pudo guardar la preferencia de idioma; se usará solo en esta sesión."
    : "Could not save the language preference; it will only apply to this session.";
}

/**
 * `forge614-shell language [es|en]`. With no argument, shows the same bilingual selector as the
 * first run and saves the choice. With `es`/`en`, validates, saves, and confirms in the chosen
 * language — no argument other than a supported locale is ever accepted, and an invalid value
 * changes nothing.
 */
export async function runLanguageCommand(args: string[], options: RunLanguageCommandOptions = {}): Promise<void> {
  const log = options.log ?? ((line: string) => console.log(line));
  const logError = options.logError ?? ((line: string) => console.error(line));
  const currentLocale = resolveConfiguredLocale(options) ?? "en";

  if (args.length > 1) {
    throw new Error(getCatalog(currentLocale).languageCommand.invalidUsage);
  }

  const requested = args[0];
  if (requested !== undefined) {
    if (!isSupportedLocale(requested)) {
      throw new Error(getCatalog(currentLocale).languageCommand.invalidLocale({ value: requested }));
    }
    const persisted = saveLocale(requested, options);
    log(getCatalog(requested).languageCommand.confirmed({ locale: requested }));
    if (!persisted) logError(saveWarning(requested));
    return;
  }

  const interactive = options.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!interactive) {
    throw new Error(getCatalog(currentLocale).startup.requiresInteractiveTerminal);
  }
  const terminal = options.terminal ?? new ProcessTerminal();
  const chosen = await runLanguageSelector(terminal, { env: options.env, version: options.version });
  if (chosen === undefined) {
    process.exitCode = 130;
    return;
  }
  const persisted = saveLocale(chosen, options);
  log(getCatalog(chosen).languageCommand.confirmed({ locale: chosen }));
  if (!persisted) logError(saveWarning(chosen));
}
