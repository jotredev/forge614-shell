#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLaunch } from "./engines/pi/launcher.ts";
import { parseEngine } from "./app/options.ts";
import { discoverSelectableEngines } from "./infrastructure/forge614-engines.ts";
import { startTerminalSpinner } from "./app/startup-spinner.ts";
import { getCatalog, resolveConfiguredLocale } from "./i18n/index.ts";
import { describeError } from "./shell-error.ts";

const metadata = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};
const args = process.argv.slice(2);

// Non-interactive commands never open the language selector, but they do resolve an effective
// locale for their own text: a valid FORGE614_SHELL_LOCALE, then a saved preference.json locale,
// then English. No selector means no translation is a myth — only the prompt is skipped.
const staticLocale = resolveConfiguredLocale({ env: process.env }) ?? "en";

if (args.length === 1 && args[0] === "update") {
  try {
    const { runUpdateCommand } = await import("./app/update-command.ts");
    await runUpdateCommand({ env: process.env, locale: staticLocale });
  } catch (error) {
    console.error(getCatalog(staticLocale).cli.updateFailed({ message: describeError(error, staticLocale) }));
    process.exitCode = 1;
  }
} else if (args.length === 1 && args[0] === "uninstall") {
  try {
    const { uninstallInstalledShell } = await import("./infrastructure/updater.ts");
    await uninstallInstalledShell({ locale: staticLocale, env: process.env });
  } catch (error) {
    console.error(getCatalog(staticLocale).cli.uninstallFailed({ message: describeError(error, staticLocale) }));
    process.exitCode = 1;
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
      await runInitCommand(args.slice(1), { version: metadata.version, env: process.env, locale, terminal });
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
  console.log(getCatalog(staticLocale).cli.help({ version: metadata.version }));
} else if (args.includes("--version") || args.includes("-v")) {
  console.log(`forge614-shell ${metadata.version}`);
} else {
  let effectiveLocale = staticLocale;
  try {
    const selected = parseEngine(args, staticLocale);
    let selectedExecutable: string | undefined;
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    // Only the legacy non-interactive Pi automation path bypasses the UI.
    if (interactive || selected.engine !== "pi") {
      if (!interactive) {
        throw new Error(getCatalog(staticLocale).cli.requiresInteractiveStartup);
      }
      // Language first, before any other visible text or work: the spinner and engine detection
      // below must never run (and the person must never see anything) until a locale is settled.
      // Cancelling the language selector cancels this whole startup — no detection, no picker.
      const { ProcessTerminal } = await import("@earendil-works/pi-tui");
      // Shared with `chooseStartup` below for the same reason as the `init` dispatch above: two
      // independent `ProcessTerminal` instances chained back to back left the second alt-screen
      // deaf to input on a real PTY.
      const terminal = new ProcessTerminal();
      const { ensureLocale } = await import("./app/language-gate.ts");
      const locale = await ensureLocale({ env: process.env, version: metadata.version, terminal });
      if (locale === undefined) {
        process.exitCode = 130;
        selected.engine = undefined;
      } else {
        effectiveLocale = locale;
        const t = getCatalog(locale);
        const stopSpinner = startTerminalSpinner(t.spinner.detectingEngines);
        let installed: Awaited<ReturnType<typeof discoverSelectableEngines>>;
        try { installed = await discoverSelectableEngines({ env: process.env }); }
        finally { stopSpinner(); }
        const { chooseStartup } = await import("./ui/startup/visual-picker.ts");
        const choice = await chooseStartup(installed, terminal, metadata.version, locale);
        selected.engine = choice?.id;
        selectedExecutable = choice?.executable;
      }
    }
    if (selected.engine === "claude") {
      const { startClaudeUI } = await import("./ui/basic/claude.ts");
      await startClaudeUI(selected.args, selectedExecutable, undefined, metadata.version, effectiveLocale);
    } else if (selected.engine === "codex") {
      const executable = selectedExecutable;
      if (!executable) throw new Error(getCatalog(effectiveLocale).cli.engineNotOnPath({ engine: selected.engine }));
      const { startNativeUI } = await import("./app/native-chat.ts");
      await startNativeUI(selected.engine, executable, selected.args, metadata.version, effectiveLocale);
    } else if (selected.engine === "pi") {
    const piModule = import.meta.resolve("@earendil-works/pi-coding-agent");
    const piRoot = new URL("../", piModule);
    const piMetadata = JSON.parse(readFileSync(new URL("package.json", piRoot), "utf8")) as {
      bin: { pi: string };
    };
    const launch = createLaunch({
      home: homedir(),
      cwd: process.cwd(),
      env: process.env,
      executable: process.execPath,
      piEntry: fileURLToPath(new URL(piMetadata.bin.pi, piRoot)),
      extension: fileURLToPath(new URL("../extensions/forge614-shell.ts", import.meta.url)),
      args: selected.args,
    });
    for (const [key, value] of Object.entries(launch.env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    process.argv = [launch.command, ...launch.args];
    // Pi owns the terminal and signals directly; there is no detached background agent.
    await import(pathToFileURL(launch.args[0]!).href);
    }
  } catch (error) {
    console.error(getCatalog(effectiveLocale).cli.couldNotStart({ message: describeError(error, effectiveLocale) }));
    process.exitCode = 1;
  }
}
