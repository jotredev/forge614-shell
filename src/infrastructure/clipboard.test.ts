import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_PASTED_IMAGE_BYTES, WINDOWS_PASTE_SCRIPT, copySelectionText, copyToClipboard, pasteClipboardImage, pasteImageKey, pasteImageKeyLabel, runImageProgram, saveNewFile } from "./clipboard.ts";
import type { ClipboardRunner, ImageProgramResult, ImageProgramRunner } from "./clipboard.ts";
import { MAX_IMAGE_BYTES } from "../ui/basic/chat-images.ts";
import { ShellError } from "../shell-error.ts";

/** On macOS the text goes to the system's own `pbcopy` as its input (nothing to install), never as an argument or through a shell. The real clipboard is never touched: the runner is a stand-in. */
test("copyToClipboard() hands the text to pbcopy on macOS", async () => {
  const calls: [string, string[], string][] = [];
  await copyToClipboard("line one\nline 'two' & $three", "darwin", async (command, args, input) => { calls.push([command, args, input]); });
  expect(calls).toEqual([["/usr/bin/pbcopy", [], "line one\nline 'two' & $three"]]);
});

test("copyToClipboard() hands the text to powershell.exe on Windows", async () => {
  const calls: [string, string[], string][] = [];
  await copyToClipboard("line one\nline 'two' & $three", "win32", async (command, args, input) => { calls.push([command, args, input]); });
  expect(calls).toEqual([[
    "powershell.exe",
    ["-NoProfile", "-Command", "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())"],
    "line one\nline 'two' & $three",
  ]]);
});

/** Elsewhere Shell has no built-in way to copy without installing something, so it says so instead of pretending. */
test("copyToClipboard() on another system reports that there is no clipboard", async () => {
  let ran = false;
  const error = await copyToClipboard("x", "linux", async () => { ran = true; }).catch(caught => caught);
  expect(error).toBeInstanceOf(ShellError);
  expect((error as ShellError).code).toBe("clipboard-unavailable");
  expect(ran).toBe(false);
});

/** `/export` never overwrites (`persist_noclobber` in Codex's `app/transcript_export.rs`): a new file is written, an existing one is left untouched. */
test("saveNewFile() writes a new file and never overwrites an existing one", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge614-shell-export-"));
  try {
    const path = join(root, "codex-session-t.md");
    await saveNewFile(path, "# Codex conversation\n");
    expect(readFileSync(path, "utf8")).toBe("# Codex conversation\n");
    const kept = join(root, "kept.md");
    writeFileSync(kept, "keep me");
    await expect(saveNewFile(kept, "other")).rejects.toThrow(`could not create ${kept}`);
    expect(readFileSync(kept, "utf8")).toBe("keep me");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── The text selected with the mouse in the chat ────────────────────────────────────────────

/** A stand-in for the system's clipboard programs: records each call and answers with what `answers` says for that program (`null` = the program is not there). */
function clipboardDouble(answers: Record<string, number | null>) {
  const calls: [string, string[], string][] = [];
  const written: string[] = [];
  const run: ClipboardRunner = async (command, args, input) => { calls.push([command, args, input]); return answers[command] ?? null; };
  return { calls, written, options: (platform: NodeJS.Platform) => ({ platform, run, write: (data: string) => { written.push(data); } }) };
}

/** The OSC 52 sequence the manual selection path writes when the system clipboard program is unavailable. */
const osc52 = (text: string) => `\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`;

/**
 * On macOS the selected text goes to the system `pbcopy` as its input, with no arguments.
 */
test("copySelectionText() copies with the system pbcopy on macOS", async () => {
  const double = clipboardDouble({ "/usr/bin/pbcopy": 0 });
  expect(await copySelectionText("line one\nline 'two' & $three", double.options("darwin"))).toBe("clipboard");
  expect(double.calls).toEqual([["/usr/bin/pbcopy", [], "line one\nline 'two' & $three"]]);
  expect(double.written).toEqual([]);
});

test("copySelectionText() reports failure when no system clipboard program confirms the copy", async () => {
  const double = clipboardDouble({ "/usr/bin/pbcopy": 1 });
  expect(await copySelectionText("texto", { ...double.options("darwin"), fallback: false })).toBe("failed");
  expect(double.written).toEqual([]);
});

/** En Linux se intenta wl-copy y después xclip; en Windows PowerShell lee UTF-8 desde stdin. */
test("copySelectionText() tries wl-copy then xclip on Linux, and powershell.exe on Windows", async () => {
  const both = clipboardDouble({ "wl-copy": null, xclip: 0 });
  expect(await copySelectionText("hola", both.options("linux"))).toBe("clipboard");
  expect(both.calls).toEqual([["wl-copy", [], "hola"], ["xclip", ["-selection", "clipboard"], "hola"]]);
  expect(both.written).toEqual([]);
  const wayland = clipboardDouble({ "wl-copy": 0 });
  expect(await copySelectionText("hola", wayland.options("linux"))).toBe("clipboard");
  expect(wayland.calls).toEqual([["wl-copy", [], "hola"]]);

  const windowsPs = clipboardDouble({ "powershell.exe": 0 });
  expect(await copySelectionText("hola", windowsPs.options("win32"))).toBe("clipboard");
  expect(windowsPs.calls).toEqual([[
    "powershell.exe",
    ["-NoProfile", "-Command", "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())"],
    "hola",
  ]]);
  expect(windowsPs.written).toEqual([]);

  const windowsFallback = clipboardDouble({ "powershell.exe": null });
  expect(await copySelectionText("ñandú → 日本", windowsFallback.options("win32"))).toBe("terminal");
  expect(windowsFallback.calls).toEqual([
    [
      "powershell.exe",
      ["-NoProfile", "-Command", "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())"],
      "ñandú → 日本",
    ],
  ]);
  expect(windowsFallback.written).toEqual([osc52("ñandú → 日本")]);
});

/**
 * Manual text selection can still use OSC 52 when the native clipboard program is unavailable. A program that cannot even be run (it rejects) follows the same fallback, and nothing ever throws.
 */
test("copySelectionText() falls back to OSC 52 for manual text selection", async () => {
  const text = "ñandú → 日本\nsegunda línea";
  const failing = clipboardDouble({ pbcopy: 1 });
  expect(await copySelectionText(text, failing.options("darwin"))).toBe("terminal");
  expect(failing.written).toEqual([osc52(text)]);
  const missing = clipboardDouble({});
  expect(await copySelectionText(text, missing.options("linux"))).toBe("terminal");
  expect(missing.calls.map(call => call[0])).toEqual(["wl-copy", "xclip"]);
  expect(missing.written).toEqual([osc52(text)]);
  const unknown = clipboardDouble({});
  expect(await copySelectionText(text, unknown.options("freebsd"))).toBe("terminal");
  expect(unknown.calls).toEqual([]);
  expect(unknown.written).toEqual([osc52(text)]);
  const rejected: string[] = [];
  expect(await copySelectionText(text, { platform: "darwin", run: async () => { throw new Error("spawn failed"); }, write: data => { rejected.push(data); } })).toBe("terminal");
  expect(rejected).toEqual([osc52(text)]);
});

/** Never throws, even when starting the clipboard program and writing OSC 52 both fail. */
test("copySelectionText() never throws", async () => {
  const answer = await copySelectionText("x", { platform: "darwin", run: async () => { throw new Error("boom"); }, write: () => { throw new Error("terminal closed"); } });
  expect(answer).toBe("failed");
});

/** No shell: the program is always a bare name with its arguments apart, whatever the text holds, and the code never asks for a shell. */
test("copySelectionText() never uses a shell", async () => {
  const text = "$(rm -rf ~); `x` && y | z";
  for (const platform of ["darwin", "linux", "win32"] as const) {
    const double = clipboardDouble({});
    await copySelectionText(text, double.options(platform));
    for (const [command, args, input] of double.calls) {
      expect(command).toMatch(/^(?:[a-z.-]+|\/usr\/bin\/pbcopy)$/);
      expect(args.some(arg => arg.includes(text))).toBe(false);
      expect(input).toBe(text);
    }
  }
  const source = readFileSync(new URL("./clipboard.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/shell\s*:\s*true|\bexec\(|execSync|\bsh -c/);
});

// ── Pasting an image from the clipboard (U2-r7) ────────────────────────────────────────────

/** A PNG's first bytes: the signature checked before a path is answered. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

interface Call { command: string; args: string[]; env?: NodeJS.ProcessEnv }
/** A program runner that does not touch the system: `answer` decides what each call does (it may write the file the program is told to write, in the environment). */
function imageDouble(answer: (call: Call) => Partial<ImageProgramResult> | undefined) {
  const calls: Call[] = [];
  const run: ImageProgramRunner = async (command, args, options) => {
    const call = { command, args, ...(options.env ? { env: options.env } : {}) };
    calls.push(call);
    return { status: 0, stdout: Buffer.alloc(0), missing: false, timedOut: false, tooBig: false, ...answer(call) };
  };
  return { calls, run };
}
const withFolder = async (body: (directory: string) => Promise<void>) => {
  const directory = mkdtempSync(join(tmpdir(), "forge614-paste-"));
  try { await body(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
};
const ok = (text: string) => Buffer.from(`${text}\n`);

test("macOS: osascript writes the clipboard's PNG straight to the file, whose path goes in the environment (never in the script), and the answer is the path", async () => {
  await withFolder(async directory => {
    const double = imageDouble(call => { writeFileSync(call.env!.FORGE614_CLIP_PATH!, PNG); return { stdout: ok("ok") }; });
    const result = await pasteClipboardImage({ platform: "darwin", run: double.run, directory, env: { HOME: "/x" }, now: () => new Date(2026, 9, 15, 15, 30, 12, 345) });
    expect(result.kind).toBe("image");
    const path = (result as { path: string }).path;
    expect(path).toMatch(/forge614-shell[\\/]paste-\d{8}-\d{6}-345\.png$/);
    expect(readFileSync(path).subarray(0, 8)).toEqual(PNG.subarray(0, 8));
    expect(double.calls).toHaveLength(1);
    const { command, args, env } = double.calls[0]!;
    expect(command).toBe("osascript");
    const script = args.filter((_, index) => index % 2 === 1).join("\n");
    expect(args.filter((_, index) => index % 2 === 0).every(flag => flag === "-e")).toBe(true);
    expect(script).toContain("the clipboard as «class PNGf»");
    expect(script).toContain("open for access theTarget with write permission");
    expect(script).not.toContain(path);
    expect(env!.FORGE614_CLIP_PATH).toBe(path);
    expect(env!.HOME).toBe("/x"); // the environment is the process's with the path added
    if (process.platform !== "win32") {
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(statSync(join(directory, "forge614-shell")).mode & 0o777).toBe(0o700);
    }
  });
});

test("macOS: with no PNG a TIFF is written and converted with sips; with neither the clipboard is empty; and a missing osascript is said", async () => {
  await withFolder(async directory => {
    const double = imageDouble(call => {
      if (call.command === "osascript") {
        const path = call.env!.FORGE614_CLIP_PATH!;
        if (call.args.join("\n").includes("PNGf")) return { stdout: ok("empty") };
        writeFileSync(path, Buffer.from("II*\0"));
        return { stdout: ok("ok") };
      }
      // sips -s format png <tiff> --out <png>
      writeFileSync(call.args[call.args.indexOf("--out") + 1]!, PNG);
      return {};
    });
    const result = await pasteClipboardImage({ platform: "darwin", run: double.run, directory });
    expect(result.kind).toBe("image");
    expect(double.calls.map(call => call.command)).toEqual(["osascript", "osascript", "/usr/bin/sips"]);
    expect(double.calls[2]!.args.slice(0, 3)).toEqual(["-s", "format", "png"]);
    // The TIFF is not left behind.
    expect(existsSync(`${(result as { path: string }).path}.tiff`)).toBe(false);
    const empty = imageDouble(() => ({ stdout: ok("empty") }));
    expect(await pasteClipboardImage({ platform: "darwin", run: empty.run, directory })).toEqual({ kind: "empty" });
    expect(await pasteClipboardImage({ platform: "darwin", run: imageDouble(() => ({ missing: true, status: null })).run, directory })).toEqual({ kind: "missing-tool", tools: "osascript" });
  });
});

test("Windows: Windows PowerShell 5.1 with -STA saves the clipboard's image, the path goes in the environment, and `empty` is an empty clipboard", async () => {
  await withFolder(async directory => {
    const double = imageDouble(call => { writeFileSync(call.env!.FORGE614_CLIP_PATH!, PNG); return { stdout: Buffer.from("ok\r\n") }; });
    const result = await pasteClipboardImage({ platform: "win32", run: double.run, directory });
    expect(result.kind).toBe("image");
    const { command, args, env } = double.calls[0]!;
    expect(command).toBe("powershell.exe");
    expect(args.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-STA"]);
    expect(args[3]).toBe("-Command");
    expect(args[4]).toBe(WINDOWS_PASTE_SCRIPT);
    expect(WINDOWS_PASTE_SCRIPT).toContain("[System.Windows.Forms.Clipboard]::GetImage()");
    expect(WINDOWS_PASTE_SCRIPT).toContain("[System.Drawing.Imaging.ImageFormat]::Png");
    expect(WINDOWS_PASTE_SCRIPT).not.toContain((result as { path: string }).path);
    expect(env!.FORGE614_CLIP_PATH).toBe((result as { path: string }).path);
    expect(await pasteClipboardImage({ platform: "win32", run: imageDouble(() => ({ stdout: Buffer.from("empty\r\n") })).run, directory })).toEqual({ kind: "empty" });
    expect(await pasteClipboardImage({ platform: "win32", run: imageDouble(() => ({ missing: true, status: null })).run, directory })).toEqual({ kind: "missing-tool", tools: "Windows PowerShell" });
    // PowerShell failing (an exception while saving) is a failure, and leaves no file.
    const failed = await pasteClipboardImage({ platform: "win32", run: imageDouble(() => ({ status: 1 })).run, directory });
    expect(failed).toEqual({ kind: "failed" });
  });
});

/** Windows PowerShell 5.1 traps that already cost Forge614 a CI each: none of them is in the script. */
test("the PowerShell script avoids the traps of Windows PowerShell 5.1", () => {
  expect(WINDOWS_PASTE_SCRIPT).not.toMatch(/\\\\/); // "a\\b" keeps two backslashes
  expect(WINDOWS_PASTE_SCRIPT).not.toMatch(/\$home\b/i); // read-only variable
  expect(WINDOWS_PASTE_SCRIPT).not.toMatch(/Join-Path/); // three parts are PowerShell 6/7
  expect(WINDOWS_PASTE_SCRIPT).not.toMatch(/\s\?\s|\s\?\?\s|\?\./); // ?: and ?? are PowerShell 7
  expect(WINDOWS_PASTE_SCRIPT).not.toMatch(/Get-FileHash/); // fails in 5.1 when started from pwsh 7
  expect(WINDOWS_PASTE_SCRIPT).not.toMatch(/\[NullString\]|=\s*\$null\b.*\)::/); // no $null goes to a .NET string
  expect(WINDOWS_PASTE_SCRIPT).toContain("$null -eq $image"); // $null on the left of the comparison
  expect(WINDOWS_PASTE_SCRIPT).toContain("$env:FORGE614_CLIP_PATH"); // the path comes from the environment
});

test("Linux (Wayland): wl-paste lists the types and then reads image/png; the answer is the saved file", async () => {
  await withFolder(async directory => {
    const double = imageDouble(call => call.args[0] === "--list-types" ? { stdout: Buffer.from("text/plain\nimage/png\n") } : { stdout: PNG });
    const result = await pasteClipboardImage({ platform: "linux", env: { WAYLAND_DISPLAY: "wayland-0" }, run: double.run, directory });
    expect(result.kind).toBe("image");
    expect(double.calls.map(call => [call.command, ...call.args])).toEqual([["wl-paste", "--list-types"], ["wl-paste", "--type", "image/png", "--no-newline"]]);
    expect(readFileSync((result as { path: string }).path)).toEqual(PNG);
    if (process.platform !== "win32") expect(statSync((result as { path: string }).path).mode & 0o777).toBe(0o600);
  });
});

test("Linux (X11): xclip lists TARGETS and then reads image/png", async () => {
  await withFolder(async directory => {
    const double = imageDouble(call => call.args.includes("TARGETS") ? { stdout: Buffer.from("TARGETS\nimage/png\nUTF8_STRING\n") } : { stdout: PNG });
    const result = await pasteClipboardImage({ platform: "linux", env: { DISPLAY: ":0" }, run: double.run, directory });
    expect(result.kind).toBe("image");
    expect(double.calls.map(call => [call.command, ...call.args])).toEqual([
      ["xclip", "-selection", "clipboard", "-t", "TARGETS", "-o"], ["xclip", "-selection", "clipboard", "-t", "image/png", "-o"],
    ]);
  });
});

test("Linux: a clipboard with only text is empty; an image that is not a PNG is converted (or fails); the missing tool says what to install", async () => {
  await withFolder(async directory => {
    const text = imageDouble(() => ({ stdout: Buffer.from("text/plain\ntext/html\n") }));
    expect(await pasteClipboardImage({ platform: "linux", env: { WAYLAND_DISPLAY: "w" }, run: text.run, directory })).toEqual({ kind: "empty" });
    // A program that has no selection to list (status 1) is an empty clipboard too.
    expect(await pasteClipboardImage({ platform: "linux", env: { WAYLAND_DISPLAY: "w" }, run: imageDouble(() => ({ status: 1 })).run, directory })).toEqual({ kind: "empty" });
    // Bytes that say image/png and are not a PNG: nothing is written.
    const fake = imageDouble(call => call.args[0] === "--list-types" ? { stdout: Buffer.from("image/png\n") } : { stdout: Buffer.from("not an image at all") });
    expect(await pasteClipboardImage({ platform: "linux", env: { WAYLAND_DISPLAY: "w" }, run: fake.run, directory })).toEqual({ kind: "failed" });
    expect(readdirSync(join(directory, "forge614-shell"))).toEqual([]);
    // A JPEG that Photon cannot decode (garbage with the signature): failed, not an exception.
    const jpeg = imageDouble(call => call.args[0] === "--list-types" ? { stdout: Buffer.from("image/jpeg\n") } : { stdout: JPEG });
    expect(await pasteClipboardImage({ platform: "linux", env: { WAYLAND_DISPLAY: "w" }, run: jpeg.run, directory })).toEqual({ kind: "failed" });
    // Missing tools: the notice names what to install for the session type.
    const none = imageDouble(() => ({ missing: true, status: null }));
    expect(await pasteClipboardImage({ platform: "linux", env: { WAYLAND_DISPLAY: "w" }, run: none.run, directory })).toEqual({ kind: "missing-tool", tools: "wl-clipboard" });
    expect(await pasteClipboardImage({ platform: "linux", env: { DISPLAY: ":0" }, run: none.run, directory })).toEqual({ kind: "missing-tool", tools: "xclip" });
    expect(await pasteClipboardImage({ platform: "linux", env: {}, run: none.run, directory })).toEqual({ kind: "missing-tool", tools: "wl-clipboard o xclip" });
    // Under Wayland with XWayland (DISPLAY too), a missing wl-paste falls to xclip.
    const fallback = imageDouble(call => call.command === "wl-paste" ? { missing: true, status: null } : call.args.includes("TARGETS") ? { stdout: Buffer.from("image/png\n") } : { stdout: PNG });
    expect((await pasteClipboardImage({ platform: "linux", env: { WAYLAND_DISPLAY: "w", DISPLAY: ":0" }, run: fallback.run, directory })).kind).toBe("image");
  });
});

test("a JPEG from the clipboard is converted to a PNG with Photon, and the PNG is what is saved", async () => {
  const { resizeImage } = await import("@earendil-works/pi-coding-agent");
  // A real JPEG: with a small ceiling `resizeImage` prefers one.
  const noise = Buffer.alloc(300 * 200 * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 31 + (i >> 5)) & 255;
  const probe = await import("../ui/basic/png-fixtures.ts");
  const made = await resizeImage(probe.realPng(400, 300, 8), "image/png", { maxWidth: 400, maxHeight: 300, maxBytes: 50_000 });
  expect(made?.mimeType).toBe("image/jpeg");
  const jpeg = Buffer.from(made!.data, "base64");
  await withFolder(async directory => {
    const double = imageDouble(call => call.args[0] === "--list-types" ? { stdout: Buffer.from("image/jpeg\n") } : { stdout: jpeg });
    const result = await pasteClipboardImage({ platform: "linux", env: { WAYLAND_DISPLAY: "w" }, run: double.run, directory });
    expect(result.kind).toBe("image");
    expect(readFileSync((result as { path: string }).path).subarray(0, 8)).toEqual(PNG.subarray(0, 8));
  });
}, { timeout: 30_000 });

test("a JPEG clipboard image with EXIF orientation is saved upright", async () => {
  const { resizeImage } = await import("@earendil-works/pi-coding-agent");
  const probe = await import("../ui/basic/png-fixtures.ts");
  const made = await resizeImage(probe.realPng(400, 300, 8), "image/png", { maxWidth: 400, maxHeight: 300, maxBytes: 50_000 });
  expect(made?.mimeType).toBe("image/jpeg");
  const jpeg = Buffer.from(made!.data, "base64");
  const exif = Buffer.from([
    0xff, 0xe1, 0x00, 0x22,
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
  const rotated = Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]);
  await withFolder(async directory => {
    const double = imageDouble(call => call.args[0] === "--list-types" ? { stdout: Buffer.from("image/jpeg\n") } : { stdout: rotated });
    const result = await pasteClipboardImage({ platform: "linux", env: { WAYLAND_DISPLAY: "w" }, run: double.run, directory });
    expect(result.kind).toBe("image");
    const png = readFileSync((result as { path: string }).path);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([225, 300]);
  });
}, { timeout: 30_000 });

test("the PNG's signature is checked on what a program wrote, and the size limit holds: a file that is not a PNG or is too big is deleted", async () => {
  await withFolder(async directory => {
    const notPng = imageDouble(call => { writeFileSync(call.env!.FORGE614_CLIP_PATH!, JPEG); return { stdout: ok("ok") }; });
    expect(await pasteClipboardImage({ platform: "darwin", run: notPng.run, directory })).toEqual({ kind: "failed" });
    expect(readdirSync(join(directory, "forge614-shell"))).toEqual([]);
    const big = imageDouble(call => { writeFileSync(call.env!.FORGE614_CLIP_PATH!, Buffer.concat([PNG, Buffer.alloc(5000)])); return { stdout: ok("ok") }; });
    expect(await pasteClipboardImage({ platform: "darwin", run: big.run, directory, maxBytes: 1000 })).toEqual({ kind: "too-big" });
    expect(readdirSync(join(directory, "forge614-shell"))).toEqual([]);
    // Over the limit while it is being read (the runner says so).
    const tooBig = imageDouble(call => call.args[0] === "--list-types" ? { stdout: Buffer.from("image/png\n") } : { status: null, tooBig: true });
    expect(await pasteClipboardImage({ platform: "linux", env: { WAYLAND_DISPLAY: "w" }, run: tooBig.run, directory })).toEqual({ kind: "too-big" });
  });
  expect(MAX_PASTED_IMAGE_BYTES).toBe(MAX_IMAGE_BYTES);
});

test("a program that does not finish within the time limit makes the paste fail, and every program is given 5 seconds", async () => {
  await withFolder(async directory => {
    const seen: number[] = [];
    const timedOut: ImageProgramRunner = async (_command, _args, options) => { seen.push(options.timeoutMs); return { status: null, stdout: Buffer.alloc(0), missing: false, timedOut: true, tooBig: false }; };
    expect(await pasteClipboardImage({ platform: "linux", env: { WAYLAND_DISPLAY: "w" }, run: timedOut, directory })).toEqual({ kind: "failed" });
    expect(await pasteClipboardImage({ platform: "win32", run: timedOut, directory })).toEqual({ kind: "failed" });
    expect(seen).toEqual([5000, 5000]);
  });
});

test("the real runner is asynchronous and bounded: it stops a program that takes too long, one that writes too much, and says when a program is not there", async () => {
  const started = Date.now();
  const slow = await runImageProgram(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { timeoutMs: 300, maxBytes: 1000 });
  expect(slow.timedOut).toBe(true);
  expect(slow.status).toBeNull();
  expect(Date.now() - started).toBeLessThan(5000);
  const flood = await runImageProgram(process.execPath, ["-e", "process.stdout.write(Buffer.alloc(3_000_000, 1))"], { timeoutMs: 5000, maxBytes: 1000 });
  expect(flood.tooBig).toBe(true);
  const absent = await runImageProgram("forge614-no-such-clipboard-program", [], { timeoutMs: 2000, maxBytes: 1000 });
  expect(absent.missing).toBe(true);
  const echoed = await runImageProgram(process.execPath, ["-e", "process.stdout.write(process.env.FORGE614_CLIP_PATH ?? '')"], { env: { ...process.env, FORGE614_CLIP_PATH: "from-env" }, timeoutMs: 5000, maxBytes: 1000 });
  expect(echoed.status).toBe(0);
  expect(echoed.stdout.toString()).toBe("from-env");
  // Never `spawnSync`: it would block a test server in the same process.
  expect(readFileSync(new URL("./clipboard.ts", import.meta.url), "utf8")).not.toMatch(/spawnSync\s*\(|import\s[^;]*spawnSync/);
});

test("the key that pastes the image is Alt+V on Windows and Ctrl+V elsewhere", () => {
  expect([pasteImageKey("win32"), pasteImageKeyLabel("win32")]).toEqual(["alt+v", "Alt+V"]);
  for (const platform of ["darwin", "linux"] as const) expect([pasteImageKey(platform), pasteImageKeyLabel(platform)]).toEqual(["ctrl+v", "Ctrl+V"]);
});

/** On Windows, a real parse of the script by Windows PowerShell 5.1 (the same parser that runs it): the script has no syntax error. */
test.skipIf(process.platform !== "win32")("Windows: the paste script parses without errors in Windows PowerShell", async () => {
  const parse = "$errors = $null; $tokens = $null; [void][System.Management.Automation.Language.Parser]::ParseInput($env:FORGE614_SCRIPT, [ref]$tokens, [ref]$errors); if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Output $_.Message }; exit 1 }; Write-Output 'parsed'";
  const result = await runImageProgram("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", parse], { env: { ...process.env, FORGE614_SCRIPT: WINDOWS_PASTE_SCRIPT }, timeoutMs: 30_000, maxBytes: 100_000 });
  expect(result.missing, "powershell.exe is not there").toBe(false);
  expect(result.stdout.toString("utf8").trim(), `status ${result.status}`).toBe("parsed");
}, { timeout: 60_000 });

/**
 * On macOS, a real `osascript` reads whatever the clipboard holds now, without changing it: with an image it answers its path (a PNG, the signature checked), with none it says so. It is never «failed» or
 * «missing»: the AppleScript compiles and runs. (Reading does not alter the clipboard.)
 */
test.skipIf(process.platform !== "darwin")("macOS: the real osascript reads the clipboard (an image or nothing) without failing", async () => {
  await withFolder(async directory => {
    const result = await pasteClipboardImage({ directory });
    console.log(`macOS real osascript read: ${result.kind}`);
    expect(["image", "empty"], JSON.stringify(result)).toContain(result.kind);
    if (result.kind === "image") expect(readFileSync(result.path).subarray(0, 8).equals(PNG.subarray(0, 8))).toBe(true);
  });
}, { timeout: 30_000 });

/**
 * On the CI's macOS only (or with `FORGE614_TEST_REAL_CLIPBOARD=1`, because it replaces the clipboard): a PNG is put on the clipboard with `set the clipboard to (read … as «class PNGf»)` and Shell reads it.
 * Where the session cannot set the clipboard (no window server) the test says so and goes on without failing.
 */
test.skipIf(process.platform !== "darwin" || (!process.env.CI && !process.env.FORGE614_TEST_REAL_CLIPBOARD))("macOS: an image put on the clipboard with osascript is read back by Shell as a PNG", async () => {
  const { realPng } = await import("../ui/basic/png-fixtures.ts");
  await withFolder(async directory => {
    const source = join(directory, "source.png");
    const original = realPng(64, 48, 3);
    writeFileSync(source, original);
    const set = await runImageProgram("osascript", ["-e", `set the clipboard to (read (POSIX file "${source}") as «class PNGf»)`], { timeoutMs: 15_000, maxBytes: 10_000 });
    if (set.status !== 0) { console.log(`The macOS session cannot set the clipboard (status ${set.status}): the real read-back is not run here.`); return; }
    const result = await pasteClipboardImage({ directory });
    expect(result.kind, JSON.stringify(result)).toBe("image");
    expect(readFileSync((result as { path: string }).path).subarray(0, 8).equals(original.subarray(0, 8))).toBe(true);
  });
}, { timeout: 60_000 });
