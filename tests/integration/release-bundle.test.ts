import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test.skipIf(process.platform === "win32")("release bundle installs outside the repository and reports its packaged version", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-release-test-"));
  const output = join(root, "release");
  const home = join(root, "home");
  try {
    const bundle = Bun.spawnSync([process.execPath, "scripts/release-bundle.mjs", "--out", output], { cwd: process.cwd() });
    expect(bundle.exitCode).toBe(0);
    const archive = (await readdir(output)).find(name => name.endsWith(".tar.gz"));
    expect(archive).toBeDefined();

    const install = Bun.spawnSync(["bash", "scripts/install.sh", "--archive", join(output, archive!)], {
      cwd: process.cwd(),
      env: { ...process.env, FORGE614_HOME: home },
    });
    expect(install.exitCode).toBe(0);

    const installed = Bun.spawnSync([join(home, "bin", "forge614-shell"), "--version"]);
    expect(installed.exitCode).toBe(0);
    expect(installed.stdout.toString()).toBe("forge614-shell 1.0.0\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
