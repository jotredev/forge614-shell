import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const VERSION = "1.17.0";

/** Run an asynchronous child process while a localhost release server remains available. */
async function run(command: string[], options: { cwd: string; env: Record<string, string | undefined>; timeoutMs?: number }) {
  const child = Bun.spawn(command, { cwd: options.cwd, env: { ...process.env, ...options.env }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill(), options.timeoutMs ?? 120_000);
  try {
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { exitCode, stdout, stderr };
  } finally { clearTimeout(timer); }
}

/** Build the six files consumed by the common gatekeeper plus its SHA256SUMS manifest. */
async function currentRelease(output: string): Promise<string> {
  const bundle = Bun.spawnSync([process.execPath, "scripts/release-bundle.mjs", "--out", output], { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" });
  expect(bundle.exitCode, new TextDecoder().decode(bundle.stderr)).toBe(0);
  for (const name of ["install.sh", "install.ps1", "install.mjs", "forge614.node.json"]) {
    await copyFile(join(REPO_ROOT, name), join(output, name));
  }
  const names = (await readdir(output)).sort();
  const lines: string[] = [];
  for (const name of names) lines.push(`${createHash("sha256").update(await readFile(join(output, name))).digest("hex")}  ${name}`);
  await writeFile(join(output, "SHA256SUMS"), `${lines.join("\n")}\n`);
  return `forge614-shell-${VERSION}.tar.gz`;
}

/** Create a small legacy package with the real 27bf310 installer and its update call shape. */
async function legacyRelease(root: string): Promise<{ installer: string; archive: string; checksum: string }> {
  const oldInstaller = Bun.spawnSync(["git", "show", "27bf310:scripts/install.sh"], { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" });
  expect(oldInstaller.exitCode, new TextDecoder().decode(oldInstaller.stderr)).toBe(0);
  const legacyRoot = join(root, "legacy-release");
  const packageRoot = join(legacyRoot, "forge614-shell-1.16.0");
  await mkdir(join(packageRoot, "dist"), { recursive: true });
  const installer = join(legacyRoot, "install.sh");
  await writeFile(installer, oldInstaller.stdout);
  await chmod(installer, 0o755);
  await copyFile(installer, join(packageRoot, "install.sh"));
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "forge614-shell", version: "1.16.0", type: "commonjs" }, null, 2));
  await writeFile(join(packageRoot, "dist", "cli.js"), `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const { join } = require("node:path");
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("forge614-shell 1.16.0"); process.exit(0); }
if (args[0] === "update") {
  const result = spawnSync("bash", [join(__dirname, "..", "install.sh"), "--latest"], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}
process.exit(64);
`);
  await chmod(join(packageRoot, "dist", "cli.js"), 0o755);
  const output = join(root, "release-1.16.0");
  await mkdir(output, { recursive: true });
  const archive = join(output, "forge614-shell-1.16.0.tar.gz");
  const pack = Bun.spawnSync(["tar", "-czf", archive, "-C", legacyRoot, "forge614-shell-1.16.0"], { stdout: "pipe", stderr: "pipe" });
  expect(pack.exitCode, new TextDecoder().decode(pack.stderr)).toBe(0);
  const checksum = `${createHash("sha256").update(await readFile(archive)).digest("hex")}  forge614-shell-1.16.0.tar.gz\n`;
  await writeFile(`${archive}.sha256`, checksum);
  return {
    installer,
    archive,
    checksum: `${archive}.sha256`,
  };
}

/** Create an Engines fixture for the installer's declared dependency and Shell's update orchestration. */
async function installEnginesFixture(forgeHome: string): Promise<void> {
  const bin = join(forgeHome, "engines", "bin");
  await mkdir(bin, { recursive: true });
  const executable = join(bin, "forge614-engines");
  await writeFile(executable, `#!/bin/sh
case "$1" in
  --version) printf '%s\\n' 'forge614-engines 1.0.0' ;;
  capabilities) printf '%s\\n' '{"schemaVersion":1,"id":"claude-code","fullySupported":true}' ;;
  detect) printf '%s\\n' '{"schemaVersion":1,"agents":[]}' ;;
  update) printf '%s\\n' '{"schemaVersion":1,"result":{"updated":false,"currentVersion":"1.0.0","latestVersion":"1.0.0"}}' ;;
  *) exit 64 ;;
esac
`);
  await chmod(executable, 0o755);
}

test.skipIf(process.platform === "win32")("1.16 legacy update, 1.17 migration, new update and uninstall run against a localhost release", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614 shell installer e2e-"));
  const releaseDir = join(root, "release-1.17.0");
  const home = join(root, "user home");
  const forgeHome = join(home, ".forge614");
  await mkdir(home, { recursive: true });
  const archiveName = await currentRelease(releaseDir);
  const legacy = await legacyRelease(root);
  await installEnginesFixture(forgeHome);
  const newChecksum = await readFile(join(releaseDir, `${archiveName}.sha256`));
  const requests: string[] = [];
  const launcherProbe = join(root, "launcher probe");
  await mkdir(join(launcherProbe, "bin"), { recursive: true });
  const unpackProbe = Bun.spawnSync(["tar", "-xzf", join(releaseDir, archiveName), "-C", launcherProbe], { stdout: "pipe", stderr: "pipe" });
  expect(unpackProbe.exitCode, new TextDecoder().decode(unpackProbe.stderr)).toBe(0);
  await mkdir(join(launcherProbe, VERSION), { recursive: true });
  await rename(join(launcherProbe, `forge614-shell-${VERSION}`), join(launcherProbe, VERSION, `forge614-shell-${VERSION}`));
  await writeFile(join(launcherProbe, ".active-version"), `${VERSION}\n`);
  const packagedLauncher = join(launcherProbe, VERSION, `forge614-shell-${VERSION}`, "forge614-shell");
  await symlink(packagedLauncher, join(launcherProbe, "bin", "forge614-shell"));
  const probe = await run([join(launcherProbe, "bin", "forge614-shell"), "--version"], { cwd: root, env: { HOME: home, FORGE614_HOME: forgeHome } });
  expect(probe.exitCode, `${probe.stdout}\n${probe.stderr}`).toBe(0);
  expect(probe.stdout.trim()).toBe(`forge614-shell ${VERSION}`);
  await copyFile(packagedLauncher, join(launcherProbe, "bin", "forge614-shell-copy"));
  const copiedProbe = await run([join(launcherProbe, "bin", "forge614-shell-copy"), "--version"], { cwd: root, env: { HOME: home, FORGE614_HOME: forgeHome } });
  expect(copiedProbe.exitCode, `${copiedProbe.stdout}\n${copiedProbe.stderr}`).toBe(0);
  expect(copiedProbe.stdout.trim()).toBe(`forge614-shell ${VERSION}`);
  let server!: ReturnType<typeof Bun.serve>;
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      requests.push(path);
      if (path === "/repos/jotredev/forge614-shell/releases/latest") return Response.json({ tag_name: `v${VERSION}` });
      if (path === "/legacy-latest") return Response.json({
        tag_name: `v${VERSION}`,
        assets: [
          { name: archiveName, browser_download_url: `${server.url}legacy-assets/${archiveName}` },
          { name: `${archiveName}.sha256`, browser_download_url: `${server.url}legacy-assets/${archiveName}.sha256` },
        ],
      });
      if (path === `/legacy-assets/${archiveName}`) return new Response(Bun.file(join(releaseDir, archiveName)));
      if (path === `/legacy-assets/${archiveName}.sha256`) return new Response(newChecksum);
      if (path.startsWith(`/repos/jotredev/forge614-shell/releases/download/v${VERSION}/`)) {
        const name = decodeURIComponent(path.slice(`/repos/jotredev/forge614-shell/releases/download/v${VERSION}/`.length));
        const file = join(releaseDir, name);
        return existsSync(file) ? new Response(Bun.file(file)) : new Response("not found", { status: 404 });
      }
      return new Response("not found", { status: 404 });
    },
  });

  try {
    const env = {
      HOME: home,
      FORGE614_HOME: forgeHome,
      FORGE614_INSTALL_TEST_BASE_URL: `http://127.0.0.1:${server.port}`,
      FORGE614_RELEASE_API_URL: `http://127.0.0.1:${server.port}/legacy-latest`,
      SHELL: "/bin/zsh",
      FORGE614_SHELL_LOCALE: "en",
    };
    const installOld = await run(["bash", legacy.installer, "--archive", legacy.archive], { cwd: root, env });
    expect(installOld.exitCode, `${installOld.stdout}\n${installOld.stderr}`).toBe(0);
    const launcher = join(forgeHome, "shell", "bin", "forge614-shell");
    const oldVersion = await run([launcher, "--version"], { cwd: root, env });
    expect(oldVersion.stdout.trim()).toBe("forge614-shell 1.16.0");

    const legacyUpdate = await run([launcher, "update"], { cwd: root, env });
    expect(legacyUpdate.exitCode, `${legacyUpdate.stdout}\n${legacyUpdate.stderr}`).toBe(0);
    const updatedByLegacy = await run([launcher, "--version"], { cwd: root, env });
    expect(updatedByLegacy.stdout.trim()).toBe(`forge614-shell ${VERSION}`);

    const newUpdate = await run([launcher, "update", "--version", `v${VERSION}`, "--json"], { cwd: root, env });
    expect(newUpdate.exitCode, `${newUpdate.stdout}\n${newUpdate.stderr}\n${requests.join("\n")}`).toBe(0);
    expect(newUpdate.stdout).toContain(`"installedVersion":"${VERSION}"`);
    expect(await readFile(join(forgeHome, "shell", ".active-version"), "utf8")).toBe(`${VERSION}\n`);

    const uninstall = await run([launcher, "uninstall", "--json"], { cwd: root, env });
    expect(uninstall.exitCode, `${uninstall.stdout}\n${uninstall.stderr}`).toBe(0);
    expect(JSON.parse(uninstall.stdout.trim())).toEqual({ schemaVersion: 1, result: { removed: true } });
    expect(existsSync(join(forgeHome, "shell"))).toBe(false);
    const profile = await readFile(join(home, ".zshrc"), "utf8");
    expect(profile).not.toContain("# Forge614 Shell");
    expect((await readdir(forgeHome)).sort()).toEqual(["engines"]);
  } finally {
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});
