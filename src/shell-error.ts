import { getCatalog } from "./i18n/index.ts";
import type { Locale, ShellErrorCode } from "./i18n/index.ts";

/**
 * A Shell-own error: a stable `code` plus whatever named params its catalog template needs, never
 * raw text typed at the throw site. `message` is always valid, readable English (rendered once, at
 * construction, against the English catalog) so logging, tests, and any code that never heard of
 * locales still see something sensible — but the *displayed* text always comes from `describeError`
 * at the presentation boundary, which re-renders `code`+`params` against the active locale.
 *
 * Never wraps text that came from Claude, Codex, Engines, or Engram — that stays a plain `Error`
 * with the external message as-is, so `describeError` passes it through unchanged (never translated,
 * never paraphrased).
 */
export class ShellError extends Error {
  readonly code: ShellErrorCode;
  readonly params: Record<string, string>;

  constructor(code: ShellErrorCode, params: Record<string, string> = {}) {
    super(getCatalog("en").errors[code](params));
    this.name = "ShellError";
    this.code = code;
    this.params = params;
  }
}

/**
 * The one place a Shell-own error becomes user-facing text. A `ShellError` renders its `code`
 * against the given locale's catalog; anything else (a plain `Error` — including literal text
 * Shell received from Claude, Codex, Engines, or Engram — or a non-Error throw) passes through
 * exactly as received, since it is data, not a Shell presentation string.
 */
export function describeError(error: unknown, locale: Locale): string {
  if (error instanceof ShellError) return getCatalog(locale).errors[error.code](error.params);
  return error instanceof Error ? error.message : String(error);
}
