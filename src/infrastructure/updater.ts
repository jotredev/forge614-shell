import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { ShellError } from "../shell-error.ts";
import { resolveConfiguredLocale } from "../i18n/index.ts";
import type { Locale } from "../i18n/index.ts";

export type Spawn = (
  command: string,
  args: string[],
  options?: { stdio?: "inherit" | "pipe"; env?: NodeJS.ProcessEnv; windowsHide?: boolean },
) => { status: number | null; stdout?: string | Buffer; stderr?: string | Buffer; error?: Error };

export interface RunInstallerOptions {
  /** Optional local installer for tests; production updates use the published release gatekeeper. */
  installer?: string;
  spawn?: Spawn;
  locale?: Locale;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  powerShellCommand?: string;
  /** Current working directory override used to exercise the uninstall safety boundary. */
  cwd?: string;
  version?: string;
  currentVersion?: string;
  fetcher?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

export interface UpdateInstalledShellResult {
  readonly updated: boolean;
  readonly previousVersion: string;
  readonly installedVersion: string;
}

const REPOSITORY = "jotredev/forge614-shell";

function shellHome(env: NodeJS.ProcessEnv): string {
  const forgeHome = env.FORGE614_HOME ?? join(env.HOME ?? env.USERPROFILE ?? homedir(), ".forge614");
  return resolve(forgeHome, "shell");
}

function readActiveShellVersion(env: NodeJS.ProcessEnv): string | undefined {
  let value: string;
  try {
    value = readFileSync(join(shellHome(env), ".active-version"), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  const version = value.trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new ShellError("updater-update-failed");
  return version;
}

function pathIsInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function canonicalPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return resolve(path);
    throw error;
  }
}

function ensureUninstallStartsOutsideShell(env: NodeJS.ProcessEnv, cwd = process.cwd()): void {
  const directory = shellHome(env);
  try {
    if (pathIsInside(canonicalPath(directory), canonicalPath(cwd))) throw new ShellError("updater-uninstall-from-shell");
  } catch (error) {
    if (error instanceof ShellError) throw error;
    throw new ShellError("updater-uninstall-from-shell");
  }
}

function ensureShellWasRemoved(env: NodeJS.ProcessEnv): void {
  const directory = shellHome(env);
  try {
    lstatSync(directory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw new Error(sanitizeInstallerDetail(`could not verify that ${directory} was removed: ${error instanceof Error ? error.message : "filesystem check failed"}`, env));
  }
  throw new Error(sanitizeInstallerDetail(`installer exited successfully but ${directory} still exists`, env));
}

/** Check whether a command executable is present on PATH. */
function isCommandOnPath(command: string, env?: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): boolean {
  const pathValue = env?.PATH ?? process.env.PATH ?? "";
  const delimiter = platform === "win32" ? ";" : ":";
  return pathValue.split(delimiter).filter(Boolean).some(dir => {
    try {
      return existsSync(join(dir, command)) || (platform === "win32" && existsSync(join(dir, `${command}.exe`)));
    } catch { return false; }
  });
}

/** Resolve PowerShell, preferring pwsh when it is on PATH. */
export function resolvePowerShellCommand(customCommand?: string, env?: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string {
  if (customCommand) return customCommand;
  if (isCommandOnPath("pwsh", env, platform)) return "pwsh";
  return "powershell.exe";
}

/** Replace only literal sensitive path values, leaving URL punctuation and hostnames intact. */
export function sanitizeInstallerDetail(detail: string, env: NodeJS.ProcessEnv = process.env): string {
  let safe = detail;
  const candidates = [env.HOME, env.USERPROFILE, env.FORGE614_HOME, env.TMP, env.TMPDIR, env.TEMP, tmpdir()]
    .filter((value): value is string => Boolean(value));
  const values = [...new Set(candidates.flatMap(value => {
    const canonical = (() => { try { return realpathSync.native(value); } catch { return undefined; } })();
    return canonical ? [value, canonical] : [value];
  }))].sort((left, right) => right.length - left.length);
  for (const value of values) safe = safe.split(value).join("<ruta>");
  return safe;
}

/** Require strict GNU SHA256SUMS lines and return the one checksum for the requested asset. */
export function checksumForAsset(file: string, manifest: string): string {
  const lines = manifest.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const parsed = lines.map(line => /^([0-9a-f]{64})  ([^\r\n]+)$/.exec(line));
  if (!parsed.length || parsed.some(line => line === null)) throw new Error("SHA256SUMS does not use strict GNU SHA-256 format.");
  const matches = parsed.filter(line => line?.[2] === file);
  if (matches.length !== 1 || !matches[0]?.[1]) throw new Error(`SHA256SUMS has no unique entry for ${file}.`);
  return matches[0][1];
}

/** Resolve a local test base, accepting only an HTTP loopback origin. */
function releaseBase(env: NodeJS.ProcessEnv): string | undefined {
  const base = env.FORGE614_INSTALL_TEST_BASE_URL;
  if (!base) return undefined;
  let url: URL;
  try { url = new URL(base); } catch { throw new Error("FORGE614_INSTALL_TEST_BASE_URL only accepts loopback HTTP."); }
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]", "::1"].includes(url.hostname) || !url.port || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("FORGE614_INSTALL_TEST_BASE_URL only accepts loopback HTTP.");
  }
  return url.origin;
}

/** Resolve latest or a requested version to the canonical vX.Y.Z tag. */
async function selectedTag(version: string | undefined, env: NodeJS.ProcessEnv, fetcher: (input: string | URL | Request, init?: RequestInit) => Promise<Response>): Promise<string> {
  if (version !== undefined) {
    const normalized = version.replace(/^v/, "");
    if (!/^\d+\.\d+\.\d+$/.test(normalized)) throw new Error("version must be X.Y.Z or vX.Y.Z");
    return `v${normalized}`;
  }
  const base = releaseBase(env);
  const url = base
    ? `${base}/repos/${REPOSITORY}/releases/latest`
    : `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
  const response = await fetcher(url, { headers: { Accept: "application/vnd.github+json" } });
  if (!response.ok) throw new Error(`could not resolve the latest release (HTTP ${response.status})`);
  const payload = await response.json() as { tag_name?: unknown };
  if (typeof payload.tag_name !== "string" || !/^v?\d+\.\d+\.\d+$/.test(payload.tag_name)) throw new Error("latest release has an invalid tag");
  return `v${payload.tag_name.replace(/^v/, "")}`;
}

/** Download and checksum the release gatekeeper before executing it. */
async function downloadGatekeeper(tag: string, platform: NodeJS.Platform, options: RunInstallerOptions): Promise<{ directory: string; installer: string }> {
  const env = options.env ?? process.env;
  const base = releaseBase(env);
  const downloadBase = base
    ? `${base}/repos/${REPOSITORY}/releases/download/${tag}`
    : `https://github.com/${REPOSITORY}/releases/download/${tag}`;
  const file = platform === "win32" ? "install.ps1" : "install.sh";
  const fetcher = options.fetcher ?? fetch;
  const [gateResponse, sumsResponse] = await Promise.all([fetcher(`${downloadBase}/${file}`), fetcher(`${downloadBase}/SHA256SUMS`)]);
  if (!gateResponse.ok) throw new Error(`could not download ${file} for ${tag} (HTTP ${gateResponse.status})`);
  if (!sumsResponse.ok) throw new Error(`could not download SHA256SUMS for ${tag} (HTTP ${sumsResponse.status})`);
  const [bytes, sums] = await Promise.all([gateResponse.arrayBuffer(), sumsResponse.text()]);
  const expected = checksumForAsset(file, sums);
  const actual = createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
  if (actual !== expected) throw new Error(`SHA-256 verification failed for ${file}`);
  const directory = await mkdtemp(join(tmpdir(), "forge614-shell-installer-"));
  const installer = join(directory, file);
  await writeFile(installer, new Uint8Array(bytes), { mode: 0o700 });
  return { directory, installer };
}

/** Execute the published gatekeeper with a resolved version, never with --latest. */
async function runPublishedInstaller(action: "update" | "uninstall", options: RunInstallerOptions): Promise<{ tag: string }> {
  const env = { ...(options.env ?? process.env) };
  const platform = options.platform ?? process.platform;
  const locale = options.locale ?? resolveConfiguredLocale({ env }) ?? "en";
  env.FORGE614_SHELL_LOCALE = locale;
  const fetcher = options.fetcher ?? fetch;
  let directory: string | undefined;
  try {
    const tag = await selectedTag(action === "update" ? options.version : undefined, env, fetcher);
    const gate = await downloadGatekeeper(tag, platform, { ...options, env, fetcher });
    directory = gate.directory;
    const command = platform === "win32" ? resolvePowerShellCommand(options.powerShellCommand, env, platform) : "sh";
    const actionArgs = action === "update" ? ["--version", tag] : ["--uninstall"];
    const args = platform === "win32"
      ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", gate.installer, ...actionArgs]
      : [gate.installer, ...actionArgs];
    const spawn = options.spawn ?? ((cmd, argv, spawnOptions) => spawnSync(cmd, argv, { encoding: "utf8", stdio: "pipe", ...spawnOptions }));
    const result = spawn(command, args, { stdio: "pipe", env, ...(platform === "win32" ? { windowsHide: true } : {}) });
    if (result.error) throw result.error;
    const stdout = typeof result.stdout === "string" ? result.stdout : Buffer.isBuffer(result.stdout) ? result.stdout.toString("utf8") : "";
    const stderr = typeof result.stderr === "string" ? result.stderr : Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : "";
    if (stdout && options.spawn) process.stdout.write(stdout);
    if (result.status !== 0) {
      const detail = sanitizeInstallerDetail(stderr.trim() || `installer exited with code ${result.status ?? 1}`, env);
      throw new Error(detail);
    }
    if (action === "uninstall") ensureShellWasRemoved(env);
    return { tag };
  } catch (error) {
    if (error instanceof ShellError) throw error;
    const detail = sanitizeInstallerDetail(error instanceof Error ? error.message : "installer failed", env);
    throw new Error(detail);
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

/** Update Shell through the published, checksum-verified gatekeeper. */
export async function updateInstalledShell(options: RunInstallerOptions = {}): Promise<UpdateInstalledShellResult> {
  const previousVersion = options.currentVersion ?? "0.0.0";
  let updateEnv = options.env ?? process.env;
  if (options.installer) {
    const env = { ...updateEnv, FORGE614_SHELL_LOCALE: options.locale ?? resolveConfiguredLocale({ env: options.env }) ?? "en" };
    updateEnv = env;
    const args = options.version ? ["--version", `v${options.version.replace(/^v/, "")}`] : ["--latest"];
    const platform = options.platform ?? process.platform;
    const command = platform === "win32" ? resolvePowerShellCommand(options.powerShellCommand, env, platform) : "bash";
    const commandArgs = platform === "win32"
      ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", options.installer, ...args]
      : [options.installer, ...args];
    const spawn = options.spawn ?? ((cmd, argv, spawnOptions) => spawnSync(cmd, argv, { encoding: "utf8", stdio: "pipe", ...spawnOptions }));
    const result = spawn(command, commandArgs, { stdio: "pipe", env, ...(platform === "win32" ? { windowsHide: true } : {}) });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const stderr = typeof result.stderr === "string" ? result.stderr : Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : "";
      throw stderr.trim() ? new Error(sanitizeInstallerDetail(stderr.trim(), env)) : new ShellError("updater-update-failed");
    }
  } else {
    await runPublishedInstaller("update", options);
  }
  const installedVersion = readActiveShellVersion(updateEnv)
    ?? (options.installer ? previousVersion : undefined);
  if (installedVersion === undefined) throw new ShellError("updater-update-failed");
  return { updated: previousVersion !== installedVersion, previousVersion, installedVersion };
}

/** Uninstall Shell through the published gatekeeper. */
export async function uninstallInstalledShell(options: RunInstallerOptions = {}): Promise<void> {
  const baseEnv = options.env ?? process.env;
  ensureUninstallStartsOutsideShell(baseEnv, options.cwd ?? process.cwd());
  if (options.installer) {
    const platform = options.platform ?? process.platform;
    const env = { ...baseEnv, FORGE614_SHELL_LOCALE: options.locale ?? resolveConfiguredLocale({ env: options.env }) ?? "en" };
    const command = platform === "win32" ? resolvePowerShellCommand(options.powerShellCommand, env, platform) : "bash";
    const args = platform === "win32"
      ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", options.installer, "--uninstall"]
      : [options.installer, "--uninstall"];
    const spawn = options.spawn ?? ((cmd, argv, spawnOptions) => spawnSync(cmd, argv, { encoding: "utf8", stdio: "pipe", ...spawnOptions }));
    const result = spawn(command, args, { stdio: "pipe", env, ...(platform === "win32" ? { windowsHide: true } : {}) });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const stderr = typeof result.stderr === "string" ? result.stderr : Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : "";
      throw stderr.trim() ? new Error(sanitizeInstallerDetail(stderr.trim(), env)) : new ShellError("updater-uninstall-failed");
    }
    ensureShellWasRemoved(env);
    return;
  }
  await runPublishedInstaller("uninstall", options);
}
