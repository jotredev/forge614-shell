import type { SDKSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import type { NativeSessionInfo } from "../../engines/types.ts";
import type { Locale } from "../../i18n/index.ts";
import { homeRelativePath } from "../../infrastructure/runtime-resources.ts";
import type { ComposerChoice } from "./composer.ts";

/** One conversation in the `/resume` selector; the same shape for Claude Code and Codex. */
export type ResumeEntry = NativeSessionInfo;

/** Longest title (in characters) written in the first column, so the date, folder and first message that tell repeated titles apart always have room. */
const MAX_TITLE_WIDTH = 32;

/** Squeezes any text to a single line: control characters (a stray escape code in a first message must not reach the terminal) and line breaks become one space. */
function oneLine(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f\s]+/g, " ").trim();
}

function cut(text: string, max: number): string {
  const letters = Array.from(text);
  return letters.length > max ? `${letters.slice(0, max - 1).join("").trimEnd()}…` : text;
}

/** The short date the row shows (day, month, hour), in the person's language, the same way Shell writes any other date. */
export function formatSessionDate(milliseconds: number, locale: Locale): string {
  return new Date(milliseconds).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
}

/** Most recent first. A conversation without a date goes after every dated one, and the input list is left untouched. */
export function sortRecentFirst(entries: ResumeEntry[]): ResumeEntry[] {
  return entries.map((entry, index) => ({ entry, index })).sort((a, b) => {
    const left = a.entry.updatedAt; const right = b.entry.updatedAt;
    if (left === undefined || right === undefined) return left === right ? a.index - b.index : left === undefined ? 1 : -1;
    return right - left || a.index - b.index;
  }).map(({ entry }) => entry);
}

/**
 * The row of the selector for one conversation. The first column is its title (or its first message
 * when it has no title, or its id as a last resort); the second is the date, the first message and the
 * folder on one line, separated by `·`; the folder goes last because it is the same for every session
 * of the project and the screen cuts the end of the line first, so what tells rows apart stays visible.
 * What the assistant did not deliver is left out, and a first message that already is the title is not
 * written twice. The text searched is the title,
 * the first message and the folder; the date is not searchable.
 */
export function resumeChoice(entry: ResumeEntry, locale: Locale, home?: string): ComposerChoice {
  const title = oneLine(entry.title ?? "");
  const firstMessage = oneLine(entry.firstMessage ?? "");
  const folder = entry.folder ? homeRelativePath(entry.folder, home) : "";
  const shownTitle = title || firstMessage || entry.id;
  return {
    value: entry.id,
    display: cut(shownTitle, MAX_TITLE_WIDTH),
    label: [entry.updatedAt === undefined ? "" : formatSessionDate(entry.updatedAt, locale), firstMessage === shownTitle ? "" : firstMessage, folder].filter(Boolean).join(" · "),
    search: [title, firstMessage, entry.folder ?? ""].join(" "),
  };
}

/**
 * Claude Code's sessions as selector rows: `customTitle` or `summary` is the title, `firstPrompt` the
 * first message, `cwd` the folder and `lastModified` the date. Only this project's sessions are kept
 * (the SDK lists by directory prefix); the SDK's own list is the only source, never the disk.
 */
export function claudeResumeEntries(infos: Pick<SDKSessionInfo, "sessionId" | "summary" | "customTitle" | "firstPrompt" | "lastModified" | "cwd">[], cwd: string): ResumeEntry[] {
  return infos.filter(info => info.cwd === cwd).map(info => {
    const title = info.customTitle || info.summary;
    return {
      id: info.sessionId,
      ...(title ? { title } : {}),
      ...(info.firstPrompt ? { firstMessage: info.firstPrompt } : {}),
      ...(info.cwd ? { folder: info.cwd } : {}),
      ...(typeof info.lastModified === "number" ? { updatedAt: info.lastModified } : {}),
    };
  });
}
