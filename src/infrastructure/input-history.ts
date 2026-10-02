import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

interface HistoryOptions {
  home?: string;
  env?: NodeJS.ProcessEnv;
}

/** One remembered message or command: the project folder it was typed in, its text and when (milliseconds since the epoch). */
interface HistoryEntry {
  cwd: string;
  text: string;
  at: number;
}

/** How many entries of the current folder come back when a chat opens (the editor itself keeps no more). */
const PER_FOLDER_LIMIT = 100;
/** How many entries the file keeps in total, over every folder; older ones are dropped as new ones arrive. */
const TOTAL_LIMIT = 1000;
/** What answers a question is not a message of the person's: it is never remembered. */
const NOT_REMEMBERED = new Set(["/f614:yes", "/f614:no"]);

/** Where the history lives: `shell/history.jsonl` inside the Forge614 home (`$FORGE614_HOME`, else `~/.forge614`), next to the preferences, so uninstalling Shell removes it with the rest. */
export function inputHistoryPath(options: HistoryOptions = {}): string {
  const home = options.home ?? homedir();
  const forgeHome = options.env?.FORGE614_HOME ?? join(home, ".forge614");
  return join(forgeHome, "shell", "history.jsonl");
}

function isEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.cwd === "string" && typeof entry.text === "string" && typeof entry.at === "number" && Number.isFinite(entry.at);
}

/**
 * Every well-formed entry of the file, oldest first; a line that is damaged is skipped. A file that does not exist is an empty history, but one that exists and cannot be read
 * (no permission, a folder in its place) gives `undefined`, so nothing ever writes over it.
 */
function readEntries(path: string): HistoryEntry[] | undefined {
  let raw: string;
  try { raw = readFileSync(path, "utf8"); }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? [] : undefined; }
  const entries: HistoryEntry[] = [];
  for (const line of raw.split("\n")) {
    try {
      const value: unknown = JSON.parse(line);
      if (isEntry(value)) entries.push(value);
    } catch { /* A damaged line is skipped; the rest of the history is still good. */ }
  }
  return entries;
}

/** The last 100 messages and commands typed in this folder, oldest first. Never throws: a history that cannot be read is an empty one. */
export function loadInputHistory(cwd: string, options: HistoryOptions = {}): string[] {
  try {
    return (readEntries(inputHistoryPath(options)) ?? []).filter(entry => entry.cwd === cwd).slice(-PER_FOLDER_LIMIT).map(entry => entry.text);
  } catch {
    return [];
  }
}

/**
 * Adds one entry and keeps the last 1000 of the whole file. The file is written to a temporary one with permissions 600 and renamed over the real one, so it is never half written. Never throws:
 * when the history cannot be read or written the entry is simply not saved (the editor still has it in memory), and an unreadable file is left exactly as it was.
 */
export function appendInputHistory(cwd: string, text: string, options: HistoryOptions = {}): void {
  let temporary: string | undefined;
  try {
    const path = inputHistoryPath(options);
    const entries = readEntries(path);
    if (!entries) return;
    entries.push({ cwd, text, at: Date.now() });
    const directory = dirname(path);
    mkdirSync(directory, { recursive: true });
    temporary = join(directory, `.history.${randomUUID()}.tmp`);
    writeFileSync(temporary, `${entries.slice(-TOTAL_LIMIT).map(entry => JSON.stringify(entry)).join("\n")}\n`, { mode: 0o600 });
    renameSync(temporary, path);
  } catch {
    if (temporary) try { rmSync(temporary, { force: true }); } catch { /* Nothing more to do: history is a convenience, never a dependency. */ }
  }
}

/**
 * Gives an editor the history of this project folder and returns the function that remembers what the person sends: the entries saved before are added oldest first (so the newest ends up
 * first in the editor's own list), and each message or command remembered afterwards goes to the editor and to the file. What answers a question (`/f614:yes`, `/f614:no`) and blank text are not remembered.
 */
export function attachInputHistory(editor: { addToHistory(text: string): void }, cwd: string, options: HistoryOptions = {}): (text: string) => void {
  for (const text of loadInputHistory(cwd, options)) editor.addToHistory(text);
  return text => {
    const trimmed = text.trim();
    if (!trimmed || NOT_REMEMBERED.has(trimmed)) return;
    editor.addToHistory(trimmed);
    appendInputHistory(cwd, trimmed, options);
  };
}
