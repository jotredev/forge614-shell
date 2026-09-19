# 06 — Release preparation and public installer bundle

2026-09-18 · Stage 02: packaging, public installation, and updates · Documentation revision: 5 · [Español](../es/06-preparacion-release-1.0.0-instalador.md) · [Index](../../README.md) · [Installation and update guide](00-installation-and-local-release-test.md)

This document details the engineering and workflow of **packaging, public distribution, and updates** for Forge614-Shell: **versioning conventions and product identity**, **pinned version display in the status bar (`v1.0.2`)**, the standalone package bundle builder (`scripts/release-bundle.mjs`), the public network installer (`scripts/install.sh`), the manual CLI updater (`forge614-shell update`), **version isolation under `~/.forge614/`**, the **maintainer workflow for publishing GitHub Releases**, cryptographic integrity guarantees backed by **SHA-256 checksums**, and software quality verified by **128 automated tests across 34 files (583 assertions)**. For the end-user step-by-step guide on macOS/Linux, see [00 — Public release installation and updates](00-installation-and-local-release-test.md).

---

## 1. The Master Analogy: The Sealed Avionics Crate and Assembly Bay

Consider the delivery and installation of critical aerospace or military avionics equipment:
- **The Factory Crate (The Standalone Bundle):** High-precision flight computers are never shipped to airfield hangars as loose schematics, nor do they require maintenance engineers to have heavy factory manufacturing equipment (`node_modules` or development compilers). They are delivered sealed inside an airtight, pressurized container (`forge614-shell-1.0.2.tar.gz`), accompanied by a cryptographic security seal (`.sha256`). The crate contains only what is strictly necessary to run: the bundled runtime, package metadata, and required system extensions.
- **The Isolated Assembly Bay (`~/.forge614/shell/1.0.2/`):** The hangar installation script (`install.sh`) never blindly overwrites active flight instruments. It uncrates the package into an assembly bay reserved exclusively for that exact version. If preflight validation detects missing core files (`package.json` or `cli.js`), the procedure aborts immediately without touching the active aircraft.
- **The Master Command Switch (`~/.forge614/bin/forge614-shell`):** Once the bay is verified, the installer repoints the main cockpit control link to the new module. Upgrading or rolling back versions consists simply of repointing this master switch.
- **The Maintenance Test Bench (`FORGE614_HOME`):** When engineers need to test the installation workflow in an isolated sandbox before altering production systems, they direct the process to a temporary test bench without affecting standard user paths.
- **The Cockpit Instrument Badge (The Status Bar):** In the bottom-right corner of the cockpit instrument panel, the pilot has a permanent, fixed indicator (`v1.0.2`) that remains visible at all times, even when flight path telemetry or engine status fills the rest of the display.

---

## 2. Release Identity and Versioning Conventions

Forge614-Shell maintains a deliberate technical distinction between package metadata, user-facing UI labels, Git version tags, and GitHub Releases:

| Attribute | Reference Value | Scope and Purpose |
| :--- | :--- | :--- |
| **Package Version** | `1.0.2` | Specified in `package.json` and parsed by Node.js / Bun runtimes (`metadata.version`). |
| **Visible UI Label** | `v1.0.2` | Rendered on the far-right edge of the bottom status bar for clear human readability. |
| **Git Release Tag** | `1.0.2` | Git tag convention strictly **without the `v` prefix** (strict SemVer in the repository). |
| **GitHub Release** | `Forge614 Shell v1.0.2` | Public web release record and downloadable asset page on GitHub linked to numeric tag `1.0.2`. |
| **Release Archive Name** | `forge614-shell-1.0.2.tar.gz` | Filename of the packaged standalone distribution archive. |
| **Publication Status** | **Public stable release (`Forge614 Shell v1.0.2`)** | Tag `1.0.2` pushed to `origin`, published on GitHub Releases, and marked as `Latest` with its 3 assets. |

> [!IMPORTANT]
> **Label Alignment:** The terminal UI displays `v1.0.2` for visual clarity, while Git tags use `1.0.2`. This separation follows industry best practices where user interfaces stylize versions with a leading "v", while package managers and release tags adhere to pure numeric SemVer.

---

## 3. Status Bar Version Display (`ShellStatusBar`)

Forge614-Shell displays its version at the bottom edge of the terminal, integrated into the compact footer row below the chat (`status-bar.ts`):

```text
F614 · Claude Code · <model> · ~/project · main · 3 changes             v1.0.2
```

### Rendering Behavior and Priority:
1. **Right-Edge Pinning:** The label `v1.0.2` is rendered in muted gray (`muted`), anchored to the far-right boundary of the status bar.
2. **Protective Truncation on Narrow Viewports:**
   - The left side aggregates Shell telemetry (`F614`), connected engine, model, context usage, home-relative project directory (`homeRelativePath`), Git branch, and pending changes.
   - When terminal width is constrained, `ShellStatusBar` computes the remaining space by subtracting the width of the version badge:
     `availableLeft = innerWidth - visibleWidth(release) - 1`
   - The left side is then truncated with ellipsis (`…`), **guaranteeing that the `v1.0.2` badge is never clipped, hidden, or wrapped to a new line**.

---

## 4. Local Release Bundle (`bundle:release`)

The standalone release archive is generated using a decoupled build script:

```bash
bun run bundle:release
```

### Architecture of the Bundler (`scripts/release-bundle.mjs`):
1. **Metadata Ingestion:** Reads the version string (`1.0.2`) directly from `package.json`.
2. **Runtime Compilation:** Runs `bun build src/cli.ts --target=node --outdir <staging>/dist`, producing an optimized, self-contained Node.js executable.
3. **Extension and Metadata Ingestion:**
   - Copies `package.json` into the staging root.
   - Copies the `extensions/` directory (required for the legacy Pi bridge and runtime extension hooks).
   - Grants executable permissions (`0o755`) to `dist/cli.js`.
4. **Archive Packaging:** Compresses the staging directory into a tarball using `tar -czf`:
   - `dist/release/forge614-shell-1.0.2.tar.gz`
5. **Cryptographic Integrity:** Computes the SHA-256 digest of the archive and generates a companion checksum file:
   - `dist/release/forge614-shell-1.0.2.tar.gz.sha256`
6. **Zero Repository Dependency:** The archive does not require cloning the git repository and completely excludes development `node_modules`.
7. **Runtime Requirement:** Requires Node.js `>=22.19.0` on the target machine.

---

## 5. Public Distribution and Network Installation

### 5.1 One-Line Public Installation Command
Any user on macOS or Linux can install Forge614 Shell with a single terminal command:

```bash
curl -fsSL https://github.com/jotredev/forge614-shell/releases/latest/download/install.sh | bash
```

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

### 5.3 Filesystem Hierarchy (`~/.forge614/`)

```text
~/.forge614/
├── bin/
│   └── forge614-shell -> <FORGE614_HOME>/shell/1.0.2/dist/cli.js   # Active symlink
└── shell/
    └── 1.0.2/                                                     # Isolated version directory
        ├── dist/
        │   └── cli.js                                             # Bundled Node.js executable
        ├── extensions/                                            # Runtime extension hooks
        └── package.json                                           # Release metadata
```

### 5.4 Automatic PATH Configuration

The installer configures the user environment completely automatically:
- Detects the active shell profile (`~/.zshrc` on `zsh`, `~/.bashrc` on `bash`, or `~/.profile` on others).
- Injects the PATH export idempotently (checking with `grep -Fqx`):
  ```bash
  # Forge614 Shell
  export PATH="$HOME/.forge614/bin:$PATH"
  ```
- **Zero manual steps:** Users never need to manually run `export PATH=...` or edit shell profile files.

### 5.5 Manual Updates via `forge614-shell update`

The CLI includes a dedicated native update command:

```bash
forge614-shell update
```

- **Safe execution:** Invokes the installer internally in `--latest` mode.
- **Manual action:** Never updates in the background without explicit user invocation.
- **Rollback safety:** If network downloads, checksums, or validation fail, the existing active version remains in place.
- **Up-to-date detection:** Reports if the current installation is already on the latest release.

---

## 6. Safety and Release Behavior

The installer (`scripts/install.sh`) includes defensive mechanisms to ensure resilient, atomic operations:

1. **Two-Stage Versioned Deployment:**
   - The archive is extracted into a temporary hidden staging directory: `$shell_root/.${version}.installing`.
   - If unpacking or preflight validation fails, the staging directory is purged without leaving orphaned files.
   - Once validated, the directory is moved atomically to its destination: `$shell_root/$version`.
2. **Preflight Validation:**
   - Validates that Node.js is available and `>=22.19.0`.
   - Validates system utilities (`tar`, `curl`, `shasum` or `sha256sum`).
   - Validates that the uncompressed directory contains both `package.json` and `dist/cli.js`. If either is missing, it exits with error code `65` (*Invalid release archive*).
3. **Safe Symlink Update:**
   - Uses `ln -sfn "$target/dist/cli.js" "$forge_home/bin/forge614-shell"` to repoint the active executable link to the installed version.
4. **Idempotent Shell Profile Injection:**
   - Prevents duplicate entries (`if ! grep -Fqx "$path_line" "$profile"`).
5. **Automated Integration Testing (`public-installer.test.ts` and `release-bundle.test.ts`):**
   - Built-in test HTTP server that verifies remote `/latest` resolution, checksum validation, clean installation, and active version preservation on bad digests.

---

## 7. Explicitly Not Implemented Yet (Negative Scope)

To maintain absolute technical integrity, the following features are **explicitly NOT implemented**:

- **No Windows support:** There is no native `install.ps1` script for Windows PowerShell (macOS and Linux via bash only).
- **No custom domain or hosted installer on `forge614.dev`:** Binaries are not hosted on `forge614.dev`; distribution uses public GitHub Releases.
- **No public npm package:** Forge614-Shell is not published to npm (`npm install -g forge614-shell` does not exist).
- **No in-app `/update` slash command:** The chat composer does not support a self-updating slash command; updates run from terminal via `forge614-shell update`.
- **No unattended background auto-updates:** Shell never polls or installs updates in the background.
- **No private collaborator restrictions:** Releases are public and open to anyone on supported platforms.

---

## 8. Maintainer Workflow: Publishing a Public Release

To publish a new public stable release on GitHub Releases, the repository maintainer must follow this 7-step procedure:

1. **Update version in `package.json`:**
   Bump the `"version"` field (e.g. `"1.0.2"`).
2. **Run full verification suite:**
   ```bash
   bun run check
   ```
   Ensure strict typechecking, 128 automated tests, and bundle compilation pass with 0 errors.
3. **Generate standalone bundle and checksum:**
   ```bash
   bun run bundle:release
   ```
   Produces in `dist/release/`:
   - `forge614-shell-<version>.tar.gz`
   - `forge614-shell-<version>.tar.gz.sha256`
4. **Tag and push numeric tag to Git:**
   ```bash
   git tag <version>
   git push origin <version>
   ```
   *(The tag must be strictly numeric, e.g. `1.0.2`, without a `v` prefix).*
5. **Create the public GitHub Release:**
   - Selected tag: `<version>` (e.g. `1.0.2`).
   - Release title: `Forge614 Shell v<version>` (e.g. `Forge614 Shell v1.0.2`).
   - Release notes: Summarize changes and reiterate Node.js `>=22.19.0` requirement.
6. **Attach all three required Assets:**
   - `forge614-shell-<version>.tar.gz`
   - `forge614-shell-<version>.tar.gz.sha256`
   - `scripts/install.sh`
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
│ • Standalone Node.js bundle (forge614-shell-<version>.tar.gz)                                     │
│ • Local archive installer (bash scripts/install.sh --archive)                              │
│ • Filesystem layout validation (~/.forge614/) and isolated integration tests                    │
│ • Numeric Git tag (1.0.0, 1.0.1, 1.0.2) pushed to origin                                        │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 2 (COMPLETED): Public GitHub Releases Distribution and Manual CLI Updates                  │
│ • Public stable release published as Latest with title "Forge614 Shell v1.0.2"                  │
│ • 3 mandatory assets (.tar.gz, .sha256, install.sh) linked to numeric tag                       │
│ • One-line public installer: curl -fsSL .../releases/latest/download/install.sh | bash         │
│ • Safe manual terminal updater: forge614-shell update                                           │
│ • Mandatory SHA-256 verification before extraction with rollback protection                      │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 3 (FUTURE): Custom Domain Infrastructure and Multiplatform Support                         │
│ • Custom domain endpoint (forge614.dev)                                                         │
│ • Multi-platform install scripts (macOS, Linux, and Windows PowerShell)                         │
│ • Extended environment hooks and runtime plugins                                                │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Verification and Quality Status

The release bundle, public network installer, and manual CLI update workflows are verified by automated tests:

```bash
bun run check
# Runs: bun run typecheck && bun test && bun run build
```

### Verified Pipeline Metrics:
- **Automated Tests:** **128 tests passing across 34 files** (0 failures, 583 `expect()` assertions).
- **Public Installer Integration Test:** `tests/integration/public-installer.test.ts` (simulated GitHub Releases server, `/latest` resolution, hash verification, and clean installation).
- **Rollback Safety Integration Test:** `tests/integration/public-installer.test.ts` (verification of active executable preservation when checksum is invalid).
- **CLI Updater Unit Test:** `src/infrastructure/updater.test.ts` (invoking the installer in `--latest` mode).
- **Strict Typecheck:** `tsc --noEmit` passed with 0 errors.
- **Production Build:** `dist/cli.js` cleanly bundled (150.77 KB).
