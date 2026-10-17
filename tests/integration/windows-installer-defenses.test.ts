import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

test("Windows launcher resolves the active version from bin and rejects a missing pointer", async () => {
  const launcher = await readFile(join(process.cwd(), "scripts", "forge614-shell.cmd"), "utf8");
  const lines = launcher.trim().split(/\r?\n/);
  expect(lines.at(-1)).toBe('@(goto) 2>nul & node "%cliPath%" %* & @exit /b');
  expect(launcher.match(/\(goto\) 2>nul/g)).toHaveLength(1);
  expect(launcher).toContain("@echo off");
  expect(launcher).toContain("setlocal");
  expect(launcher).toContain(".active-version");
  expect(launcher).toContain('if exist "%~dp0dist\\cli.js" goto useLocalCli');
  expect(launcher).toContain('set "cliPath=%~dp0..\\%activeVersion%\\forge614-shell-%activeVersion%\\dist\\cli.js"');
  expect(launcher).toContain('set "cliPath=%~dp0dist\\cli.js"');
  expect(launcher).toContain("if not exist \"%activeVersionFile%\" goto missingVersion");
  expect(launcher).toContain('set "activeVersion="');
  expect(launcher).toContain("if not defined activeVersion goto missingVersion");
  expect(launcher).toContain("%*");
  expect(launcher).toContain("exit /b 1");
});

test("Unix launcher resolves .active-version relative to its bin link and quotes paths", async () => {
  const launcher = await readFile(join(process.cwd(), "scripts", "forge614-shell"), "utf8");
  expect(launcher).toContain('"$(dirname "$0")"');
  expect(launcher).toContain('"$launcher_dir/dist/cli.js"');
  expect(launcher).toContain('"$launcher_dir/.."');
  expect(launcher).toContain('cat "$shell_home/.active-version"');
  expect(launcher).toContain('exec node "$shell_home/$version/forge614-shell-$version/dist/cli.js" "$@"');
});

test("rendered gatekeepers use the Shell identity and PowerShell keeps its UTF-8 BOM", async () => {
  const shell = await readFile(join(process.cwd(), "install.sh"), "utf8");
  const powershell = await readFile(join(process.cwd(), "install.ps1"));
  expect(shell.startsWith("#!/bin/sh")).toBe(true);
  expect(shell).toContain('NODE_NAME="shell"');
  expect(shell).toContain('REPO="jotredev/forge614-shell"');
  expect(powershell[0]).toBe(0xef);
  expect(powershell[1]).toBe(0xbb);
  expect(powershell[2]).toBe(0xbf);
  expect(powershell.toString("utf8")).toContain('$NodeName = "shell"');
  expect(powershell.toString("utf8")).toContain('$Repo = "jotredev/forge614-shell"');
});

test("release package includes the two active-version launchers and omits retired installers", async () => {
  const script = await readFile(join(process.cwd(), "scripts", "release-bundle.mjs"), "utf8");
  expect(script).toContain('"forge614-shell"');
  expect(script).toContain('"forge614-shell.cmd"');
  expect(script).not.toContain("forge614-shell.cmd.template");
  expect(script).not.toContain('"scripts", "install.sh"');
});
