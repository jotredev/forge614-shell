import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checksumForAsset, sanitizeInstallerDetail, uninstallInstalledShell, updateInstalledShell } from "./updater.ts";
import { ShellError, describeError } from "../shell-error.ts";

test("SHA256SUMS accepts one strict GNU entry and rejects malformed or duplicate entries", () => {
  const digest = "a".repeat(64);
  expect(checksumForAsset("install.sh", `${digest}  install.sh\n`)).toBe(digest);
  expect(() => checksumForAsset("install.sh", `${digest} *install.sh\n`)).toThrow("strict GNU");
  expect(() => checksumForAsset("install.sh", `${digest}  install.sh\n${digest}  install.sh\n`)).toThrow("unique entry");
});

test("passes the resolved version tag to the local installer seam", async () => {
  const calls: string[][] = [];
  await updateInstalledShell({ installer: "/tmp/release/install.sh", platform: "darwin", version: "1.17.0", spawn: ((command: string, args: string[]) => {
    calls.push([command, ...args]);
    return { status: 0, stderr: "" } as never;
  }) as never });
  expect(calls).toEqual([["bash", "/tmp/release/install.sh", "--version", "v1.17.0"]]);
});

test("reports the active version when an installer exits successfully without changing it", async () => {
  const temp = await mkdtemp(join(tmpdir(), "forge614-updater-noop-"));
  const forgeHome = join(temp, ".forge614");
  const shellHome = join(forgeHome, "shell");
  await mkdir(shellHome, { recursive: true });
  await writeFile(join(shellHome, ".active-version"), "1.16.0\n");
  try {
    const result = await updateInstalledShell({
      installer: "/tmp/release/install.sh",
      platform: "darwin",
      currentVersion: "1.16.0",
      version: "1.17.0",
      env: { HOME: temp, FORGE614_HOME: forgeHome },
      spawn: (() => ({ status: 0, stderr: "" })) as never,
    });
    expect(result).toEqual({ updated: false, previousVersion: "1.16.0", installedVersion: "1.16.0" });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("reports installer diagnostics", async () => {
  await expect(updateInstalledShell({ installer: "/tmp/release/install.sh", spawn: (() => ({ status: 69, stderr: "Node.js is required" }) as never) as never })).rejects.toThrow("Node.js is required");
});

test("redacts gatekeeper paths beneath TMPDIR from installer errors", () => {
  const gatekeeper = join(tmpdir(), "forge614-shell-installer-test", "install.sh");
  const sanitized = sanitizeInstallerDetail(`could not run ${gatekeeper}`, { TMPDIR: tmpdir() } as NodeJS.ProcessEnv);
  expect(sanitized).not.toContain(tmpdir());
  expect(sanitized).toContain("<ruta>/forge614-shell-installer-test/install.sh");
});

test("runs the bundled installer with --uninstall", async () => {
  const calls: string[][] = [];
  await uninstallInstalledShell({ installer: "/tmp/release/install.sh", platform: "darwin", env: { FORGE614_HOME: "/tmp/forge614-updater-no-shell" }, spawn: ((command: string, args: string[]) => {
    calls.push([command, ...args]);
    return { status: 0, stderr: "" } as never;
  }) as never });
  expect(calls).toEqual([["bash", "/tmp/release/install.sh", "--uninstall"]]);
});

test("rejects uninstall from inside Shell and leaves the installation untouched", async () => {
  const temp = await mkdtemp(join(tmpdir(), "forge614-updater-cwd-"));
  const forgeHome = join(temp, ".forge614");
  const shellHome = join(forgeHome, "shell");
  await mkdir(join(shellHome, "bin"), { recursive: true });
  let installerCalls = 0;
  try {
    const error = await uninstallInstalledShell({
      installer: "/tmp/release/install.sh",
      platform: "win32",
      env: { HOME: temp, FORGE614_HOME: forgeHome },
      cwd: join(shellHome, "bin"),
      spawn: (() => { installerCalls++; return { status: 0, stderr: "" }; }) as never,
    }).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ShellError);
    expect((error as ShellError).code).toBe("updater-uninstall-from-shell");
    expect(describeError(error, "es")).toBe("Ejecuta uninstall desde fuera de la carpeta de Forge614 Shell.");
    expect(describeError(error, "en")).toBe("Run uninstall from outside the Forge614 Shell folder.");
    expect(installerCalls).toBe(0);
    expect(existsSync(shellHome)).toBe(true);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === "win32")("rejects uninstall when CWD reaches Shell through a symlink", async () => {
  const temp = await mkdtemp(join(tmpdir(), "forge614-updater-symlink-"));
  const forgeHome = join(temp, ".forge614");
  const shellHome = join(forgeHome, "shell");
  const alias = join(temp, "shell alias");
  await mkdir(shellHome, { recursive: true });
  await symlink(shellHome, alias, "dir");
  let installerCalls = 0;
  try {
    const error = await uninstallInstalledShell({
      installer: "/tmp/release/install.sh",
      platform: "darwin",
      env: { HOME: temp, FORGE614_HOME: forgeHome },
      cwd: alias,
      spawn: (() => { installerCalls++; return { status: 0, stderr: "" }; }) as never,
    }).catch((thrown: unknown) => thrown);
    expect((error as ShellError).code).toBe("updater-uninstall-from-shell");
    expect(installerCalls).toBe(0);
    expect(existsSync(shellHome)).toBe(true);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("does not report a successful uninstall when the gatekeeper leaves Shell installed", async () => {
  const temp = await mkdtemp(join(tmpdir(), "forge614-updater-leftover-"));
  const forgeHome = join(temp, ".forge614");
  const shellHome = join(forgeHome, "shell");
  await mkdir(shellHome, { recursive: true });
  try {
    const error = await uninstallInstalledShell({
      installer: "/tmp/release/install.sh",
      platform: "darwin",
      env: { HOME: temp, FORGE614_HOME: forgeHome },
      cwd: temp,
      spawn: (() => ({ status: 0, stderr: "" })) as never,
    }).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("still exists");
    expect((error as Error).message).not.toContain(temp);
    expect(existsSync(shellHome)).toBe(true);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("passes Shell's effective locale to the installer through a controlled environment variable", async () => {
  let capturedEnv: NodeJS.ProcessEnv | undefined;
  await updateInstalledShell({
    installer: "/tmp/release/install.sh", locale: "es",
    spawn: ((_command: string, _args: string[], options?: { env?: NodeJS.ProcessEnv }) => {
      capturedEnv = options?.env;
      return { status: 0, stderr: "" };
    }) as never,
  });
  expect(capturedEnv?.FORGE614_SHELL_LOCALE).toBe("es");
});

test("without an explicit locale, resolves one from FORGE614_SHELL_LOCALE / preferences the same way the rest of Shell does, defaulting to English", async () => {
  let capturedEnv: NodeJS.ProcessEnv | undefined;
  await updateInstalledShell({
    installer: "/tmp/release/install.sh",
    env: { FORGE614_SHELL_LOCALE: "es" } as NodeJS.ProcessEnv,
    spawn: ((_command: string, _args: string[], options?: { env?: NodeJS.ProcessEnv }) => {
      capturedEnv = options?.env;
      return { status: 0, stderr: "" };
    }) as never,
  });
  expect(capturedEnv?.FORGE614_SHELL_LOCALE).toBe("es");
});

test("when the installer reports nothing on stderr, the fallback is a typed ShellError that translates at the boundary", async () => {
  const error = await updateInstalledShell({
    installer: "/tmp/release/install.sh",
    spawn: (() => ({ status: 65, stderr: "" })) as never,
  }).catch((thrown: unknown) => thrown);
  expect(error).toBeInstanceOf(ShellError);
  expect((error as ShellError).code).toBe("updater-update-failed");
  expect(describeError(error, "es")).toBe("Falló la actualización de Forge614 Shell.");

  const uninstallError = await uninstallInstalledShell({
    installer: "/tmp/release/install.sh",
    spawn: (() => ({ status: 65, stderr: "" })) as never,
  }).catch((thrown: unknown) => thrown);
  expect((uninstallError as ShellError).code).toBe("updater-uninstall-failed");
  expect(describeError(uninstallError, "es")).toBe("Falló la desinstalación de Forge614 Shell.");
});

test("the installer's own stderr (already localized by the installer itself) is passed through literally, never re-wrapped", async () => {
  await expect(updateInstalledShell({
    installer: "/tmp/release/install.sh",
    spawn: (() => ({ status: 69, stderr: "Forge614 Shell requiere Node.js 22.19 o más reciente." })) as never,
  })).rejects.toThrow("Forge614 Shell requiere Node.js 22.19 o más reciente.");
});

test("runs the bundled installer with install.ps1 and -Latest on Windows", async () => {
  const calls: { command: string; args: string[]; options?: { windowsHide?: boolean; env?: NodeJS.ProcessEnv } }[] = [];
  await updateInstalledShell({
    installer: "C:\\Program Files\\release\\install.ps1",
    platform: "win32",
    version: "1.17.0",
    powerShellCommand: "pwsh",
    spawn: ((command: string, args: string[], options?: { windowsHide?: boolean; env?: NodeJS.ProcessEnv }) => {
      calls.push({ command, args, options });
      return { status: 0, stderr: "" } as never;
    }) as never,
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]!.command).toBe("pwsh");
  expect(calls[0]!.args).toEqual([
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    "C:\\Program Files\\release\\install.ps1",
    "--version",
    "v1.17.0",
  ]);
  expect(calls[0]!.options?.windowsHide).toBe(true);
});

test("runs the bundled installer with install.ps1 and -Uninstall on Windows without -Yes", async () => {
  const calls: { command: string; args: string[]; options?: { windowsHide?: boolean; env?: NodeJS.ProcessEnv } }[] = [];
  await uninstallInstalledShell({
    installer: "C:\\Program Files\\release\\install.ps1",
    platform: "win32",
    powerShellCommand: "powershell.exe",
    env: { FORGE614_HOME: "C:\\forge614-test-home" },
    spawn: ((command: string, args: string[], options?: { windowsHide?: boolean; env?: NodeJS.ProcessEnv }) => {
      calls.push({ command, args, options });
      return { status: 0, stderr: "" } as never;
    }) as never,
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]!.command).toBe("powershell.exe");
  expect(calls[0]!.args).toEqual([
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    "C:\\Program Files\\release\\install.ps1",
    "--uninstall",
  ]);
  expect(calls[0]!.options?.windowsHide).toBe(true);
});

test("selects powershell.exe when pwsh is not available on Windows", async () => {
  let executedCommand = "";
  await updateInstalledShell({
    installer: "C:\\release\\install.ps1",
    platform: "win32",
    env: { PATH: "C:\\Windows\\System32" } as NodeJS.ProcessEnv,
    spawn: ((command: string) => {
      executedCommand = command;
      return { status: 0, stderr: "" } as never;
    }) as never,
  });
  expect(executedCommand).toBe("powershell.exe");
});

test("preserves locale and diagnostics on Windows update failure", async () => {
  let capturedEnv: NodeJS.ProcessEnv | undefined;
  const promise = updateInstalledShell({
    installer: "C:\\release\\install.ps1",
    platform: "win32",
    locale: "es",
    spawn: ((_command: string, _args: string[], options?: { env?: NodeJS.ProcessEnv }) => {
      capturedEnv = options?.env;
      return { status: 1, stderr: "Falló la verificación del checksum" } as never;
    }) as never,
  });
  await expect(promise).rejects.toThrow("Falló la verificación del checksum");
  expect(capturedEnv?.FORGE614_SHELL_LOCALE).toBe("es");
});

test("downloads and verifies the Windows gatekeeper and invokes it with execution policy bypass", async () => {
  const temp = await mkdtemp(join(tmpdir(), "forge614-updater-published-"));
  const forgeHome = join(temp, ".forge614");
  const shellHome = join(forgeHome, "shell");
  await mkdir(shellHome, { recursive: true });
  await writeFile(join(shellHome, ".active-version"), "1.16.0\n");
  const calls: { command: string; args: string[] }[] = [];
  const fetched: string[] = [];
  const fetcher = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    fetched.push(url);
    if (url.endsWith("/SHA256SUMS")) {
      const digest = createHash("sha256").update("gatekeeper").digest("hex");
      return new Response(`${digest}  install.ps1\n`);
    }
    return new Response("gatekeeper");
  };
  try {
    const result = await updateInstalledShell({
      platform: "win32",
      version: "1.17.0",
      currentVersion: "1.16.0",
      env: { HOME: temp, FORGE614_HOME: forgeHome, FORGE614_INSTALL_TEST_BASE_URL: "http://127.0.0.1:1234" } as NodeJS.ProcessEnv,
      fetcher,
      powerShellCommand: "pwsh",
      spawn: (command, args) => { calls.push({ command, args }); return { status: 0, stderr: "" }; },
    });
    expect(result).toEqual({ updated: false, previousVersion: "1.16.0", installedVersion: "1.16.0" });
    expect(fetched).toEqual([
      "http://127.0.0.1:1234/repos/jotredev/forge614-shell/releases/download/v1.17.0/install.ps1",
      "http://127.0.0.1:1234/repos/jotredev/forge614-shell/releases/download/v1.17.0/SHA256SUMS",
    ]);
    expect(calls[0]?.command).toBe("pwsh");
    expect(calls[0]?.args.slice(0, 3)).toEqual(["-NoProfile", "-ExecutionPolicy", "Bypass"]);
    expect(calls[0]?.args.slice(-2)).toEqual(["--version", "v1.17.0"]);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
