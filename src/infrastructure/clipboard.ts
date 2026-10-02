import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { ShellError } from "../shell-error.ts";

/** Runs `command` with `args` and writes `input` to its standard input; rejects when it cannot run or exits with an error. */
export type RunWithInput = (command: string, args: string[], input: string) => Promise<void>;

const runWithInput: RunWithInput = (command, args, input) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
  child.once("error", reject);
  child.once("close", code => { if (code === 0) resolve(); else reject(new Error(`${command} exited with status ${code}`)); });
  child.stdin.end(input);
});

/**
 * Puts `text` on the system clipboard, for `/copy` and `/export`. Codex's terminal app copies natively on macOS;
 * Shell does the same with the system's own `/usr/bin/pbcopy` — the text goes in as its input, never as an
 * argument or through a shell — and installs nothing. On another system there is no built-in command Shell can
 * rely on, so it raises `clipboard-unavailable` instead of pretending it copied.
 */
export async function copyToClipboard(text: string, platform: NodeJS.Platform = process.platform, run: RunWithInput = runWithInput): Promise<void> {
  if (platform !== "darwin") throw new ShellError("clipboard-unavailable");
  await run("/usr/bin/pbcopy", [], text);
}

/**
 * Runs `command` with `args`, sends `input` to its standard input and answers its exit status; `null` when it could not be run at all (it is not installed, it could not start) or it did
 * not finish in time.
 */
export type ClipboardRunner = (command: string, args: string[], input: string) => Promise<number | null>;

/** How long a clipboard program may take before it is given up on and the next way of copying is tried. */
const CLIPBOARD_TIMEOUT_MS = 3000;

/** The real runner: the program is started with its arguments apart (no shell), the text goes in as its input, and it is stopped after `CLIPBOARD_TIMEOUT_MS`. Never rejects. */
const runClipboardProgram: ClipboardRunner = (command, args, input) => new Promise(resolve => {
  let settled = false;
  const finish = (status: number | null) => { if (settled) return; settled = true; clearTimeout(timer); resolve(status); };
  let child: ReturnType<typeof spawn>;
  const timer = setTimeout(() => { child?.kill(); finish(null); }, CLIPBOARD_TIMEOUT_MS);
  try {
    child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
    child.once("error", () => finish(null));
    child.once("close", code => finish(code));
    // A program that closes its input early (or never reads it) must not take the process down with an unhandled error.
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  } catch { finish(null); }
});

/** The programs that put text on the clipboard of each system, in the order they are tried; no shell is involved in any of them. */
function clipboardPrograms(platform: NodeJS.Platform): [string, string[]][] {
  if (platform === "darwin") return [["pbcopy", []]];
  if (platform === "linux") return [["wl-copy", []], ["xclip", ["-selection", "clipboard"]]];
  if (platform === "win32") return [["clip", []]];
  return [];
}

/**
 * Copies the text selected with the mouse in the chat to the system's clipboard — the `copySelection` pi-tui's screen asks the app for: `pbcopy` on macOS, `wl-copy` and then
 * `xclip -selection clipboard` on Linux, `clip` on Windows; the text goes in as the program's input, never through a shell. It answers `true` only when a program ended with status 0. Without
 * a program, or when every one fails, it writes the OSC 52 sequence through `write` (what pi-tui did on its own, and what a terminal that understands it — Orca, a remote session — copies from)
 * and still answers `true`. Never throws: it answers `false` only when even that write fails.
 */
export async function copySelectionText(
  text: string,
  options: { write: (data: string) => void; platform?: NodeJS.Platform; run?: ClipboardRunner },
): Promise<boolean> {
  const run = options.run ?? runClipboardProgram;
  for (const [command, args] of clipboardPrograms(options.platform ?? process.platform)) {
    try { if (await run(command, args, text) === 0) return true; } catch { /* try the next way of copying */ }
  }
  try {
    options.write(`\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`);
    return true;
  } catch { return false; }
}

/**
 * Writes `text` to a file that must not exist yet, like Codex's `/export` (`persist_noclobber`): an existing file
 * is never overwritten. The error says which path could not be created, in Codex's words.
 */
export async function saveNewFile(path: string, text: string): Promise<void> {
  try { await writeFile(path, text, { flag: "wx" }); }
  catch (error) { throw new Error(`could not create ${path}: ${error instanceof Error ? error.message : String(error)}`); }
}
