import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverCodexSkills } from "./skills.ts";

test("Codex skill discovery reads named SKILL.md files from the project", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-skills-"));
  const skill = join(root, ".agents", "skills", "review");
  await mkdir(skill, { recursive: true });
  await writeFile(join(skill, "SKILL.md"), "---\nname: review\ndescription: Review a pull request\n---\nInstructions");

  await expect(discoverCodexSkills(root, { home: join(root, "home"), systemDir: join(root, "system") })).resolves.toEqual([
    { value: "$review", label: "Review a pull request" },
  ]);
});

test("Codex skill discovery includes skills installed through a plugin", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-plugin-skills-"));
  const skill = join(root, "plugins", "vendor", "package", "1.0.0", "skills", "release");
  await mkdir(skill, { recursive: true });
  await writeFile(join(skill, "SKILL.md"), "---\nname: release\ndescription: Prepare a release\n---\nInstructions");

  await expect(discoverCodexSkills(root, { home: join(root, "home"), systemDir: join(root, "system"), pluginCacheDir: join(root, "plugins") })).resolves.toContainEqual(
    { value: "$release", label: "Prepare a release" },
  );
});
