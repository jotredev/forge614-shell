import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultRun } from "./forge614-engram.ts";

/** A fake Engram: a script in a temporary folder that waits `waitMs` and then runs `body` (the one real process these tests start). */
function fakeBinary(root: string, name: string, waitMs: number, body: string): string {
  const path = join(root, name);
  writeFileSync(path, `#!${process.execPath}\nsetTimeout(() => { ${body} }, ${waitMs});\n`, { mode: 0o755 });
  return path;
}

/**
 * `defaultRun` must not freeze the process while Engram works: with `spawnSync` the screen did not draw for the ≈650 ms `startup-context` takes. While a fake binary that waits about 300 ms runs, a
 * 10 ms timer has to fire before it ends, and the result keeps the shape `{ status, stdout, stderr }`.
 */
test.skipIf(process.platform === "win32")("defaultRun does not freeze the process while the binary runs, and keeps its result's shape", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge614-engram-run-"));
  try {
    const binary = fakeBinary(root, "slow", 300, `console.log(JSON.stringify({ ok: true }));`);
    let timerFiredBeforeEnd = false;
    let finished = false;
    const timer = setInterval(() => { if (!finished) timerFiredBeforeEnd = true; }, 10);
    const result = await defaultRun(binary, ["startup-context", "--json"]);
    finished = true; clearInterval(timer);
    expect(timerFiredBeforeEnd).toBe(true);
    expect(result).toEqual({ status: 0, stdout: "{\"ok\":true}\n", stderr: "" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

/** The same result as before for an exit with an error (its status, what it wrote to each stream) and for a binary that is not there (no status, nothing on either stream). */
test.skipIf(process.platform === "win32")("defaultRun reports a failing binary's status and streams, and a missing binary as a null status", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge614-engram-run-"));
  try {
    const failing = fakeBinary(root, "failing", 0, `console.log("partial"); console.error(JSON.stringify({ code: "X", error: "bad" })); process.exit(3);`);
    expect(await defaultRun(failing, [])).toEqual({ status: 3, stdout: "partial\n", stderr: "{\"code\":\"X\",\"error\":\"bad\"}\n" });
    expect(await defaultRun(join(root, "not-there"), [])).toEqual({ status: null, stdout: "", stderr: "" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
