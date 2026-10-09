import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { copyToClipboard, copySelectionText } from "../../src/infrastructure/clipboard.ts";
import { updateInstalledShell } from "../../src/infrastructure/updater.ts";
import { gitDiff } from "../../src/infrastructure/git-local.ts";
import { defaultRun } from "../../src/infrastructure/forge614-engines.ts";

const isWindows = process.platform === "win32";
const baseTemp = process.env.RUNNER_TEMP ?? tmpdir();

describe("Windows S2 native verifications", () => {
  /** En Windows, comprueba la ejecución directa de un .exe fixture mediante defaultRun sin invocar shell. */
  test.skipIf(!isWindows)("direct execution of fixture .exe with defaultRun without shell", async () => {
    const tempDir = mkdtempSync(join(baseTemp, "forge614-s2-exe-"));
    try {
      const srcFile = join(tempDir, "echo.ts");
      const exeFile = join(tempDir, "echo.exe");
      writeFileSync(srcFile, `
        const args = process.argv.slice(2);
        console.log(JSON.stringify({ schemaVersion: 1, received: args }));
      `);
      execFileSync("bun", ["build", srcFile, "--compile", "--outfile", exeFile]);
      const result = await defaultRun(exeFile, ["hello", "world"]);
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout) as { received: string[] };
      expect(parsed.received).toEqual(["hello", "world"]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  /** En Windows, comprueba updateInstalledShell con un fixture install.ps1 en una ruta con espacios. */
  test.skipIf(!isWindows)("updateInstalledShell executes install.ps1 fixture in path with spaces without shell interpolation", async () => {
    const tempDir = mkdtempSync(join(baseTemp, "forge614 s2 space dir-"));
    try {
      const ps1File = join(tempDir, "install.ps1");
      writeFileSync(ps1File, `
        param([switch]$Latest, [switch]$Uninstall)
        if (-not $Latest -or $Uninstall) { throw "incorrect installer mode" }
        Write-Output "ok-from-fixture"
        exit 0
      `);
      await expect(updateInstalledShell({ installer: ps1File })).resolves.toBeUndefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  /** En Windows, comprueba que copyToClipboard y copySelectionText preservan acentos y emoji via UTF-8 stdin. */
  test.skipIf(!isWindows)("native clipboard handles accents and emoji via UTF-8 stdin on Windows", async () => {
    let priorClipboard: string | null = null;
    try {
      priorClipboard = execFileSync("powershell.exe", [
        "-NoProfile",
        "-Command",
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Clipboard -Raw",
      ], { encoding: "utf8" });
    } catch {
      // El portapapeles anterior puede estar vacío o no disponible
    }

    try {
      const testText = "¡Hola mundo! 🚀 ñañú — ÁÉÍÓÚ — 日本語 🌟";
      await copyToClipboard(testText);
      const read1 = execFileSync("powershell.exe", [
        "-NoProfile",
        "-Command",
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Clipboard -Raw",
      ], { encoding: "utf8" }).replace(/\r?\n$/, "");
      expect(read1).toBe(testText);

      const testText2 = "Texto de selección con acentos: áéíóú y emoji 🎯";
      const copied = await copySelectionText(testText2, { write: () => {} });
      expect(copied).toBe(true);
      const read2 = execFileSync("powershell.exe", [
        "-NoProfile",
        "-Command",
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Clipboard -Raw",
      ], { encoding: "utf8" }).replace(/\r?\n$/, "");
      expect(read2).toBe(testText2);
    } finally {
      if (priorClipboard !== null) {
        try {
          execFileSync("powershell.exe", [
            "-NoProfile",
            "-Command",
            "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())",
          ], { input: priorClipboard });
        } catch {
          // Restauración con el mejor esfuerzo
        }
      }
    }
  }, 20_000);

  /** Comprueba que gitDiff procesa correctamente archivos no rastreados con /dev/null en un repo temporal. */
  test("gitDiff handles untracked files correctly in temp repository", async () => {
    const tempRepo = mkdtempSync(join(baseTemp, "forge614-s2-git-"));
    try {
      execFileSync("git", [
        "-c", "user.name=CI Tester",
        "-c", "user.email=tester@example.com",
        "-c", "commit.gpgsign=false",
        "init", "-q", "--initial-branch=main",
      ], { cwd: tempRepo });

      writeFileSync(join(tempRepo, "tracked.txt"), "tracked line 1\n");
      execFileSync("git", [
        "-c", "user.name=CI Tester",
        "-c", "user.email=tester@example.com",
        "-c", "commit.gpgsign=false",
        "add", "tracked.txt",
      ], { cwd: tempRepo });
      execFileSync("git", [
        "-c", "user.name=CI Tester",
        "-c", "user.email=tester@example.com",
        "-c", "commit.gpgsign=false",
        "commit", "-q", "-m", "initial",
      ], { cwd: tempRepo });

      writeFileSync(join(tempRepo, "untracked.txt"), "untracked Windows content\n");
      const diffResult = await gitDiff(tempRepo);
      expect(diffResult.inRepo).toBe(true);
      const plain = stripVTControlCharacters(diffResult.diff);
      expect(plain).toContain("untracked.txt");
      expect(plain).toContain("untracked Windows content");
    } finally {
      rmSync(tempRepo, { recursive: true, force: true });
    }
  });
});
