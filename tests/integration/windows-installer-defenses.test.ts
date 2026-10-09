import { expect, test } from "bun:test";
import { readFile, readdir, mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Normaliza y filtra una lista de rutas simulando la lógica de coincidencia exacta
 * de Remove-UserPath en scripts/install.ps1.
 */
function removeUserPathExact(currentPath: string, targetDirectory: string): string {
  const normalizedTarget = targetDirectory.replace(/[\\/]+$/, "").toLowerCase();
  const entries = currentPath.split(";").filter(e => e.trim().length > 0);
  const remaining = entries.filter(entry => entry.replace(/[\\/]+$/, "").toLowerCase() !== normalizedTarget);
  return remaining.join(";");
}

test("launcher template quotes versioned cli path and preserves argument quoting", async () => {
  const templatePath = join(process.cwd(), "scripts", "forge614-shell.cmd.template");
  const template = await readFile(templatePath, "utf8");

  expect(template).toContain("@echo off");
  // La ruta a dist/cli.js debe estar entre comillas para soportar espacios en la ruta de instalación
  expect(template).toMatch(/node\s+"%~dp0\.\.\\__VERSION__\\dist\\cli\.js"\s+%\*/);
  // Preservación del código de salida de Node
  expect(template).toContain("exit /b %ERRORLEVEL%");

  // Comprobar sustitución de versión
  const generated = template.replace("__VERSION__", "1.13.1");
  expect(generated).toContain('node "%~dp0..\\1.13.1\\dist\\cli.js" %*');
});

test("PATH removal matches exact directory and preserves similar prefixes and other tools", () => {
  const samplePath = [
    "C:\\Windows\\system32",
    "C:\\Users\\tester\\.forge614\\shell\\bin",
    "C:\\Users\\tester\\.forge614\\shell\\bin-extra",
    "C:\\Users\\tester\\.forge614\\engines\\bin",
    "C:\\Users\\tester\\.forge614\\engram\\bin",
  ].join(";");

  const targetToRemove = "C:\\Users\\tester\\.forge614\\shell\\bin";
  const updated = removeUserPathExact(samplePath, targetToRemove);

  expect(updated).not.toContain("C:\\Users\\tester\\.forge614\\shell\\bin;");
  expect(updated).toContain("C:\\Users\\tester\\.forge614\\shell\\bin-extra");
  expect(updated).toContain("C:\\Users\\tester\\.forge614\\engines\\bin");
  expect(updated).toContain("C:\\Users\\tester\\.forge614\\engram\\bin");
  expect(updated).toContain("C:\\Windows\\system32");
});

test("install.ps1 implements strict defenses for checksum, engines preservation, and path validation", async () => {
  const scriptPath = join(process.cwd(), "scripts", "install.ps1");
  const script = await readFile(scriptPath, "utf8");

  // Parámetros y modos requeridos
  expect(script).toContain('[Parameter(ParameterSetName = "Latest")]');
  expect(script).toContain('[Parameter(ParameterSetName = "Archive"');
  expect(script).toContain('[Parameter(ParameterSetName = "Uninstall"');
  expect(script).toContain('[switch]$Yes');

  // Rechazo estricto de FORGE614_HOME relativo o vacío
  expect(script).toContain("IsPathRooted");
  expect(script).toContain("IsNullOrWhiteSpace");

  // Verificación de checksum SHA256 antes de extraer
  expect(script).toContain("Get-FileHash");
  expect(script).toContain("SHA256");

  // Comprobación de compatibilidad de Engines antes de modificar Shell
  expect(script).toContain("schemaVersion");
  expect(script).toContain("fullySupported");

  // Validación de URL HTTPS o loopback verificado
  expect(script).toContain("127.0.0.1");
  expect(script).toContain("localhost");
  expect(script).toContain("https");

  // Coincidencia exacta en PATH (-ieq)
  expect(script).toContain("-ieq");
});

test("release bundle packages Windows installer and launcher template alongside unix assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-bundle-windows-"));
  const output = join(root, "release");
  try {
    const bundle = Bun.spawnSync([process.execPath, "scripts/release-bundle.mjs", "--out", output], { cwd: process.cwd() });
    expect(bundle.exitCode).toBe(0);

    const files = await readdir(output);
    const archiveName = files.find(f => f.endsWith(".tar.gz"));
    expect(archiveName).toBeDefined();

    // El instalador standalone install.ps1 debe copiarse al directorio de release
    expect(files).toContain("install.ps1");

    // Desempaquetar y verificar que el tar.gz contiene install.ps1 y el template
    const unpacked = join(root, "unpacked");
    await mkdir(unpacked, { recursive: true });
    const unpack = Bun.spawnSync(["tar", "-xzf", join(output, archiveName!), "-C", unpacked], { cwd: process.cwd() });
    expect(unpack.exitCode).toBe(0);

    const version = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")).version;
    const releaseFolder = join(unpacked, `forge614-shell-${version}`);
    const packagedFiles = await readdir(releaseFolder);

    expect(packagedFiles).toContain("install.ps1");
    expect(packagedFiles).toContain("forge614-shell.cmd.template");
    expect(packagedFiles).toContain("install.sh");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
