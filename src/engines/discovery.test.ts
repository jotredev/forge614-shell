import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { discoverEngines } from "./discovery.ts";

test("discovery includes executable supported engines only, once, without running them", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-discovery-"));
  try {
    const bin = join(root, "bin with spaces");
    await mkdir(bin);
    for (const name of ["claude", "codex", "agy", "gemini", "copilot", "opencode", "pi"]) {
      const file = join(bin, process.platform === "win32" ? `${name}.exe` : name);
      await writeFile(file, "not an executable program; discovery must not run me");
      await chmod(file, 0o755);
    }
    const engines = await discoverEngines({ PATH: [bin, bin].join(delimiter) });
    expect(engines.map(engine => engine.id)).toEqual(["claude", "codex", "antigravity"]);
    expect(engines[0]?.executable).toBe(join(bin, process.platform === "win32" ? "claude.exe" : "claude"));
    expect(await discoverEngines({ PATH: root })).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a directory named claude is not an installed engine", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-not-binary-"));
  try {
    await mkdir(join(root, process.platform === "win32" ? "claude.exe" : "claude"));
    expect(await discoverEngines({ PATH: root })).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test.skipIf(process.platform === "win32")("non-executable files are not offered", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-not-executable-"));
  try {
    await writeFile(join(root, "claude"), "fixture", { mode: 0o644 });
    expect(await discoverEngines({ PATH: root })).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Windows npm engines resolve to their package entry without executing a cmd shell", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-win-discovery-"));
  try {
    const pkg = join(root, "node_modules", "@openai", "codex");
    await mkdir(join(pkg, "dist"), { recursive: true });
    await writeFile(join(root, "codex.cmd"), "this shim must never be executed");
    await writeFile(join(pkg, "package.json"), JSON.stringify({ bin: { codex: "dist/index.js" } }));
    await writeFile(join(pkg, "dist", "index.js"), "// entry fixture");
    expect(await discoverEngines({ PATH: root }, "win32")).toEqual([{ id: "codex", label: "Codex", executable: join(pkg, "dist", "index.js") }]);
    await writeFile(join(pkg, "package.json"), JSON.stringify({ bin: { codex: "../../outside.js" } }));
    expect(await discoverEngines({ PATH: root }, "win32")).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
