# 00 — Installation, updates, and commands

Like installing a tool on a workbench, this process puts Shell where the terminal can find it without moving neighbouring tools.

## Requirements and first installation

### macOS and Linux
macOS or Linux needs Node.js 22.19 or later, `curl`, and `shasum` or `sha256sum`. Install the public release with:

```bash
curl -fsSL https://github.com/jotredev/forge614-shell/releases/latest/download/install.sh | bash
```

The gatekeeper requires Node.js 22.19 or later and verifies `install.mjs` and `forge614.node.json` against the release's GNU-format `SHA256SUMS`. It prepares Shell under `~/.forge614/shell/<version>/forge614-shell-<version>/`, records the active version, and ensures compatible Engines. Open a new terminal and run `forge614-shell`.

### Windows x64
Windows needs Windows 10 version 1803+ or Windows 11 x64, Node.js 22.19 or later, PowerShell 5.1 or PowerShell 7 (`pwsh`), and `tar.exe`. The download commands below also use `curl.exe`; the installer itself uses PowerShell to fetch assets.

For security, download the official installer script as a local file before running it; never pipe remote scripts directly into `Invoke-Expression` (`iex`):

```powershell
curl.exe -fsSL -o install.ps1 https://github.com/jotredev/forge614-shell/releases/latest/download/install.ps1
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Latest
Remove-Item install.ps1
```

Or when using PowerShell 7 (`pwsh`):

```powershell
curl.exe -fsSL -o install.ps1 https://github.com/jotredev/forge614-shell/releases/latest/download/install.ps1
pwsh -ExecutionPolicy Bypass -File .\install.ps1 -Latest
Remove-Item install.ps1
```

The gatekeeper requires Node.js 22.19 or later and verifies `install.mjs` and `forge614.node.json` against GNU-format `SHA256SUMS`. It installs Shell under `%USERPROFILE%\.forge614\shell\<version>\forge614-shell-<version>` (or `$env:FORGE614_HOME\shell\<version>\forge614-shell-<version>`), ensures compatible Forge614 Engines (`fullySupported: true` for Claude Code), creates the `forge614-shell.cmd` launcher, and adds `shell\bin` to the user `Path`. Open a new PowerShell or Terminal window and run `forge614-shell`.

The PowerShell gatekeeper uses .NET SHA-256 APIs and runs `install.mjs` with `-ExecutionPolicy Bypass`, including under Windows PowerShell 5.1.

## Commands

```text
forge614-shell                    # starts the interactive picker
forge614-shell --help             # displays help
forge614-shell --version          # displays the version
forge614-shell --version --json   # prints the common version object
forge614-shell update [--version X.Y.Z|vX.Y.Z] [--json]
forge614-shell uninstall          # asks before removing Shell, preferences, and history
forge614-shell uninstall --json   # removes Shell without prompting and prints JSON
forge614-shell uninstall --self   # reports Shell has no integrations of its own to remove
forge614-shell init --product engram
```

`forge614-shell update` verifies the selected release's `install.sh` against strict `SHA256SUMS` and always passes the resolved `vX.Y.Z` tag to the gatekeeper. It also refreshes Forge614 Engines, and Forge614 Engram if installed; each outcome is reported independently and failures do not appear as successes. `update --json` writes one object to stdout: `{ "schemaVersion": 1, "result": { "shell": ..., "engines": ..., "engram": ... } }`. Each component has a `status` (`updated`, `already-up-to-date`, `pending`, `not-installed`, or `failed`); Shell includes `previousVersion` and `installedVersion`, Engines includes `currentVersion`, `latestVersion`, and optional `note`, and Engram includes `previousVersion`, `installedVersion`, and optional `pendingVersion`. A failed component includes `error`; an overall failure is written to stderr as `{ "schemaVersion": 1, "code": "UPDATE_FAILED", "error": "…" }` and exits with code 1. Run `uninstall` from outside `FORGE614_HOME/shell`; it requires internet access to download the published gatekeeper. On Windows, do not use `call forge614-shell` from another `.bat` file because the launcher also exits that script. The command waits for the gatekeeper to finish and reports removal only after that directory is gone. Invalid command input exits with 2; update or uninstall failures exit with 1; cancelling the interactive uninstall exits with 130.

Shell releases use `vX.Y.Z` tags. Version 1.17.0 additionally publishes `forge614-shell-1.17.0.tar.gz.sha256` once so the bundled 1.16.0 updater can verify and download the new package; the following release removes that compatibility sidecar.

`--engine claude|codex` checks with Forge614 Engines that the chosen adapter is fully supported before opening a terminal or saving preferences; Shell then asks for the language and starts that adapter. `--engine pi` and other unsupported ids fail with `engine-not-fully-supported`; without a supported explicit id, startup asks which adapter to open. Native chat requires an interactive terminal. The installer only keeps an existing Forge614 Engines if `capabilities --agent claude-code` also returns a boolean `fullySupported`; otherwise (or if that call fails) it installs the latest one.

## Startup and common errors

Shell queries Engines and offers only Claude Code and Codex with chat adapters. If Engines is absent or incompatible, reinstall Shell to repair it; do not replace it with manual discovery. If Claude or Codex is not authenticated, use `/login` (Claude Code) or `/f614:login` (Codex) in Shell and complete the official flow. If the command is not found after installation, open a new terminal and verify that the installer-added `PATH` line loaded.

For Engram initialization and its memory integration with assistants, see [07](07-engram-initialization-and-mcp.md). For full diagnostics, see [08](08-troubleshooting-and-limits.md).
