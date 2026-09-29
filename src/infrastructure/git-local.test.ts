import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { gitBranches, gitCommits, gitCurrentBranch, gitDiff } from "./git-local.ts";

// A throwaway repository per test, built with the person's own git but none of their global settings, so
// what the tests read never depends on (or touches) the developer's real repositories or config.
let root: string;
const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Shell Tests", "-c", "user.email=tests@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: root, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "forge614-shell-git-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

/** Like Codex's `get_git_diff.rs`: the diff of tracked changes followed by each untracked file as a diff against /dev/null. */
test("gitDiff() returns tracked changes and untracked files", async () => {
  git("init", "-q", "--initial-branch=main");
  writeFileSync(join(root, "tracked.txt"), "one\n");
  git("add", "tracked.txt"); git("commit", "-q", "-m", "first");
  writeFileSync(join(root, "tracked.txt"), "one\ntwo\n");
  writeFileSync(join(root, "new.txt"), "brand new\n");
  const result = await gitDiff(root);
  expect(result.inRepo).toBe(true);
  // Like Codex, git is asked for color (`--color`); the screen strips it, so the checks read the plain text.
  const plain = stripVTControlCharacters(result.diff);
  expect(plain).toContain("diff --git a/tracked.txt b/tracked.txt");
  expect(plain).toContain("+two");
  expect(plain).toContain("+brand new");
  expect(plain.indexOf("tracked.txt")).toBeLessThan(plain.indexOf("new.txt"));
});

/** Outside a repository there is nothing to diff, and git is not asked for more than that. */
test("gitDiff() outside a repository reports it and an unchanged repository has an empty diff", async () => {
  expect(await gitDiff(root)).toEqual({ inRepo: false, diff: "" });
  git("init", "-q", "--initial-branch=main");
  writeFileSync(join(root, "a.txt"), "a\n");
  git("add", "a.txt"); git("commit", "-q", "-m", "first");
  expect(await gitDiff(root)).toEqual({ inRepo: true, diff: "" });
});

/** Codex's `/review` pickers: local branches sorted with the default branch (main, else master) first, the current branch, and the recent commits newest first. */
test("branches put main first, the current branch is reported and commits come newest first", async () => {
  git("init", "-q", "--initial-branch=main");
  writeFileSync(join(root, "a.txt"), "a\n");
  git("add", "a.txt"); git("commit", "-q", "-m", "First commit");
  git("checkout", "-q", "-b", "alpha");
  writeFileSync(join(root, "a.txt"), "b\n");
  git("commit", "-q", "-am", "Second commit");
  expect(await gitBranches(root)).toEqual(["main", "alpha"]);
  expect(await gitCurrentBranch(root)).toBe("alpha");
  expect((await gitCommits(root, 100)).map(commit => commit.subject)).toEqual(["Second commit", "First commit"]);
  expect((await gitCommits(root, 1)).map(commit => commit.sha)).toEqual([git("rev-parse", "HEAD").toString().trim()]);
});
