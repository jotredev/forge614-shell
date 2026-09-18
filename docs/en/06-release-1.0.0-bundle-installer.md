# 06 — Release 1.0.0 preparation and installer bundle

2026-09-18 · Stage 02: packaging and local installation · Documentation revision: 2 · [Español](../es/06-preparacion-release-1.0.0-instalador.md) · [Index](../../README.md) · [Practical installation guide](00-installation-and-local-release-test.md)

This document details the preparation of the **Forge614-Shell 1.0.0 local release**: the **versioning conventions and product identity**, the **pinned version display in the status bar (`v1.0.0`)**, the standalone package bundle builder (`scripts/release-bundle.mjs`), the filesystem-based local installer (`scripts/install.sh`), **isolated installation under `~/.forge614/`**, the **maintainer workflow for creating a private GitHub Release**, integrity guarantees backed by **SHA-256 checksums**, and software quality verified by **124 automated tests across 32 files**. For the beginner-friendly step-by-step installation guide on macOS, see [00 — Installation and local release test](00-installation-and-local-release-test.md).

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

Forge614-Shell maintains a deliberate technical distinction between package metadata, user-facing UI labels, Git version tags, and GitHub Releases:

| Attribute | Value | Scope and Purpose |
| :--- | :--- | :--- |
| **Package Version** | `1.0.0` | Specified in `package.json` and parsed by Node.js / Bun runtimes (`metadata.version`). |
| **Visible UI Label** | `v1.0.0` | Rendered on the far-right edge of the bottom status bar for clear human readability. |
| **Git Release Tag** | `1.0.0` | Git tag convention strictly **without the `v` prefix** (strict SemVer in the repository). |
| **GitHub Release** | `Forge614 Shell v1.0.0` | Private web release record and downloadable asset page on GitHub linked to numeric tag `1.0.0`. |
| **Release Archive Name** | `forge614-shell-1.0.0.tar.gz` | Filename of the packaged standalone distribution archive. |
| **Publication Status** | **Tag pushed; Private web release documented** | The `1.0.0` source tag is pushed to the private `origin` repository. The maintainer workflow to publish the private GitHub Release with its 3 assets is documented in Section 8; publication on the GitHub web UI is pending manual execution by the maintainer. |

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
- **No unattended remote GitHub Release download flow:** There is no background download daemon or automated download client; the web-based workflow for private collaborators is documented in Section 8 and requires manual publication by the maintainer.
- **No `curl | bash` endpoint:** There is no remote pipe installer such as `curl -fsSL https://... | bash`.
- **No hosted `forge614.dev` installer:** The `forge614.dev` domain does not host installer scripts or binary assets.
- **No automatic background updates:** Shell does not poll or download updates in the background.
- **No in-app `/update` command:** The composer does not have a slash command for self-updating.
- **No Windows PowerShell installer:** There is no native `install.ps1` script for Windows.
- **No remote release channels:** There are no remote *stable*, *beta*, or *nightly* update channels.
- **No published GitHub Release assets yet:** The `1.0.0` source tag exists in the private `origin` repository, but no maintainer has published the web release page with its 3 attached assets in the GitHub interface yet.
- **No registry publication:** The package is not published to npm or another commercial package registry.

---

# Creating a private GitHub Release

## 8. Maintainer Workflow: Creating a Private GitHub Release

> [!NOTE]
> **Maintainer-Only Workflow:**
> This section documents the manual steps required by a repository administrator in the GitHub web interface to create a private Release and attach downloadable installation packages. End users and testers do not execute these steps.

### 8.1 Critical Distinction: Git Tag vs. GitHub Release

It is vital to understand the technical boundary between a Git tag and a GitHub Release:

1. **The Git Tag (`1.0.0`):** An immutable reference in Git history pointing to an exact source commit. Pushing a tag to origin (`git push origin 1.0.0`) registers the tag on the Git remote server, **but does NOT automatically create a GitHub Release page or attach downloadable assets**.
2. **The GitHub Release (`Forge614 Shell v1.0.0`):** A distinct web record on GitHub associated with an existing Git tag. It provides release notes and a downloadable files section (*Assets*). It must be manually drafted and published by a repository maintainer.
3. **Naming Convention:** The Git tag strictly uses numeric SemVer `1.0.0` (without a `v` prefix), whereas the visible GitHub Release title uses the human-oriented product brand `Forge614 Shell v1.0.0` (with the `v` prefix).
4. **Meaning of "Stable":** In this private environment, "stable" denotes a **maintainer-approved normal release** (the *Set as a pre-release* checkbox is left unchecked) intended for internal testing by authorized collaborators. It **does not** imply an automated background update channel or in-app `/update` command.

### 8.2 Terminology and Naming Conventions Table

| Term | Example | Scope and Technical Meaning |
| :--- | :--- | :--- |
| **Package version** | `1.0.0` | Internal product version declared in `package.json` (`metadata.version`). |
| **UI label** | `v1.0.0` | Visual label pinned to the far right of the bottom status bar (`ShellStatusBar`). |
| **Git Tag** | `1.0.0` | Immutable source-code commit identifier in Git (strictly numeric, without `v`). |
| **GitHub Release** | `Forge614 Shell v1.0.0` | Private web release record and downloadable asset page on GitHub. |
| **Stable release** | Normal published release (not marked as pre-release) | Maintainer-approved release for internal collaborator testing; does not imply an automated update channel or `/update` command. |

### 8.3 Step-by-Step GitHub Web Interface Workflow

To create and publish the private GitHub Release from the pushed `1.0.0` tag:

1. **Open the private repository on GitHub in a browser:** Navigate to `https://github.com/<owner>/forge614-shell` while logged into an account with maintainer/admin permissions.
2. **Navigate to the Releases page:** Click on **Releases** in the right-hand sidebar of the code repository view (or navigate to `/releases`).
3. **Initiate release creation:** Click **Create a new release** (or **Draft a new release** if no prior release exists).
4. **Select the existing tag (`Choose a tag`):**
   - Click the **Choose a tag** dropdown menu.
   - Select the existing tag **`1.0.0`**.
   - ⚠️ **Strict Rule:** Do NOT type or generate a new tag in this box. **Never create a tag named `v1.0.0`**. The numeric tag `1.0.0` is already pushed and must be chosen directly from the list.
5. **Set the Release title:** Enter the exact title:
   ```text
   Forge614 Shell v1.0.0
   ```
6. **Add the release notes:** In the main description box (*Describe this release*), paste this exact markdown text:
   ```markdown
   Initial private testing release for Forge614 Shell.

   macOS and Linux local/archive installation only.
   Requires Node.js 22.19.0 or newer.

   Windows installer and public distribution are not available yet.
   ```
7. **Attach the three release assets:**
   Drag and drop (or browse to upload) exactly the following **3 files**:
   - `dist/release/forge614-shell-1.0.0.tar.gz`: The installable standalone archive bundle.
   - `dist/release/forge614-shell-1.0.0.tar.gz.sha256`: Cryptographic checksum file for integrity verification.
   - `scripts/install.sh`: The macOS/Linux installation script.
8. **Technical justification for each attached file:**
   - `forge614-shell-1.0.0.tar.gz`: The self-contained, pre-bundled Node.js runtime archive. Allows collaborators to install and run Forge614 Shell without cloning the Git repository or needing development dependencies (`node_modules`, Bun).
   - `forge614-shell-1.0.0.tar.gz.sha256`: Cryptographic checksum file containing the SHA-256 digest. Guarantees that the downloaded archive is authentic and has not been corrupted or tampered with in transit.
   - `install.sh`: The helper installation script for macOS and Linux that handles safe extraction into `~/.forge614/shell/1.0.0/` and atomically configures the executable symlink `~/.forge614/bin/forge614-shell`.
9. **Release settings:**
   - **Do NOT check `Set as a pre-release`**. Leave it unchecked so it is published as a standard, stable release for private testers.
   - Leave `Set as the latest release` checked if prompted.
10. **Publish the release:** Click the green **Publish release** button.

> [!WARNING]
> **Private Repository Access:**
> Because this repository is private, **only users explicitly invited as collaborators** or granted access within the GitHub organization can view the release or download its attached assets. Publishing a release on a private repository **does NOT make the repository, code, or assets public**.

### 8.4 After Publishing Checklist

After clicking **Publish release**, verify the following points:

1. **Release record confirmation:** Verify that the release appears on the Releases page with the title `Forge614 Shell v1.0.0` linked to tag `1.0.0`.
2. **Asset availability:** Expand the *Assets* section and ensure all three files are listed with valid download links and file sizes:
   - `forge614-shell-1.0.0.tar.gz`
   - `forge614-shell-1.0.0.tar.gz.sha256`
   - `install.sh`
   *(Along with the automatic source code zip and tarball generated by GitHub).*
3. **Download and installation test:** Using an authorized secondary test account with read access, download the 3 assets and verify installation:
   ```bash
   bash install.sh --archive forge614-shell-1.0.0.tar.gz
   ```
4. **Documentation integrity:** Update documentation status only after the release is physically published on GitHub. Do not claim the release is live before the maintainer completes these steps.

---

## 9. Three-Tier Distribution Roadmap

The software delivery lifecycle of Forge614-Shell progresses across three distinct tiers:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ TIER 1 (COMPLETED): Local Bundling and Verification                                             │
│ • Standalone Node.js bundle (forge614-shell-1.0.0.tar.gz)                                      │
│ • Local archive installer (bash scripts/install.sh --archive)                                   │
│ • Filesystem layout validation (~/.forge614/) and isolated integration tests                    │
│ • Pure numeric Git tag (1.0.0) pushed to origin                                                 │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 2 (IN PROGRESS): Private GitHub Releases Distribution                                      │
│ • Documented maintainer web workflow with title "Forge614 Shell v1.0.0"                         │
│ • Manual publication of 3 assets (.tar.gz, .sha256, install.sh) attached to tag 1.0.0           │
│ • Authenticated downloads for invited collaborators on private repository                       │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 3 (FUTURE): Public Hosted Infrastructure and In-App Updates                                │
│ • Quick-install hosted endpoint (forge614.dev)                                                  │
│ • Multi-platform install scripts (macOS, Linux, and Windows PowerShell)                         │
│ • In-app (/update) command with cryptographic checksum verification and zero-downtime swaps     │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Verification and Quality Status

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
