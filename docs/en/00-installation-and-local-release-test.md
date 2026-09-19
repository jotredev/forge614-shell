# 00 — Public release installation and updates

2026-09-18 · Stage 02: public installation and updates on macOS and Linux · Revision: 5 · [Español](../es/00-instalacion-y-prueba-local-release.md) · [Index](../../README.md) · [Technical bundle details](06-release-1.0.0-bundle-installer.md)

This guide provides a comprehensive, step-by-step walkthrough for individuals **starting from zero with no technical or command-line background**. It details the definitive public installation and update workflow of **Forge614 Shell** on **macOS or Linux**, using release **`1.0.2`** (`Forge614 Shell v1.0.2`) as the active stable reference version.

The Forge614 Shell repository is public, and official software distribution is hosted directly on **GitHub Releases**.

---

## Requirements

Before starting, ensure your computer meets the following requirements:

- **macOS or Linux:** Compatible operating system (commands are identical on both platforms; macOS uses the standard Terminal app, and Linux uses any standard terminal emulator).
- **Terminal:** The built-in command-line application on your computer.
- **Bash:** The standard shell scripting interpreter present in macOS and Linux.
- **`curl`:** Standard network utility used to fetch the installer script.
- **`tar`:** Standard utility to extract the application archive.
- **`shasum` or `sha256sum`:** Cryptographic utility to verify the SHA-256 integrity of downloaded archives.
- **Compatible Node.js installed:** Requires Node.js version `>=22.19.0`.
- **Internet connection:** Required to connect to GitHub and download the release package assets.
- **One or more AI CLIs installed and authenticated:** Depending on which AI engines you plan to use (e.g., Claude Code, OpenAI Codex, Google Gemini CLI, or Antigravity CLI).

---

## What is not available yet

To maintain absolute technical integrity and set clear expectations, keep in mind what is explicitly not available:

- **Windows is not supported yet:** There is no Windows PowerShell installer script (`install.ps1`). Support is currently limited to macOS and Linux using Bash.
- **No custom domain or hosted installer on `forge614.dev`:** Binaries are not served from a custom web domain; distribution uses public GitHub Releases infrastructure directly.
- **No npm package:** Commands such as `npm install -g forge614-shell` do not exist.
- **No in-app `/update` command inside the chat:** Updates are not triggered via a slash command in the interactive chat; updating is handled from the shell via the CLI subcommand: `forge614-shell update`.
- **No automatic background updates:** Forge614 Shell never checks for, downloads, or installs updates in the background without your explicit action.
- **No private collaborator restrictions:** The repository and releases are public; anyone on macOS or Linux with compatible Node.js can install without needing collaborator invites.

---

## First Installation (One-Line Public Flow)

To install Forge614 Shell on your computer for the first time, the **only command** you need to run in your Terminal is:

```bash
curl -fsSL https://github.com/jotredev/forge614-shell/releases/latest/download/install.sh | bash
```

### What does this command do automatically?
The installer script automates the entire process cleanly behind the scenes:

1. **Queries GitHub Releases:** Connects to the public GitHub API to identify the latest stable release (`releases/latest`).
2. **Downloads the bundle and checksum:** Automatically downloads the packaged standalone archive (`forge614-shell-<version>.tar.gz`) and its companion digest file (`.sha256`).
3. **Verifies integrity with SHA-256:** Computes the mathematical digest of the downloaded file using `shasum` or `sha256sum` before unpacking. If the checksum does not match the official hash, it aborts immediately to protect your system.
4. **Installs into `~/.forge614`:** Unpacks the application into an isolated directory under your user folder (`~/.forge614/shell/<version>/`) and creates an active executable symlink in `~/.forge614/bin/forge614-shell`.
5. **Automatically configures the `forge614-shell` command:** Detects your active shell profile (`~/.zshrc` on macOS, `~/.bashrc` on Linux, or `~/.profile`) and appends the binary directory to your `PATH` idempotently (never duplicating lines on re-runs).
6. **Does NOT require editing `PATH` manually:** You do not need to run manual `export PATH=...` commands or edit configuration files by hand.
7. **Does NOT require development tools:** You do not need Git, GitHub CLI (`gh`), Bun, or npm installed, and you do not need to clone the repository source code.
8. **Does NOT require administrator permissions (`sudo`):** The installer runs entirely within your user space and will not prompt for system administrator passwords.

### Steps after completing installation

Once the command finishes and outputs `Installed Forge614 Shell v1.0.2`:

1. **Quit the Terminal application completely** (on macOS press **Command + Q**; on Linux close the terminal window).
2. **Open a fresh Terminal window.**
3. **Launch the application:**

```bash
forge614-shell
```

To confirm the installed version at any time, run:

```bash
forge614-shell --version
```

- **Expected output:**
  ```text
  forge614-shell 1.0.2
  ```

---

## Manual Updates (`forge614-shell update`)

When a new stable release is published on GitHub, you can upgrade your local installation simply by running this command in Terminal:

```bash
forge614-shell update
```

### Behavior of the update command:
- **Downloads and installs the latest stable release:** Queries the public GitHub Releases API, fetches the latest assets, verifies checksums, and updates the active symlink.
- **Deliberate manual action:** Updates never happen automatically in the background. You control when upgrades occur.
- **Rollback protection:** If the download is interrupted, the checksum verification fails, or the archive is invalid, **your existing active version remains intact and unaffected**. Your environment will never be left broken.
- **Up-to-date notification:** If you are already running the latest version, the system reports:
  ```text
  Forge614 Shell v1.0.2 is already active.
  ```
  and exits cleanly without downloading unnecessary files.
- **Session restart:** After updating, exit your current Forge614 Shell session (by typing `/quit`) and launch it again to run the updated release.

---

## Required Pre-Authentication of AI Tools

> [!IMPORTANT]
> **Forge614 Shell relies on your existing, local AI sessions:**
> Forge614 Shell is a unified cockpit and terminal workspace for AI programming, but **it does not include bundled AI accounts, subscriptions, or pre-configured API keys**.
>
> It connects exclusively to the AI CLIs and accounts that **you already have installed and authenticated locally on your computer**:
> - **For Claude Code:** You must have the official Claude Code CLI (`claude`) installed on your computer and be actively signed in (`claude login` or web browser OAuth) with an active Anthropic plan (Claude Pro or Claude Max).
> - **For OpenAI Codex:** You must have the Codex CLI installed and signed in to your ChatGPT / OpenAI account.
> - **For Google Gemini CLI / Antigravity CLI:** You must have completed the Google account authentication flow on your machine.
>
> If you select an AI engine whose CLI is not installed or whose login session has expired, Forge614 Shell will display a helpful message indicating that you must install or sign in to that tool before sending prompts.

---

## Error Handling and Diagnostic Help

The installer and updater provide clear diagnostics to assist with common issues:

### 1. Node.js missing or too old
- **Error message:**
  ```text
  Forge614 Shell requires Node.js 22.19 or newer.
  ```
  or `node: command not found`.
- **Cause:** Node.js is not installed or the installed version is older than required (e.g. v18 or v20).
- **Solution:** Visit [nodejs.org](https://nodejs.org), download the official LTS or Current installer for macOS or Linux, complete installation, restart Terminal, and re-run the installer.

### 2. No internet connection
- **Error message:**
  ```text
  Could not download Forge614 Shell release metadata.
  ```
- **Cause:** The machine cannot reach GitHub due to network disconnection or firewall/VPN issues.
- **Solution:** Check your internet connection and proxy settings, then try again.

### 3. Nonexistent public release or GitHub network issue
- **Error message:**
  ```text
  Could not download Forge614 Shell release metadata.
  ```
- **Cause:** GitHub API is unreachable or no stable release is marked as Latest.
- **Solution:** Verify in your browser that the public release page at `https://github.com/jotredev/forge614-shell/releases` is accessible.

### 4. Required assets missing from the release
- **Error message:**
  ```text
  Latest release is missing valid Forge614 Shell assets.
  ```
- **Cause:** The published GitHub Release does not contain all three required assets (`.tar.gz`, `.sha256`, and `install.sh`).
- **Solution:** The maintainer must ensure all three assets are attached to the release before users can install it.

### 5. Checksum verification failure
- **Error message:**
  ```text
  Forge614 Shell download checksum failed.
  ```
- **Cause:** The archive was corrupted or truncated during download.
- **Solution:** The installer aborts cleanly without altering your system. Re-run the command to perform a clean download.

### 6. Unsupported operating system
- **Error message:**
  ```text
  Forge614 Shell supports macOS and Linux only.
  ```
- **Cause:** Attempted execution on Windows or another unsupported platform.
- **Solution:** Use a machine running macOS or a supported Linux distribution.

### 7. `forge614-shell: command not found` after installing
- **Cause:** You are still typing in the same Terminal window where the installer ran, before the shell reloaded configuration.
- **Solution:** Quit Terminal completely (**Command + Q** on macOS) and open a fresh window. Run `forge614-shell` again.

---

## Filesystem Layout on Your Machine (`~/.forge614/`)

After installation, the application resides under your user home directory:

```text
~/.forge614/
├── bin/
│   └── forge614-shell -> ~/.forge614/shell/1.0.2/dist/cli.js   # Active symlink
└── shell/
    └── 1.0.2/                                                 # Isolated 1.0.2 release directory
        ├── dist/
        │   └── cli.js                                         # Pre-bundled Node.js entry point
        ├── extensions/                                        # Runtime extension hooks
        └── package.json                                       # Release metadata
```

When updating to a future version using `forge614-shell update`, a parallel folder is created (e.g. `shell/1.0.3/`) and the active symlink `bin/forge614-shell` is swapped atomically.

---

## Developer Local Packaging and Verification (Optional)

> [!NOTE]
> This section is **intended only for repository maintainers or developers** who cloned the full source repository and wish to bundle or test packages locally in a sandbox. End users do not need to run these commands.

1. **Build the release bundle locally:**
   ```bash
   bun run bundle:release
   ```
   Produces `dist/release/forge614-shell-1.0.2.tar.gz` and `dist/release/forge614-shell-1.0.2.tar.gz.sha256`.
2. **Test archive-based installation in an isolated sandbox:**
   ```bash
   FORGE614_HOME="$HOME/.forge614-test" bash scripts/install.sh --archive "$PWD/dist/release/forge614-shell-1.0.2.tar.gz"
   ```
3. **Verify installed version:**
   ```bash
   ~/.forge614-test/bin/forge614-shell --version
   # Expected output: forge614-shell 1.0.2
   ```
4. **Clean up the sandbox:**
   ```bash
   rm -rf ~/.forge614-test
   ```

For detailed information on the packaging pipeline and the maintainer release publishing workflow, see:
👉 [06 — Release preparation and installer bundle](06-release-1.0.0-bundle-installer.md)
