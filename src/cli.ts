#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { parseEngine } from "./app/options.ts";
import { discoverSelectableEngines, requireFullySupportedEngine } from "./infrastructure/forge614-engines.ts";
import { startTerminalSpinner } from "./app/startup-spinner.ts";
import { getCatalog, resolveConfiguredLocale } from "./i18n/index.ts";
import { describeError } from "./shell-error.ts";
import { helpLines } from "./ui/basic/logo.ts";

const metadata = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};
const args = process.argv.slice(2);

// Non-interactive commands never open the language selector, but they do resolve an effective
// locale for their own text: a valid FORGE614_SHELL_LOCALE, then a saved preference.json locale,
// then English. No selector means no translation is a myth — only the prompt is skipped.
const staticLocale = resolveConfiguredLocale({ env: process.env }) ?? "en";

if (args[0] === "update") {
  let version: string | undefined;
  let json = false;
  let invalid = false;
  for (let index = 1; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--json" && !json) json = true;
    else if (arg === "--version" && version === undefined && index + 1 < args.length && /^v?\d+\.\d+\.\d+$/.test(args[index + 1] ?? "")) version = args[++index];
    else invalid = true;
  }
  if (invalid) {
    console.error(JSON.stringify({ schemaVersion: 1, code: "INVALID_ARGUMENTS", error: "Uso: forge614-shell update [--version X.Y.Z|vX.Y.Z] [--json]." }));
    process.exitCode = 2;
  } else {
    try {
      const { runUpdateCommand } = await import("./app/update-command.ts");
      await runUpdateCommand({ env: process.env, locale: staticLocale, version, currentVersion: metadata.version, json });
    } catch (error) {
      console.error(JSON.stringify({ schemaVersion: 1, code: "UPDATE_FAILED", error: getCatalog(staticLocale).cli.updateFailed({ message: describeError(error, staticLocale) }) }));
      process.exitCode = 1;
    }
  }
} else if (args[0] === "uninstall") {
  const flags = args.slice(1);
  const json = flags.includes("--json");
  const self = flags.includes("--self");
  if (flags.some(flag => flag !== "--json" && flag !== "--self") || new Set(flags).size !== flags.length) {
    console.error(JSON.stringify({ schemaVersion: 1, code: "INVALID_ARGUMENTS", error: "Uso: forge614-shell uninstall [--json] [--self]." }));
    process.exitCode = 2;
  } else if (self) {
    if (json) console.log(JSON.stringify({ schemaVersion: 1, result: { integrationsRemoved: true } }));
    else console.log(staticLocale === "es" ? "Forge614 Shell no tiene integraciones propias que retirar." : "Forge614 Shell has no integrations of its own to remove.");
  } else {
    let confirmed = true;
    if (!json && process.stdin.isTTY && process.stdout.isTTY) {
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const question = staticLocale === "es"
          ? "Esto eliminará Forge614 Shell, sus preferencias y su historial. ¿Continuar? [s/N] "
          : "This removes Forge614 Shell, its preferences, and its history. Continue? [y/N] ";
        const answer = await prompt.question(question);
        confirmed = staticLocale === "es" ? /^s(?:í|i)?$/i.test(answer.trim()) : /^y(?:es)?$/i.test(answer.trim());
      } catch { confirmed = false; }
      finally { prompt.close(); }
    }
    if (!confirmed) {
      if (!json) console.log(staticLocale === "es" ? "No se desinstaló nada." : "Nothing was uninstalled.");
      process.exitCode = 130;
    } else {
      try {
        const { uninstallInstalledShell } = await import("./infrastructure/updater.ts");
        await uninstallInstalledShell({ locale: staticLocale, env: process.env });
        if (json) console.log(JSON.stringify({ schemaVersion: 1, result: { removed: true } }));
        else console.log(staticLocale === "es" ? "Forge614 Shell, sus preferencias y su historial se eliminaron." : "Forge614 Shell, its preferences, and its history were removed.");
      } catch (error) {
        console.error(JSON.stringify({ schemaVersion: 1, code: "UNINSTALL_FAILED", error: describeError(error, staticLocale) }));
        process.exitCode = 1;
      }
    }
  }
} else if (args[0] === "init") {
  // Mutable: starts at the static (non-prompting) resolution, then becomes whatever the person
  // just chose in the selector below. Every catch in this branch uses this variable, never
  // `staticLocale` directly — otherwise a person who just picked Español would see a Shell-own
  // error from `runInitCommand` printed in English.
  let effectiveLocale = staticLocale;
  try {
    const { requireEngramProduct, runInitCommand } = await import("./app/init-engram.ts");
    requireEngramProduct(args.slice(1));
    const { ProcessTerminal } = await import("@earendil-works/pi-tui");
    // One real terminal shared across the language selector and the Engram flow: two independent
    // `ProcessTerminal` instances each toggling raw mode and attaching/detaching their own stdin
    // listener left the second alt-screen deaf to all input on a real PTY (confirmed with a live
    // pty harness) — `chooseStartup` below avoids this the same way, by reusing one instance.
    const terminal = new ProcessTerminal();
    const { ensureLocale } = await import("./app/language-gate.ts");
    const locale = await ensureLocale({ env: process.env, version: metadata.version, terminal });
    if (locale === undefined) {
      process.exitCode = 130;
    } else {
      effectiveLocale = locale;
      // `interactive` comes from the real TTYs, never from having a terminal object: `terminal` above
      // exists even when stdin is a pipe, and passing only it made `init` start its screens (and then
      // die on stdin closing) instead of refusing at once as documented.
      await runInitCommand(args.slice(1), { version: metadata.version, env: process.env, locale, terminal, interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY) });
    }
  } catch (error) {
    console.error(getCatalog(effectiveLocale).cli.initFailed({ message: describeError(error, effectiveLocale) }));
    process.exitCode = 1;
  }
} else if (args[0] === "language") {
  try {
    const { runLanguageCommand } = await import("./app/language-command.ts");
    await runLanguageCommand(args.slice(1), { version: metadata.version, env: process.env });
  } catch (error) {
    console.error(getCatalog(staticLocale).cli.languageFailed({ message: describeError(error, staticLocale) }));
    process.exitCode = 1;
  }
} else if (args.includes("--help") || args.includes("-h")) {
  /** A terminal gets the responsive colored sign; a pipe gets stable, wide, plain rows before unchanged help text. */
  console.log(helpLines(process.stdout, getCatalog(staticLocale).cli.help({ version: metadata.version })).join("\n"));
} else if (args.includes("--version") || args.includes("-v")) {
  const validVersionArgs = args.length === 1 || (args.length === 2 && args.includes("--version") && args.includes("--json"));
  if (!validVersionArgs) {
    console.error(JSON.stringify({ schemaVersion: 1, code: "INVALID_ARGUMENTS", error: "Use --version [--json]." }));
    process.exitCode = 2;
  } else if (args.includes("--json")) {
    console.log(JSON.stringify({ schemaVersion: 1, name: "forge614-shell", version: metadata.version }));
  } else {
    console.log(`forge614-shell ${metadata.version}`);
  }
} else {
  let effectiveLocale = staticLocale;
  try {
    const selected = parseEngine(args, staticLocale);
    const explicitEngine = selected.engine
      ? await requireFullySupportedEngine(selected.engine, { env: process.env })
      : undefined;
    let selectedExecutable = explicitEngine?.executable;
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    if (!interactive) throw new Error(getCatalog(staticLocale).cli.requiresInteractiveStartup);

    // Explicit adapter support was confirmed above, before constructing a terminal or entering the language gate.
    // Normal startup still chooses a language first, then detects and asks which supported adapter to open.
    const { ProcessTerminal } = await import("@earendil-works/pi-tui");
    const terminal = new ProcessTerminal();
    const { ensureLocale } = await import("./app/language-gate.ts");
    const locale = await ensureLocale({ env: process.env, version: metadata.version, terminal });
    if (locale === undefined) {
      process.exitCode = 130;
      selected.engine = undefined;
    } else {
      effectiveLocale = locale;
      if (!selected.engine) {
        const t = getCatalog(locale);
        const stopSpinner = startTerminalSpinner(t.spinner.detectingEngines);
        let installed: Awaited<ReturnType<typeof discoverSelectableEngines>>;
        try { installed = await discoverSelectableEngines({ env: process.env }); }
        finally { stopSpinner(); }
        const { chooseStartup } = await import("./ui/startup/visual-picker.ts");
        const { loadLastEngine, saveLastEngine } = await import("./infrastructure/shell-preferences.ts");
        const choice = await chooseStartup(installed, terminal, metadata.version, locale, loadLastEngine({ env: process.env }));
        if (choice) saveLastEngine(choice.id, { env: process.env });
        selected.engine = choice?.id;
        selectedExecutable = choice?.executable;
      }
    }
    if (selected.engine === "claude") {
      const { startClaudeUI } = await import("./ui/basic/claude.ts");
      const { readEcosystemVersions } = await import("./infrastructure/ecosystem-versions.ts");
      await startClaudeUI(selected.args, selectedExecutable, undefined, metadata.version, effectiveLocale, undefined, () => readEcosystemVersions({ env: process.env }));
    } else if (selected.engine === "codex") {
      const executable = selectedExecutable;
      if (!executable) throw new Error(getCatalog(effectiveLocale).cli.engineNotOnPath({ engine: selected.engine }));
      const { startNativeUI } = await import("./app/native-chat.ts");
      const { readEcosystemVersions } = await import("./infrastructure/ecosystem-versions.ts");
      await startNativeUI(selected.engine, executable, selected.args, metadata.version, effectiveLocale, () => readEcosystemVersions({ env: process.env }));
    }
  } catch (error) {
    console.error(getCatalog(effectiveLocale).cli.couldNotStart({ message: describeError(error, effectiveLocale) }));
    process.exitCode = 1;
  }
}
