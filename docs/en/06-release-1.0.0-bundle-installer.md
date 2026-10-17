# 06 — Releases, security, and maintenance

Like a sealed suitcase with a shipping label, a release delivers a verifiable version without mixing it with other products' belongings.

## Installation and update

The public gatekeeper requires Node.js 22.19+, verifies `install.mjs` and `forge614.node.json` against GNU-format `SHA256SUMS`, installs Shell under `~/.forge614/shell/<version>/forge614-shell-<version>/` (or `%USERPROFILE%\.forge614\shell\<version>\forge614-shell-<version>` on Windows), and places the stable launcher on the user's `PATH`. Windows uses PowerShell 5.1 or `pwsh` with `-ExecutionPolicy Bypass`. The user guide is [00](00-installation-and-local-release-test.md).

Before activating Shell, the installer validates Forge614 Engines at `~/.forge614/engines/` (`%USERPROFILE%\.forge614\engines\` on Windows) with `detect` and schema 1, checking that `fullySupported` is a boolean. If needed, it installs Engines through its compatible installer. Engines is neither added to `PATH` nor presented as an application to run directly.

Releases use `vX.Y.Z` tags. `forge614-shell update [--version X.Y.Z|vX.Y.Z] [--json]` downloads and checksum-verifies the release gatekeeper, passes it the resolved tag, and activates the selected release. Shell also updates Engines and Engram when installed. `forge614-shell uninstall` asks for confirmation and removes the entire `shell/` directory, including preferences and history; `uninstall --json` skips prompting and `uninstall --self` reports that Shell owns no external integrations. Engram, Atlas, Engines, and the parent directory remain intact.

Release 1.17.0 publishes `forge614-shell-1.17.0.tar.gz.sha256` once so the old 1.16.0 updater can validate the new archive. The next release removes this compatibility sidecar; all new gatekeepers use `SHA256SUMS`.

## Maintenance

Maintainers run `bun run typecheck`, `bun test`, `bun run build`, and `git diff --check`. `bun run bundle:release` creates the Node package tarball with POSIX and Windows launchers; `scripts/prepare-release-assets.mjs` adds the common gatekeepers and node pointer and writes `SHA256SUMS`. The release workflow validates that the `vX.Y.Z` tag matches `package.json` and publishes seven assets for 1.17.0.

## Limits

The public installer supports macOS, Linux, and Windows x64. Operating system native packages (.deb, .rpm, .msi) and a custom domain are not implemented. Installation does not configure assistants, MCP, or memory by itself; MCP configuration appears only as a confirmed follow-up step of `init --product engram`.
