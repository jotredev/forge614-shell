#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLaunch } from "./engines/pi/launcher.ts";
import { parseEngine } from "./app/options.ts";
import { discoverEngines } from "./engines/discovery.ts";

const metadata = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Forge614-Shell ${metadata.version}

Usage: forge614-shell [--engine claude|codex|antigravity|pi]

Every interactive startup asks for visual interface, then installed AI engine.
Basic is available; Full — Coming later is disabled.
Selections are not saved. Even a single available option waits for confirmation.
The selected native CLI must already be installed. /login uses its official account flow.
Shell does not store subscription credentials or manage billing.

  --engine <name>      Legacy option; does not bypass interactive selectors
  --engine pi          Legacy Pi automation in non-interactive mode only
  --version, -v       Show the Shell version
  --help, -h          Show this help

Native chat: /login, /logout, /resume, /new, /model, /effort, /status, /stop, /quit
/logout disconnects only the current Shell session; native accounts and other apps are unchanged.
Claude sessions: managed by Claude Code, shared with its native history.
Codex: native history, model catalog, reasoning and reported account limits.
Login reuses existing accounts. Antigravity asks before opening native agy if sign-in is required.
Headless uses native permissions, with no interactive tool approvals.
Antigravity /resume <id> selects a conversation without a history preview.
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
      const installed = await discoverEngines(process.env);
      if (!interactive) {
        throw new Error("Shell startup requires an interactive terminal to select the visual interface and AI engine.");
      }
      const { chooseStartup } = await import("./ui/startup/visual-picker.ts");
      const choice = await chooseStartup(installed);
      selected.engine = choice?.id;
      selectedExecutable = choice?.executable;
    }
    if (selected.engine === "claude") {
      const { startClaudeUI } = await import("./ui/basic/claude.ts");
      await startClaudeUI(selected.args, selectedExecutable, undefined, metadata.version);
    } else if (selected.engine === "codex" || selected.engine === "antigravity") {
      const executable = selectedExecutable ?? (await discoverEngines(process.env)).find(engine => engine.id === selected.engine)?.executable;
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
