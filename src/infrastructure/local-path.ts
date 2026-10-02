import { execFile } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
type Execute = (command: string, args: string[]) => Promise<unknown>;
const execute: Execute = (command, args) => execFileAsync(command, args, { timeout: 5000, windowsHide: true, maxBuffer: 65536 });

/** What Shell needs to know about something on disk: whether it is a folder and its permission bits. */
export interface PathStat { isDirectory: boolean; mode: number }

/** The ways the outside world is reached, each replaceable so a test opens nothing for real. */
export interface LocalPathDeps {
  platform?: NodeJS.Platform;
  run?: Execute;
  /** What is at `path` (following links), or undefined when nothing is there. */
  stat?: (path: string) => PathStat | undefined;
  /** Where `path` really leads, once its links are followed. */
  realPath?: (path: string) => string;
}

/** A path found on disk, without its `:line` or `:line:column` suffix (given apart when it was written). */
export interface ResolvedPath { path: string; line?: number; column?: number }

const realStat = (path: string): PathStat | undefined => {
  try { const stats = statSync(path); return { isDirectory: stats.isDirectory(), mode: stats.mode }; } catch { return undefined; }
};
const realPathOf = (path: string): string => { try { return realpathSync(path); } catch { return path; } };

/** Folders that macOS shows as one thing and runs or installs when opened (an app, a plug-in, an installer); matched case-insensitively. */
const PACKAGE_EXTENSIONS = new Set([".app", ".bundle", ".framework", ".plugin", ".kext", ".pkg", ".mpkg", ".workflow", ".xpc", ".appex", ".prefpane", ".saver", ".component", ".action", ".dext", ".systemextension"]);
/** Files that run, install or mount something when the Mac opens them; the owner's list, matched case-insensitively. */
const RISKY_FILE_EXTENSIONS = new Set([".command", ".tool", ".terminal", ".sh", ".zsh", ".bash", ".pkg", ".mpkg", ".dmg", ".workflow", ".scpt", ".applescript"]);

/**
 * Whether a click must only show `path` in Finder instead of opening it: Shell never runs anything because of a click. That is so for an app or another package folder, for a file with
 * the execute permission, and for a file with an extension that runs or installs when opened. The name and what the path really leads to (through links) are both judged, so a link
 * called `notes.txt` that points to an app is shown, not opened.
 */
function shouldOnlyShow(path: string, stat: (path: string) => PathStat | undefined, realPath: (path: string) => string): boolean {
  const real = realPath(path);
  for (const candidate of new Set([path, real])) {
    const facts = stat(candidate);
    if (!facts) continue;
    const extension = extname(candidate).toLowerCase();
    if (facts.isDirectory ? PACKAGE_EXTENSIONS.has(extension) : (facts.mode & 0o111) !== 0 || RISKY_FILE_EXTENSIONS.has(extension)) return true;
  }
  return false;
}

/**
 * Opens a path the person clicked in the chat, as separate arguments and never through a shell. On macOS `/usr/bin/open <path>` opens it with the app the Mac has for it (a folder opens in Finder),
 * except what `shouldOnlyShow` names, which is shown in Finder with `/usr/bin/open -R <path>`. On Linux it is `xdg-open <path>` and what is only shown opens the folder that holds it. On
 * Windows nothing is ever opened: a folder opens in Explorer and a file is selected in it. A path that is not there, an unknown system and any failure of the opener answer false.
 */
export async function openLocalPath(path: string, deps: LocalPathDeps = {}): Promise<boolean> {
  const platform = deps.platform ?? process.platform;
  const run = deps.run ?? execute;
  const stat = deps.stat ?? realStat;
  try {
    const facts = stat(path);
    if (!facts) return false;
    const show = shouldOnlyShow(path, stat, deps.realPath ?? realPathOf);
    if (platform === "darwin") await run("/usr/bin/open", show ? ["-R", path] : [path]);
    else if (platform === "linux") await run("xdg-open", [show ? dirname(path) : path]);
    else if (platform === "win32") await run("explorer.exe", [facts.isDirectory && !show ? path : `/select,${path}`]);
    else return false;
    return true;
  } catch { return false; }
}

/**
 * Understands what a person wrote as a path: absolute, `~/…`, `./…`, `../…` or relative to the session's folder `base.cwd`, with an optional `:line` or `:line:column` at the end. It answers only
 * when the path exists (checked now), with the full path and the suffix apart; otherwise undefined. This is the one place that decides what is a path, for both what becomes a link and what a click opens.
 */
export function resolveLocalPath(text: string, base: { cwd: string; home?: string; stat?: (path: string) => PathStat | undefined }): ResolvedPath | undefined {
  const stat = base.stat ?? realStat;
  let written = text;
  let line: number | undefined; let column: number | undefined;
  const suffix = /^(.+?):(\d+)(?::(\d+))?$/.exec(text);
  if (suffix) { written = suffix[1]!; line = Number(suffix[2]); if (suffix[3] !== undefined) column = Number(suffix[3]); }
  if (!written) return undefined;
  let full: string;
  if (written.startsWith("~/")) { if (!base.home) return undefined; full = join(base.home, written.slice(2)); }
  else full = resolve(base.cwd, written);
  if (!stat(full)) return undefined;
  return { path: full, ...(line === undefined ? {} : { line }), ...(column === undefined ? {} : { column }) };
}
