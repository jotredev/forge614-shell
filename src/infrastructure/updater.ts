import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ShellError } from "../shell-error.ts";
import { resolveConfiguredLocale } from "../i18n/index.ts";
import type { Locale } from "../i18n/index.ts";

type Spawn = (command: string, args: string[], options?: { stdio?: "inherit"; env?: NodeJS.ProcessEnv }) => { status: number | null; stderr?: string | Buffer; error?: Error };

async function runInstalledInstaller(
  argument: "--latest" | "--uninstall",
  failedCode: "updater-update-failed" | "updater-uninstall-failed",
  options: { installer?: string; spawn?: Spawn; locale?: Locale; env?: NodeJS.ProcessEnv } = {},
): Promise<void> {
  const installer = options.installer ?? fileURLToPath(new URL("../install.sh", import.meta.url));
  const spawn = options.spawn ?? ((command, args, spawnOptions) => spawnSync(command, args, { stdio: "inherit", ...spawnOptions }));
  // The installer is a separate bash process with its own stdio, so Shell's i18n layer cannot
  // translate its output directly — instead Shell resolves its own effective locale and passes it
  // through a controlled environment variable; the installer validates it itself (en|es, English
  // fallback otherwise) rather than trusting Shell blindly.
  const locale = options.locale ?? resolveConfiguredLocale({ env: options.env }) ?? "en";
  const env = { ...(options.env ?? process.env), FORGE614_SHELL_LOCALE: locale };
  const result = spawn("bash", [installer, argument], { stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    // The installer's own (now-localized) stderr, when present, is already correct presentation
    // text — passed through literally, exactly like external text from Claude/Codex/Engines/Engram.
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    throw stderr ? new Error(stderr) : new ShellError(failedCode);
  }
}

export async function updateInstalledShell(options: { installer?: string; spawn?: Spawn; locale?: Locale; env?: NodeJS.ProcessEnv } = {}): Promise<void> {
  await runInstalledInstaller("--latest", "updater-update-failed", options);
}

export async function uninstallInstalledShell(options: { installer?: string; spawn?: Spawn; locale?: Locale; env?: NodeJS.ProcessEnv } = {}): Promise<void> {
  await runInstalledInstaller("--uninstall", "updater-uninstall-failed", options);
}
