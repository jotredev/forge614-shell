import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendInputHistory, attachInputHistory, inputHistoryPath, loadInputHistory } from "./input-history.ts";

/** Every test works inside its own temporary FORGE614_HOME: the developer's real ~/.forge614/shell/history.jsonl is never read or written. */
let forgeHome: string;
const options = () => ({ env: { FORGE614_HOME: forgeHome } as NodeJS.ProcessEnv });
const lines = () => readFileSync(inputHistoryPath(options()), "utf8").split("\n").filter(Boolean);
beforeEach(() => { forgeHome = mkdtempSync(join(tmpdir(), "forge614-history-test-")); });
afterEach(() => { try { chmodSync(join(forgeHome, "shell"), 0o755); chmodSync(inputHistoryPath(options()), 0o600); } catch { /* nothing to restore */ } rmSync(forgeHome, { recursive: true, force: true }); });

test("the history lives in shell/history.jsonl with one {cwd,text,at} line per entry and Unix mode 600", () => {
  expect(inputHistoryPath(options())).toBe(join(forgeHome, "shell", "history.jsonl"));
  appendInputHistory("/work/a", "first", options());
  appendInputHistory("/work/a", "multi\nline", options());
  const entries = lines().map(line => JSON.parse(line));
  expect(entries.map(entry => Object.keys(entry).sort())).toEqual([["at", "cwd", "text"], ["at", "cwd", "text"]]);
  expect(entries.map(entry => [entry.cwd, entry.text])).toEqual([["/work/a", "first"], ["/work/a", "multi\nline"]]);
  expect(typeof entries[0].at).toBe("number");
  if (process.platform !== "win32") {
    expect(statSync(inputHistoryPath(options())).mode & 0o777).toBe(0o600);
  } else {
    // En Windows (NTFS), libuv mapea archivos legibles y escribibles a 0o666; no existen bits de permiso de grupo/otros.
    expect(statSync(inputHistoryPath(options())).mode & 0o777).toBe(0o666);
  }
});

test("replacing existing history narrows Unix permissions to 600", () => {
  mkdirSync(join(forgeHome, "shell"), { recursive: true });
  writeFileSync(inputHistoryPath(options()), "", { mode: 0o644 });
  chmodSync(inputHistoryPath(options()), 0o644);
  appendInputHistory("/work/a", "again", options());
  if (process.platform !== "win32") {
    expect(statSync(inputHistoryPath(options())).mode & 0o777).toBe(0o600);
  } else {
    expect(statSync(inputHistoryPath(options())).mode & 0o777).toBe(0o666);
  }
});

test("loading gives only the entries of that folder, oldest first", () => {
  appendInputHistory("/work/a", "a1", options());
  appendInputHistory("/work/b", "b1", options());
  appendInputHistory("/work/a", "a2", options());
  expect(loadInputHistory("/work/a", options())).toEqual(["a1", "a2"]);
  expect(loadInputHistory("/work/b", options())).toEqual(["b1"]);
  expect(loadInputHistory("/work/other", options())).toEqual([]);
});

test("loading gives the last 100 of the folder, and the file is trimmed to the last 1000 in total", () => {
  for (let i = 1; i <= 1050; i++) appendInputHistory(i % 2 ? "/work/a" : "/work/b", `m${i}`, options());
  expect(lines()).toHaveLength(1000);
  expect(JSON.parse(lines()[0]!).text).toBe("m51");
  const a = loadInputHistory("/work/a", options());
  expect(a).toHaveLength(100);
  expect(a[0]).toBe("m851");
  expect(a.at(-1)).toBe("m1049");
});

test("a missing file is an empty history", () => {
  expect(loadInputHistory("/work/a", options())).toEqual([]);
});

test("a damaged file is skipped line by line and writing goes on without losing the good lines", () => {
  mkdirSync(join(forgeHome, "shell"), { recursive: true });
  writeFileSync(inputHistoryPath(options()), [
    JSON.stringify({ cwd: "/work/a", text: "good one", at: 1 }), "{not json", JSON.stringify({ cwd: 3, text: "wrong shape", at: 2 }),
    JSON.stringify(["array"]), "", JSON.stringify({ cwd: "/work/a", text: "good two", at: 3 }),
  ].join("\n"), { mode: 0o600 });
  expect(loadInputHistory("/work/a", options())).toEqual(["good one", "good two"]);
  appendInputHistory("/work/a", "good three", options());
  expect(loadInputHistory("/work/a", options())).toEqual(["good one", "good two", "good three"]);
});

test("a history that cannot be read or written never throws and never replaces what is there", () => {
  mkdirSync(join(forgeHome, "shell"), { recursive: true });
  // The path is a folder: not readable as a file, not replaceable by a rename of a file.
  mkdirSync(inputHistoryPath(options()));
  expect(loadInputHistory("/work/a", options())).toEqual([]);
  expect(() => appendInputHistory("/work/a", "x", options())).not.toThrow();
  expect(statSync(inputHistoryPath(options())).isDirectory()).toBe(true);
});

test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("a file without read permission keeps its content and writing is silently given up", () => {
  appendInputHistory("/work/a", "kept", options());
  const before = readFileSync(inputHistoryPath(options()), "utf8");
  chmodSync(inputHistoryPath(options()), 0o000);
  expect(loadInputHistory("/work/a", options())).toEqual([]);
  expect(() => appendInputHistory("/work/a", "lost", options())).not.toThrow();
  chmodSync(inputHistoryPath(options()), 0o600);
  expect(readFileSync(inputHistoryPath(options()), "utf8")).toBe(before);
});

test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("a folder that cannot be written is silently given up", () => {
  appendInputHistory("/work/a", "kept", options());
  chmodSync(join(forgeHome, "shell"), 0o500);
  expect(() => appendInputHistory("/work/a", "lost", options())).not.toThrow();
  expect(loadInputHistory("/work/a", options())).toEqual(["kept"]);
});

/** A stand-in for the editor that only records what it is given. */
function editor() {
  const added: string[] = [];
  return { added, addToHistory: (text: string) => { added.push(text); } };
}

test("opening seeds the editor oldest first, so the newest entry ends up first in the editor's own list", () => {
  appendInputHistory("/work/a", "one", options());
  appendInputHistory("/work/b", "elsewhere", options());
  appendInputHistory("/work/a", "two", options());
  const box = editor();
  attachInputHistory(box, "/work/a", options());
  expect(box.added).toEqual(["one", "two"]);
});

test("each message or command remembered goes to the editor and to the file; blank text, /f614:yes and /f614:no go to neither", () => {
  const box = editor();
  const remember = attachInputHistory(box, "/work/a", options());
  remember("hello"); remember("/model"); remember("   "); remember("/f614:yes"); remember(" /f614:no "); remember("/f614:stop");
  expect(box.added).toEqual(["hello", "/model", "/f614:stop"]);
  expect(loadInputHistory("/work/a", options())).toEqual(["hello", "/model", "/f614:stop"]);
});

test("an unwritable history still fills the editor: it works in memory only, with no error", () => {
  mkdirSync(join(forgeHome, "shell"), { recursive: true });
  mkdirSync(inputHistoryPath(options()));
  const box = editor();
  const remember = attachInputHistory(box, "/work/a", options());
  expect(() => remember("only in memory")).not.toThrow();
  expect(box.added).toEqual(["only in memory"]);
});
