# 00 — Installation and local release test

2026-09-18 · Stage 02: collaborator guide for macOS and Linux · Revision: 4 · [Español](../es/00-instalacion-y-prueba-local-release.md) · [Index](../../README.md) · [Technical bundle details](06-release-1.0.0-bundle-installer.md)

This guide provides a comprehensive, step-by-step walkthrough for individuals **starting from zero with no technical or command-line background**. It details the definitive installation workflow of **Forge614 Shell** for authorized collaborators of a private repository on **macOS or Linux**, using release **`1.0.1`** (`Forge614 Shell v1.0.1`) as the active reference version.

---

## Requirements

Before starting, ensure you have the following ready:

- **macOS or Linux:** Compatible operating system (commands are identical on both platforms; macOS uses the standard Terminal app, and Linux uses any standard terminal emulator).
- **Terminal:** The built-in command-line application on your computer.
- **Bash:** The standard shell scripting interpreter present in macOS and Linux.
- **Compatible Node.js installed:** Requires Node.js version `>=22.19.0`.
- **GitHub account with accepted access to the private repository:** Your GitHub account must have received and accepted the invitation as a collaborator on the private Forge614 Shell repository.
- **Internet access:** To log in to GitHub and download the release package assets.
- **One or more AI CLIs installed and authenticated:** Depending on which AI engines you plan to use (e.g., Claude Code, OpenAI Codex, Google Gemini CLI, or Antigravity CLI).

---

## What collaborators cannot do yet

To prevent confusion and set precise expectations, keep in mind what is not currently available:

- **People without repository access cannot download or install:** Because the repository is private, uninvited users cannot access the code, release pages, or assets.
- **Windows is not supported yet:** There is no Windows PowerShell installer script (`install.ps1`). Support is currently limited to macOS and Linux using Bash.
- **No public installer exists:** There are no public web downloads or hosted endpoints on the `forge614.dev` domain.
- **No automatic updates exist:** The application does not poll or download updates in the background, and there is no in-app `/update` command.
- **No installation via npm or curl exists:** Commands like `npm install -g forge614-shell` and pipe commands like `curl -fsSL ... | bash` do not exist.

---

## Definitive Installation Workflow for Authorized Collaborators

Follow these 15 steps in exact sequential order. No prior coding experience is needed.

### Step 1: Accept the private repository invitation
Ensure your GitHub account has been invited as a collaborator to the private Forge614 Shell repository and that you have clicked **Accept invitation** from the email notification or your GitHub notification inbox.

### Step 2: Log in to GitHub
Open your preferred web browser (Safari, Chrome, Firefox, etc.) and log in to [github.com](https://github.com) using the account that was granted access.

### Step 3: Open the private repository and navigate to Releases
1. In your browser's address bar, navigate to the private repository URL:
   `https://github.com/<owner>/forge614-shell`
2. In the right-hand sidebar of the main repository page, click on **Releases** (or navigate directly to `/releases`).

### Step 4: Open the latest published release
Locate the most recent published release, titled:
```text
Forge614 Shell v1.0.1
```
*(Linked to the pure numeric Git tag `1.0.1`). Click on the title to open the release details page.*

### Step 5: Download exactly the three Assets
Scroll to the bottom of the release notes and expand the **Assets** section. Download exactly these **3 files** to your computer:

1. `forge614-shell-1.0.1.tar.gz`: The pre-bundled application archive.
2. `forge614-shell-1.0.1.tar.gz.sha256`: The cryptographic checksum file to verify download integrity.
3. `install.sh`: The automated installer script.

> [!NOTE]
> Save all three files directly into your standard **Downloads** folder (`~/Downloads`). Ignore the additional *Source code (zip)* and *Source code (tar.gz)* files; those contain raw development code that you do not need.

### Step 6: Open the Terminal application
- **On macOS:** Press **Command (⌘) + Spacebar** simultaneously to open Spotlight search. Type `Terminal` and press **Enter**. A command-line window will open.
- **On Linux:** Open the **Terminal** app from your system application launcher or press **Ctrl + Alt + T**.

### Step 7: Check that Node.js is installed
Forge614 Shell requires Node.js to execute. In your Terminal window, type or paste the following command and press **Enter**:

```bash
node --version
```

- **What does a correct response mean?**
  You will see text starting with a `v` followed by three numbers separated by periods, for example:
  `v22.19.0`, `v22.19.1`, or `v23.x`.
  If the reported number is `v22.19.0` or higher, your machine is ready to proceed.
- **What to do if `command not found` or an older version appears?**
  - If Terminal responds with `command not found`, Node.js is not installed on your system.
  - If it prints an older version (such as `v18.x` or `v20.x`), your version is out of date.
  - **Required Action:** Stop and install or update Node.js before continuing. Go to [nodejs.org](https://nodejs.org), download the official installer recommended for your operating system, and run it. Once installed, quit Terminal, open a fresh Terminal window, and run `node --version` again until a compatible version is reported.

### Step 8: Change directory into Downloads
In your Terminal window, run the following command and press **Enter**:

```bash
cd ~/Downloads
```

*(The `cd` command stands for "change directory", and `~/Downloads` points Terminal directly to your Downloads folder where the three downloaded files reside).*

### Step 9: List files to verify their presence
Run the following command and press **Enter**:

```bash
ls
```

Inspect the output list in Terminal. Visually verify that all three files are listed:
- `forge614-shell-1.0.1.tar.gz`
- `forge614-shell-1.0.1.tar.gz.sha256`
- `install.sh`

### Step 10: Verify the cryptographic integrity of the archive
Before installing, verify that the downloaded archive was downloaded completely without corruption or missing bytes. Run this command:

```bash
shasum -a 256 -c forge614-shell-1.0.1.tar.gz.sha256
```

- **Correct and expected result:**
  ```text
  forge614-shell-1.0.1.tar.gz: OK
  ```
- **What does this mean?** Your computer computed the mathematical fingerprint of the downloaded file and confirmed that it matches the official cryptographic hash generated by the development team.
- If it reports `FAILED` or shows an error, the download was interrupted. Delete the file from `~/Downloads`, download it again from the GitHub Releases page, and repeat the command.

### Step 11: Run the installer
Once cryptographic integrity is verified, run the installation script pointing to the archive:

```bash
bash install.sh --archive forge614-shell-1.0.1.tar.gz
```

Press **Enter**. The script will unpack the package and configure your profile, outputting:

```text
Installed Forge614 Shell v1.0.1
Configured /Users/<your-user>/.zshrc so forge614-shell is available in new Terminal windows.
Close and reopen Terminal, then run: forge614-shell
```

### Step 12: What the installer does automatically (and what you do NOT need to do)
The automated installer handles all system configuration behind the scenes:

- **Installs into `~/.forge614`:** It extracts the application into an isolated version directory (`~/.forge614/shell/1.0.1/`) and links the active binary into `~/.forge614/bin/forge614-shell`.
- **Automatically configures the `forge614-shell` command:** It detects your shell profile (`~/.zshrc` on macOS or `~/.bashrc` on Linux) and injects the `PATH` variable idempotently (never creating duplicates upon reinstalling).
- **Does NOT require Git:** You do not need Git installed on your computer.
- **Does NOT require GitHub CLI (`gh`):** You do not need command-line GitHub tools.
- **Does NOT require Bun:** The bundled release runs on standard Node.js without needing Bun.
- **Does NOT require cloning the repository:** You do not need to download development source code.
- **Does NOT require editing PATH or copying `export PATH=...`:** The installer configured your profile for you; you do not need to manually edit shell configuration files.

### Step 13: Close Terminal completely, open a new window, and verify
Existing terminal windows cannot automatically absorb environment changes applied by child scripts. Therefore:

1. **Quit the Terminal application completely** (on macOS press **Command + Q**; on Linux close the window).
2. **Open a fresh Terminal window.**
3. Verify that the command is available by running:

```bash
forge614-shell --version
```

- **Expected output:**
  ```text
  forge614-shell 1.0.1
  ```

### Step 14: Launch Forge614 Shell
To start the workspace, type in Terminal and press **Enter**:

```bash
forge614-shell
```

- An interactive menu will appear prompting you to choose the visual interface (select **Basic**) and your preferred AI engine.
- **Look at the far-right edge of the bottom status bar:** You will clearly see the version badge:
  ```text
  v1.0.1
  ```
- To exit the program at any time, type `/quit` and press **Enter**, or press **Control + C**.

### Step 15: Required pre-authentication of AI tools
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

## Automatic PATH Configuration (Zero Manual Steps)

Unlike traditional guides requiring manual shell configuration, Forge614 Shell **requires no manual PATH exports or profile editing**:

1. **Intelligent shell detection:**
   - On macOS, the installer detects `zsh` and automatically updates `~/.zshrc`.
   - On Linux, it detects `bash` and automatically updates `~/.bashrc`.
   - On other Unix-compatible environments, it updates `~/.profile`.
2. **Idempotent safeguard:**
   Before appending:
   ```bash
   # Forge614 Shell
   export PATH="$HOME/.forge614/bin:$PATH"
   ```
   The installer uses `grep` to check if the line already exists. If present, it skips adding it again, keeping your configuration file clean.
3. **Sole user action:**
   Simply quit Terminal completely and open a new window for the updated configuration to take effect.

---

## Troubleshooting Common Issues

### 1. `node: command not found` or version below `22.19.0`
- **Cause:** Node.js is not installed or an outdated version is present.
- **Solution:** Visit [nodejs.org](https://nodejs.org), download the official LTS or Current installer for your platform, and complete installation. Reopen Terminal before continuing.

### 2. `shasum: forge614-shell-1.0.1.tar.gz: FAILED`
- **Cause:** The archive was corrupted or only partially downloaded by the browser.
- **Solution:** Navigate to `~/Downloads`, delete `forge614-shell-1.0.1.tar.gz`, re-download it from GitHub Releases, and re-run `shasum -a 256 -c forge614-shell-1.0.1.tar.gz.sha256`.

### 3. `forge614-shell: command not found` after installing
- **Cause:** You are still using the same Terminal window where the installer was executed.
- **Solution:** Quit Terminal completely (**Command + Q** on macOS) and open a new window. Run `forge614-shell` again.

### 4. `Release archive not found: ...`
- **Cause:** Terminal is not located in the folder where the files were saved.
- **Solution:** Run `cd ~/Downloads` followed by `ls` to ensure you are in the correct directory containing the downloaded files.

### 5. `Permission denied` when running `install.sh`
- **Cause:** You attempted to run `./install.sh` directly without granting executable permissions.
- **Solution:** Always invoke the script with `bash`:
  ```bash
  bash install.sh --archive forge614-shell-1.0.1.tar.gz
  ```

### 6. Authentication errors when launching Claude Code or Codex
- **Cause:** You have not logged in to the underlying AI tool on your computer.
- **Solution:** Open a separate terminal window and run the provider's native login command (e.g. `claude login` for Claude Code). Once verified, return to Forge614 Shell.

---

## Filesystem Layout on Your Machine (`~/.forge614/`)

After installation, the application resides under your user home directory:

```text
~/.forge614/
├── bin/
│   └── forge614-shell -> ~/.forge614/shell/1.0.1/dist/cli.js   # Active symlink
└── shell/
    └── 1.0.1/                                                 # Isolated 1.0.1 release directory
        ├── dist/
        │   └── cli.js                                         # Pre-bundled Node.js entry point
        ├── extensions/                                        # Runtime extension hooks
        └── package.json                                       # Release 1.0.1 metadata
```

---

## Developer Local Packaging and Verification (Optional)

> [!NOTE]
> This section is **intended only for repository maintainers or developers** who cloned the full source repository and wish to bundle or test packages locally in a sandbox. Collaborators do not need to run these commands.

1. **Build the release bundle:**
   ```bash
   bun run bundle:release
   ```
   Produces `dist/release/forge614-shell-1.0.1.tar.gz` and companion `.sha256`.
2. **Test in an isolated sandbox (`~/.forge614-test`):**
   ```bash
   FORGE614_HOME="$HOME/.forge614-test" bash scripts/install.sh --archive "$PWD/dist/release/forge614-shell-1.0.1.tar.gz"
   ```
3. **Verify installed version:**
   ```bash
   ~/.forge614-test/bin/forge614-shell --version
   # Expected output: forge614-shell 1.0.1
   ```
4. **Clean up the sandbox:**
   ```bash
   rm -rf ~/.forge614-test
   ```

For detailed information on the packaging pipeline and the maintainer release publishing workflow on GitHub, see:
👉 [06 — Release 1.0.0 preparation and installer bundle](06-release-1.0.0-bundle-installer.md)
