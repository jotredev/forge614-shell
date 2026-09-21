#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLaunch } from "./engines/pi/launcher.ts";
import { parseEngine } from "./app/options.ts";
import { discoverSelectableEngines } from "./infrastructure/forge614-engines.ts";
import { startTerminalSpinner } from "./app/startup-spinner.ts";

const metadata = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};
const args = process.argv.slice(2);

if (args.length === 1 && args[0] === "update") {
  try {
    const { runUpdateCommand } = await import("./app/update-command.ts");
    await runUpdateCommand({ env: process.env });
  } catch (error) {
    console.error(`Forge614-Shell update failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
} else if (args.length === 1 && args[0] === "uninstall") {
  try {
    const { uninstallInstalledShell } = await import("./infrastructure/updater.ts");
    await uninstallInstalledShell();
  } catch (error) {
    console.error(`Forge614-Shell uninstall failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
} else if (args[0] === "init") {
  try {
    const { runInitCommand } = await import("./app/init-engram.ts");
    await runInitCommand(args.slice(1));
  } catch (error) {
    console.error(`Forge614-Shell init failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
} else if (args.includes("--help") || args.includes("-h")) {
  console.log(`Forge614-Shell ${metadata.version}

Usage: forge614-shell [--engine claude|codex|pi]

Every interactive startup asks for visual interface, then installed AI engine.
Basic is available; Full — Coming later is disabled.
Selections are not saved. Even a single available option waits for confirmation.
The selected native CLI must already be installed. /login uses its official account flow.
Shell does not store subscription credentials or manage billing.

  --engine <name>      Legacy option; does not bypass interactive selectors
  --engine pi          Legacy Pi automation in non-interactive mode only
  --version, -v       Show the Shell version
  update              Download and activate the latest stable release, and refresh Forge614 Engines (and Engram, if installed)
  uninstall           Remove Forge614 Shell from this computer
  init --product <name>  Set up a Forge614 product's local memory and, for engram, its memory integration (MCP + instructions)
  --help, -h          Show this help

Native chat: /login, /logout, /resume, /new, /model, /effort, /status, /stop, /quit
/logout disconnects only the current Shell session; native accounts and other apps are unchanged.
Claude sessions: managed by Claude Code, shared with its native history.
Codex: native history, model catalog, reasoning and reported account limits.
Login reuses existing accounts.
Headless uses native permissions, with no interactive tool approvals.
Pi profile only: ~/.forge614-shell/agent (FORGE614_SHELL_HOME override)
Pass Pi-specific options after --engine pi.

The selected engine's project settings and permissions apply. This is not a sandbox.`);
} else if (args.includes("--version") || args.includes("-v")) {
  console.log(`forge614-shell ${metadata.version}`);
} else {
  try {
    const selected = parseEngine(args);
    let selectedExecutable: string | undefined;
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    // Only the legacy non-interactive Pi automation path bypasses the UI.
    if (interactive || selected.engine !== "pi") {
      const stopSpinner = startTerminalSpinner("Detecting installed AI engines…");
      let installed: Awaited<ReturnType<typeof discoverSelectableEngines>>;
      try { installed = await discoverSelectableEngines({ env: process.env }); }
      finally { stopSpinner(); }
      if (!interactive) {
        throw new Error("Shell startup requires an interactive terminal to select the visual interface and AI engine.");
      }
      const { chooseStartup } = await import("./ui/startup/visual-picker.ts");
      const choice = await chooseStartup(installed, undefined, metadata.version);
      selected.engine = choice?.id;
      selectedExecutable = choice?.executable;
    }
    if (selected.engine === "claude") {
      const { startClaudeUI } = await import("./ui/basic/claude.ts");
      await startClaudeUI(selected.args, selectedExecutable, undefined, metadata.version);
    } else if (selected.engine === "codex") {
      const executable = selectedExecutable;
      if (!executable) throw new Error(`${selected.engine} is not installed on PATH.`);
      const { startNativeUI } = await import("./app/native-chat.ts");
      await startNativeUI(selected.engine, executable, selected.args, metadata.version);
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
    console.error(`Forge614-Shell could not start: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
