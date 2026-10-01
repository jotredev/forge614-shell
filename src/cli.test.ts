import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

test("the init dispatch forwards the real process env to runInitCommand, so a custom FORGE614_HOME reaches Engines/Engram resolution", async () => {
  const source = await readFile(new URL("./cli.ts", import.meta.url), "utf8");
  const initCall = source.match(/runInitCommand\(args\.slice\(1\),\s*\{[^}]*\}\)/)?.[0];
  expect(initCall).toBeDefined();
  expect(initCall).toContain("env: process.env");
});

test("the init branch's own error catch reports in the locale the person just selected, not the pre-selection static one", async () => {
  const source = await readFile(new URL("./cli.ts", import.meta.url), "utf8");
  const initBranch = source.slice(source.indexOf('args[0] === "init"'), source.indexOf('args[0] === "language"'));
  // `effectiveLocale` must be declared before `ensureLocale` runs, updated once it resolves, and
  // used (never `staticLocale`) in this branch's own catch — otherwise a person who just chose
  // Español would see `runInitCommand`'s own error printed in English.
  expect(initBranch).toMatch(/let effectiveLocale = staticLocale;/);
  expect(initBranch).toMatch(/effectiveLocale = locale;/);
  const catchBlock = initBranch.slice(initBranch.indexOf("} catch (error) {"));
  expect(catchBlock).toContain("getCatalog(effectiveLocale)");
  expect(catchBlock).not.toContain("getCatalog(staticLocale)");
});

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCatalog } from "./i18n/index.ts";

/** Idea 7: startup hands the picker the assistant used last time and remembers the one chosen now, both through Shell's preferences file. */
test("startup marks the last used engine in the picker and remembers the one chosen", async () => {
  const source = await readFile(new URL("./cli.ts", import.meta.url), "utf8");
  expect(source).toMatch(/chooseStartup\(installed,\s*terminal,\s*metadata\.version,\s*locale,\s*loadLastEngine\(\{\s*env:\s*process\.env\s*\}\)\)/);
  expect(source).toMatch(/saveLastEngine\(choice\.id,\s*\{\s*env:\s*process\.env\s*\}\)/);
});

test("without a real terminal, init refuses at once (it never starts the screens, so it can never ask or link a group)", () => {
  const home = mkdtempSync(join(tmpdir(), "forge614-shell-cli-notty-"));
  try {
    const result = spawnSync("bun", [new URL("./cli.ts", import.meta.url).pathname, "init", "--product", "engram"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20000,
      env: { PATH: process.env.PATH, HOME: home, FORGE614_HOME: join(home, "forge614"), FORGE614_SHELL_LOCALE: "es" },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(getCatalog("es").startup.requiresInteractiveTerminal);
    // The interactive screens were never opened: no alternate screen, no "stdin closed" result.
    expect(result.stdout).not.toContain("\u001b[?1049h");
    expect(result.stdout + result.stderr).not.toContain("La entrada interactiva se cerró");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

/**
 * The real `--help` a person reads, in both languages: it names Shell's own commands with `/f614:` (login, status, refresh, stop,
 * quit, commands, help) and none of the old unprefixed names. It exists because the help is the first place the commands are
 * listed and the catalog test only sees the text, not what the program prints.
 */
test("--help prints Shell commands with the /f614: prefix in both languages", () => {
  const home = mkdtempSync(join(tmpdir(), "forge614-shell-cli-help-"));
  try {
    for (const locale of ["en", "es"]) {
      const result = spawnSync("bun", [new URL("./cli.ts", import.meta.url).pathname, "--help"], {
        encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20000,
        env: { PATH: process.env.PATH, HOME: home, FORGE614_HOME: join(home, "forge614"), FORGE614_SHELL_LOCALE: locale },
      });
      expect(result.status, locale).toBe(0);
      expect(result.stdout, `${locale} non-terminal sign`).toStartWith("█▀▀▀ █▀▀█ █▀▀▄ █▀▀▀ █▀▀▀  █▀▀▀ ▀█  █  █\n");
      for (const name of ["login", "status", "refresh", "stop", "quit", "commands", "help"]) expect(result.stdout, `${locale} /f614:${name}`).toContain(`/f614:${name}`);
      for (const old of ["/refresh", "/yes", "/no", "/commands", "/help", "/quit!", "/exit!", "/forge614-status"]) expect(result.stdout, `${locale} ${old}`).not.toMatch(new RegExp(`(?<![\\w:/.-])${old}(?![\\w:-])`));
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
});

/**
 * Came out of the third real-account test: `--help` said «Selections are not saved», which stopped being true when Shell began to remember the assistant used last (it
 * comes highlighted) and each assistant's model, reasoning and work mode; and it said «Headless uses native permissions», when a start without an interactive terminal is refused.
 * The real `--help`, in both languages, says what is true: the exact new lines are written out, and the two old claims are gone.
 */
test("--help says what Shell remembers and that a chat needs an interactive terminal, and no longer the old claims", () => {
  const home = mkdtempSync(join(tmpdir(), "forge614-shell-cli-help-truth-"));
  const expected = {
    en: ["Shell remembers the assistant you used last (it comes highlighted) and each assistant's model, reasoning and work mode. It still asks every time: even a single available option waits for confirmation.",
      "Starting a chat needs an interactive terminal; without one Shell refuses to start."],
    es: ["Shell recuerda el último asistente que usaste (aparece resaltado) y el modelo, el razonamiento y el modo de trabajo de cada uno. Aun así pregunta cada vez: incluso con una sola opción disponible se espera confirmación.",
      "Abrir un chat necesita una terminal interactiva; sin ella Shell no arranca."],
  } as const;
  try {
    for (const locale of ["en", "es"] as const) {
      const result = spawnSync("bun", [new URL("./cli.ts", import.meta.url).pathname, "--help"], {
        encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20000,
        env: { PATH: process.env.PATH, HOME: home, FORGE614_HOME: join(home, "forge614"), FORGE614_SHELL_LOCALE: locale },
      });
      expect(result.status, locale).toBe(0);
      for (const line of expected[locale]) expect(result.stdout, `${locale} ${line}`).toContain(line);
      for (const old of ["Selections are not saved", "Las selecciones no se guardan", "Headless", "headless"]) expect(result.stdout, `${locale} ${old}`).not.toContain(old);
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
});
