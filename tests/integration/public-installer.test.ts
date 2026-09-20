import { expect, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

type CommandResult = { exitCode: number; stdout: string; stderr: string };

async function run(command: string[], options: { cwd: string; env: Record<string, string | undefined> }): Promise<CommandResult> {
  const child = Bun.spawn(command, { ...options, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

async function createRelease(root: string) {
  const output = join(root, "release");
  const bundle = Bun.spawnSync([process.execPath, "scripts/release-bundle.mjs", "--out", output], { cwd: process.cwd() });
  expect(bundle.exitCode).toBe(0);
  const archiveName = (await readdir(output)).find(name => name.endsWith(".tar.gz"));
  expect(archiveName).toBeDefined();
  return {
    archiveName: archiveName!,
    archive: await readFile(join(output, archiveName!)),
    checksum: await readFile(join(output, `${archiveName}.sha256`)),
    output,
  };
}

function enginesBinaryScript(schemaVersion = 1): string {
  return `#!/usr/bin/env bash
if [[ "\${1:-}" == "detect" ]]; then
  echo '{"schemaVersion":${schemaVersion},"agents":[]}'
  exit 0
fi
exit 64
`;
}

function enginesInstallerScript(schemaVersion = 1): string {
  return `#!/usr/bin/env bash
set -euo pipefail
engines_root="\${FORGE614_HOME:?}/engines"
mkdir -p "$engines_root/bin"
cat > "$engines_root/bin/forge614-engines" <<'ENGINE'
${enginesBinaryScript(schemaVersion)}ENGINE
chmod +x "$engines_root/bin/forge614-engines"
echo "Installed Forge614 Engines v1.0.0"
`;
}

function latestServer(
  release: Awaited<ReturnType<typeof createRelease>>,
  checksum = release.checksum,
  engineInstaller?: string,
) {
  const version = release.archiveName.replace(/^forge614-shell-/, "").replace(/\.tar\.gz$/, "");
  let server!: ReturnType<typeof Bun.serve>;
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/latest") {
        return Response.json({
          tag_name: version,
          assets: [
            { name: release.archiveName, browser_download_url: `${server.url}archive` },
            { name: `${release.archiveName}.sha256`, browser_download_url: `${server.url}checksum` },
          ],
        });
      }
      if (path === "/archive") return new Response(release.archive);
      if (path === "/checksum") return new Response(checksum);
      if (path === "/engines-install.sh" && engineInstaller) return new Response(engineInstaller);
      return new Response("missing", { status: 404 });
    },
  });
  return server;
}

test.skipIf(process.platform === "win32")("latest installer downloads, verifies, and installs the published archive", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-public-install-"));
  const home = join(root, "home");
  try {
    const release = await createRelease(root);
    const legacyBin = join(home, ".forge614", "bin");
    await mkdir(legacyBin, { recursive: true });
    await symlink("/tmp/legacy-forge614-shell", join(legacyBin, "forge614-shell"));
    await writeFile(join(home, ".zshrc"), `# Forge614 Shell\nexport PATH=\"${legacyBin}:$PATH\"\n`);
    const server = latestServer(release, release.checksum, enginesInstallerScript());
    const version = release.archiveName.replace(/^forge614-shell-/, "").replace(/\.tar\.gz$/, "");
    try {
      const result = await run(["bash", "scripts/install.sh", "--latest"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOME: home,
          SHELL: "/bin/zsh",
          FORGE614_HOME: join(home, ".forge614"),
          FORGE614_RELEASE_API_URL: `${server.url}latest`,
          FORGE614_ENGINES_INSTALLER_URL: `${server.url}engines-install.sh`,
        },
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`Installed Forge614 Shell v${version}`);
      const installed = await run([join(home, ".forge614", "shell", "bin", "forge614-shell"), "--version"], {
        cwd: process.cwd(), env: { ...process.env, HOME: home },
      });
      expect(installed.stdout).toBe(`forge614-shell ${version}\n`);
      const profile = await readFile(join(home, ".zshrc"), "utf8");
      expect(profile).not.toContain(`export PATH=\"${legacyBin}:$PATH\"`);
      await expect(lstat(join(legacyBin, "forge614-shell"))).rejects.toThrow();
      const engines = await run([join(home, ".forge614", "engines", "bin", "forge614-engines"), "detect"], {
        cwd: process.cwd(), env: { ...process.env, HOME: home },
      });
      expect(engines.stdout).toContain('"schemaVersion":1');
    } finally {
      server.stop(true);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === "win32")("a bad latest checksum preserves the active executable", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-public-checksum-"));
  const home = join(root, "home");
  const forgeHome = join(home, ".forge614");
  try {
    const release = await createRelease(root);
    const enginesBin = join(forgeHome, "engines", "bin");
    const enginesExecutable = join(enginesBin, "forge614-engines");
    await mkdir(enginesBin, { recursive: true });
    await writeFile(enginesExecutable, enginesBinaryScript());
    await chmod(enginesExecutable, 0o755);
    const initial = await run(["bash", "scripts/install.sh", "--archive", join(release.output, release.archiveName)], {
      cwd: process.cwd(), env: { ...process.env, HOME: home, SHELL: "/bin/zsh", FORGE614_HOME: forgeHome },
    });
    expect(initial.exitCode).toBe(0);
    const active = join(forgeHome, "shell", "bin", "forge614-shell");
    const before = await readlink(active);
    const server = latestServer(release, Buffer.from(`not-the-right-hash  ${release.archiveName}\n`));
    try {
      const result = await run(["bash", "scripts/install.sh", "--latest"], {
        cwd: process.cwd(),
        env: { ...process.env, HOME: home, SHELL: "/bin/zsh", FORGE614_HOME: forgeHome, FORGE614_RELEASE_API_URL: `${server.url}latest` },
      });
      expect(result.exitCode).not.toBe(0);
      expect(await readlink(active)).toBe(before);
    } finally {
      server.stop(true);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === "win32")("an already compatible Engines installation is reused without downloading its installer", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-public-engines-reuse-"));
  const home = join(root, "home");
  const forgeHome = join(home, ".forge614");
  try {
    const release = await createRelease(root);
    const enginesBin = join(forgeHome, "engines", "bin");
    const enginesExecutable = join(enginesBin, "forge614-engines");
    await mkdir(enginesBin, { recursive: true });
    await writeFile(enginesExecutable, enginesBinaryScript());
    await chmod(enginesExecutable, 0o755);
    const server = latestServer(release);
    try {
      const result = await run(["bash", "scripts/install.sh", "--latest"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOME: home,
          SHELL: "/bin/zsh",
          FORGE614_HOME: forgeHome,
          FORGE614_RELEASE_API_URL: `${server.url}latest`,
          FORGE614_ENGINES_INSTALLER_URL: `${server.url}missing-engines-install.sh`,
        },
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Using compatible Forge614 Engines");
    } finally {
      server.stop(true);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
