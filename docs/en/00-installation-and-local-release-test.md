# 00 — Installation, updates, and commands

Like installing a tool on a workbench, this process puts Shell where the terminal can find it without moving neighbouring tools.

## Requirements and first installation

macOS or Linux needs Node.js 22.19 or later, `curl`, and `shasum` or `sha256sum`. Install the public release with:

```bash
curl -fsSL https://github.com/jotredev/forge614-shell/releases/latest/download/install.sh | bash
```

The installer verifies downloads, prepares Shell under `~/.forge614/shell/`, and ensures a compatible Engines copy. Open a new terminal and run `forge614-shell`.

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

`--engine claude|codex|pi` is a legacy option; in an interactive terminal it does not bypass pickers. `pi` is only for non-interactive automation. Native chat requires an interactive terminal.

## Startup and common errors

Shell queries Engines and offers only Claude Code and Codex with chat adapters. If Engines is absent or incompatible, reinstall Shell to repair it; do not replace it with manual discovery. If Claude or Codex is not authenticated, use `/login` in Shell and complete the official flow. If the command is not found after installation, open a new terminal and verify that the installer-added `PATH` line loaded.

For Engram initialization and its memory integration with assistants, see [07](07-engram-initialization-and-mcp.md). For full diagnostics, see [08](08-troubleshooting-and-limits.md).
