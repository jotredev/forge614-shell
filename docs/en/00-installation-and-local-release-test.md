# 00 — Installation, updates, and commands

Like installing a tool on a workbench, this process puts Shell where the terminal can find it without moving neighbouring tools.

## Requirements and first installation

### macOS and Linux
macOS or Linux needs Node.js 22.19 or later, `curl`, and `shasum` or `sha256sum`. Install the public release with:

```bash
curl -fsSL https://github.com/jotredev/forge614-shell/releases/latest/download/install.sh | bash
```

The installer verifies downloads via SHA-256, prepares Shell under `~/.forge614/shell/`, and ensures a compatible Engines copy. Open a new terminal and run `forge614-shell`.

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

The installer verifies cryptographic SHA-256 checksums against the `.sha256` sidecar, installs Shell under `%USERPROFILE%\.forge614\shell\<version>` (or `$env:FORGE614_HOME\shell\<version>`), ensures a compatible Forge614 Engines installation (`forge614-engines.exe` with schema 1 and a boolean `fullySupported` capability), creates the `forge614-shell.cmd` launcher, and adds `shell\bin` to the user `Path`. Open a new PowerShell or Terminal window and run `forge614-shell`.

The SHA-256 checksum is computed with .NET classes (`System.Security.Cryptography.SHA256`), not with the `Get-FileHash` cmdlet: if `powershell.exe` 5.1 is opened from PowerShell 7 it inherits its `PSModulePath` and does not find that cmdlet, with exactly the command documented above typed in Windows Terminal with `pwsh`. For the same reason, the Forge614 Engines installer runs with the same PowerShell that is running `install.ps1` (the full path of `pwsh` or `powershell.exe`), not with the first one found on the `PATH`.

## Commands

```text
forge614-shell                    # starts the interactive picker
forge614-shell --help             # displays help
forge614-shell --version          # displays the version
forge614-shell update             # updates Shell, Engines, and Engram (if installed)
forge614-shell uninstall          # removes only Shell after confirmation
forge614-shell init --product engram
```

`forge614-shell update` also refreshes Forge614 Engines, and Forge614 Engram if it is installed — each is reported independently (updated, already up to date, not installed, or failed with a safe message), and a failure in one never hides or is presented as success for the others; the command exits with a non-zero status if any of the three failed.

`--engine claude|codex` checks with Forge614 Engines that the chosen adapter is fully supported before opening a terminal or saving preferences; Shell then asks for the language and starts that adapter. `--engine pi` and other unsupported ids fail with `engine-not-fully-supported`; without a supported explicit id, startup asks which adapter to open. Native chat requires an interactive terminal. The installer only keeps an existing Forge614 Engines if `capabilities --agent claude-code` also returns a boolean `fullySupported`; otherwise (or if that call fails) it installs the latest one.

## Startup and common errors

Shell queries Engines and offers only Claude Code and Codex with chat adapters. If Engines is absent or incompatible, reinstall Shell to repair it; do not replace it with manual discovery. If Claude or Codex is not authenticated, use `/login` (Claude Code) or `/f614:login` (Codex) in Shell and complete the official flow. If the command is not found after installation, open a new terminal and verify that the installer-added `PATH` line loaded.

For Engram initialization and its memory integration with assistants, see [07](07-engram-initialization-and-mcp.md). For full diagnostics, see [08](08-troubleshooting-and-limits.md).
