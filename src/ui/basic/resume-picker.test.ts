import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { filterChoices } from "./composer.ts";
import { claudeResumeEntries, resumeChoice, sortRecentFirst } from "./resume-picker.ts";
import type { ResumeEntry } from "./resume-picker.ts";

/** Three sessions with the very same title, the way the owner saw «Color favorito» three times: only date, folder and first message tell them apart. */
const same: ResumeEntry[] = [
  { id: "old", title: "Favorite color", firstMessage: "What is my favorite color?", folder: "/Users/x/app", updatedAt: Date.UTC(2026, 8, 20, 10) },
  { id: "new", title: "Favorite color", firstMessage: "Pick a color for the logo", folder: "/Users/x/app", updatedAt: Date.UTC(2026, 8, 28, 10) },
  { id: "mid", title: "Favorite color", firstMessage: "Café menu ideas", folder: "/Users/x/other", updatedAt: Date.UTC(2026, 8, 25, 10) },
];
const choices = (entries: ResumeEntry[]) => entries.map(entry => resumeChoice(entry, "en", "/Users/x"));
const idsFor = (query: string) => filterChoices(choices(same), query).map(choice => choice.value);

/** The list must open with the most recent conversation on top, and one without a date must never jump ahead of one with a date. */
test("sortRecentFirst puts the newest first, sends undated ones last and leaves the input untouched", () => {
  const undated: ResumeEntry = { id: "undated", title: "No date" };
  const input = [same[0]!, undated, same[1]!, same[2]!];
  expect(sortRecentFirst(input).map(entry => entry.id)).toEqual(["new", "mid", "old", "undated"]);
  expect(input.map(entry => entry.id)).toEqual(["old", "undated", "new", "mid"]);
});

/** Search must find a conversation by any of the three things the person remembers — its title, its first message or its folder — ignoring case. */
test("filterChoices searches title, first message and folder without caring about case", () => {
  expect(idsFor("FAVORITE")).toEqual(["old", "new", "mid"]);
  expect(idsFor("logo")).toEqual(["new"]);
  expect(idsFor("OTHER")).toEqual(["mid"]);
  expect(idsFor("zzz")).toEqual([]);
});

/** People type «cafe» for «Café» (and the other way round); an accent must never hide a conversation. */
test("filterChoices ignores accents in both directions", () => {
  expect(idsFor("cafe")).toEqual(["mid"]);
  expect(idsFor("CAFÉ")).toEqual(["mid"]);
  const plain = [resumeChoice({ id: "p", title: "Cafe plans" }, "en")];
  expect(filterChoices(plain, "café").map(choice => choice.value)).toEqual(["p"]);
});

/** Every typed word has to match somewhere, so narrowing a search with a second word never widens it. */
test("filterChoices needs every typed word to match and an empty search keeps everything", () => {
  expect(idsFor("color logo")).toEqual(["new"]);
  expect(idsFor("color nothing")).toEqual([]);
  expect(idsFor("   ")).toEqual(["old", "new", "mid"]);
});

/** The whole point of the task: three rows with the same title must look different in what is painted (date, folder, first message). */
test("three sessions with the same title read differently in their rows", () => {
  const rows = choices(same).map(choice => stripVTControlCharacters(`${choice.display} ${choice.label}`));
  expect(new Set(rows).size).toBe(3);
  expect(rows[0]).toContain("What is my favorite color?");
  expect(rows[1]).toContain("Pick a color for the logo");
  expect(rows[2]).toContain("~/other");
  expect(rows[0]).toContain("~/app");
  const dates = choices(same).map(choice => choice.label.split(" · ")[0]);
  expect(new Set(dates).size).toBe(3);
});

/** The owner asked to show only what the assistant delivers: a missing piece is left out, never replaced by a made-up one. */
test("a row leaves out what the assistant did not deliver instead of inventing it", () => {
  const bare = resumeChoice({ id: "just-an-id" }, "en");
  expect(bare.display).toBe("just-an-id");
  expect(bare.label).toBe("");
  const noTitle = resumeChoice({ id: "x", firstMessage: "Only the first message" }, "en");
  expect(noTitle.display).toBe("Only the first message");
  expect(noTitle.label).toBe("");
  for (const choice of [bare, noTitle]) expect(`${choice.display}${choice.label}`).not.toMatch(/undefined|null|NaN|Invalid/);
});

/** A first message can be a paragraph; the row is one line, and a title that already is the first message is not written twice. */
test("the first message is squeezed to one line and not repeated when it is the title", () => {
  const multi = resumeChoice({ id: "m", title: "Long", firstMessage: "line one\n\n  line two\tend" }, "en");
  expect(multi.label).toBe("line one line two end");
  const same = resumeChoice({ id: "s", title: "Hello there", firstMessage: "Hello there" }, "en");
  expect(same.label).toBe("");
  const hostile = resumeChoice({ id: "h", title: "T", firstMessage: "\x1b[2Jred\x07 alert" }, "en");
  expect(hostile.label).not.toMatch(/[\u0000-\u001f]/);
});

/** Claude's SDK hands over `summary`, `firstPrompt`, `lastModified` and `cwd`; this is where they become rows, without touching the real ~/.claude. */
test("claudeResumeEntries fills the rows from the SDK's fields and keeps only this project's sessions", () => {
  const entries = claudeResumeEntries([
    { sessionId: "s1", summary: "Named session", customTitle: "Named session", firstPrompt: "Fix the login", lastModified: 1_790_000_000_000, cwd: "/project" },
    { sessionId: "s2", summary: "Fix the header", firstPrompt: "Fix the header", lastModified: 1_790_100_000_000, cwd: "/project" },
    { sessionId: "s3", summary: "Elsewhere", lastModified: 1_790_200_000_000, cwd: "/other" },
    { sessionId: "s4", summary: "", lastModified: 1_790_300_000_000, cwd: "/project" },
  ], "/project");
  expect(entries).toEqual([
    { id: "s1", title: "Named session", firstMessage: "Fix the login", folder: "/project", updatedAt: 1_790_000_000_000 },
    { id: "s2", title: "Fix the header", firstMessage: "Fix the header", folder: "/project", updatedAt: 1_790_100_000_000 },
    { id: "s4", folder: "/project", updatedAt: 1_790_300_000_000 },
  ]);
});
