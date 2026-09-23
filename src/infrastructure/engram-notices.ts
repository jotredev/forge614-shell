import { getCatalog } from "../i18n/index.ts";
import type { Catalog, Locale } from "../i18n/index.ts";
import type { getStartupContext, StartupContextResult } from "./forge614-engram.ts";

/**
 * The only Engram notices Shell shows to a person, plus `PROJECT_FILE_INVALID`, which is not a
 * notice but a failure Engram reports for the whole `startup-context` call (an invalid
 * `.forge614/project.json` yields no context at all) and which the host must make visible.
 * `PROJECT_FILE_CREATED` and `PROJECT_FILE_NOT_WRITTEN` are deliberately not shown: Engram writes
 * its own identity file silently (acta 0023 §2) and the person never needs to hear about it.
 */
export type EngramNoticeCode = "DATABASE_MIGRATED" | "PROJECT_REBOUND_FROM_FILE" | "PROJECT_FILE_INVALID";

export interface EngramNotice {
  readonly code: EngramNoticeCode;
  /** Where Engram left the pre-migration backup, when it had data to back up. */
  readonly backup?: string;
}

const SHOWN_FROM_ENGRAM: ReadonlySet<string> = new Set<EngramNoticeCode>(["DATABASE_MIGRATED", "PROJECT_REBOUND_FROM_FILE"]);

/**
 * Reads the `notices` array Engram adds to some results (`startup-context`'s `project.notices`, and
 * `init --directory`, `group-create`, `group-bind`). Tolerant on purpose (R31): unknown codes, extra
 * fields and malformed entries are ignored, never an error — a notice must never break a command.
 * Engram's own `message` is dropped: the text a person reads comes from Shell's catalog.
 */
export function parseEngramNotices(value: unknown): EngramNotice[] {
  if (!Array.isArray(value)) return [];
  const notices: EngramNotice[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.code !== "string" || !SHOWN_FROM_ENGRAM.has(entry.code)) continue;
    const code = entry.code as EngramNoticeCode;
    notices.push(typeof entry.backup === "string" && entry.backup ? { code, backup: entry.backup } : { code });
  }
  return notices;
}

/**
 * Remembers what was already shown so each notice reaches the person once per Shell run, even if a
 * later conversation (or Engram itself) reports it again. Engram already announces most of them only
 * once; this is the second, independent guard.
 */
export function createNoticeTracker(): { fresh(notices: readonly EngramNotice[]): EngramNotice[] } {
  const shown = new Set<string>();
  return {
    fresh(notices) {
      const result: EngramNotice[] = [];
      for (const notice of notices) {
        const key = `${notice.code}\u0000${notice.backup ?? ""}`;
        if (shown.has(key)) continue;
        shown.add(key);
        result.push(notice);
      }
      return result;
    },
  };
}

/** Removes C0/C1 control characters (terminal escapes among them) from text that came from Engram. */
function stripControl(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

/** The person-facing text for a notice, always from the catalog and never from Engram's own message. */
export function noticeText(notice: EngramNotice, catalog: Catalog): string {
  const t = catalog.engramNotices;
  if (notice.code === "DATABASE_MIGRATED") return t.databaseMigrated({ backup: stripControl(notice.backup ?? "") });
  if (notice.code === "PROJECT_REBOUND_FROM_FILE") return t.projectReboundFromFile;
  return t.projectFileInvalid;
}

/**
 * Wraps a `getStartupContext` so the person sees Engram's notices, without any chat session having to
 * know about them: the composition root injects the wrapped function instead of the plain one. The
 * result is always returned untouched. Notices come from `project.notices` on success, and an invalid
 * `.forge614/project.json` — which yields no context at all — is shown as a problem (`isProblem`) so
 * memory being absent is never silent. Each notice is shown once per run; a `show` that throws (the
 * screen already closed) can never break the fetch.
 */
export function withStartupNotices(
  fetch: typeof getStartupContext, show: (text: string, isProblem: boolean) => void, locale: Locale, tracker = createNoticeTracker(),
): typeof getStartupContext {
  const catalog = getCatalog(locale);
  return async (directory, options): Promise<StartupContextResult> => {
    const result = await fetch(directory, options);
    const notices: readonly EngramNotice[] = result.available
      ? result.notices ?? []
      : result.code === "PROJECT_FILE_INVALID" ? [{ code: "PROJECT_FILE_INVALID" }] : [];
    for (const notice of tracker.fresh(notices)) {
      try { show(noticeText(notice, catalog), notice.code === "PROJECT_FILE_INVALID"); } catch { /* never break the memory fetch */ }
    }
    return result;
  };
}
