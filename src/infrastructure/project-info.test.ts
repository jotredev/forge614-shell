import { expect, test } from "bun:test";
import { readProjectInfo } from "./project-info.ts";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

test("project reader handles plain directories and real Git changes without modifying them", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "forge-project-"));
  try {
    expect((await readProjectInfo(cwd)).git).toBe(false);
    execFileSync("git", ["init", "-b", "test-branch", cwd]);
    expect((await readProjectInfo(cwd)).changedFiles).toBe(0);
    await writeFile(join(cwd, "file.txt"), "hello");
    const info = await readProjectInfo(cwd);
    expect(info.git).toBe(true); expect(info.changedFiles).toBe(1);
    expect(info.branch).toContain("test-branch");
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
