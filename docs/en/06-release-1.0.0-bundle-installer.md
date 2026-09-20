# 06 — Release preparation and public installer bundle

2026-09-19 · Stage 02: packaging, public installation, and updates · Documentation revision: 7 · [Español](../es/06-preparacion-release-1.0.0-instalador.md) · [Index](../../README.md) · [Installation and update guide](00-installation-and-local-release-test.md)

This document details the engineering and workflow of **packaging, public distribution, and updates** for Forge614-Shell: **versioning conventions and product identity**, **pinned version display in the status bar**, the standalone package bundle builder (`scripts/release-bundle.mjs`), the public network installer (`scripts/install.sh`), the manual CLI updater (`forge614-shell update`), **version isolation under `~/.forge614/shell/`**, the **automatic bootstrap integration with Forge614 Engines under `~/.forge614/engines/`**, the **maintainer workflow for publishing GitHub Releases**, cryptographic integrity guarantees backed by **SHA-256 checksums**, and software quality verified by **133 automated tests across 35 files (597 assertions)**. For the end-user step-by-step guide on macOS/Linux, see [00 — Public release installation and updates](00-installation-and-local-release-test.md).

> [!NOTE]
> The automatic bootstrap integration with Forge614 Engines and the isolated PATH routing under `~/.forge614/shell/bin/` are built and verified in the codebase for **the next stable Shell release**, without altering the existing release published on GitHub Releases.

---

## 1. The Master Analogy: The Sealed Avionics Crate and Assembly Bay

Consider the delivery and installation of critical aerospace or military avionics equipment:
- **The Factory Crate (The Standalone Bundle):** High-precision flight computers are never shipped to airfield hangars as loose schematics, nor do they require maintenance engineers to have heavy factory manufacturing equipment (`node_modules` or development compilers). They are delivered sealed inside an airtight, pressurized container (`forge614-shell-<version>.tar.gz`), accompanied by a cryptographic security seal (`.sha256`). The crate contains only what is strictly necessary to run: the bundled runtime, package metadata, and required system extensions.
- **The Isolated Assembly Bay (`~/.forge614/shell/<version>/`):** The hangar installation script (`install.sh`) never blindly overwrites active flight instruments. It uncrates the package into an assembly bay reserved exclusively for that exact version. If preflight validation detects missing core files (`package.json` or `cli.js`), the procedure aborts immediately without touching the active aircraft.
- **The Master Command Switch (`~/.forge614/shell/bin/forge614-shell`):** Once the bay is verified, the installer repoints the main cockpit control link to the new module. Upgrading or rolling back versions consists simply of repointing this master switch.
- **The Internal Auxiliary Subsystem (`~/.forge614/engines/`):** Shell coordinates local AI engine detection by relying on Forge614 Engines (`v1.0.0`, `schemaVersion: 1`), an internal headless utility that resides in its own isolated bay (`~/.forge614/engines/bin/forge614-engines`) and is verified or installed automatically by Shell behind the scenes.
- **The Maintenance Test Bench (`FORGE614_HOME`):** When engineers need to test the installation workflow in an isolated sandbox before altering production systems, they direct the process to a temporary test bench without affecting standard user paths.
- **The Cockpit Instrument Badge (The Status Bar):** In the bottom-right corner of the cockpit instrument panel, the pilot has a permanent, fixed indicator (`v1.0.x`) that remains visible at all times, even when flight path telemetry or engine status fills the rest of the display.

---

## 2. Release Identity and Versioning Conventions

Forge614-Shell maintains a deliberate technical distinction between package metadata, user-facing UI labels, Git version tags, and GitHub Releases:

| Attribute | Convention | Scope and Purpose |
| :--- | :--- | :--- |
| **Package Version** | `<version>` (e.g. `1.0.2` / `1.0.4`) | Specified in `package.json` and parsed by Node.js / Bun runtimes (`metadata.version`). |
| **Visible UI Label** | `v<version>` (e.g. `v1.0.2` / `v1.0.4`) | Rendered on the far-right edge of the bottom status bar for clear human readability. |
| **Git Release Tag** | `<version>` (e.g. `1.0.2` / `1.0.4`) | Git tag convention strictly **without the `v` prefix** (strict SemVer in the repository). |
| **GitHub Release** | `Forge614 Shell v<version>` | Public web release record and downloadable asset page on GitHub linked to the numeric tag. |
| **Release Archive Name** | `forge614-shell-<version>.tar.gz` | Filename of the packaged standalone distribution archive. |
| **Publication Status** | **Public stable releases** | Numeric tags pushed to `origin`, published on GitHub Releases, and marked as `Latest` with their 3 assets. |

> [!IMPORTANT]
> **Label Alignment:** The terminal UI displays `v<version>` for visual clarity, while Git tags use `<version>` purely. This separation follows industry best practices where user interfaces stylize versions with a leading "v", while package managers and release tags adhere to pure numeric SemVer.

---

## 3. Status Bar Version Display (`ShellStatusBar`)

Forge614-Shell displays its version at the bottom edge of the terminal, integrated into the compact footer row below the chat (`status-bar.ts`):

```text
F614 · Claude Code · <model> · ~/project · main · 3 changes             v1.0.2
```

### Rendering Behavior and Priority:
1. **Right-Edge Pinning:** The version label is rendered in muted gray (`muted`), anchored to the far-right boundary of the status bar.
2. **Protective Truncation on Narrow Viewports:**
   - The left side aggregates Shell telemetry (`F614`), connected engine, model, context usage, home-relative project directory (`homeRelativePath`), Git branch, and pending changes.
   - When terminal width is constrained, `ShellStatusBar` computes the remaining space by subtracting the width of the version badge:
     `availableLeft = innerWidth - visibleWidth(release) - 1`
   - The left side is then truncated with ellipsis (`…`), **guaranteeing that the version badge is never clipped, hidden, or wrapped to a new line**.

---

## 4. Local Release Bundle (`bundle:release`)

The standalone release archive is generated using a decoupled build script:

```bash
bun run bundle:release
```

### Architecture of the Bundler (`scripts/release-bundle.mjs`):
1. **Metadata Ingestion:** Reads the version string directly from `package.json`.
2. **Runtime Compilation:** Runs `bun build src/cli.ts --target=node --outdir <staging>/dist`, producing an optimized, self-contained Node.js executable.
3. **Extension and Metadata Ingestion:**
   - Copies `package.json` into the staging root.
   - Copies the `extensions/` directory (required for the legacy Pi bridge and runtime extension hooks).
   - Grants executable permissions (`0o755`) to `dist/cli.js`.
4. **Archive Packaging:** Compresses the staging directory into a tarball using `tar -czf`:
   - `dist/release/forge614-shell-<version>.tar.gz`
5. **Cryptographic Integrity:** Computes the SHA-256 digest of the archive and generates a companion checksum file:
   - `dist/release/forge614-shell-<version>.tar.gz.sha256`
6. **Zero Repository Dependency:** The archive does not require cloning the git repository and completely excludes development `node_modules`. **No Forge614 Engines binaries are copied inside this archive.**
7. **Runtime Requirement:** Requires Node.js `>=22.19.0` on the target machine.

---

## 5. Public Distribution and Network Installation

### 5.1 One-Line Public Installation Command
Any user on macOS or Linux can install Forge614 Shell with a single terminal command:

```bash
curl -fsSL https://github.com/jotredev/forge614-shell/releases/latest/download/install.sh | bash
```

> [!IMPORTANT]
> **No Secondary Commands:** There is no separate command to install Forge614 Engines. Shell automates the entire Engines bootstrap and verification workflow.

### 5.2 Operating Modes of the Installer (`scripts/install.sh`):
1. **Default Mode (`--latest`):**
   - Queries `https://api.github.com/repos/jotredev/forge614-shell/releases/latest`.
   - Extracts the release version and browser download URLs for the archive (`.tar.gz`) and checksum (`.sha256`).
   - Downloads into a secure temporary staging directory.
   - Validates the SHA-256 checksum before extracting (`shasum -a 256 -c` or `sha256sum -c`).
   - If the version matches the currently active version, it reports: `Forge614 Shell v<version> is already active.` and exits cleanly.
2. **Local Archive Mode (`--archive <tarball>`):**
   - Used for development, CI testing, and offline environments.
   - Validates and installs directly from a specified local tarball.
3. **Uninstall Mode (`--uninstall`):**
   - Safely removes `~/.forge614/shell/` and cleans up the PATH export line in the user profile, leaving other products (such as Engines or Engram) untouched.

### 5.3 Filesystem Hierarchy (`~/.forge614/`)

```text
~/.forge614/
├─ shell/
│  ├─ bin/
│  │  └─ forge614-shell -> <FORGE614_HOME>/shell/<version>/dist/cli.js   # Active symlink (ONLY entry in PATH)
│  └─ <version>/                                                        # Isolated version directory
│     ├── dist/
│     │   └── cli.js                                                    # Bundled Node.js executable
│     ├── extensions/                                                   # Runtime extension hooks
│     └── package.json                                                  # Release metadata
└─ engines/
   └─ bin/
      └─ forge614-engines                                               # Internal Engines binary (NOT in PATH)
```

### 5.4 Automatic PATH Configuration

The installer configures the user environment completely automatically:
- Detects the active shell profile (`~/.zshrc` on `zsh`, `~/.bashrc` on `bash`, or `~/.profile` on others).
- Injects the PATH export targeting the isolated Shell binary directory idempotently (checking with `grep -Fqx`):
  ```bash
  # Forge614 Shell
  export PATH="$HOME/.forge614/shell/bin:$PATH"
  ```
- **Legacy PATH Migration:** If the profile contains the older general line `export PATH="$HOME/.forge614/bin:$PATH"`, the installer automatically strips it.
- **Engines Isolation:** The directory `~/.forge614/engines/bin` is **never added to PATH**. `forge614-engines` is an internal engine detector and is not intended for manual execution.

### 5.5 Automatic Bootstrap and Validation of Forge614 Engines

During installation or manual update with `forge614-shell update`, before activating Shell, the installer invokes `ensure_engines`:

1. **Checks Existing Binary:** Verifies if `~/.forge614/engines/bin/forge614-engines` exists and is executable.
2. **Validates Detection Contract:** Executes `"$engines_binary" detect` and verifies with Node.js that the JSON output satisfies:
   - `schemaVersion: 1`
   - `Array.isArray(report.agents)`
3. **Smart Reuse:** If compatible, outputs `Using compatible Forge614 Engines (schema v1).` and skips unnecessary downloads.
4. **Automated Fetch and Installation:** If missing or incompatible, downloads the official Engines installer from `FORGE614_ENGINES_INSTALLER_URL` (defaulting to `https://github.com/jotredev/forge614-engines/releases/latest/download/install.sh`) and runs `FORGE614_HOME="$forge_home" bash "$installer" --latest`.
5. **Atomic Failure Guarantee:** Re-checks compatibility after installation. If download, installation, or contract validation fails, the installer aborts with exit code `65`:
   - `Forge614 Engines installation failed; Forge614 Shell was not changed.`
   - `Installed Forge614 Engines is not compatible with Forge614 Shell; Forge614 Shell was not changed.`
   - **Shell is never activated:** Your existing Shell installation remains untouched, ensuring your system is never left in a broken intermediate state.

### 5.6 Lifecycle and Independent Native Host Workflow

Forge614 Shell provides the human visual interface for ecosystem setup and management, but daily programming does not require keeping it running:
- Users open Shell to run initial setup, configure integrations, or inspect ecosystem health.
- Once setup is complete, **the user may freely close Shell and work directly in their preferred native host**, such as ADE Orca, Claude Code, or OpenAI Codex.
- Managed integrations remain active across native clients without needing Shell running in the background.

### 5.7 Manual Updates via `forge614-shell update`

The CLI includes a dedicated native update command:

```bash
forge614-shell update
```

- **Safe execution:** Invokes the installer internally in `--latest` mode, validating both Shell assets and Engines compatibility.
- **Manual action:** Never updates in the background without explicit user invocation.
- **Rollback safety:** If network downloads, checksums, or Engines validation fail, the existing active version remains in place.
- **Up-to-date detection:** Reports if the current installation is already on the latest release.

---

## 6. Safety and Release Behavior

The installer (`scripts/install.sh`) includes defensive mechanisms to ensure resilient, atomic operations:

1. **Two-Stage Versioned Deployment:**
   - The archive is extracted into a temporary hidden staging directory: `$shell_root/.${version}.installing`.
   - If unpacking or preflight validation fails, the staging directory is purged without leaving orphaned files.
   - Once validated and Engines is verified, the directory is moved atomically to its destination: `$shell_root/$version`.
2. **Preflight Validation:**
   - Validates that Node.js is available and `>=22.19.0`.
   - Validates system utilities (`tar`, `curl`, `shasum` or `sha256sum`).
   - Validates that the uncompressed directory contains both `package.json` and `dist/cli.js`. If either is missing, it exits with error code `65` (*Invalid release archive*).
3. **Safe Symlink Update:**
   - Uses `ln -sfn "$target/dist/cli.js" "$shell_root/bin/forge614-shell"` to repoint the active executable link within `~/.forge614/shell/bin/`.
4. **Idempotent Shell Profile Injection:**
   - Prevents duplicate entries (`if ! grep -Fqx "$path_line" "$profile"`).
5. **Automated Integration Testing (`public-installer.test.ts` and `release-bundle.test.ts`):**
   - Verifies remote `/latest` resolution, checksum validation, clean installation, PATH migration, Engines reuse, and active version preservation on bad digests or broken Engines.

---

## 7. Explicitly Not Implemented Yet (Negative Scope)

To maintain absolute technical integrity, the following features are **explicitly NOT implemented**:

- **No Windows support:** There is no native `install.ps1` script for Windows PowerShell (macOS and Linux via bash only).
- **No custom domain or hosted installer on `forge614.dev`:** Binaries are not hosted on `forge614.dev`; distribution uses public GitHub Releases.
- **No public npm package:** Forge614-Shell is not published to npm (`npm install -g forge614-shell` does not exist).
- **No in-app `/update` slash command:** The chat composer does not support a self-updating slash command; updates run from terminal via `forge614-shell update`.
- **No unattended background auto-updates:** Shell never polls or installs updates in the background.
- **Engines is not added to PATH or executed directly:** `forge614-engines` is an internal dependency without a TUI; it is not a standalone user tool.
- **No obligation to keep Shell open:** Users are not required to run their daily programming sessions through Shell.

---

## 8. Maintainer Workflow: Publishing a Public Release

To publish a new public stable release on GitHub Releases, the repository maintainer must follow this 7-step procedure:

1. **Ensure Forge614 Engines is Published:**
   - `forge614-engines` must have a compatible stable release published (e.g. `v1.0.0` with `schemaVersion: 1`) before publishing a Shell release that depends on it.
   - Shell's installer consumes the official Engines installer over the network; **never copy Engines binaries into the Shell release bundle**.
2. **Update version in `package.json`:**
   Bump the `"version"` field (e.g. `"1.0.4"` or the next stable release).
3. **Run full verification suite:**
   ```bash
   bun run check
   ```
   Ensure strict typechecking, 133 automated tests, and bundle compilation pass with 0 errors.
4. **Generate standalone bundle and checksum:**
   ```bash
   bun run bundle:release
   ```
   Produces in `dist/release/`:
   - `forge614-shell-<version>.tar.gz`
   - `forge614-shell-<version>.tar.gz.sha256`
5. **Tag and push numeric tag to Git:**
   ```bash
   git tag <version>
   git push origin <version>
   ```
   *(The tag must be strictly numeric, e.g. `1.0.4`, without a `v` prefix).*
6. **Create the public GitHub Release and attach all three required Assets:**
   - Selected tag: `<version>`.
   - Release title: `Forge614 Shell v<version>`.
   - Attach all three required Assets:
     1. `forge614-shell-<version>.tar.gz`
     2. `forge614-shell-<version>.tar.gz.sha256`
     3. `scripts/install.sh`
7. **Mark as Latest ONLY if it is the public stable release:**
   - Check the **Set as the latest release** checkbox.
   - > [!WARNING]
     > The public installer (`curl .../releases/latest/download/install.sh | bash`) and `forge614-shell update` query `/releases/latest`. **A prerelease or experimental build must NEVER be marked as Latest**, as doing so would immediately route public installations to an unstable version.

---

## 9. Three-Tier Distribution Roadmap

The software delivery lifecycle of Forge614-Shell progresses across three distinct tiers:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ TIER 1 (COMPLETED): Local Bundling and Verification                                             │
│ • Standalone Node.js bundle (forge614-shell-<version>.tar.gz)                                   │
│ • Local archive installer (bash scripts/install.sh --archive)                                   │
│ • Filesystem layout validation (~/.forge614/shell/) and isolated integration tests              │
│ • Numeric Git tag pushed to origin                                                              │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 2 (CURRENT / NEXT STABLE RELEASE): Public GitHub Releases and Engines Bootstrap            │
│ • Public stable release published as Latest with title "Forge614 Shell v<version>"              │
│ • 3 mandatory assets (.tar.gz, .sha256, install.sh) linked to numeric tag                       │
│ • One-line public installer: curl -fsSL .../releases/latest/download/install.sh | bash         │
│ • Safe manual terminal updater: forge614-shell update                                           │
│ • Automatic bootstrap and verification of Forge614 Engines (schemaVersion: 1) in ~/.forge614/engines/│
│ • Isolated PATH configuration under ~/.forge614/shell/bin (Engines remains outside PATH)        │
│ • Handoff for direct native work in ADE Orca, Claude Code, or Codex after setup                 │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 3 (FUTURE): Custom Domain Infrastructure and Multiplatform Support                         │
│ • Custom domain endpoint (forge614.dev)                                                         │
│ • Multi-platform install scripts (macOS, Linux, and Windows PowerShell)                         │
│ • Extended environment hooks and runtime plugins                                                │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Verification and Quality Status

The release bundle, public network installer, Engines bootstrap, and manual CLI update workflows are verified by automated tests:

```bash
bun run check
# Runs: bun run typecheck && bun test && bun run build
```

### Verified Pipeline Metrics:
- **Automated Tests:** **133 tests passing across 35 files** (0 failures, 597 `expect()` assertions).
- **Engines Contract & No-Fallback Test:** `src/infrastructure/forge614-engines.test.ts` (schema v1 detect contract, exclusive Shell chat adapter mapping, immediate failure on unavailable or incompatible Engines without local fallback).
- **Public Installer & Engines Bootstrap Test:** `tests/integration/public-installer.test.ts` (remote `/latest` resolution, hash verification, Shell installation, Engines v1.0.0 bootstrap, compatible Engines reuse, and failure safety if hash or Engines is invalid).
- **Rollback Safety Integration Test:** `tests/integration/public-installer.test.ts` (verification of active executable preservation when checksum is invalid).
- **CLI Updater Unit Test:** `src/infrastructure/updater.test.ts` (invoking the installer in `--latest` mode).
- **Strict Typecheck:** `tsc --noEmit` passed with 0 errors.
- **Production Build:** `dist/cli.js` cleanly bundled.
