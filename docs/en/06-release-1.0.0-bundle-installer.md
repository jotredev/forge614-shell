# 06 — Releases, security, and maintenance

Like a sealed suitcase with a shipping label, a release delivers a verifiable version without mixing it with other products' belongings.

## Installation and update

The public installer downloads the release, verifies its SHA-256 (a cryptographic fingerprint used to detect an altered download), installs Shell under `~/.forge614/shell/<version>/` (or `%USERPROFILE%\.forge614\shell\<version>\` on Windows), and places the executable (`forge614-shell` on Unix, `forge614-shell.cmd` on Windows) on the user's `PATH`. On macOS and Linux it requires Node.js 22.19+, `curl`, and a SHA-256 tool (`shasum` or `sha256sum`). On Windows x64 it requires Node.js 22.19+, PowerShell (5.1 or `pwsh`), and `tar.exe`; the documented command uses `curl.exe` to save `install.ps1` locally before running it with `-Latest` (avoiding piping remote code to `iex`). The user guide is [00](00-installation-and-local-release-test.md).

Before activating Shell, the installer validates Forge614 Engines at `~/.forge614/engines/` (`%USERPROFILE%\.forge614\engines\` on Windows) with `detect` and schema 1, checking that `fullySupported` is a boolean. If needed, it installs Engines through its compatible installer. Engines is neither added to `PATH` nor presented as an application to run directly.

`forge614-shell update` (or `install.ps1 -Latest`) downloads and activates the latest stable release. `forge614-shell uninstall` asks for confirmation and removes only the `shell/` directory; direct `install.ps1 -Uninstall -Yes` skips confirmation. Engram, Atlas, Engines, and the parent directory remain intact.

## Maintenance

Maintainers run `bun run check` before packaging: typecheck (TypeScript static checking), tests, and build (compilation). `bun run bundle:release` creates the release archive (`forge614-shell-<version>.tar.gz`, its `.sha256` sidecar, `install.sh`, and `install.ps1`). The script `validate-release-bundle.mjs` verifies that the bundle contains all required pieces used by both installers before publication. The published version must match `package.json` and the GitHub Releases assets (downloadable files).

## Limits

The public installer supports macOS, Linux, and Windows x64. Operating system native packages (.deb, .rpm, .msi) and a custom domain are not implemented. Installation does not configure assistants, MCP, or memory by itself; MCP configuration appears only as a confirmed follow-up step of `init --product engram`.
