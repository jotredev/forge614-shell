import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyToClipboard, saveNewFile } from "./clipboard.ts";
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
