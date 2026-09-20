# 06 — Releases, security, and maintenance

Like a sealed suitcase with a shipping label, a release delivers a verifiable version without mixing it with other products' belongings.

## Installation and update

The public installer downloads the release, verifies its SHA-256 (a cryptographic fingerprint used to detect an altered download), installs Shell under `~/.forge614/shell/<version>/`, and makes `forge614-shell` the only Shell entry added to `PATH`. It requires Node.js 22.19+, `curl`, and a SHA-256 tool. The user guide is [00](00-installation-and-local-release-test.md).

Before activating Shell, the installer validates Forge614 Engines at `~/.forge614/engines/` with `detect` and schema 1. If needed, it installs Engines through its compatible installer. Engines is neither added to `PATH` nor presented as an application to run directly.

`forge614-shell update` downloads and activates the latest stable release. `forge614-shell uninstall` asks for confirmation and removes only `~/.forge614/shell/`; Engram, Atlas, Engines, and the parent directory remain.

## Maintenance

Maintainers run `bun run check` before packaging: typecheck (TypeScript static checking), tests, and build (compilation). `bun run bundle:release` creates the release archive. The published version must match `package.json` and the GitHub Releases assets (downloadable files).

## Limits

The current public installer targets macOS and Linux. Windows, native packages, and a custom domain are not implemented. Installation does not configure assistants, MCP, or memory by itself; MCP configuration appears only as a confirmed follow-up step of `init --product engram`.
