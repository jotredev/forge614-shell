import { expect, test } from "bun:test";
import { uninstallInstalledShell, updateInstalledShell } from "./updater.ts";
import { ShellError, describeError } from "../shell-error.ts";

test("runs the bundled installer with --latest", async () => {
  const calls: string[][] = [];
  await updateInstalledShell({ installer: "/tmp/release/install.sh", spawn: ((command: string, args: string[]) => {
    calls.push([command, ...args]);
    return { status: 0, stderr: "" } as never;
  }) as never });
  expect(calls).toEqual([["bash", "/tmp/release/install.sh", "--latest"]]);
});

test("reports installer diagnostics", async () => {
  await expect(updateInstalledShell({ installer: "/tmp/release/install.sh", spawn: (() => ({ status: 69, stderr: "Node.js is required" }) as never) as never })).rejects.toThrow("Node.js is required");
});

test("runs the bundled installer with --uninstall", async () => {
  const calls: string[][] = [];
  await uninstallInstalledShell({ installer: "/tmp/release/install.sh", spawn: ((command: string, args: string[]) => {
    calls.push([command, ...args]);
    return { status: 0, stderr: "" } as never;
  }) as never });
  expect(calls).toEqual([["bash", "/tmp/release/install.sh", "--uninstall"]]);
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
