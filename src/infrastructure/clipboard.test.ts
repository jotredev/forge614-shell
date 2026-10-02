import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copySelectionText, copyToClipboard, saveNewFile } from "./clipboard.ts";
import type { ClipboardRunner } from "./clipboard.ts";
import { ShellError } from "../shell-error.ts";

/** On macOS the text goes to the system's own `pbcopy` as its input (nothing to install), never as an argument or through a shell. The real clipboard is never touched: the runner is a stand-in. */
test("copyToClipboard() hands the text to pbcopy on macOS", async () => {
  const calls: [string, string[], string][] = [];
  await copyToClipboard("line one\nline 'two' & $three", "darwin", async (command, args, input) => { calls.push([command, args, input]); });
  expect(calls).toEqual([["/usr/bin/pbcopy", [], "line one\nline 'two' & $three"]]);
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

/** The OSC 52 sequence a terminal that understands it copies from: the exact bytes the fallback writes. */
const osc52 = (text: string) => `\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`;

/** A stand-in for the system's clipboard programs: records each call and answers with what `answers` says for that program (`null` = the program is not there). */
function clipboardDouble(answers: Record<string, number | null>) {
  const calls: [string, string[], string][] = [];
  const written: string[] = [];
  const run: ClipboardRunner = async (command, args, input) => { calls.push([command, args, input]); return answers[command] ?? null; };
  return { calls, written, options: (platform: NodeJS.Platform) => ({ platform, run, write: (data: string) => { written.push(data); } }) };
}

/**
 * On macOS the selected text goes to `pbcopy` as its input, with no arguments, and nothing else is written: macOS Terminal does not understand OSC 52, so the sequence alone would show «Copied»
 * and leave the clipboard empty. It exists because that was the bug: Shell gave pi-tui no clipboard of its own.
 */
test("copySelectionText() copies with pbcopy on macOS and writes no OSC 52 when it worked", async () => {
  const double = clipboardDouble({ pbcopy: 0 });
  expect(await copySelectionText("line one\nline 'two' & $three", double.options("darwin"))).toBe(true);
  expect(double.calls).toEqual([["pbcopy", [], "line one\nline 'two' & $three"]]);
  expect(double.written).toEqual([]);
});

/** On Linux `wl-copy` goes first and `xclip -selection clipboard` only when `wl-copy` is not there; on Windows it is `clip`. */
test("copySelectionText() tries wl-copy then xclip on Linux, and clip on Windows", async () => {
  const both = clipboardDouble({ "wl-copy": null, xclip: 0 });
  expect(await copySelectionText("hola", both.options("linux"))).toBe(true);
  expect(both.calls).toEqual([["wl-copy", [], "hola"], ["xclip", ["-selection", "clipboard"], "hola"]]);
  expect(both.written).toEqual([]);
  const wayland = clipboardDouble({ "wl-copy": 0 });
  expect(await copySelectionText("hola", wayland.options("linux"))).toBe(true);
  expect(wayland.calls).toEqual([["wl-copy", [], "hola"]]);
  const windows = clipboardDouble({ clip: 0 });
  expect(await copySelectionText("hola", windows.options("win32"))).toBe(true);
  expect(windows.calls).toEqual([["clip", [], "hola"]]);
  expect(windows.written).toEqual([]);
});

/**
 * With a program that ends in an error, or no program at all, the exact OSC 52 sequence (the text in base64) is written and the answer is still true: a terminal that does understand it
 * (Orca, a remote session) keeps copying. A program that cannot even be run (it rejects) is the same, and nothing ever throws.
 */
test("copySelectionText() falls back to the exact OSC 52 sequence and still answers true", async () => {
  const text = "ñandú → 日本\nsegunda línea";
  const failing = clipboardDouble({ pbcopy: 1 });
  expect(await copySelectionText(text, failing.options("darwin"))).toBe(true);
  expect(failing.written).toEqual([osc52(text)]);
  const missing = clipboardDouble({});
  expect(await copySelectionText(text, missing.options("linux"))).toBe(true);
  expect(missing.calls.map(call => call[0])).toEqual(["wl-copy", "xclip"]);
  expect(missing.written).toEqual([osc52(text)]);
  const unknown = clipboardDouble({});
  expect(await copySelectionText(text, unknown.options("freebsd"))).toBe(true);
  expect(unknown.calls).toEqual([]);
  expect(unknown.written).toEqual([osc52(text)]);
  const rejected: string[] = [];
  expect(await copySelectionText(text, { platform: "darwin", run: async () => { throw new Error("spawn failed"); }, write: data => { rejected.push(data); } })).toBe(true);
  expect(rejected).toEqual([osc52(text)]);
});

/** Never throws, even when the fallback's own write does: the answer is then false (the person is told the copy failed), not an exception. */
test("copySelectionText() never throws", async () => {
  const answer = await copySelectionText("x", { platform: "darwin", run: async () => { throw new Error("boom"); }, write: () => { throw new Error("terminal closed"); } });
  expect(answer).toBe(false);
});

/** No shell: the program is always a bare name with its arguments apart, whatever the text holds, and the code never asks for a shell. */
test("copySelectionText() never uses a shell", async () => {
  const text = "$(rm -rf ~); `x` && y | z";
  for (const platform of ["darwin", "linux", "win32"] as const) {
    const double = clipboardDouble({});
    await copySelectionText(text, double.options(platform));
    for (const [command, args, input] of double.calls) {
      expect(command).toMatch(/^[a-z-]+$/);
      expect(args.every(arg => /^-?[a-z]+$/.test(arg))).toBe(true);
      expect(input).toBe(text);
    }
  }
  const source = readFileSync(new URL("./clipboard.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/shell\s*:\s*true|\bexec\(|execSync|\bsh -c/);
});
