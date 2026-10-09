import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ShellError } from "../shell-error.ts";
import { resolveConfiguredLocale } from "../i18n/index.ts";
import type { Locale } from "../i18n/index.ts";

export type Spawn = (
  command: string,
  args: string[],
  options?: { stdio?: "inherit"; env?: NodeJS.ProcessEnv; windowsHide?: boolean },
) => { status: number | null; stderr?: string | Buffer; error?: Error };

export interface RunInstallerOptions {
  installer?: string;
  spawn?: Spawn;
  locale?: Locale;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  powerShellCommand?: string;
}

/** Comprueba si un comando ejecutable existe en el PATH para preferir pwsh sobre powershell.exe en Windows. */
function isCommandOnPath(command: string, env?: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): boolean {
  const pathValue = env?.PATH ?? process.env.PATH ?? "";
  const delimiter = platform === "win32" ? ";" : ":";
  const directories = pathValue.split(delimiter).filter(Boolean);
  for (const dir of directories) {
    try {
      if (existsSync(join(dir, command)) || existsSync(join(dir, `${command}.exe`))) {
        return true;
      }
    } catch {
      // Ignorar errores de acceso al sistema de archivos
    }
  }
  return false;
}

/** Resuelve el ejecutable de PowerShell a utilizar en Windows (pwsh o powershell.exe). */
export function resolvePowerShellCommand(customCommand?: string, env?: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string {
  if (customCommand) return customCommand;
  if (isCommandOnPath("pwsh", env, platform)) return "pwsh";
  return "powershell.exe";
}

async function runInstalledInstaller(
  argument: "--latest" | "--uninstall",
  failedCode: "updater-update-failed" | "updater-uninstall-failed",
  options: RunInstallerOptions = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  const isWindows = platform === "win32";

  const defaultInstallerUrl = isWindows ? "../install.ps1" : "../install.sh";
  const installer = options.installer ?? fileURLToPath(new URL(defaultInstallerUrl, import.meta.url));

  const spawn = options.spawn ?? ((command, args, spawnOptions) => spawnSync(command, args, { stdio: "inherit", ...spawnOptions }));

  // El instalador es un subproceso con su propio stdio, por lo que Shell transmite el idioma efectivo
  // mediante FORGE614_SHELL_LOCALE; el instalador lo valida antes de usarlo.
  const locale = options.locale ?? resolveConfiguredLocale({ env: options.env }) ?? "en";
  const env = { ...(options.env ?? process.env), FORGE614_SHELL_LOCALE: locale };

  let command: string;
  let args: string[];

  if (isWindows) {
    command = resolvePowerShellCommand(options.powerShellCommand, options.env, platform);
    const mode = argument === "--uninstall" ? "-Uninstall" : "-Latest";
    args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", installer, mode];
  } else {
    command = "bash";
    args = [installer, argument];
  }

  const result = spawn(command, args, { stdio: "inherit", env, ...(isWindows ? { windowsHide: true } : {}) });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : (Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8").trim() : "");
    throw stderr ? new Error(stderr) : new ShellError(failedCode);
  }
}

export async function updateInstalledShell(options: RunInstallerOptions = {}): Promise<void> {
  await runInstalledInstaller("--latest", "updater-update-failed", options);
}

export async function uninstallInstalledShell(options: RunInstallerOptions = {}): Promise<void> {
  await runInstalledInstaller("--uninstall", "updater-uninstall-failed", options);
}
