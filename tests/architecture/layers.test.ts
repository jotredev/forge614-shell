import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

test("engine and infrastructure layers do not depend on UI or application startup", async () => {
  for (const layer of ["engines", "infrastructure"]) {
    const root = new URL(`../../src/${layer}/`, import.meta.url);
    for (const file of await readdir(root, { recursive: true })) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
      const code = await readFile(new URL(file, root), "utf8");
      expect(code).not.toMatch(/(?:from\s*|import\s*\()["'][^"']*\/(ui|app)\//);
    }
  }
});

test("each supported native engine owns its session implementation", async () => {
  for (const engine of ["claude", "codex", "antigravity"]) {
    const source = await readFile(new URL(join("../../src/engines", engine, "session.ts"), import.meta.url), "utf8");
    expect(source).toContain("export class");
  }
});
