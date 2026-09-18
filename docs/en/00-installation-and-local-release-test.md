# 00 — Installation and local release test

2026-09-18 · Stage 02: step-by-step beginner guide for macOS and Linux · [Español](../es/00-instalacion-y-prueba-local-release.md) · [Index](../../README.md) · [Technical bundle details](06-release-1.0.0-bundle-installer.md)

This guide walks you through, step by step from scratch on **macOS or Linux**, how to build the Forge614 Shell release archive and test its installer inside an isolated folder on your computer—no prior experience with terminals, Git repositories, or environment variables required. The commands are the same on both systems; macOS opening instructions use Spotlight, while Linux users open their usual Terminal application.

> [!IMPORTANT]
> **Scope notice:** This guide documents **only the local test** of the installer on your own machine. **It is NOT yet the installation flow for external users and NOT yet a public download flow.** There are currently no public download links or remote installation commands.

---

## 1. What this guide is for

When a developer builds software, the program typically runs directly inside the project folder where the source code was written. However, an end user should not need to download the developer's source code folder just to run the program.

This guide verifies one essential question: **can Forge614 Shell be installed and launched outside its project folder as a standalone application, without relying on the source repository?**

To perform this test:
- **Do not open Orca or Forge614 Shell first.**
- **First open the standard macOS Terminal application.**

---

## 2. What is and is not being tested

To prevent confusion, we strictly distinguish three stages of distribution:

1. **Current local installer test (What we are doing today):** We build a standalone archive on your machine and confirm that the installer script unpacks it, automatically configures your shell profile, and prepares it for execution in an isolated test folder. **This is our base technical verification.**
2. **Private collaborator installation through GitHub Releases:** Team members invited as collaborators to the private repository can download the package (`.tar.gz`), its checksum (`.sha256`), and the installer (`install.sh`) directly from GitHub Release Assets, without needing the source repository, Git, GitHub CLI, or Bun installed.
3. **Public installation through a hosted installer (In the future):** Anyone will be able to install the program with a single terminal command from the internet or via a website (`forge614.dev`). *(Not yet available).*

### What is explicitly NOT available yet:
- No remote `curl ... | bash` installation command.
- No hosted installer on `forge614.dev`.
- No in-app `/update` command inside the chat composer.
- No public npm package (`npm install -g forge614-shell` does not exist).
- No Windows PowerShell installer (`install.ps1`). Windows is explicitly not supported yet.
- No automatic background update mechanisms.

---

## 3. Before starting

### 3.1 Opening macOS Terminal using Spotlight
1. On your Mac keyboard, press **Command (⌘)** and the **Spacebar** simultaneously. The Spotlight search bar will appear in the center of your screen.
2. Type: `Terminal`
3. Press **Enter**. A window will open with a blinking cursor: this is your command line.

### 3.2 What a command is and how to run it
A **command** is a line of text that instructs your computer to perform an action.
- To use the commands in this guide: highlight the text in each gray code block, copy it (**Command + C**), click on the Terminal window, and paste it (**Command + V**).
- **Run one command at a time.**
- After pasting each command, press **Enter** to execute it.

### 3.3 Verifying required tools
Before packaging, we need to make sure your Mac has **Node.js** and **Bun** installed:

Run the first command:
```bash
node --version
```

Run the second command:
```bash
bun --version
```

- **Node.js version check:** You should see a version string starting with `v22.19.0` or newer (for instance, `v22.19.1` or `v23.x`). If your version is older, stop here and update Node.js before continuing: the installed application requires that version even though the current installer checks only that `node` exists.
- **If you see `"command not found"`:**
  - If Node.js is missing: download and install it from the official website: [nodejs.org](https://nodejs.org).
  - If Bun is missing: follow the official instructions on their website: [bun.sh](https://bun.sh).

---

## 4. Create the release archive

To test the installer, we first build the standalone archive for version `1.0.0`.

1. Navigate to the project folder. If your repository is located on your Desktop, run:
```bash
cd ~/Desktop/forge614-shell
```
*(If your repository is stored in another location, replace `~/Desktop/forge614-shell` with your actual directory path).*

2. Generate the release archive:
```bash
bun run bundle:release
```

### What just happened?
- The build script bundled the application into an optimized standalone executable and created a directory named `dist/release/` inside the project.
- Inside that directory, you will find two files:
  - `forge614-shell-1.0.0.tar.gz`: The package containing the compiled program, metadata, and runtime extensions. It excludes the heavy development `node_modules` directory, but the target machine still needs Node.js. This is the exact archive that will eventually be distributed to users.
  - `forge614-shell-1.0.0.tar.gz.sha256`: A SHA-256 checksum for detecting accidental corruption of the archive after download.

---

## 5. Safe isolated installation test

Now we will test installing Forge614 Shell into an isolated test folder (`.forge614-test`) inside your user home directory. This ensures nothing in your system is modified.

Run this exact command (all on a single line):

```bash
FORGE614_HOME="$HOME/.forge614-test" bash scripts/install.sh --archive "$PWD/dist/release/forge614-shell-1.0.0.tar.gz"
```

### Explaining every part of the command:
- `FORGE614_HOME="$HOME/.forge614-test"`: Instructs the installer: *"Install into a temporary test directory named `.forge614-test` in my home folder, rather than the default location"*.
- `bash`: The macOS system program that runs installation scripts.
- `scripts/install.sh`: The installer script that extracts files and validates the setup.
- `--archive`: The flag indicating we are passing a path to a `.tar.gz` package.
- `"$PWD/dist/release/forge614-shell-1.0.0.tar.gz"`: The absolute path to the archive created in step 4 (`$PWD` means *"the directory I am currently in"*).

### Expected output:
If the installation succeeded, Terminal will display:
```text
Installed Forge614 Shell v1.0.0
Configured /Users/<user>/.zshrc so forge614-shell is available in new Terminal windows.
Close and reopen Terminal, then run: forge614-shell
```

---

## 6. Verify and launch

### 6.1 Check the installed version
Ask the newly installed binary to report its version:

```bash
~/.forge614-test/bin/forge614-shell --version
```

**Expected exact output:**
```text
forge614-shell 1.0.0
```

### 6.2 Launch the installed application
Now launch the interactive terminal interface from the isolated installation:

```bash
~/.forge614-test/bin/forge614-shell
```

### What you should observe:
- The Forge614 Shell terminal interface will start, prompting you to choose an interface mode and connected engine.
- **Look at the bottom-right corner of the terminal (the footer row below the chat):** you will see the visible version label:
  ```text
  v1.0.0
  ```
- To exit the program, type `/quit` and press **Enter**, or press **Control + C**.

**What does this prove?** This proves conclusively that Forge614 Shell was successfully unpacked into a separate filesystem location and runs as a standalone program without relying on the development repository.

---

### 7. Normal installation and collaborator workflow

### 7.1 Local normal installation (Optional after validating isolated test)

> [!NOTE]
> This step is **optional**. Only proceed if the isolated test in step 6 succeeded and you wish to have Forge614 Shell installed in its standard user directory (`~/.forge614/`).

1. Remove the test override variable:
```bash
unset FORGE614_HOME
```

2. Ensure you are in the project folder:
```bash
cd ~/Desktop/forge614-shell
```

3. Run the standard installer:
```bash
bash scripts/install.sh --archive "$PWD/dist/release/forge614-shell-1.0.0.tar.gz"
```

The application is now installed at `~/.forge614/bin/forge614-shell` and your shell profile is automatically configured.

### 7.2 Collaborator installation workflow (Direct download from GitHub Releases)

If you are an invited collaborator on the private repository without access to the source code, Git, GitHub CLI, or Bun, here is the complete end-to-end workflow:

1. **Download the three release assets from GitHub Releases:**
   Log in to GitHub with your authorized account, open the repository Releases page, and under the **Assets** section of the desired release (`v1.0.0` or `v1.0.1`), download these **3 files** to your Downloads folder (`~/Downloads`):
   - `forge614-shell-1.0.0.tar.gz` (the application bundle)
   - `forge614-shell-1.0.0.tar.gz.sha256` (cryptographic checksum file)
   - `install.sh` (the installation helper script)

2. **Open Terminal and navigate to Downloads:**
   ```bash
   cd ~/Downloads
   ```

3. **Verify archive integrity:**
   Verify that the archive was not corrupted or truncated during download:
   ```bash
   shasum -a 256 -c forge614-shell-1.0.0.tar.gz.sha256
   ```
   **Expected output:**
   ```text
   forge614-shell-1.0.0.tar.gz: OK
   ```

4. **Run the installer:**
   ```bash
   bash install.sh --archive ./forge614-shell-1.0.0.tar.gz
   ```

5. **Expected output:**
   The installer extracts files to `~/.forge614/shell/1.0.0/`, creates the active launcher `~/.forge614/bin/forge614-shell`, and automatically configures your shell profile (`~/.zshrc` on macOS or `~/.bashrc` on Linux):
   ```text
   Installed Forge614 Shell v1.0.0
   Configured /Users/<user>/.zshrc so forge614-shell is available in new Terminal windows.
   Close and reopen Terminal, then run: forge614-shell
   ```

6. **Launch:**
   **Close the current Terminal window**, open a new Terminal window, and simply run:
   ```bash
   forge614-shell
   ```

---

## 8. Automatic PATH configuration (Zero manual steps)

### No manual PATH commands
Unlike traditional tools that require copying complex commands or editing hidden dotfiles, **`install.sh` handles environment setup 100% automatically**:
- You **DO NOT** need to run `export PATH=...`.
- You **DO NOT** need to edit `~/.zshrc`, `~/.bashrc`, or `~/.profile` manually.
- You **DO NOT** need deep command-line knowledge.

### How automatic PATH configuration works:
1. **Shell Detection:** The script inspects your active shell (`$SHELL`):
   - On **macOS** (where `zsh` is default), it automatically selects `~/.zshrc`.
   - On **Linux** (where `bash` is default), it automatically selects `~/.bashrc`.
   - In other Unix-compatible environments, it selects `~/.profile`.
2. **Idempotent Injection:** It cleanly appends the PATH configuration:
   ```bash
   # Forge614 Shell
   export PATH="$HOME/.forge614/bin:$PATH"
   ```
   If you rerun the installer to reinstall or update, it checks with `grep` and **never duplicates entries**.
3. **The Only User Step:**
   Because a running terminal window cannot absorb environment modifications made by an external child process, the only action needed after installation is:
   - **Close the current Terminal window.**
   - **Open a brand-new Terminal window.**
   - Type:
     ```bash
     forge614-shell
     ```
   To verify that your system recognizes it, run:
   ```bash
   forge614-shell --version
   ```
   Expected output: `forge614-shell 1.0.0`.

---

## 9. Troubleshooting

### 1. `cd: no such file or directory: ~/Desktop/forge614-shell`
- **Cause:** The project folder is not located on your Desktop or has a different name.
- **Fix:** Type `pwd` to check your current directory, or drag the project folder directly from Finder into the Terminal window after typing `cd `.

### 2. `bun: command not found`
- **Cause:** Bun is not installed or not in your terminal's PATH.
- **Fix:** Only needed if bundling from source (step 4). Install it following [bun.sh](https://bun.sh). Collaborators downloading release archives do not need Bun.

### 3. `node: command not found`
- **Cause:** Node.js is not installed on your system.
- **Fix:** Download and install the recommended version (>= 22.19) from [nodejs.org](https://nodejs.org).

### 4. `Forge614 Shell requires Node.js 22.19 or newer`
- **Cause:** An older version of Node.js is active.
- **Fix:** Visit [nodejs.org](https://nodejs.org) and install the latest package for your system.

### 5. `Release archive not found: ...`
- **Cause:** Packaging was not run before installing, or the downloaded archive is not in the current folder.
- **Fix:** Verify that `forge614-shell-1.0.0.tar.gz` exists in your current folder by running `ls -la`.

### 6. `Permission denied`
- **Cause:** You ran `./scripts/install.sh` directly without execution permissions.
- **Fix:** Prefix the command with `bash`, as shown throughout this guide: `bash install.sh --archive ...`.

### 7. The command says `forge614-shell: command not found` after install
- **Cause:** You are still typing in the same Terminal window where the installer ran, so the updated shell profile has not been loaded.
- **Fix:** Close that Terminal window completely (**Command + Q** or **Command + W**) and open a new Terminal window. Type `forge614-shell` directly.

### 8. I accidentally closed the Terminal window
- **Fix:** No problem. Re-open Terminal, navigate to the target directory, and resume your step.

### 9. I want to clean up and repeat the isolated test
- **Fix:** Delete the temporary test folder:
```bash
rm -rf ~/.forge614-test
```
Then rerun step 5.

---

## 10. Files created by the test

When the installation completes, it creates the following hierarchy in your user directory:

```text
~/.forge614-test/ (or ~/.forge614/ for normal install)
├── bin/
│   └── forge614-shell       <- Active symlink (executable launcher)
└── shell/
    └── 1.0.0/               <- Isolated version 1.0.0 directory
        ├── dist/
        │   └── cli.js       <- Bundled Node.js executable
        ├── extensions/      <- Runtime environment extensions
        └── package.json     <- Version metadata manifest
```

- `bin/`: Contains the symlink that macOS/Linux runs when launching `forge614-shell`.
- `shell/1.0.0/`: Holds the exact files for version 1.0.0. Future updates can install side-by-side in separate version folders without overwriting previous releases.
- `dist/cli.js`: The unified Forge614 Shell JavaScript bundle ready to execute with Node.js without development compilers.

---

## 11. Next steps and versioning policy

Now that the installation has been verified on your Mac or Linux machine:

### 11.1 Immutable releases and patch policy
- **Immutability of published releases:** Version `1.0.0` is an already published stable private release on GitHub with attached assets. In accordance with software engineering best practices, **a published release is never modified, replaced, or retagged**.
- **Publishing patch releases (e.g., `1.0.1`):** Post-release improvements (such as automatic PATH configuration in `install.sh` or future bugfixes) are released as a new semantic patch version (`1.0.1`).
- **The publishing workflow for `1.0.1` consists of:**
  1. Update `"version": "1.0.1"` in `package.json`.
  2. Run the test suite: `bun run check`.
  3. Package the standalone bundle: `bun run bundle:release` (creates `forge614-shell-1.0.1.tar.gz` and `.sha256`).
  4. Create numeric Git tag `1.0.1` and push to origin (`git tag 1.0.1 && git push origin 1.0.1`).
  5. Create and publish GitHub Release visible as `Forge614 Shell v1.0.1` linked to tag `1.0.1` (stable release, not pre-release).
  6. Attach the 3 assets (`.tar.gz`, `.sha256`, and updated `install.sh`).

### 11.2 Collaborator access and platform scope
- **Private repository:** Only users explicitly added as collaborators to the private GitHub repository can access and download release assets.
- **No developer tooling required:** Collaborators do not need `git`, GitHub CLI (`gh`), or Bun. They only need Node.js `>=22.19.0`, Terminal, and Bash.
- **Operating system support:** The current installer supports **macOS and Linux**. Windows **is not yet supported** (requires a PowerShell `install.ps1` script to be implemented in a future milestone).
- **No false claims:** Public `curl | bash` installation, npm publishing, and automatic background updates are not available yet.

For technical details on the maintainer workflow and bundle architecture, see:
👉 [06 — Release 1.0.0 preparation and installer bundle](06-release-1.0.0-bundle-installer.md)
