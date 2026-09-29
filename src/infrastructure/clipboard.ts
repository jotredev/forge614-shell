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
 * Writes `text` to a file that must not exist yet, like Codex's `/export` (`persist_noclobber`): an existing file
 * is never overwritten. The error says which path could not be created, in Codex's words.
 */
export async function saveNewFile(path: string, text: string): Promise<void> {
  try { await writeFile(path, text, { flag: "wx" }); }
  catch (error) { throw new Error(`could not create ${path}: ${error instanceof Error ? error.message : String(error)}`); }
}
