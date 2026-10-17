import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = process.env.FORGE614_TEST_CLI ?? fileURLToPath(new URL("../../src/cli.ts", import.meta.url));

test("the runtime rejects the retired Pi engine before writing to either home", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-runtime-"));
  const home = join(root, "home");
  const forge614Home = join(root, "forge614-home");
  const child = spawn("node", [cli, "--engine", "pi", "--mode", "rpc"], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMPDIR: process.env.TMPDIR,
      HOME: home,
      FORGE614_HOME: forge614Home,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", data => { stderr += String(data); });

  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    expect(code).toBe(1);
    expect(stderr).toMatch(/pi.*(fully supported|totalmente compatible)/i);
    expect(await readdir(root)).toEqual([]);
  } finally {
    child.kill();
    await rm(root, { recursive: true, force: true });
  }
});
