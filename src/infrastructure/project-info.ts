import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
export type ProjectInfo = { path: string; branch?: string; changedFiles?: number; git: boolean };

export async function readProjectInfo(cwd: string): Promise<ProjectInfo> {
  try {
    const { stdout } = await execute("git", ["status", "--porcelain=v1", "--branch", "-z", "--untracked-files=normal"], {
      cwd, timeout: 3000, maxBuffer: 1024 * 1024, windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    });
    const records = stdout.split("\0");
    const branch = records.shift()?.replace(/^## /, "").replace(/^(No commits yet on|Initial commit on) /, "").split("...")[0];
    let changedFiles = 0;
    for (let i = 0; i < records.length; i++) {
      const entry = records[i]; if (!entry) continue;
      changedFiles++;
      if (/^[RC]|^.[RC]/.test(entry)) i++;
    }
    return { path: cwd, git: true, branch, changedFiles };
  } catch { return { path: cwd, git: false }; }
}
