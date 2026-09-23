import { execFile } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

/** Files that make a plain folder count as a project when there is no Git repository. */
const PROJECT_MANIFESTS = [
  "package.json", "pyproject.toml", "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "composer.json", "Gemfile", "forge614.node.json",
] as const;

export type GroupPromptDecision =
  | { readonly ask: false }
  | { readonly ask: true; /** The project root: the Git repository root, or the current folder. */ readonly root: string };

/** The Git repository root containing `cwd` (a worktree counts), or `undefined` when `cwd` is not in one. */
async function gitRoot(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execute("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 3000, windowsHide: true });
    return stdout.trim() || undefined;
  } catch { return undefined; }
}

/** True when anything exists at the path (file, directory or even a broken symlink) — content is never read. */
function pathExists(path: string): boolean {
  try { lstatSync(path); return true; } catch { return false; }
}

/**
 * Decides whether the group-selection screen must be shown (acta 0023 §4): only in an interactive
 * flow, only for a folder that is a project (a Git repository or one with a manifest), and only when
 * Engram's `.forge614/project.json` does not exist yet — if it exists, the person was already asked
 * (or Engram was told by a declaration), so it is never asked again. Shell only checks that the file
 * exists; it never reads its content and never writes anything (Engram owns that file).
 */
export async function resolveGroupPrompt(options: { cwd: string; interactive: boolean }): Promise<GroupPromptDecision> {
  if (!options.interactive) return { ask: false };
  if (!existsSync(options.cwd)) return { ask: false };
  const repositoryRoot = await gitRoot(options.cwd);
  const isProject = repositoryRoot !== undefined || PROJECT_MANIFESTS.some(name => pathExists(join(options.cwd, name)));
  if (!isProject) return { ask: false };
  const root = repositoryRoot ?? options.cwd;
  if (pathExists(join(root, ".forge614", "project.json"))) return { ask: false };
  return { ask: true, root };
}
