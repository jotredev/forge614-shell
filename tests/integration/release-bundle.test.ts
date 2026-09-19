import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test.skipIf(process.platform === "win32")("release bundle installs outside the repository and reports its packaged version", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-release-test-"));
  const output = join(root, "release");
  const home = join(root, "home");
  const installation = join(home, ".forge614");
  try {
    const bundle = Bun.spawnSync([process.execPath, "scripts/release-bundle.mjs", "--out", output], { cwd: process.cwd() });
    expect(bundle.exitCode).toBe(0);
    const archive = (await readdir(output)).find(name => name.endsWith(".tar.gz"));
    expect(archive).toBeDefined();
    const unpacked = join(root, "unpacked");
    await mkdir(unpacked);
    expect(Bun.spawnSync(["tar", "-xzf", join(output, archive!), "-C", unpacked]).exitCode).toBe(0);
    const version = JSON.parse(await readFile("package.json", "utf8")).version;
    const packagedInstaller = join(unpacked, `forge614-shell-${version}`, "install.sh");
    expect(await readFile(packagedInstaller, "utf8")).toContain("--latest");

    const installArguments = ["bash", "scripts/install.sh", "--archive", join(output, archive!)];
    const install = Bun.spawnSync(installArguments, {
      cwd: process.cwd(),
      env: { ...process.env, HOME: home, SHELL: "/bin/zsh", FORGE614_HOME: installation },
    });
    expect(install.exitCode).toBe(0);
    expect(Bun.spawnSync(installArguments, {
      cwd: process.cwd(),
      env: { ...process.env, HOME: home, SHELL: "/bin/zsh", FORGE614_HOME: installation },
    }).exitCode).toBe(0);

    const installed = Bun.spawnSync([join(installation, "bin", "forge614-shell"), "--version"]);
    expect(installed.exitCode).toBe(0);
    expect(installed.stdout.toString()).toBe("forge614-shell 1.0.2\n");
    const profile = await readFile(join(home, ".zshrc"), "utf8");
    expect(profile.split(`export PATH=\"${installation}/bin:$PATH\"`).length - 1).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
