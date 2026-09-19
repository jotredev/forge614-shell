import { expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, readlink, rm } from "node:fs/promises";
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

function latestServer(release: Awaited<ReturnType<typeof createRelease>>, checksum = release.checksum) {
  let server!: ReturnType<typeof Bun.serve>;
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/latest") {
        return Response.json({
          tag_name: "1.0.1",
          assets: [
            { name: release.archiveName, browser_download_url: `${server.url}archive` },
            { name: `${release.archiveName}.sha256`, browser_download_url: `${server.url}checksum` },
          ],
        });
      }
      if (path === "/archive") return new Response(release.archive);
      if (path === "/checksum") return new Response(checksum);
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
    const server = latestServer(release);
    try {
      const result = await run(["bash", "scripts/install.sh", "--latest"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOME: home,
          SHELL: "/bin/zsh",
          FORGE614_HOME: join(home, ".forge614"),
          FORGE614_RELEASE_API_URL: `${server.url}latest`,
        },
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Installed Forge614 Shell v1.0.1");
      const installed = await run([join(home, ".forge614", "bin", "forge614-shell"), "--version"], {
        cwd: process.cwd(), env: { ...process.env, HOME: home },
      });
      expect(installed.stdout).toBe("forge614-shell 1.0.1\n");
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
    const initial = await run(["bash", "scripts/install.sh", "--archive", join(release.output, release.archiveName)], {
      cwd: process.cwd(), env: { ...process.env, HOME: home, SHELL: "/bin/zsh", FORGE614_HOME: forgeHome },
    });
    expect(initial.exitCode).toBe(0);
    const active = join(forgeHome, "bin", "forge614-shell");
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
