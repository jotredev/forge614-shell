#!/usr/bin/env node

// Shared Forge614 installer. Node-specific values come from forge614.node.json.

import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, copyFile, lstat, mkdir, readFile, readlink, readdir, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { gunzipSync, inflateRawSync } from "node:zlib";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

const EXIT = Object.freeze({ OK: 0, USAGE: 64, REQUIREMENT: 65, DOWNLOAD: 66, DEPENDENCY: 69 });
const MIN_NODE = [22, 19, 0];
const TEST_BASE_ENV = "FORGE614_INSTALL_TEST_BASE_URL";
const temporaryInstallDirs = new Set();
const temporaryFiles = new Set();

/** Remove every staged installer directory when a signal interrupts installation. */
async function cleanupInstallDirs() {
  await Promise.all([
    ...[...temporaryInstallDirs].map((path) => rm(path, { recursive: true, force: true }).catch(() => {})),
    ...[...temporaryFiles].map((path) => rm(path, { force: true }).catch(() => {})),
  ]);
  temporaryInstallDirs.clear();
  temporaryFiles.clear();
}

for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  process.once(signal, () => {
    void cleanupInstallDirs().finally(() => {
      process.exitCode = code;
      process.exit(code);
    });
  });
}

/** Raise an installer error with its public exit code. */
class InstallerError extends Error {
  /** Construct a localized installer error. */
  constructor(code, message) {
    super(message);
    this.name = "InstallerError";
    this.code = code;
  }
}

/** Select Spanish or English from the current and legacy locale variables. */
function locale() {
  const selected = process.env.FORGE614_LOCALE || process.env.FORGE614_SHELL_LOCALE || "es";
  return selected.toLowerCase().startsWith("en") ? "en" : "es";
}

/** Return a localized message for a known installer message key. */
function message(key, values = {}) {
  const messages = {
    installed: { es: "forge614-{node} quedó instalado en {version}.", en: "forge614-{node} was installed at {version}." },
    current: { es: "forge614-{node} ya está al día ({version}).", en: "forge614-{node} is already up to date ({version})." },
    updated: { es: "forge614-{node} se actualizó de {previous} a {version}.", en: "forge614-{node} was updated from {previous} to {version}." },
    reinstalled: { es: "forge614-{node} se reinstaló {version}.", en: "forge614-{node} was reinstalled at {version}." },
    pathNotAdded: { es: "forge614-{node} quedó instalado, pero no se agregó al PATH: {reason}.", en: "forge614-{node} was installed, but was not added to PATH: {reason}." },
    removed: { es: "forge614-{node} se desinstaló.", en: "forge614-{node} was uninstalled." },
    uninstallHookFailed: { es: "Aviso: falló forge614-{node} uninstall --self; se sigue con la limpieza del instalador.", en: "Warning: forge614-{node} uninstall --self failed; continuing with installer cleanup." },
    help: { es: "Uso: install.mjs [--latest] [--force] [--version ETIQUETA] [--archive RUTA] [--uninstall] [--bin-dir RUTA]", en: "Usage: install.mjs [--latest] [--force] [--version TAG] [--archive PATH] [--uninstall] [--bin-dir PATH]" },
  };
  let text = messages[key]?.[locale()] ?? key;
  for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
  return text;
}

/** Compare two numeric semantic versions, ignoring a leading v and prerelease suffix. */
function compareVersions(left, right) {
  const parse = (value) => value.replace(/^v/, "").split(/[+-]/, 1)[0].split(".").map((part) => Number(part));
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta < 0 ? -1 : 1;
  }
  return 0;
}

/** Parse supported arguments without changing their values. */
function parseArguments(argv) {
  const options = { version: "", archive: "", force: false, uninstall: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--latest") continue;
    if (arg === "--force") options.force = true;
    else if (arg === "--uninstall") options.uninstall = true;
    else if (arg === "--help") options.help = true;
    else if (arg === "--version" || arg === "--archive" || arg === "--bin-dir") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new InstallerError(EXIT.USAGE, `invalid value for ${arg}`);
      if (arg === "--version") options.version = value;
      if (arg === "--archive") options.archive = value;
      if (arg === "--bin-dir") options.binDir = value;
      index += 1;
    } else throw new InstallerError(EXIT.USAGE, `unknown argument: ${arg}`);
  }
  if (options.version && !/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(options.version)) {
    throw new InstallerError(EXIT.USAGE, "invalid version tag");
  }
  return options;
}

/** Ensure the running Node version meets the installer's declared minimum. */
function checkNodeVersion() {
  if (compareVersions(process.versions.node, MIN_NODE.join(".")) < 0) {
    throw new InstallerError(EXIT.REQUIREMENT, "Node.js 22.19.0 or later is required.");
  }
}

/** Resolve and validate an absolute Forge614 home directory. */
function forgeHome() {
  const configured = process.env.FORGE614_HOME ?? join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".forge614");
  if (!configured || !isAbsolute(configured)) throw new InstallerError(EXIT.USAGE, "INVALID_FORGE614_HOME");
  return resolve(configured);
}

/** Validate the test-only local HTTP base URL and return it when enabled. */
function testBaseUrl() {
  const candidate = process.env[TEST_BASE_ENV];
  if (!candidate) return undefined;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new InstallerError(EXIT.USAGE, `invalid ${TEST_BASE_ENV}`);
  }
  const localHost = url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "::1";
  if (url.protocol !== "http:" || !localHost || !url.port || url.username || url.password || url.pathname !== "/") {
    throw new InstallerError(EXIT.USAGE, `${TEST_BASE_ENV} only accepts a loopback HTTP origin`);
  }
  if (url.search || url.hash) throw new InstallerError(EXIT.USAGE, `${TEST_BASE_ENV} only accepts a loopback HTTP origin`);
  return url.origin;
}

/** Build the release API URL for a repository and optional local test origin. */
function latestUrl(repository, testBase) {
  return testBase ? `${testBase}/repos/${repository}/releases/latest` : `https://api.github.com/repos/${repository}/releases/latest`;
}

/** Build the URL of a named asset from one immutable release tag. */
function assetUrl(repository, tag, name, testBase) {
  const encoded = name.split("/").map(encodeURIComponent).join("/");
  return testBase
    ? `${testBase}/repos/${repository}/releases/download/${encodeURIComponent(tag)}/${encoded}`
    : `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encoded}`;
}

/** Download a response body and map network or HTTP failures to installer code 66. */
async function download(url) {
  let response;
  try {
    response = await fetch(url, { headers: { "User-Agent": "forge614-installer" }, signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    throw new InstallerError(EXIT.DOWNLOAD, `download failed: ${error instanceof Error ? error.message : "network error"}`);
  }
  if (!response.ok) throw new InstallerError(EXIT.DOWNLOAD, `download failed with HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** Download and parse latest-release metadata. */
async function latestTag(repository, testBase) {
  const bytes = await download(latestUrl(repository, testBase));
  let release;
  try {
    release = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new InstallerError(EXIT.DOWNLOAD, "release metadata is invalid");
  }
  if (typeof release.tag_name !== "string" || !/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(release.tag_name)) {
    throw new InstallerError(EXIT.DOWNLOAD, "release tag is invalid");
  }
  return release.tag_name;
}

/** Fetch an asset and verify the exact GNU SHA256SUMS entry before returning it. */
async function verifiedAsset(repository, tag, name, sums, testBase) {
  const lines = sums.toString("utf8").split(/\r?\n/).filter((line) => line.endsWith(`  ${name}`));
  if (lines.length !== 1 || !/^([0-9a-f]{64})  /.test(lines[0] ?? "")) {
    throw new InstallerError(EXIT.DOWNLOAD, `SHA256SUMS has no unique entry for ${name}`);
  }
  const bytes = await download(assetUrl(repository, tag, name, testBase));
  const expected = lines[0].slice(0, 64);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) throw new InstallerError(EXIT.DOWNLOAD, `SHA-256 mismatch for ${name}`);
  return bytes;
}

/** Read and validate the install block in a node pointer. */
function parsePointer(bytes) {
  let pointer;
  try {
    pointer = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new InstallerError(EXIT.DOWNLOAD, "forge614.node.json is invalid JSON");
  }
  const install = pointer?.install;
  if (typeof pointer?.node !== "string" || !/^[a-z0-9-]+$/.test(pointer.node) || !install || typeof install !== "object") {
    throw new InstallerError(EXIT.REQUIREMENT, "forge614.node.json has no valid install block");
  }
  if (typeof install.repository !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(install.repository)) {
    throw new InstallerError(EXIT.REQUIREMENT, "install.repository is invalid");
  }
  if (typeof install.minimumNodeVersion !== "string" || compareVersions(process.versions.node, install.minimumNodeVersion) < 0) {
    throw new InstallerError(EXIT.REQUIREMENT, "Node.js does not meet install.minimumNodeVersion");
  }
  if (!Array.isArray(install.systems) || !Array.isArray(install.dependencies) || !install.asset || typeof install.asset.pattern !== "string") {
    throw new InstallerError(EXIT.REQUIREMENT, "install block is incomplete");
  }
  return { node: pointer.node, install };
}

/** Return the current OS and supported Node architecture names. */
function currentPlatform() {
  const os = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : "unknown";
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : "unknown";
  return { os, arch, platform: `${os}-${arch}` };
}

/** Confirm the current platform and architecture are declared in the pointer. */
function requireSupportedSystem(install, platform) {
  const supported = install.systems.some((system) => system.os === platform.os && Array.isArray(system.architectures) && system.architectures.includes(platform.arch));
  if (!supported) throw new InstallerError(EXIT.REQUIREMENT, `unsupported system: ${platform.platform}`);
}

/** Resolve the concrete release asset name from the ficha's pattern and asset type. */
function assetName(install, version, platform) {
  let pattern = install.asset.pattern.replaceAll("<ver>", version).replaceAll("<plat>", platform.os).replaceAll("<arch>", platform.arch);
  if (install.asset.type === "binary-tar-gzip-or-zip") pattern = pattern.replace(/\.tar\.gz\|\.zip$/, platform.os === "windows" ? ".zip" : ".tar.gz");
  pattern = pattern.replace("[.exe]", platform.os === "windows" ? ".exe" : "");
  if (!pattern || pattern.includes("<") || pattern.includes("|")) throw new InstallerError(EXIT.REQUIREMENT, "install.asset.pattern cannot resolve this platform");
  return pattern;
}

/** Read a SemVer-like version from a launcher's human or JSON output. */
async function installedVersion(launcher, node) {
  const result = await run(launcher, ["--version"], { allowFailure: true });
  if (result.code !== 0) return undefined;
  const match = new RegExp(`^forge614-${node}\\s+(\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?)$`).exec(result.stdout.trim());
  return match?.[1];
}

/** Run an executable with bounded time and capture its output. */
function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const isCmd = process.platform === "win32" && /\.cmd$/i.test(command);
    const child = spawn(isCmd ? `"${command}"` : command, args, { windowsHide: true, shell: isCmd, stdio: ["ignore", "pipe", "pipe"], ...options });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => child.kill("SIGKILL"), options.timeout ?? 15_000);
    child.stdout?.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr?.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.once("error", (error) => {
      clearTimeout(timeout);
      if (options.allowFailure) {
        settled = true;
        resolvePromise({ code: null, stdout, stderr: stderr || error.message });
      } else {
        settled = true;
        reject(error);
      }
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (settled) return;
      if (code !== 0 && !options.allowFailure) reject(new Error(stderr || `process exited with ${code}`));
      else resolvePromise({ code, stdout, stderr });
    });
  });
}

/** Find a working launcher for the active version, then the system's stable launcher names. */
async function findLauncher(nodeHome, node, platform, binDir = join(nodeHome, "bin")) {
  const names = platform.os === "windows"
    ? [`forge614-${node}.exe`, `forge614-${node}.cmd`]
    : [`forge614-${node}`];
  const activeVersion = await readFile(join(nodeHome, ".active-version"), "utf8").then((value) => value.trim()).catch(() => "");
  const validVersion = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(activeVersion);
  const directories = validVersion
    ? [join(nodeHome, activeVersion, "bin"), binDir]
    : [binDir];
  for (const directory of directories) {
    for (const name of names) {
      const launcher = join(directory, name);
      if (!(await pathExists(launcher))) continue;
      const version = await installedVersion(launcher, node);
      if (version) return { launcher, version };
    }
  }
  return undefined;
}

/** Check a dependency's installed version and required capabilities, including a diagnostic reason. */
async function dependencyCompatible(dependency, home) {
  const found = await findLauncher(join(home, dependency.node), dependency.node, currentPlatform());
  if (!found) return { compatible: false, reason: "launcher-missing" };
  const { launcher, version } = found;
  if (dependency.minimumVersion && compareVersions(version, dependency.minimumVersion) < 0) return { compatible: false, reason: "version-below-minimum" };
  if (Array.isArray(dependency.requiredCapabilities) && dependency.requiredCapabilities.length > 0) {
    for (const requirement of dependency.requiredCapabilities) {
      if (!requirement || typeof requirement.agent !== "string" || typeof requirement.field !== "string") return { compatible: false, reason: "invalid-capability-requirement" };
    }
    const agents = [...new Set(dependency.requiredCapabilities.map((requirement) => requirement.agent))];
    for (const agent of agents) {
      const result = await run(launcher, ["capabilities", "--agent", agent], { allowFailure: true });
      if (result.code !== 0) return { compatible: false, reason: "capabilities-command-failed" };
      try {
        const capabilities = JSON.parse(result.stdout);
        if (capabilities.schemaVersion !== 1) return { compatible: false, reason: "capabilities-schema-unsupported" };
        const missing = dependency.requiredCapabilities
          .filter((requirement) => requirement.agent === agent && capabilities[requirement.field] !== true)
          .map((requirement) => requirement.field);
        if (missing.length > 0) return { compatible: false, reason: "capability-missing", fields: missing };
      } catch {
        return { compatible: false, reason: "capabilities-invalid-json" };
      }
    }
  }
  return { compatible: true };
}

/** Describe why a dependency failed compatibility in the selected language. */
function dependencyDiagnostic(dependency, result) {
  const subject = `dependency ${dependency.node}`;
  const subjectEs = `dependencia ${dependency.node}`;
  const field = result.fields?.join(", ");
  const reason = {
    "launcher-missing": ["no se encontró el lanzador instalado", "installed launcher was not found"],
    "version-unavailable": ["no se pudo leer la versión", "version could not be read"],
    "version-below-minimum": ["la versión instalada está debajo del mínimo", "installed version is below the minimum"],
    "invalid-capability-requirement": ["la ficha pide una capacidad inválida", "the pointer requests an invalid capability"],
    "capabilities-command-failed": ["falló `capabilities --agent`", "`capabilities --agent` failed"],
    "capabilities-invalid-json": ["la salida de capabilities no es JSON válido", "capabilities output is not valid JSON"],
    "capabilities-schema-unsupported": ["el esquema de capabilities no es compatible", "capabilities schema is unsupported"],
    "capability-missing": [`supports ${field} no es true`, `supports ${field} is not true`],
    "installation-failed": [`la instalación terminó con código ${result.exitCode}`, `installation exited with code ${result.exitCode}`],
  }[result.reason] ?? ["no cumple el contrato", "does not meet the contract"];
  return locale() === "es" ? `${subjectEs}: ${reason[0]}.` : `${subject}: ${reason[1]}.`;
}

/** Download and run a dependency's verified common installer if it is incompatible. */
async function ensureDependencies(install, home, testBase) {
  if (install.dependencies.length > 0) await mkdir(home, { recursive: true });
  for (const dependency of install.dependencies) {
    if (typeof dependency?.node !== "string" || !/^[a-z0-9-]+$/.test(dependency.node)) {
      throw new InstallerError(EXIT.REQUIREMENT, "install dependency node is invalid");
    }
    if ((await dependencyCompatible(dependency, home)).compatible) continue;
    const repository = `jotredev/forge614-${dependency.node}`;
    const dependencyTag = await latestTag(repository, testBase);
    const sums = await download(assetUrl(repository, dependencyTag, "SHA256SUMS", testBase));
    const installer = await verifiedAsset(repository, dependencyTag, "install.mjs", sums, testBase);
    const pointerBytes = await verifiedAsset(repository, dependencyTag, "forge614.node.json", sums, testBase);
    parsePointer(pointerBytes);
    const temp = join(home, `.dependency-${dependency.node}-${randomUUID()}.mjs`);
    await writeFile(temp, installer, { mode: 0o600 });
    temporaryFiles.add(temp);
    try {
      const args = [temp, "--latest", "--force"];
      const child = await run(process.execPath, args, {
        env: { ...process.env, FORGE614_HOME: home, FORGE614_INSTALL_REPOSITORY: repository, FORGE614_INSTALL_NODE: dependency.node },
        timeout: 120_000,
        allowFailure: true,
      });
      if (child.code === EXIT.DOWNLOAD) throw new InstallerError(EXIT.DOWNLOAD, child.stderr || `dependency ${dependency.node} download failed`);
      const compatibility = await dependencyCompatible(dependency, home);
      if (child.code !== 0 || !compatibility.compatible) {
        throw new InstallerError(EXIT.DEPENDENCY, compatibility.compatible
          ? dependencyDiagnostic(dependency, { reason: "installation-failed", exitCode: child.code })
          : dependencyDiagnostic(dependency, compatibility));
      }
    } catch (error) {
      if (error instanceof InstallerError) throw error;
      throw new InstallerError(EXIT.DEPENDENCY, locale() === "es"
        ? `dependencia ${dependency.node}: no se pudo completar la instalación.`
        : `dependency ${dependency.node}: installation could not be completed.`);
    } finally {
      await rm(temp, { force: true });
      temporaryFiles.delete(temp);
    }
  }
}

/** Write bytes through a temporary sibling and atomic rename. */
async function atomicWrite(path, bytes, mode) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  temporaryFiles.add(temp);
  try {
    await writeFile(temp, bytes, mode === undefined ? undefined : { mode });
    if (mode !== undefined) await chmod(temp, mode);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  } finally {
    temporaryFiles.delete(temp);
  }
}

/** Select the one profile to create when the user's home has no known profile. */
function defaultProfile(home) {
  const shell = (process.env.SHELL ?? "").toLowerCase();
  if (shell.endsWith("zsh")) return join(home, ".zshrc");
  if (shell.endsWith("bash")) return join(home, ".bashrc");
  return join(home, ".profile");
}

/** Preserve an existing profile's bytes and permissions for activation rollback. */
async function profileSnapshot(profile) {
  let info;
  try {
    info = await lstat(profile);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return { profile, target: profile, existed: false, bytes: Buffer.alloc(0), mode: 0o644 };
  }
  const target = info.isSymbolicLink() ? await realpath(profile) : profile;
  const targetInfo = await stat(target);
  return { profile, target, existed: true, bytes: await readFile(target), mode: targetInfo.mode & 0o777 };
}

/** Decode a POSIX profile while preserving a UTF-8 BOM. */
function decodeProfile(bytes) {
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  return { content: bytes.toString("utf8").replace(/^\uFEFF/, ""), encode: (text) => Buffer.concat([hasBom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(text, "utf8")]) };
}

/** Validate the test-only registry key and require a loopback test release server. */
function testWindowsEnvironmentKey() {
  const key = process.env.FORGE614_TEST_WINDOWS_ENV_KEY;
  if (!key) return undefined;
  const base = testBaseUrl();
  const hostname = base ? new URL(base).hostname : "";
  if (!base || !["127.0.0.1", "::1", "[::1]"].includes(hostname)) {
    throw new InstallerError(EXIT.USAGE, "FORGE614_TEST_WINDOWS_ENV_KEY requires FORGE614_INSTALL_TEST_BASE_URL at 127.0.0.1 or [::1]");
  }
  if (!/^Software\\Forge614-Test-[A-Za-z0-9-]+$/.test(key)) {
    throw new InstallerError(EXIT.USAGE, "FORGE614_TEST_WINDOWS_ENV_KEY must name a key under HKCU:\\Software\\Forge614-Test-");
  }
  return key;
}

/** Encode a PowerShell script as UTF-16LE base64 for Windows PowerShell 5.1. */
function encodedPowerShell(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

/** Resolve the real or test registry path inside PowerShell, without embedding a user value. */
function windowsRegistryPathScript() {
  return [
    "$registryPath = 'HKCU:\\Environment'",
    "if ($env:FORGE614_TEST_WINDOWS_ENV_KEY) {",
    "  if ($env:FORGE614_TEST_WINDOWS_ENV_KEY -notmatch '^Software\\\\Forge614-Test-[A-Za-z0-9-]+$') { throw 'invalid test registry key' }",
    "  $registryPath = 'HKCU:\\' + $env:FORGE614_TEST_WINDOWS_ENV_KEY",
    "}",
  ].join("\n");
}

/** Run a UTF-16LE encoded PowerShell script with values passed only through the child environment. */
async function runWindowsPathScript(script, environment = {}) {
  const key = testWindowsEnvironmentKey();
  const result = await run("powershell.exe", ["-NoProfile", "-EncodedCommand", encodedPowerShell(script)], {
    allowFailure: true,
    env: { ...process.env, ...environment, FORGE614_TEST_WINDOWS_ENV_KEY: key ?? "" },
  });
  if (result.code !== 0) throw new Error(result.stderr || "could not access the current user's Path");
  return result.stdout.trim();
}

/** Read the raw current user's Path value and registry type without expanding environment variables. */
async function readWindowsPath() {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "try {",
    windowsRegistryPathScript(),
    "  $item = Get-Item -LiteralPath $registryPath -ErrorAction SilentlyContinue",
    "  if ($null -eq $item -or -not ($item.GetValueNames() -contains 'Path')) { [Console]::Out.WriteLine('MISSING||'); exit 0 }",
    "  $value = $item.GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)",
    "  $kind = $item.GetValueKind('Path').ToString()",
    "  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($value))",
    "  [Console]::Out.WriteLine($kind + '|' + $encoded)",
    "} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }",
  ].join("\n");
  const result = await runWindowsPathScript(script);
  const [kind, encoded] = result.split("|");
  if (kind === "MISSING") return { value: "", kind: null, exists: false };
  if (!kind || encoded === undefined) throw new Error("could not decode the current user's Path");
  return { value: Buffer.from(encoded, "base64").toString("utf8"), kind, exists: true };
}

/** Write the current user's Path using its existing registry type or restore its absent state. */
async function setWindowsPath(value, kind, exists = true) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "try {",
    windowsRegistryPathScript(),
    "  if ($env:FORGE614_USER_PATH_PRESENT -eq '1') {",
    "    $item = Get-Item -LiteralPath $registryPath -ErrorAction SilentlyContinue",
    "    if ($null -ne $item -and $item.GetValueNames() -contains 'Path') { Set-ItemProperty -LiteralPath $registryPath -Name Path -Value $env:FORGE614_NEW_USER_PATH -Type $env:FORGE614_USER_PATH_KIND }",
    "    else { New-ItemProperty -LiteralPath $registryPath -Name Path -Value $env:FORGE614_NEW_USER_PATH -PropertyType $env:FORGE614_USER_PATH_KIND -Force | Out-Null }",
    "  }",
    "  elseif (Test-Path -LiteralPath $registryPath) { Remove-ItemProperty -LiteralPath $registryPath -Name Path -ErrorAction SilentlyContinue }",
    "  Add-Type -TypeDefinition @'\nusing System;\nusing System.Runtime.InteropServices;\npublic static class Forge614PathNotification {\n  [DllImport(\"user32.dll\", CharSet = CharSet.Auto, SetLastError = true)]\n  public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint message, IntPtr wParam, string lParam, uint flags, uint timeout, out IntPtr result);\n}\n'@",
    "  $notificationResult = [IntPtr]::Zero",
    "  [void][Forge614PathNotification]::SendMessageTimeout([IntPtr]0xffff, 0x001A, [IntPtr]::Zero, 'Environment', 0x0002, 5000, [ref]$notificationResult)",
    "} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }",
  ].join("\n");
  await runWindowsPathScript(script, {
    FORGE614_NEW_USER_PATH: value,
    FORGE614_USER_PATH_KIND: kind ?? "ExpandString",
    FORGE614_USER_PATH_PRESENT: exists ? "1" : "0",
  });
}

/** Update the current user's Windows Path variable and return its rollback snapshot. */
async function updateWindowsPath(binDir, add) {
  const originalState = await readWindowsPath();
  const original = originalState.value;
  const entries = original ? original.split(";") : [];
  const normalizedBin = binDir.replace(/[\\/]+$/, "").toLowerCase();
  const hasEntry = entries.some((entry) => entry.replace(/[\\/]+$/, "").toLowerCase() === normalizedBin);
  const next = add
    ? hasEntry ? original : original ? `${original};${binDir}` : binDir
    : hasEntry ? entries.filter((entry) => entry.replace(/[\\/]+$/, "").toLowerCase() !== normalizedBin).join(";") : original;
  if (next === original) return undefined;
  const kind = originalState.kind === "ExpandString" || next.includes("%") || !originalState.exists
    ? "ExpandString"
    : originalState.kind ?? "String";
  try {
    await setWindowsPath(next, kind, true);
  } catch (error) {
    try {
      await setWindowsPath(original, originalState.kind, originalState.exists);
    } catch (restoreError) {
      process.stderr.write(`No se pudo restaurar la variable Path del usuario: ${restoreError.message}\n`);
    }
    throw error;
  }
  return { windowsPath: original, windowsPathKind: originalState.kind, windowsPathExists: originalState.exists };
}

/** Restore profile contents or remove a profile created by a failed activation. */
async function restoreProfiles(snapshots) {
  for (const snapshot of [...snapshots].reverse()) {
    if (snapshot.windowsPath !== undefined) {
      try {
        await setWindowsPath(snapshot.windowsPath, snapshot.windowsPathKind, snapshot.windowsPathExists);
      } catch (error) {
        process.stderr.write(`No se pudo restaurar la variable Path del usuario: ${error.message}\n`);
      }
      continue;
    }
    if (snapshot.existed) await atomicWrite(snapshot.target, snapshot.bytes, snapshot.mode).catch(() => {});
    else await rm(snapshot.profile, { force: true }).catch(() => {});
  }
}

/** Remove Forge614 PATH blocks from existing profiles and optionally add this node's block. */
async function updatePath(home, nodeName, binDir, platform, add = true) {
  if (platform.os === "windows") {
    const snapshot = await updateWindowsPath(binDir, add);
    return { snapshots: snapshot ? [snapshot] : [], warning: "" };
  }
  if (!home) {
    process.stderr.write("No se modificó PATH: no hay HOME ni USERPROFILE.\n");
    return { snapshots: [], warning: locale() === "es" ? "no se encontró un perfil de shell modificable" : "no modifiable shell profile was found" };
  }
  const profiles = [
    join(home, ".zshrc"), join(home, ".bashrc"), join(home, ".bash_profile"), join(home, ".profile"),
  ];
  const present = [];
  for (const profile of profiles) if (await pathExists(profile)) present.push(profile);
  if (present.length === 0 && add) present.push(defaultProfile(home));
  const snapshots = [];
  let warning = "";
  const begin = `# >>> forge614-${nodeName} PATH >>>`;
  const end = `# <<< forge614-${nodeName} PATH <<<`;
  try {
    for (const profile of present) {
      let snapshot;
      try {
        snapshot = await profileSnapshot(profile);
      } catch (error) {
        if (error?.code === "ENOENT" && (await pathExists(profile))) {
          process.stderr.write(`Aviso: se omite el perfil roto ${profile}.\n`);
          warning ||= locale() === "es" ? "el perfil de shell no está disponible" : "the shell profile is unavailable";
          continue;
        }
        throw error;
      }
      const decoded = decodeProfile(snapshot.bytes);
      const content = snapshot.existed ? decoded.content : "";
      const parts = content.split(/(\r\n|\n)/);
      const records = [];
      for (let index = 0; index < parts.length; index += 2) records.push({ line: parts[index] ?? "", ending: parts[index + 1] ?? "" });
      const hasBegin = records.some(({ line }) => line === begin);
      const hasEnd = records.some(({ line }) => line === end);
      const hasLegacyShell = nodeName === "shell" && records.some(({ line }) => line === "# Forge614 Shell");
      if (!add && !hasBegin && !hasEnd && !hasLegacyShell) continue;
      const endings = records.flatMap(({ ending }) => ending ? [ending] : []);
      const crlfCount = endings.filter((ending) => ending === "\r\n").length;
      const newline = crlfCount > endings.length - crlfCount ? "\r\n" : "\n";
      const kept = [];
      let skip = false;
      let removeShellPath = false;
      let incomplete = false;
      for (const record of records) {
        const { line } = record;
        if (line === begin) { if (skip) incomplete = true; skip = true; continue; }
        if (line === end) { if (!skip) incomplete = true; skip = false; continue; }
        if (nodeName === "shell" && line === "# Forge614 Shell") { removeShellPath = true; continue; }
        if (removeShellPath) {
          removeShellPath = false;
          if (/^\s*(export\s+)?PATH\s*=/.test(line)) continue;
        }
        if (!skip) kept.push(record);
      }
      if (skip || hasBegin !== hasEnd) incomplete = true;
      if (incomplete) {
        process.stderr.write(`Aviso: el perfil ${profile} tiene un marcador PATH incompleto; no se modificó.\n`);
        warning ||= locale() === "es" ? "el perfil tiene un marcador PATH incompleto" : "the profile has an incomplete PATH marker";
        continue;
      }
      const pathLine = `export PATH="${binDir.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("$", "\\$").replaceAll("`", "\\`")}:$PATH"`;
      const body = kept.map(({ line, ending }) => `${line}${ending}`).join("");
      let next = body;
      if (add) {
        if (next && !next.endsWith("\n")) next += newline;
        const finalNewline = !content || content.endsWith("\n") ? newline : "";
        next += `${begin}${newline}${pathLine}${newline}${end}${finalNewline}`;
      }
      if (next !== content) {
        snapshots.push(snapshot);
        await atomicWrite(snapshot.target, decoded.encode(next), snapshot.mode);
      }
    }
  } catch (error) {
    await restoreProfiles(snapshots);
    throw error;
  }
  return { snapshots, warning };
}

/** Return true if a path exists without following a missing path error. */
async function pathExists(path) {
  try { await lstat(path); return true; } catch { return false; }
}

/** Extract a gzip-compressed tar archive while rejecting paths outside the destination. */
async function extractTarGzip(bytes, destination) {
  const tar = gunzipSync(bytes);
  let pendingPath = "";
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    let entry = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim() || "0", 8);
    const type = String.fromCharCode(header[156] ?? 48);
    const dataStart = offset + 512;
    const data = tar.subarray(dataStart, dataStart + size);
    if (type === "x" || type === "g") {
      if (type === "x") {
        for (const record of data.toString("utf8").split("\n")) {
          const match = /^\d+ path=(.*)$/.exec(record);
          if (match) pendingPath = match[1] ?? "";
        }
      }
    } else if (type === "L") {
      pendingPath = data.toString("utf8").replace(/\0.*$/, "").replace(/\n$/, "");
    } else {
      if (pendingPath) entry = pendingPath;
      pendingPath = "";
      if (isUnsafeArchivePath(entry) || !["0", "\0", "5"].includes(type)) throw new InstallerError(EXIT.DOWNLOAD, "archive contains an unsafe path or link");
      const target = resolve(destination, entry);
      if (target !== destination && !target.startsWith(`${destination}${sep}`)) throw new InstallerError(EXIT.DOWNLOAD, "archive contains an unsafe path");
      if (type === "5") await mkdir(target, { recursive: true });
      else {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, data, { mode: Number.parseInt(header.subarray(100, 108).toString("ascii").trim() || "644", 8) & 0o777 });
      }
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
}

/** Extract a ZIP archive using its central directory and Node's built-in inflater. */
async function extractZip(bytes, destination) {
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new InstallerError(EXIT.DOWNLOAD, "ZIP archive is invalid");
  const entries = bytes.readUInt16LE(eocd + 10);
  let offset = bytes.readUInt32LE(eocd + 16);
  for (let index = 0; index < entries; index += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new InstallerError(EXIT.DOWNLOAD, "ZIP directory is invalid");
    const method = bytes.readUInt16LE(offset + 10);
    const compressed = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const unixMode = bytes.readUInt32LE(offset + 38) >>> 16;
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (isUnsafeArchivePath(name) || (unixMode & 0o170000) === 0o120000) throw new InstallerError(EXIT.DOWNLOAD, "archive contains an unsafe path or link");
    const dataOffset = localOffset + 30 + bytes.readUInt16LE(localOffset + 26) + bytes.readUInt16LE(localOffset + 28);
    const compressedBytes = bytes.subarray(dataOffset, dataOffset + compressed);
    const data = method === 0 ? compressedBytes : method === 8 ? inflateRawSync(compressedBytes) : undefined;
    if (!data) throw new InstallerError(EXIT.DOWNLOAD, "ZIP compression is unsupported");
    const target = resolve(destination, name);
    if (target !== destination && !target.startsWith(`${destination}${sep}`)) throw new InstallerError(EXIT.DOWNLOAD, "archive contains an unsafe path");
    if (name.endsWith("/")) await mkdir(target, { recursive: true });
    else { await mkdir(dirname(target), { recursive: true }); await writeFile(target, data); }
    offset += 46 + nameLength + extraLength + commentLength;
  }
}

/** Reject absolute archive names and any parent traversal segment before resolving them. */
function isUnsafeArchivePath(name) {
  const normalized = name.replaceAll("\\\\", "/");
  return normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").includes("..");
}

/** Extract a verified asset according to its declared format and return its launcher file. */
async function prepareAsset(install, asset, name, nodeName, directory, platform) {
  if (install.asset.type === "raw-binary") {
    const extension = platform.os === "windows" ? (name.endsWith(".exe") ? ".exe" : name.endsWith(".cmd") ? ".cmd" : ".exe") : "";
    const file = join(directory, `forge614-${nodeName}${extension}`);
    await writeFile(file, asset, { mode: 0o755 });
    return file;
  }
  if (install.asset.type === "binary-tar-gzip" || install.asset.type === "binary-tar-gzip-or-zip" || install.asset.type === "node-package-tar-gzip") {
    if (name.endsWith(".zip")) await extractZip(asset, directory);
    else await extractTarGzip(asset, directory);
    const wanted = platform.os === "windows" ? [`forge614-${nodeName}.exe`, `forge614-${nodeName}.cmd`] : [`forge614-${nodeName}`];
    const found = await findFile(directory, wanted);
    if (!found) throw new InstallerError(EXIT.DOWNLOAD, `archive has no forge614-${nodeName} launcher`);
    if (platform.os !== "windows") await chmod(found, 0o755);
    return found;
  }
  throw new InstallerError(EXIT.REQUIREMENT, `unsupported asset type: ${install.asset.type}`);
}

/** Find one of the expected launcher names under an extracted directory. */
async function findFile(directory, names) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isFile() && names.includes(entry.name)) return path;
    if (entry.isDirectory()) {
      const nested = await findFile(path, names);
      if (nested) return nested;
    }
  }
  return undefined;
}

/** Move every flat launcher entry, including broken symbolic links, to a retained legacy folder. */
async function migrateFlatInstall(nodeHome, launchers, hasActiveVersion) {
  if (hasActiveVersion) return [];
  const migrations = [];
  let legacyDir;
  try {
    for (const launcher of launchers) {
      if (!(await pathExists(launcher))) continue;
      legacyDir ??= join(nodeHome, `legacy-${Date.now()}-${randomUUID()}`);
      await mkdir(legacyDir, { recursive: true });
      const legacyLauncher = join(legacyDir, launcher.split(/[\\/]/).at(-1) ?? "launcher");
      await rename(launcher, legacyLauncher);
      migrations.push({ launcher, legacyLauncher });
    }
  } catch (error) {
    for (const migration of migrations) {
      await rename(migration.legacyLauncher, migration.launcher).catch(() => {});
    }
    if (legacyDir) await rm(legacyDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return migrations;
}

/** Atomically replace the Unix launcher from a temporary sibling and handle cross-device fallback. */
async function publishUnixLauncher(source, launcher) {
  await mkdir(dirname(launcher), { recursive: true });
  const tempLink = `${launcher}.${randomUUID()}.tmp`;
  const target = resolve(source);
  try {
    await symlink(target, tempLink);
    await rename(tempLink, launcher);
  } catch (error) {
    await rm(tempLink, { force: true }).catch(() => {});
    if (error?.code !== "EXDEV") throw error;
    const tempCopy = `${launcher}.${randomUUID()}.tmp`;
    try {
      await copyFile(source, tempCopy);
      await chmod(tempCopy, 0o755);
      await rename(tempCopy, launcher);
    } catch (copyError) {
      await rm(tempCopy, { force: true }).catch(() => {});
      throw copyError;
    }
  }
}

/** Publish the new version, PATH, active pointer and smoke test as one rollback transaction. */
async function activate(nodeName, version, nodeHome, stagedDir, stagedLauncher, binDir, platform, pathModify, home, smokeTest) {
  const activeFile = join(nodeHome, ".active-version");
  const binDirFile = join(nodeHome, ".bin-dir");
  const hadBinDir = await pathExists(binDirFile);
  const previousBinDir = await readFile(binDirFile).catch(() => null);
  const hadActivePointer = await pathExists(activeFile);
  const previousVersion = await readFile(activeFile, "utf8").then((value) => value.trim()).catch(() => "");
  const launcherName = `forge614-${nodeName}${platform.os === "windows" && stagedLauncher.endsWith(".cmd") ? ".cmd" : platform.os === "windows" ? ".exe" : ""}`;
  const launcher = join(binDir, launcherName);
  const versionDir = join(nodeHome, version);
  const publishDir = previousVersion === version && await pathExists(versionDir)
    ? join(nodeHome, `${version}.install-${randomUUID()}`)
    : versionDir;
  const versionBackup = publishDir === versionDir && await pathExists(versionDir) ? join(nodeHome, `.version-backup-${randomUUID()}`) : "";
  const launcherExists = await pathExists(launcher);
  let oldLauncherTarget = "";
  let launcherBackup = "";
  if (launcherExists) {
    const info = await lstat(launcher);
    if (info.isSymbolicLink()) oldLauncherTarget = await readlink(launcher);
    else {
      launcherBackup = join(dirname(launcher), `.launcher-backup-${randomUUID()}`);
      temporaryFiles.add(launcherBackup);
      await copyFile(launcher, launcherBackup);
    }
  }
  await mkdir(nodeHome, { recursive: true });
  await mkdir(binDir, { recursive: true });
  let migrations = [];
  let pathSnapshots = [];
  let pathWarning = "";
  let pointerWritten = false;
  try {
    const flatLaunchers = platform.os === "windows"
      ? ["", ".exe", ".cmd"].map((extension) => join(nodeHome, "bin", `forge614-${nodeName}${extension}`))
      : [join(nodeHome, "bin", `forge614-${nodeName}`)];
    migrations = await migrateFlatInstall(nodeHome, flatLaunchers, hadActivePointer);
    if (versionBackup) await rename(versionDir, versionBackup);
    await rename(stagedDir, publishDir);
    const relativeTarget = stagedLauncher.slice(stagedDir.length + 1);
    const publishedLauncher = join(publishDir, relativeTarget);
    if (platform.os === "windows") {
      const temporaryLauncher = `${launcher}.${randomUUID()}.tmp`;
      temporaryFiles.add(temporaryLauncher);
      try {
        await copyFile(publishedLauncher, temporaryLauncher);
        await rename(temporaryLauncher, launcher);
      } finally {
        await rm(temporaryLauncher, { force: true }).catch(() => {});
        temporaryFiles.delete(temporaryLauncher);
      }
    } else await publishUnixLauncher(publishedLauncher, launcher);
    if (pathModify) {
      const pathResult = await updatePath(home, nodeName, binDir, platform, true);
      pathSnapshots = pathResult.snapshots;
      pathWarning = pathResult.warning;
    }
    await atomicWrite(binDirFile, Buffer.from(`${binDir}\n`));
    await atomicWrite(activeFile, Buffer.from(`${version}\n`));
    pointerWritten = true;
    const smoke = await run(launcher, smokeTest, { allowFailure: true });
    if (smoke.code !== 0 || smoke.stdout.trim() !== `forge614-${nodeName} ${version}`) {
      throw new Error("published launcher smoke test failed");
    }
    if (launcherBackup) {
      await rm(launcherBackup, { force: true });
      temporaryFiles.delete(launcherBackup);
    }
    if (versionBackup) await rm(versionBackup, { recursive: true, force: true });
    for (const entry of await readdir(nodeHome)) {
      if (entry.startsWith(`${version}.install-`) && join(nodeHome, entry) !== publishDir) {
        await rm(join(nodeHome, entry), { recursive: true, force: true });
      }
    }
  } catch (error) {
    await restoreProfiles(pathSnapshots);
    if (pointerWritten) {
      if (previousVersion) await atomicWrite(activeFile, Buffer.from(`${previousVersion}\n`)).catch(() => {});
      else await rm(activeFile, { force: true }).catch(() => {});
    }
    await rm(launcher, { force: true }).catch(() => {});
    if (oldLauncherTarget) {
      const tempLink = `${launcher}.${randomUUID()}.rollback`;
      try {
        await symlink(oldLauncherTarget, tempLink);
        await rename(tempLink, launcher);
      } catch (restoreError) {
        await rm(tempLink, { force: true });
        process.stderr.write(`No se pudo restaurar el enlace del lanzador ${launcher}: ${restoreError.message}\n`);
      }
    } else if (launcherBackup && await pathExists(launcherBackup)) {
      try {
        await rename(launcherBackup, launcher);
        temporaryFiles.delete(launcherBackup);
      } catch (restoreError) {
        process.stderr.write(`No se pudo restaurar el lanzador ${launcher}: ${restoreError.message}\n`);
      }
    }
    for (const migration of migrations) {
      if (await pathExists(migration.legacyLauncher)) await rename(migration.legacyLauncher, migration.launcher).catch(() => {});
    }
    for (const migration of migrations) await rm(dirname(migration.legacyLauncher), { recursive: true, force: true }).catch(() => {});
    if (previousBinDir) await atomicWrite(binDirFile, previousBinDir).catch(() => {});
    else if (!hadBinDir) await rm(binDirFile, { force: true }).catch(() => {});
    await rm(publishDir, { recursive: true, force: true }).catch(() => {});
    if (versionBackup && await pathExists(versionBackup)) await rename(versionBackup, versionDir).catch(() => {});
    throw error;
  }
  return pathWarning;
}

/** Execute installation arguments and convert failures to the documented exit codes. */
async function main(argv) {
  const options = parseArguments(argv);
  if (options.help) { process.stdout.write(`${message("help")}\n`); return EXIT.OK; }
  checkNodeVersion();
  const home = forgeHome();
  if (options.uninstall) {
    const node = process.env.FORGE614_INSTALL_NODE;
    if (!node || !/^[a-z0-9-]+$/.test(node)) throw new InstallerError(EXIT.REQUIREMENT, "the gatekeeper did not provide the node identity");
    return await uninstallNode(node, home, options.binDir);
  }
  const testBase = testBaseUrl();
  const repositoryHint = process.env.FORGE614_INSTALL_REPOSITORY;
  if (!repositoryHint) throw new InstallerError(EXIT.REQUIREMENT, "install repository is not available");
  const tag = options.version ? (options.version.startsWith("v") ? options.version : `v${options.version}`) : await latestTag(repositoryHint, testBase);
  const sums = await download(assetUrl(repositoryHint, tag, "SHA256SUMS", testBase));
  const pointerBytes = await verifiedAsset(repositoryHint, tag, "forge614.node.json", sums, testBase);
  const { node, install } = parsePointer(pointerBytes);
  if (install.repository !== repositoryHint) throw new InstallerError(EXIT.REQUIREMENT, "release repository does not match install.repository");
  if (process.env.FORGE614_INSTALL_NODE && process.env.FORGE614_INSTALL_NODE !== node) throw new InstallerError(EXIT.REQUIREMENT, "release node does not match the gatekeeper");
  const platform = currentPlatform();
  requireSupportedSystem(install, platform);
  const nodeHome = join(home, node);
  const activeFile = join(nodeHome, ".active-version");
  const previousVersion = await readFile(activeFile, "utf8").then((value) => value.trim()).catch(() => "");
  const version = tag.replace(/^v/, "");
  if (previousVersion === version && !options.force) {
    process.stdout.write(`${message("current", { node, version })}\n`);
    return EXIT.OK;
  }
  const name = assetName(install, version, platform);
  let asset;
  if (options.archive) {
    asset = await readFile(resolve(options.archive)).catch(() => { throw new InstallerError(EXIT.DOWNLOAD, "archive could not be read"); });
    const expected = sums.toString("utf8").split(/\r?\n/).find((line) => line.endsWith(`  ${name}`))?.slice(0, 64);
    if (!expected || createHash("sha256").update(asset).digest("hex") !== expected) throw new InstallerError(EXIT.DOWNLOAD, `SHA-256 mismatch for ${name}`);
  } else asset = await verifiedAsset(install.repository, tag, name, sums, testBase);
  await ensureDependencies(install, home, testBase);
  const stage = join(nodeHome, `.install-${randomUUID()}`);
  await mkdir(stage, { recursive: true });
  temporaryInstallDirs.add(stage);
  try {
    const stagedLauncher = await prepareAsset(install, asset, name, node, stage, platform);
    const smokeTest = install.smokeTest ?? ["--version"];
    const smoke = await run(stagedLauncher, smokeTest, { allowFailure: true });
    if (smoke.code !== 0 || smoke.stdout.trim() !== `forge614-${node} ${version}`) throw new Error("staged launcher smoke test failed");
    const selectedBinDir = options.binDir ? resolve(options.binDir) : join(nodeHome, "bin");
    const pathWarning = await activate(node, version, nodeHome, stage, stagedLauncher, selectedBinDir, platform, install.path?.modify === true, process.env.HOME || process.env.USERPROFILE || "", smokeTest);
    process.stdout.write(`${pathWarning
      ? message("pathNotAdded", { node, reason: pathWarning })
      : message(previousVersion === version ? "reinstalled" : previousVersion ? "updated" : "installed", { node, previous: previousVersion, version })}\n`);
    return EXIT.OK;
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  } finally {
    temporaryInstallDirs.delete(stage);
  }
}

/** Return true when another Forge614 Windows launcher still uses this directory. */
async function hasWindowsLauncher(binDir) {
  const entries = await readdir(binDir).catch(() => []);
  return entries.some((name) => /^forge614-.+\.(?:exe|cmd)$/i.test(name));
}

/** Run the node's self-uninstall hook, then delete only its Forge614 home. */
async function uninstallNode(node, home, binDirOverride) {
  const nodeHome = join(home, node);
  const storedBinDir = await readFile(join(nodeHome, ".bin-dir"), "utf8").then((value) => value.trim()).catch(() => "");
  const binDir = binDirOverride ? resolve(binDirOverride) : storedBinDir || join(nodeHome, "bin");
  const platform = currentPlatform();
  const launcherCandidates = platform.os === "windows"
    ? [`forge614-${node}.exe`, `forge614-${node}.cmd`]
    : [`forge614-${node}`];
  const found = await findLauncher(nodeHome, node, platform, binDir);
  if (found) {
    const result = await run(found.launcher, ["uninstall", "--self"], { allowFailure: true });
    if (result.code !== 0) process.stderr.write(`${message("uninstallHookFailed", { node })}\n`);
  }
  const removesExternalLauncher = Boolean(binDirOverride || storedBinDir);
  if (removesExternalLauncher) for (const name of launcherCandidates) await rm(join(binDir, name), { force: true });
  const sharedWindowsLauncherRemains = platform.os === "windows" && removesExternalLauncher && await hasWindowsLauncher(binDir);
  if (!sharedWindowsLauncherRemains) await updatePath(process.env.HOME || process.env.USERPROFILE || "", node, binDir, platform, false);
  await rm(nodeHome, { recursive: true, force: true });
  process.stdout.write(`${message("removed", { node })}\n`);
  return EXIT.OK;
}

/** Print one stable error to stderr and return its documented process code. */
function reportError(error) {
  const known = error instanceof InstallerError ? error : new InstallerError(EXIT.REQUIREMENT, error instanceof Error ? error.message : "installation failed");
  let text = known.message;
  if (locale() === "es" && known.code !== EXIT.DEPENDENCY) {
    text = text === "INVALID_FORGE614_HOME" ? "La ruta FORGE614_HOME no es válida." :
      known.code === EXIT.USAGE ? "Uso inválido del instalador Forge614." :
      known.code === EXIT.REQUIREMENT ? "No se cumple un requisito local para instalar Forge614." :
        known.code === EXIT.DOWNLOAD ? "No se pudo descargar o verificar la release de Forge614." :
          text;
  }
  process.stderr.write(`${text}\n`);
  if (locale() === "es") process.stderr.write(`Detalle técnico: ${known.message}\n`);
  return known.code;
}

const exitCode = await main(process.argv.slice(2)).catch(reportError);
process.exitCode = exitCode;
