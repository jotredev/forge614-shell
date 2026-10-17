import { expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const VERSION = "1.17.0";

/** Overlay environment values without retaining duplicate names on case-insensitive platforms. */
function mergeEnvironment(base: NodeJS.ProcessEnv, overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const environment = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    for (const existing of Object.keys(environment)) {
      if (existing.toLowerCase() === key.toLowerCase()) delete environment[existing];
    }
    environment[key] = value;
  }
  return environment;
}

/** Run a child process with a bounded wait and captured output. */
async function run(command: string[], options: { cwd: string; env: Record<string, string | undefined>; timeoutMs?: number }) {
  const child = Bun.spawn(command, { cwd: options.cwd, env: mergeEnvironment(process.env, options.env), stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill(), options.timeoutMs ?? 30_000);
  try {
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { exitCode, stdout, stderr };
  } finally { clearTimeout(timer); }
}

test("Windows E2E environment overlays replace keys without regard to case", () => {
  const merged = mergeEnvironment({ Path: "original", Other: "kept" }, { PATH: "shim", OTHER: "changed" });
  expect(Object.keys(merged).filter((key) => key.toLowerCase() === "path")).toEqual(["PATH"]);
  expect(merged.PATH).toBe("shim");
  expect(Object.keys(merged).filter((key) => key.toLowerCase() === "other")).toEqual(["OTHER"]);
  expect(merged.OTHER).toBe("changed");
});

/** Build a localhost release containing the package, common gatekeepers, node pointer and manifest. */
async function buildRelease(output: string): Promise<void> {
  const bundle = Bun.spawnSync([process.execPath, "scripts/release-bundle.mjs", "--out", output], { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" });
  expect(bundle.exitCode, new TextDecoder().decode(bundle.stderr)).toBe(0);
  for (const name of ["install.sh", "install.ps1", "install.mjs", "forge614.node.json"]) await copyFile(join(REPO_ROOT, name), join(output, name));
  const names = (await readdir(output)).sort();
  const lines: string[] = [];
  for (const name of names) lines.push(`${createHash("sha256").update(await readFile(join(output, name))).digest("hex")}  ${name}`);
  await writeFile(join(output, "SHA256SUMS"), `${lines.join("\n")}\n`);
}

/** Install a fake but protocol-shaped Engines launcher beside the temporary Shell home. */
async function installEnginesFixture(forgeHome: string): Promise<void> {
  const bin = join(forgeHome, "engines", "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, "fake-engines.js"), `const a=process.argv.slice(2); if(a[0]==="--version") console.log("forge614-engines 1.0.0"); else if(a[0]==="detect") console.log(JSON.stringify({schemaVersion:1,agents:[]})); else if(a[0]==="capabilities") console.log(JSON.stringify({schemaVersion:1,id:"claude-code",fullySupported:true})); else if(a[0]==="update") console.log(JSON.stringify({schemaVersion:1,result:{updated:false,currentVersion:"1.0.0",latestVersion:"1.0.0"}})); else process.exit(64);`);
  const launcher = join(bin, "forge614-engines.cmd");
  await writeFile(launcher, `@node "%~dp0fake-engines.js" %* & @exit /b\r\n`);
}

test.skipIf(process.platform !== "win32")("Windows .cmd update and uninstall wait for the installed process and use only localhost", async () => {
  // This E2E builds, installs, updates and removes a release; 120s is a bounded CI allowance for those Windows process and filesystem steps.
  const testStartedAt = Date.now();
  const logStage = (stage: string) => process.stderr.write(`[Windows E2E] ${stage} (${Date.now() - testStartedAt} ms)\n`);
  const root = await mkdtemp(join(tmpdir(), "forge614-shell-win-e2e-"));
  const releaseDir = join(root, "release");
  const home = join(root, "user home");
  const forgeHome = join(home, ".forge614");
  const registryKey = `Software\\Forge614-Test-ShellE2E-${randomUUID().replaceAll("-", "")}`;
  await mkdir(home, { recursive: true });
  await buildRelease(releaseDir);
  await installEnginesFixture(forgeHome);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/repos/jotredev/forge614-shell/releases/latest") return Response.json({ tag_name: `v${VERSION}` });
      const prefix = `/repos/jotredev/forge614-shell/releases/download/v${VERSION}/`;
      if (path.startsWith(prefix)) {
        const file = join(releaseDir, decodeURIComponent(path.slice(prefix.length)));
        return existsSync(file) ? new Response(Bun.file(file)) : new Response("not found", { status: 404 });
      }
      return new Response("not found", { status: 404 });
    },
  });

  try {
    const createKey = `$key='HKCU:\\${registryKey}'; New-Item -Path $key -Force | Out-Null; New-ItemProperty -Path $key -Name Path -Value '' -PropertyType ExpandString -Force | Out-Null`;
    const registry = await run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", createKey], { cwd: root, env: {} });
    expect(registry.exitCode, registry.stderr).toBe(0);
    const env = {
      HOME: home,
      USERPROFILE: home,
      FORGE614_HOME: forgeHome,
      FORGE614_INSTALL_TEST_BASE_URL: `http://127.0.0.1:${server.port}`,
      FORGE614_TEST_WINDOWS_ENV_KEY: registryKey,
      FORGE614_SHELL_LOCALE: "en",
    };
    logStage("install: started");
    const install = await run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(REPO_ROOT, "install.ps1"), "--latest"], { cwd: root, env });
    expect(install.exitCode, `${install.stdout}\n${install.stderr}`).toBe(0);
    logStage("install: completed");
    const launcher = join(forgeHome, "shell", "bin", "forge614-shell.cmd");
    expect(existsSync(launcher)).toBe(true);
    const quoteForPowerShell = (value: string) => `'${value.replaceAll("'", "''")}'`;
    const commandLine = (args: string[], cwd = root, extraEnv: Record<string, string> = {}) => run([
      "powershell.exe",
      "-NoProfile",
      "-Command",
      `& ${quoteForPowerShell(launcher)} ${args.map(quoteForPowerShell).join(" ")}; exit $LASTEXITCODE`,
    ], { cwd, env: { ...env, ...extraEnv } });
    const version = await commandLine(["--version"]);
    expect(version.exitCode, `${version.stdout}\n${version.stderr}`).toBe(0);
    expect(version.stdout.trim()).toBe(`forge614-shell ${VERSION}`);

    const shellHome = join(forgeHome, "shell");
    const blockedUninstall = await commandLine(["uninstall", "--json"], join(shellHome, "bin"));
    expect(blockedUninstall.exitCode, `${blockedUninstall.stdout}\n${blockedUninstall.stderr}`).toBe(1);
    const blockedOutput = `${blockedUninstall.stdout}\n${blockedUninstall.stderr}`;
    expect(blockedOutput).toContain('"code":"UNINSTALL_FAILED"');
    expect(blockedOutput).toContain("Run uninstall from outside the Forge614 Shell folder.");
    expect(existsSync(shellHome)).toBe(true);
    expect(existsSync(launcher)).toBe(true);
    expect(existsSync(join(shellHome, ".active-version"))).toBe(true);
    const versionAfterRejectedUninstall = await commandLine(["--version"], join(shellHome, "bin"));
    expect(versionAfterRejectedUninstall.exitCode, `${versionAfterRejectedUninstall.stdout}\n${versionAfterRejectedUninstall.stderr}`).toBe(0);
    expect(versionAfterRejectedUninstall.stdout.trim()).toBe(`forge614-shell ${VERSION}`);

    const fakeNodeDir = join(root, "node command probe");
    await mkdir(fakeNodeDir, { recursive: true });
    const realNode = await run(["powershell.exe", "-NoProfile", "-Command", "(Get-Command node.exe).Source"], { cwd: root, env });
    expect(realNode.exitCode, realNode.stderr).toBe(0);
    const captureScript = join(fakeNodeDir, "capture.mjs");
    await writeFile(captureScript, "process.stdout.write(JSON.stringify({ script: process.argv[2], args: process.argv.slice(3) })); process.exitCode = Number(process.env.FORGE614_TEST_NODE_EXIT ?? 0);\n");
    await writeFile(join(fakeNodeDir, "node.cmd"), `@echo off\r\n@"${realNode.stdout.trim()}" "%~dp0capture.mjs" %*\r\n@exit /b %ERRORLEVEL%\r\n`);
    const probeEnv = {
      PATH: `${fakeNodeDir};${process.env.PATH ?? ""}`,
      PATHEXT: ".CMD;.EXE;.BAT",
      FORGE614_TEST_NODE_EXIT: "0",
    };
    const pathEnvKeys = Object.keys({ ...process.env, ...probeEnv }).filter((key) => key.toLowerCase() === "path");
    const resolvedNode = await run(["cmd.exe", "/d", "/c", "where node"], { cwd: root, env: probeEnv });
    logStage(`node probe environment ${JSON.stringify({ pathEnvKeys, whereNode: resolvedNode.stdout.trim(), error: resolvedNode.stderr.trim() })}`);
    expect(resolvedNode.exitCode, resolvedNode.stderr).toBe(0);
    expect(resolvedNode.stdout.split(/\r?\n/)[0]).toBe(join(fakeNodeDir, "node.cmd"));
    for (const exitCode of [0, 1, 2, 130]) {
      const forwarded = await commandLine(["argument with spaces", 'value with "embedded quotes"'], root, {
        ...probeEnv,
        FORGE614_TEST_NODE_EXIT: String(exitCode),
      });
      expect(forwarded.exitCode, `${forwarded.stdout}\n${forwarded.stderr}`).toBe(exitCode);
      const payload = JSON.parse(forwarded.stdout.trim()) as { script: string; args: string[] };
      expect(payload.script).toContain(`forge614-shell-${VERSION}`);
      expect(payload.args).toEqual(["argument with spaces", 'value with "embedded quotes"']);
    }

    logStage("update: started");
    const update = await commandLine(["update", "--version", `v${VERSION}`, "--json"]);
    expect(update.exitCode, `${update.stdout}\n${update.stderr}`).toBe(0);
    expect(update.stdout).toContain(`"installedVersion":"${VERSION}"`);
    logStage("update: installed Node process exited");

    logStage("uninstall: started");
    const uninstall = await commandLine(["uninstall", "--json"]);
    expect(uninstall.exitCode, `${uninstall.stdout}\n${uninstall.stderr}`).toBe(0);
    expect(JSON.parse(uninstall.stdout.trim())).toEqual({ schemaVersion: 1, result: { removed: true } });
    expect(existsSync(shellHome)).toBe(false);
    expect(`${uninstall.stdout}\n${uninstall.stderr}`).not.toMatch(/The batch file cannot be found|cmd\.exe/i);
    logStage("uninstall: returned after shell directory removal");
    const pathRead = await run(["powershell.exe", "-NoProfile", "-Command", `$key='HKCU:\\${registryKey}'; (Get-ItemProperty -Path $key -Name Path).Path`], { cwd: root, env });
    expect(pathRead.stdout).not.toContain(join(forgeHome, "shell", "bin"));
  } finally {
    server.stop(true);
    const removeKey = `Remove-Item -LiteralPath 'HKCU:\\${registryKey}' -Recurse -Force -ErrorAction SilentlyContinue`;
    await run(["powershell.exe", "-NoProfile", "-Command", removeKey], { cwd: root, env: {} });
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);
