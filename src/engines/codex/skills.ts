import { readdir, readFile } from "node:fs/promises";
import { join, dirname, parse } from "node:path";

export type CodexSkillChoice = { value: string; label: string };

type Options = { home?: string; systemDir?: string; pluginCacheDir?: string };

function field(source: string, name: string): string | undefined {
  const match = source.match(new RegExp(`^${name}:\\s*["']?(.+?)["']?\\s*$`, "m"));
  return match?.[1]?.trim();
}

async function skillsAt(directory: string): Promise<CodexSkillChoice[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return (await Promise.all(entries.filter(entry => entry.isDirectory()).map(async entry => {
      try {
        const source = await readFile(join(directory, entry.name, "SKILL.md"), "utf8");
        const name = field(source, "name");
        if (!name) return undefined;
        return { value: `$${name}`, label: field(source, "description") ?? "Codex skill" };
      } catch { return undefined; }
    }))).filter((skill): skill is CodexSkillChoice => Boolean(skill));
  } catch { return []; }
}

function projectSkillDirectories(cwd: string): string[] {
  const directories: string[] = [];
  for (let current = cwd; ; current = dirname(current)) {
    directories.push(join(current, ".agents", "skills"));
    if (dirname(current) === current || parse(current).root === current) return directories;
  }
}

async function pluginSkillDirectories(root: string, depth = 0): Promise<string[]> {
  if (depth > 6) return [];
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const children = entries.filter(entry => entry.isDirectory());
    return (await Promise.all(children.map(async entry => {
      const path = join(root, entry.name);
      return entry.name === "skills" ? [path] : pluginSkillDirectories(path, depth + 1);
    }))).flat();
  } catch { return []; }
}

/** Mirrors Codex's local skill scopes without reading arbitrary markdown. */
export async function discoverCodexSkills(cwd: string, options: Options = {}): Promise<CodexSkillChoice[]> {
  const home = options.home ?? process.env.HOME;
  const roots = [
    ...projectSkillDirectories(cwd),
    ...(home ? [join(home, ".agents", "skills"), join(home, ".codex", "skills")] : []),
    options.systemDir ?? "/etc/codex/skills",
  ];
  const pluginRoots = await pluginSkillDirectories(options.pluginCacheDir ?? join(home ?? "", ".codex", "plugins", "cache"));
  const discovered = await Promise.all([...roots, ...pluginRoots].map(skillsAt));
  return discovered.flat();
}
