import { execFile } from "node:child_process";

/**
 * Read-only git queries in the session's own folder, for the Codex commands whose data Codex's terminal app also
 * gets from local git rather than from the app-server (`/diff`, the `/review` pickers). Every call is a separate
 * `git` process with separate arguments — never a shell — and repeats the safety settings Codex passes
 * (`codex-rs/tui/src/get_git_diff.rs`, `codex-rs/git-utils`): bare repositories only when explicit, no
 * repository hooks, no fsmonitor helper, no optional locks. Nothing here writes to the repository.
 */
const SAFE_CONFIG = ["-c", "safe.bareRepository=explicit", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"];
/** Codex's per-command limit for `/diff` (`DIFF_COMMAND_TIMEOUT`). */
const GIT_TIMEOUT_MS = 30_000;

interface GitOutput { code: number; stdout: string }

/** Runs `git` with Codex's safety settings, `extraEnv` added to the environment; resolves with the exit code instead of throwing, so each caller decides what a failure means. */
function runGit(cwd: string, args: string[], extraEnv: Record<string, string> = {}): Promise<GitOutput> {
  return new Promise((resolve, reject) => {
    execFile("git", [...SAFE_CONFIG, ...args], {
      cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", ...extraEnv },
    }, (error, stdout) => {
      if (error && typeof (error as NodeJS.ErrnoException).code === "string") { reject(error); return; } // git itself could not run
      resolve({ code: error ? Number((error as { code?: number }).code ?? 1) : 0, stdout: String(stdout) });
    });
  });
}

/** A diff command's output: git answers 1 when there are differences, which is not a failure. */
async function diffOutput(cwd: string, args: string[], env: Record<string, string>): Promise<string> {
  const output = await runGit(cwd, args, env);
  if (output.code !== 0 && output.code !== 1) throw new Error(`git ${JSON.stringify(args)} failed with status ${output.code}`);
  return output.stdout;
}

/**
 * Environment that turns off every clean/process filter driver the repository configures, so `/diff` stays
 * informational and never runs a helper the repository chose (`diff_filter_config_overrides` in Codex).
 */
async function filterOverrides(cwd: string): Promise<Record<string, string>> {
  const output = await runGit(cwd, ["config", "--null", "--name-only", "--get-regexp", "^filter\\..*\\.(clean|process)$"]);
  if (output.code !== 0 && output.code !== 1) throw new Error(`git config failed with status ${output.code}`);
  const drivers = [...new Set(output.stdout.split("\0").flatMap(key => {
    const match = /^(.*)\.(clean|process)$/.exec(key);
    return match ? [match[1]!] : [];
  }))].sort();
  const pairs = drivers.flatMap(driver => [[`${driver}.clean`, ""], [`${driver}.process`, ""], [`${driver}.required`, "false"]]);
  if (!pairs.length) return {};
  return Object.fromEntries([["GIT_CONFIG_COUNT", String(pairs.length)], ...pairs.flatMap(([key, value], index) => [[`GIT_CONFIG_KEY_${index}`, key!], [`GIT_CONFIG_VALUE_${index}`, value!]])]);
}

const DIFF_ARGS = ["diff", "--no-textconv", "--no-ext-diff", "--submodule=short", "--ignore-submodules=dirty", "--color"];

/**
 * `/diff`, as `get_git_diff.rs` computes it: whether the folder is inside a work tree and, if so, the diff of the
 * tracked changes followed by one diff per untracked (and not ignored) file against /dev/null.
 */
export async function gitDiff(cwd: string): Promise<{ inRepo: boolean; diff: string }> {
  if ((await runGit(cwd, ["rev-parse", "--is-inside-work-tree"])).code !== 0) return { inRepo: false, diff: "" };
  const env = await filterOverrides(cwd);
  const [tracked, untracked] = await Promise.all([
    diffOutput(cwd, DIFF_ARGS, env),
    runGit(cwd, ["ls-files", "--others", "--exclude-standard"]).then(output => {
      if (output.code !== 0) throw new Error(`git ls-files failed with status ${output.code}`);
      return output.stdout;
    }),
  ]);
  let diff = tracked;
  for (const file of untracked.split("\n").map(line => line.trim()).filter(Boolean)) {
    diff += await diffOutput(cwd, [...DIFF_ARGS, "--no-index", "--", "/dev/null", file], env);
  }
  return { inRepo: true, diff };
}

/** The local branches for the `/review` base-branch picker, sorted, with `main` (else `master`) first — `local_git_branches` in Codex. */
export async function gitBranches(cwd: string): Promise<string[]> {
  const output = await runGit(cwd, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
  const branches = output.code === 0 ? output.stdout.split("\n").map(line => line.trim()).filter(Boolean).sort() : [];
  for (const base of ["main", "master"]) {
    if ((await runGit(cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${base}`])).code !== 0) continue;
    const index = branches.indexOf(base);
    if (index > 0) { branches.splice(index, 1); branches.unshift(base); }
    break;
  }
  return branches;
}

/** The branch checked out now, or undefined on a detached HEAD or outside a repository — `current_branch_name` in Codex. */
export async function gitCurrentBranch(cwd: string): Promise<string | undefined> {
  const output = await runGit(cwd, ["branch", "--show-current"]);
  return output.code === 0 ? output.stdout.trim() || undefined : undefined;
}

/** The most recent commits (newest first) for the `/review` commit picker — `recent_commits` in Codex; empty outside a repository. */
export async function gitCommits(cwd: string, limit: number): Promise<{ sha: string; subject: string }[]> {
  if ((await runGit(cwd, ["rev-parse", "--git-dir"])).code !== 0) return [];
  const output = await runGit(cwd, ["log", ...(limit > 0 ? ["-n", String(limit)] : []), "--pretty=format:%H%x1f%ct%x1f%s"]);
  if (output.code !== 0) return [];
  return output.stdout.split("\n").flatMap(line => {
    const [sha, , subject] = line.split("\x1f");
    return sha?.trim() ? [{ sha: sha.trim(), subject: (subject ?? "").trim() }] : [];
  });
}
