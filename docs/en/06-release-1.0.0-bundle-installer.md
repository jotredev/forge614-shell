# 06 — Release 1.0.0 preparation and installer bundle

2026-09-18 · Stage 02: packaging and local installation · Documentation revision: 1 · [Español](../es/06-preparacion-release-1.0.0-instalador.md) · [Index](../../README.md)

This document details the preparation of the **Forge614-Shell 1.0.0 local release**: the **versioning conventions and product identity**, the **pinned version display in the status bar (`v1.0.0`)**, the standalone package bundle builder (`scripts/release-bundle.mjs`), the filesystem-based local installer (`scripts/install.sh`), **isolated installation under `~/.forge614/`**, integrity guarantees backed by **SHA-256 checksums**, and software quality verified by **124 automated tests across 32 files**.

---

## 1. The Master Analogy: The Sealed Avionics Crate and Assembly Bay

Consider the delivery and installation of critical aerospace or military avionics equipment:
- **The Factory Crate (The Standalone Bundle):** High-precision flight computers are never shipped to airfield hangars as loose schematics, nor do they require maintenance engineers to have heavy factory manufacturing equipment (`node_modules` or development compilers). They are delivered sealed inside an airtight, pressurized container (`forge614-shell-1.0.0.tar.gz`), accompanied by a cryptographic security seal (`.sha256`). The crate contains only what is strictly necessary to run: the bundled runtime, package metadata, and required system extensions.
- **The Isolated Assembly Bay (`~/.forge614/shell/1.0.0/`):** The hangar installation script (`install.sh`) never blindly overwrites active flight instruments. It uncrates the package into an assembly bay reserved exclusively for that exact version. If preflight validation detects missing core files (`package.json` or `cli.js`), the procedure aborts immediately without touching the active aircraft.
- **The Master Command Switch (`~/.forge614/bin/forge614-shell`):** Once bay 1.0.0 is verified, the installer atomically switches the main cockpit control link to the new module. Upgrading or rolling back versions consists simply of repointing this master switch.
- **The Maintenance Test Bench (`FORGE614_HOME`):** When engineers need to test the installation workflow in an isolated sandbox before altering production systems, they direct the process to a temporary test bench without affecting standard user paths.
- **The Cockpit Instrument Badge (The Status Bar):** In the bottom-right corner of the cockpit instrument panel, the pilot has a permanent, fixed indicator (`v1.0.0`) that remains visible at all times, even when flight path telemetry or engine status fills the rest of the display.

---

## 2. Release Identity and Versioning Conventions

Forge614-Shell maintains a deliberate technical distinction between package metadata, user-facing UI labels, and Git version tags:

| Attribute | Value | Scope and Purpose |
| :--- | :--- | :--- |
| **Package Version** | `1.0.0` | Specified in `package.json` and parsed by Node.js / Bun runtimes (`metadata.version`). |
| **Visible UI Label** | `v1.0.0` | Rendered on the far-right edge of the bottom status bar for clear human readability. |
| **Git Release Tag** | `1.0.0` | Git tag convention strictly **without the `v` prefix** (strict SemVer in the repository). |
| **Release Archive Name** | `forge614-shell-1.0.0.tar.gz` | Filename of the packaged standalone distribution archive. |
| **Publication Status** | **Local only** | Prepared and verified on the local development machine; **neither pushed nor published to any remote repository or registry**. |

> [!IMPORTANT]
> **Label Alignment:** The terminal UI displays `v1.0.0` for visual clarity, while Git tags use `1.0.0`. This separation follows industry best practices where user interfaces stylize versions with a leading "v", while package managers and release tags adhere to pure numeric SemVer.

---

## 3. Status Bar Version Display (`ShellStatusBar`)

Forge614-Shell displays its version at the bottom edge of the terminal, integrated into the compact footer row below the chat (`status-bar.ts`):

```text
F614 · Claude Code · <model> · ~/project · main · 3 changes             v1.0.0
```

### Rendering Behavior and Priority:
1. **Right-Edge Pinning:** The label `v1.0.0` is rendered in muted gray (`muted`), anchored to the far-right boundary of the status bar.
2. **Protective Truncation on Narrow Viewports:**
   - The left side aggregates Shell telemetry (`F614`), connected engine, model, context usage, home-relative project directory (`homeRelativePath`), Git branch, and pending changes.
   - When terminal width is constrained, `ShellStatusBar` computes the remaining space by subtracting the width of the version badge:
     `availableLeft = innerWidth - visibleWidth(release) - 1`
   - The left side is then truncated with ellipsis (`…`), **guaranteeing that the `v1.0.0` badge is never clipped, hidden, or wrapped to a new line**.

---

## 4. Local Release Bundle (`bundle:release`)

The standalone release archive is generated using a decoupled build script:

```bash
bun run bundle:release
```

### Architecture of the Bundler (`scripts/release-bundle.mjs`):
1. **Metadata Ingestion:** Reads the version string (`1.0.0`) directly from `package.json`.
2. **Runtime Compilation:** Runs `bun build src/cli.ts --target=node --outdir <staging>/dist`, producing an optimized, self-contained Node.js executable.
3. **Extension and Metadata Ingestion:**
   - Copies `package.json` into the staging root.
   - Copies the `extensions/` directory (required for the legacy Pi bridge and runtime extension hooks).
   - Grants executable permissions (`0o755`) to `dist/cli.js`.
4. **Archive Packaging:** Compresses the staging directory into a tarball using `tar -czf`:
   - `dist/release/forge614-shell-1.0.0.tar.gz`
5. **Cryptographic Integrity:** Computes the SHA-256 digest of the archive and generates a companion checksum file:
   - `dist/release/forge614-shell-1.0.0.tar.gz.sha256`
6. **Zero Repository Dependency:** The archive does not require cloning the git repository and completely excludes development `node_modules`.
7. **Runtime Requirement:** Requires Node.js `>=22.19.0` on the target machine.

---

## 5. Local Installation Test Flow

The initial installer for Forge614-Shell is intentionally archive-based (`--archive`). Its purpose is to validate the real directory layout, file permissions, and active symlinks on the host operating system before deploying remote distribution mechanisms.

### 5.1 Running the Installer

```bash
bash scripts/install.sh --archive "$PWD/dist/release/forge614-shell-1.0.0.tar.gz"
```

### 5.2 Target Filesystem Hierarchy (`~/.forge614/`)

By default, the installer populates the following structure under the user's home directory:

```text
~/.forge614/
├── bin/
│   └── forge614-shell -> <FORGE614_HOME>/shell/1.0.0/dist/cli.js   # Active symlink
└── shell/
    └── 1.0.0/                                         # Isolated version directory
        ├── dist/
        │   └── cli.js                                 # Bundled Node.js entry point
        ├── extensions/                                # Runtime extension hooks
        └── package.json                               # Release metadata
```

### 5.3 Verifying the Installation

After running the installer script, verify that the binary executes properly:

```bash
# Check installed version
~/.forge614/bin/forge614-shell --version
# Output: forge614-shell 1.0.0

# Interactive startup
~/.forge614/bin/forge614-shell
```

### 5.4 PATH Configuration

To run `forge614-shell` from any terminal session, add the binary directory to your shell configuration (`~/.zshrc` or `~/.bashrc`):

```bash
export PATH="$HOME/.forge614/bin:$PATH"
```

### 5.5 Overriding the Installation Root (`FORGE614_HOME`)

For automated testing, CI pipelines, or isolated environments, the `FORGE614_HOME` environment variable overrides the default `~/.forge614` destination:

```bash
FORGE614_HOME=/tmp/test-forge614 bash scripts/install.sh --archive dist/release/forge614-shell-1.0.0.tar.gz
```

---

## 6. Safety and Release Behavior

The installer (`scripts/install.sh`) includes defensive mechanisms to ensure resilient, atomic operations:

1. **Two-Stage Versioned Deployment:**
   - The archive is extracted into a temporary hidden staging directory: `$shell_root/.${version}.installing`.
   - If unpacking or preflight validation fails, the staging directory is purged without leaving orphaned files.
   - Once validated, the directory is moved atomically to its destination: `$shell_root/$version`.
2. **Preflight Validation:**
   - Ensures that Node.js is available in the system. The packaged application declares Node.js `>=22.19.0` as its runtime requirement.
   - Validates that the uncompressed directory contains both `package.json` and `dist/cli.js`. If either is missing, it exits with error code `65` (*Invalid release archive*).
3. **Safe Symlink Update:**
   - Uses `ln -sfn "$target/dist/cli.js" "$forge_home/bin/forge614-shell"` to repoint the active executable link to the installed version.
4. **Automated Integration Testing (`release-bundle.test.ts`):**
   - The integration test suite validates the entire end-to-end flow:
     1. Creates the bundle via `bun scripts/release-bundle.mjs --out <temp-dir>`.
     2. Runs `scripts/install.sh --archive <archive>` pointing to a temporary `FORGE614_HOME`.
     3. Executes `<temp-home>/bin/forge614-shell --version`.
     4. Asserts that exit code is `0` and stdout exactly matches `forge614-shell 1.0.0`.

---

## 7. Explicitly Not Implemented Yet (Negative Scope)

To maintain absolute technical integrity and avoid premature assumptions, the following features are **explicitly NOT implemented**:

- **No public npm package:** Forge614-Shell is not published to npm (`npm install -g forge614-shell` does not exist).
- **No remote GitHub Release download flow:** No automated download mechanism from GitHub Releases exists yet.
- **No `curl | bash` endpoint:** There is no remote pipe installer such as `curl -fsSL https://... | bash`.
- **No hosted `forge614.dev` installer:** The `forge614.dev` domain does not host installer scripts or binary assets.
- **No automatic background updates:** Shell does not poll or download updates in the background.
- **No in-app `/update` command:** The composer does not have a slash command for self-updating.
- **No Windows PowerShell installer:** There is no native `install.ps1` script for Windows.
- **No remote release channels:** There are no remote *stable*, *beta*, or *nightly* update channels.
- **No remote publishing has occurred:** The local repository has not been published or pushed (`git push` pending).
- **No remote GitHub tag pushed:** Tag `1.0.0` exists only in the local Git repository.

---

## 8. Three-Tier Distribution Roadmap

The software delivery lifecycle of Forge614-Shell progresses across three distinct tiers:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ TIER 1 (CURRENT): Local Bundling and Verification                                               │
│ • Standalone Node.js bundle (forge614-shell-1.0.0.tar.gz)                                      │
│ • Local archive installer (bash scripts/install.sh --archive)                                   │
│ • Filesystem layout validation (~/.forge614/) and isolated integration tests                    │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 2 (UPCOMING): Private GitHub Releases Distribution                                         │
│ • Publishing numeric tags (1.0.0) and signed tarball assets to GitHub Releases                  │
│ • Authenticated downloads via GitHub CLI or personal access tokens for internal teams           │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 3 (FUTURE): Public Hosted Infrastructure and In-App Updates                                │
│ • Quick-install hosted endpoint (forge614.dev)                                                  │
│ • Multi-platform install scripts (macOS, Linux, and Windows PowerShell)                         │
│ • In-app (/update) command with cryptographic checksum verification and zero-downtime swaps     │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Verification and Quality Status

The release bundle and installer workflows are fully covered by the project's standard verification command:

```bash
bun run check
# Runs: bun run typecheck && bun test && bun run build
```

### Verified Pipeline Metrics:
- **Automated Tests:** **124 tests passing across 32 files** (0 failures, 566 `expect()` assertions).
- **Key Integration Test Added:** `tests/integration/release-bundle.test.ts` (bundling, installing, and executing `--version` outside the repository).
- **Key UI Test Added:** `src/ui/basic/workspace-chrome.test.ts` (anchoring `v1.0.0` to the right edge with protective truncation of left-side metadata).
- **Strict Typecheck:** `tsc --noEmit` passed with 0 errors.
- **Production Build:** `dist/cli.js` cleanly bundled (149.48 KB).
