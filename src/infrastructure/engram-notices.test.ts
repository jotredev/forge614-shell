import { expect, test } from "bun:test";
import { createNoticeTracker, noticeText, parseEngramNotices } from "./engram-notices.ts";
import { getCatalog } from "../i18n/index.ts";

const migrated = { code: "DATABASE_MIGRATED", message: "La base se actualizó.", backup: "/Users/tester/.forge614/engram/engram.db.v7.bak" };
const rebound = { code: "PROJECT_REBOUND_FROM_FILE", message: "Re-vinculado." };

test("parseEngramNotices keeps only the two notices Shell shows, ignoring unknown codes and extra fields", () => {
  const notices = parseEngramNotices([
    { ...migrated, future: true },
    { code: "PROJECT_FILE_CREATED", message: "x" },
    { code: "PROJECT_FILE_NOT_WRITTEN", message: "x" },
    rebound,
  ]);
  expect(notices.map(notice => notice.code)).toEqual(["DATABASE_MIGRATED", "PROJECT_REBOUND_FROM_FILE"]);
  expect(notices[0]).toEqual({ code: "DATABASE_MIGRATED", backup: migrated.backup });
});

test("parseEngramNotices tolerates absence and malformed input without throwing", () => {
  expect(parseEngramNotices(undefined)).toEqual([]);
  expect(parseEngramNotices(null)).toEqual([]);
  expect(parseEngramNotices("DATABASE_MIGRATED")).toEqual([]);
  expect(parseEngramNotices([null, 3, "x", {}, { code: 7 }])).toEqual([]);
  expect(parseEngramNotices([{ code: "DATABASE_MIGRATED", backup: 42 }])).toEqual([{ code: "DATABASE_MIGRATED" }]);
});

test("the tracker returns each notice once, even if Engram (or a new conversation) reports it again", () => {
  const tracker = createNoticeTracker();
  const first = parseEngramNotices([migrated, rebound]);
  expect(tracker.fresh(first)).toHaveLength(2);
  expect(tracker.fresh(first)).toEqual([]);
  expect(tracker.fresh(parseEngramNotices([{ ...migrated, backup: "/another/backup.bak" }]))).toHaveLength(1);
});

test("noticeText comes from the catalog in each language, never from Engram's own message", () => {
  const [db, re] = parseEngramNotices([migrated, rebound]) as [ReturnType<typeof parseEngramNotices>[number], ReturnType<typeof parseEngramNotices>[number]];
  expect(noticeText(db, getCatalog("es"))).toContain("actualizó su base de datos");
  expect(noticeText(db, getCatalog("es"))).toContain(migrated.backup);
  expect(noticeText(db, getCatalog("en"))).toContain("updated its database");
  expect(noticeText(db, getCatalog("en"))).not.toContain("La base se actualizó");
  expect(noticeText(re, getCatalog("es"))).toContain(".forge614/project.json");
  expect(noticeText(re, getCatalog("en"))).toContain("re-linked");
});

test("a migration notice without a backup path says nothing about a backup", () => {
  const [db] = parseEngramNotices([{ code: "DATABASE_MIGRATED", message: "x" }]);
  expect(noticeText(db!, getCatalog("es"))).not.toContain("copia de seguridad");
  expect(noticeText(db!, getCatalog("en"))).not.toContain("backup");
});

test("control characters (terminal escapes) in the backup path are removed before display", () => {
  const [db] = parseEngramNotices([{ code: "DATABASE_MIGRATED", backup: "/tmp/\u001b[31mred\u001b[0m\u0007/x.bak" }]);
  const text = noticeText(db!, getCatalog("en"));
  expect(text).not.toContain("\u001b");
  expect(text).not.toContain("\u0007");
  expect(text).toContain("/tmp/");
});

// --- withStartupNotices: the composition-root wrapper that shows notices without touching the sessions ---

import { withStartupNotices } from "./engram-notices.ts";
import type { StartupContextResult } from "./forge614-engram.ts";

const okResult = (notices: unknown[]): StartupContextResult => ({ available: true, text: "memory", notices: parseEngramNotices(notices) });

test("each notice is shown once across several conversations, and the result is passed through untouched", async () => {
  const shown: [string, boolean][] = [];
  const result = okResult([migrated, rebound]);
  const wrapped = withStartupNotices(async () => result, (text, isProblem) => shown.push([text, isProblem]), "es");
  expect(await wrapped("/repo", {})).toBe(result);
  await wrapped("/repo", {});
  await wrapped("/repo", {});
  expect(shown).toHaveLength(2);
  expect(shown.every(([, isProblem]) => isProblem === false)).toBe(true);
  expect(shown[0]![0]).toContain("actualizó su base de datos");
});

test("PROJECT_FILE_INVALID (no context at all) is shown once as a problem, and the failure result is untouched", async () => {
  const shown: [string, boolean][] = [];
  const failure: StartupContextResult = { available: false, reason: "x", code: "PROJECT_FILE_INVALID" };
  const wrapped = withStartupNotices(async () => failure, (text, isProblem) => shown.push([text, isProblem]), "en");
  expect(await wrapped("/repo", {})).toBe(failure);
  await wrapped("/repo", {});
  expect(shown).toHaveLength(1);
  expect(shown[0]![1]).toBe(true);
  expect(shown[0]![0]).toContain(".forge614/project.json");
  expect(shown[0]![0]).toContain("Fix the file or delete it");
});

test("an ordinary failure or a result with no notices shows nothing", async () => {
  const shown: string[] = [];
  const results: StartupContextResult[] = [{ available: false, reason: "no" }, { available: true, text: "x" }, okResult([])];
  for (const result of results) await withStartupNotices(async () => result, text => shown.push(text), "es")("/repo", {});
  expect(shown).toEqual([]);
});

test("a screen callback that throws (a closed UI) can never break the memory fetch", async () => {
  const result = okResult([migrated]);
  const wrapped = withStartupNotices(async () => result, () => { throw new Error("ui closed"); }, "es");
  expect(await wrapped("/repo", {})).toBe(result);
});
