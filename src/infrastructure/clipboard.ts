import { spawn } from "node:child_process";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ShellError } from "../shell-error.ts";

/** Comando y argumentos para fijar el portapapeles en Windows leyendo UTF-8 desde stdin sin interpolar en shell. */
const WINDOWS_CLIPBOARD_COMMAND = "powershell.exe";
const WINDOWS_CLIPBOARD_ARGS: readonly string[] = [
  "-NoProfile",
  "-Command",
  "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())",
];

/** Runs `command` with `args` and writes `input` to its standard input; rejects when it cannot run or exits with an error. */
export type RunWithInput = (command: string, args: string[], input: string) => Promise<void>;

const runWithInput: RunWithInput = (command, args, input) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
  child.once("error", reject);
  child.once("close", code => { if (code === 0) resolve(); else reject(new Error(`${command} exited with status ${code}`)); });
  child.stdin?.on("error", () => {});
  child.stdin.end(input);
});

/**
 * Puts `text` on the system clipboard, for `/copy` and `/export`. Codex's terminal app copies natively on macOS;
 * Shell does the same with the system's own `/usr/bin/pbcopy` — the text goes in as its input, never as an
 * argument or through a shell — and installs nothing. On Windows it uses powershell.exe with Set-Clipboard
 * reading UTF-8 from stdin without putting text in arguments or shell. On another system there is no built-in
 * command Shell can rely on, so it raises `clipboard-unavailable` instead of pretending it copied.
 */
export async function copyToClipboard(text: string, platform: NodeJS.Platform = process.platform, run: RunWithInput = runWithInput): Promise<void> {
  if (platform === "darwin") {
    await run("/usr/bin/pbcopy", [], text);
    return;
  }
  if (platform === "win32") {
    await run(WINDOWS_CLIPBOARD_COMMAND, [...WINDOWS_CLIPBOARD_ARGS], text);
    return;
  }
  throw new ShellError("clipboard-unavailable");
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
  if (platform === "win32") return [[WINDOWS_CLIPBOARD_COMMAND, [...WINDOWS_CLIPBOARD_ARGS]]];
  return [];
}

/**
 * Copies the text selected with the mouse in the chat to the system's clipboard — the `copySelection` pi-tui's screen asks the app for: `pbcopy` on macOS, `wl-copy` and then
 * `xclip -selection clipboard` on Linux, `powershell.exe` on Windows; the text goes in as the program's input, never through a shell. It answers `true` only when a program ended with status 0. Without
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

// ── Pasting an image from the clipboard ────────────────────────────────────────────────────

/** The key that pastes the clipboard's image into the box: `Alt+V` on Windows (Windows Terminal keeps `Ctrl+V` to paste text) and `Ctrl+V` everywhere else; as pi-tui names it, and as it is shown (`Label`). */
export const pasteImageKey = (platform: NodeJS.Platform = process.platform): "alt+v" | "ctrl+v" => platform === "win32" ? "alt+v" : "ctrl+v";
export const pasteImageKeyLabel = (platform: NodeJS.Platform = process.platform): "Alt+V" | "Ctrl+V" => platform === "win32" ? "Alt+V" : "Ctrl+V";

/** The largest image Shell takes from the clipboard (20 MB): the same limit as the images it draws (`MAX_IMAGE_BYTES` in `ui/basic/chat-images.ts`, which a test keeps equal). */
export const MAX_PASTED_IMAGE_BYTES = 20 * 1024 * 1024;
/** How long each clipboard program may take (5 s) before it is stopped and the paste is given up. */
const PASTE_TIMEOUT_MS = 5000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** What a program run to read the clipboard did: how it ended (`status`, `null` when it did not end by itself), what it wrote (`stdout`), and why it did not finish if it did not. */
export interface ImageProgramResult { status: number | null; stdout: Buffer; missing: boolean; timedOut: boolean; tooBig: boolean }
/** Runs `command` with `args` (and `env` over the process's) with no shell and no input; its output is collected up to `maxBytes` and it is stopped after `timeoutMs`. Never rejects. */
export type ImageProgramRunner = (command: string, args: string[], options: { env?: NodeJS.ProcessEnv; timeoutMs: number; maxBytes: number }) => Promise<ImageProgramResult>;

/** The real runner: always asynchronous (`spawn`, never `spawnSync`: a test server and a blocked process would wait for each other in the same process). */
export const runImageProgram: ImageProgramRunner = (command, args, { env, timeoutMs, maxBytes }) => new Promise(resolve => {
  const chunks: Buffer[] = [];
  let size = 0; let settled = false; let tooBig = false; let timedOut = false;
  let child: ReturnType<typeof spawn> | undefined;
  const finish = (status: number | null, missing = false) => {
    if (settled) return;
    settled = true; clearTimeout(timer);
    resolve({ status, stdout: Buffer.concat(chunks), missing, timedOut, tooBig });
  };
  const timer = setTimeout(() => { timedOut = true; child?.kill(); finish(null); }, timeoutMs);
  try {
    child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"], env: env ?? process.env, windowsHide: true });
    child.stdout?.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) { tooBig = true; child?.kill(); finish(null); return; }
      chunks.push(chunk);
    });
    child.once("error", error => finish(null, (error as NodeJS.ErrnoException).code === "ENOENT"));
    child.once("close", code => finish(code));
  } catch { finish(null, true); }
});

/** The result of pasting: the path of the PNG written, or why there is none. `missing-tool` carries what to install (`tools`) or have. */
export type PastedImage =
  | { kind: "image"; path: string }
  | { kind: "empty" }
  | { kind: "missing-tool"; tools: string }
  | { kind: "too-big" }
  | { kind: "failed" };

export interface PasteImageDeps {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Runs the program that reads the clipboard; tests give a fake one. */
  run?: ImageProgramRunner;
  /** Where `forge614-shell/` is made (the system's temporary folder by default). */
  directory?: string;
  now?: () => Date;
  maxBytes?: number;
  timeoutMs?: number;
}

/** The name of the environment variable that carries the file's path to the script, so that the path is never part of the script's text. */
const PATH_VARIABLE = "FORGE614_CLIP_PATH";

/**
 * AppleScript that writes the clipboard's data of one class (`PNGf` or `TIFF`) straight to the file named by `FORGE614_CLIP_PATH`: through `open for access … with write permission` and `write`, never through the
 * output (which would be text). It answers `empty` when the clipboard has no data of that class and `ok` when it wrote the file; a failure while writing is an error.
 */
const macScript = (dataClass: "PNGf" | "TIFF"): string[] => [
  `set theTarget to POSIX file (system attribute "${PATH_VARIABLE}")`,
  "try",
  `set theData to (the clipboard as «class ${dataClass}»)`,
  "on error",
  'return "empty"',
  "end try",
  "set theFile to open for access theTarget with write permission",
  "try",
  "set eof of theFile to 0",
  "write theData to theFile",
  "close access theFile",
  "on error errorMessage",
  "try",
  "close access theFile",
  "end try",
  "error errorMessage",
  "end try",
  'return "ok"',
];

/**
 * The script of Windows PowerShell 5.1 (`-STA`, which the clipboard requires) that saves the clipboard's image as a PNG at the path in `FORGE614_CLIP_PATH` and says `empty` when there is none. The path is read from the
 * environment, never written into the text. It uses nothing PowerShell 6/7 has and 5.1 does not (`Join-Path` with three parts, `?:`), no `$home`, no escaped backslashes and no .NET call that takes a `$null` as a string.
 */
export const WINDOWS_PASTE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -AssemblyName System.Windows.Forms",
  "Add-Type -AssemblyName System.Drawing",
  `$target = $env:${PATH_VARIABLE}`,
  "$image = [System.Windows.Forms.Clipboard]::GetImage()",
  "if ($null -eq $image) { Write-Output 'empty'; exit 0 }",
  "try { $image.Save($target, [System.Drawing.Imaging.ImageFormat]::Png); Write-Output 'ok' } finally { $image.Dispose() }",
].join("\n");

/** The image types a clipboard may offer that Photon can turn into a PNG when there is no `image/png`. */
const CONVERTIBLE = ["image/jpeg", "image/webp", "image/gif", "image/bmp"];

/** `bytes` as a PNG: as they are when they already are one, converted with Photon (`convertToPng` of pi-coding-agent) when they are another image type; undefined when that cannot be done. */
async function asPng(bytes: Buffer, mime: string): Promise<Buffer | undefined> {
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return bytes;
  if (!CONVERTIBLE.includes(mime)) return undefined;
  try {
    const { convertToPng } = await import("@earendil-works/pi-coding-agent");
    const png = await convertToPng(bytes.toString("base64"), mime);
    const converted = png ? Buffer.from(png.data, "base64") : undefined;
    return converted?.subarray(0, 8).equals(PNG_SIGNATURE) ? converted : undefined;
  } catch { return undefined; }
}

/** The first line of `types` (a list of MIME types one to a line) that is an image, preferring PNG and then what can be converted. */
function pickImageType(types: string): string | undefined {
  const offered = types.split(/\r?\n/).map(line => line.split(";")[0]!.trim().toLowerCase()).filter(Boolean);
  return offered.find(type => type === "image/png") ?? offered.find(type => CONVERTIBLE.includes(type));
}

/** Whether `path` is a regular file of at most `maxBytes` that starts with a PNG's signature. */
function isPngFile(path: string, maxBytes: number): "ok" | "too-big" | "invalid" {
  try {
    const size = statSync(path).size;
    if (size > maxBytes) return "too-big";
    const descriptor = openSync(path, "r");
    try {
      const header = Buffer.alloc(8);
      readSync(descriptor, header, 0, 8, 0);
      return header.equals(PNG_SIGNATURE) ? "ok" : "invalid";
    } finally { closeSync(descriptor); }
  } catch { return "invalid"; }
}

/**
 * Reads the image on the system's clipboard and saves it as a PNG in `<temporary folder>/forge614-shell/paste-<date>-<time>.png` (the folder `0700`, the file `0600`), the way Orca leaves a pasted image as a file and
 * pastes its path: the answer is that path, which Shell then treats like any other (path → thumbnail → sent to the assistant). No native module and no shell is used, and every program is started with `spawn` and
 * stopped after 5 s. The file's signature is checked before its path is answered, and it is deleted if it is not a PNG or is over 20 MB.
 * - macOS: `osascript` writes `the clipboard as «class PNGf»` straight to the file; without a PNG, `«class TIFF»` is written and `sips -s format png` converts it.
 * - Windows: Windows PowerShell 5.1 with `-STA` saves `[System.Windows.Forms.Clipboard]::GetImage()` as a PNG (`WINDOWS_PASTE_SCRIPT`); the path goes in an environment variable.
 * - Linux: Wayland (`WAYLAND_DISPLAY`) with `wl-paste --list-types` and `wl-paste --type image/png`; X11 with `xclip -selection clipboard -t TARGETS -o` and `-t image/png -o`. If the program that is needed is not
 *   installed the answer says which to install.
 */
export async function pasteClipboardImage(deps: PasteImageDeps = {}): Promise<PastedImage> {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const run = deps.run ?? runImageProgram;
  const maxBytes = deps.maxBytes ?? MAX_PASTED_IMAGE_BYTES;
  const timeoutMs = deps.timeoutMs ?? PASTE_TIMEOUT_MS;
  const options = { timeoutMs, maxBytes };
  let target: string;
  try {
    const directory = join(deps.directory ?? tmpdir(), "forge614-shell");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    const when = (deps.now ?? (() => new Date()))();
    const stamp = `${when.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-")}-${String(when.getMilliseconds()).padStart(3, "0")}`;
    target = join(directory, `paste-${stamp}.png`);
    for (let n = 1; existsSync(target); n++) target = join(directory, `paste-${stamp}-${n}.png`);
  } catch { return { kind: "failed" }; }

  /** The answer for a file a program wrote: checked, set to `0600`, and its path; or what is wrong with it. */
  const finishFile = (): PastedImage => {
    const check = isPngFile(target, maxBytes);
    if (check !== "ok") { rmSync(target, { force: true }); return check === "too-big" ? { kind: "too-big" } : { kind: "failed" }; }
    try { chmodSync(target, 0o600); } catch { /* a system without permissions (Windows) keeps what it has */ }
    return { kind: "image", path: target };
  };
  const failure = (result: ImageProgramResult): PastedImage => result.tooBig ? { kind: "too-big" } : { kind: "failed" };

  if (platform === "darwin") {
    const write = (dataClass: "PNGf" | "TIFF", file: string) => run("osascript", macScript(dataClass).flatMap(line => ["-e", line]), { ...options, env: { ...env, [PATH_VARIABLE]: file } });
    const png = await write("PNGf", target);
    if (png.missing) return { kind: "missing-tool", tools: "osascript" };
    if (png.status !== 0) { rmSync(target, { force: true }); return failure(png); }
    if (png.stdout.toString("utf8").trim() === "ok") return finishFile();
    // No PNG on the clipboard: a TIFF (what some apps copy) is written next to it and converted with the system's `sips`.
    const tiff = `${target}.tiff`;
    const tiffResult = await write("TIFF", tiff);
    rmSync(target, { force: true });
    if (tiffResult.status !== 0) { rmSync(tiff, { force: true }); return failure(tiffResult); }
    if (tiffResult.stdout.toString("utf8").trim() !== "ok") { rmSync(tiff, { force: true }); return { kind: "empty" }; }
    const converted = await run("/usr/bin/sips", ["-s", "format", "png", tiff, "--out", target], options);
    rmSync(tiff, { force: true });
    if (converted.status !== 0) { rmSync(target, { force: true }); return failure(converted); }
    return finishFile();
  }

  if (platform === "win32") {
    const result = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-Command", WINDOWS_PASTE_SCRIPT], { ...options, env: { ...env, [PATH_VARIABLE]: target } });
    if (result.missing) return { kind: "missing-tool", tools: "Windows PowerShell" };
    if (result.status !== 0) { rmSync(target, { force: true }); return failure(result); }
    if (result.stdout.toString("utf8").trim() !== "ok") { rmSync(target, { force: true }); return { kind: "empty" }; }
    return finishFile();
  }

  // Linux (and the rest): Wayland first when the session is one, then X11; the other is tried too if the first one's program is not installed.
  const wayland = Boolean(env.WAYLAND_DISPLAY) || env.XDG_SESSION_TYPE === "wayland";
  const tools: Record<"wl" | "x", { list: [string, string[]]; read: (type: string) => [string, string[]] }> = {
    wl: { list: ["wl-paste", ["--list-types"]], read: type => ["wl-paste", ["--type", type, "--no-newline"]] },
    x: { list: ["xclip", ["-selection", "clipboard", "-t", "TARGETS", "-o"]], read: type => ["xclip", ["-selection", "clipboard", "-t", type, "-o"]] },
  };
  const order = wayland ? (["wl", "x"] as const) : env.DISPLAY ? (["x", "wl"] as const) : (["wl", "x"] as const);
  let anyInstalled = false;
  for (const name of order) {
    const [command, listArgs] = tools[name].list;
    const listed = await run(command, [...listArgs], options);
    if (listed.missing) continue;
    anyInstalled = true;
    if (listed.timedOut) return { kind: "failed" };
    // A program that says it has nothing to offer (no selection at all) is an empty clipboard.
    const type = listed.status === 0 ? pickImageType(listed.stdout.toString("utf8")) : undefined;
    if (!type) return { kind: "empty" };
    const [readCommand, readArgs] = tools[name].read(type);
    const data = await run(readCommand, [...readArgs], options);
    if (data.missing || data.status !== 0 || data.stdout.length === 0) return failure(data);
    const png = await asPng(data.stdout, type);
    if (!png) return { kind: "failed" };
    if (png.length > maxBytes) return { kind: "too-big" };
    try { writeFileSync(target, png, { mode: 0o600, flag: "wx" }); } catch { return { kind: "failed" }; }
    return finishFile();
  }
  return anyInstalled ? { kind: "empty" } : { kind: "missing-tool", tools: wayland ? "wl-clipboard" : env.DISPLAY ? "xclip" : "wl-clipboard o xclip" };
}
