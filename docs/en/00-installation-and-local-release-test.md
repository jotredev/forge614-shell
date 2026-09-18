# 00 — Installation and local release test

2026-09-18 · Stage 02: step-by-step beginner guide for macOS · [Español](../es/00-instalacion-y-prueba-local-release.md) · [Index](../../README.md) · [Technical bundle details](06-release-1.0.0-bundle-installer.md)

This guide walks you through, step by step from scratch on **macOS**, how to build the Forge614 Shell release archive and test its installer inside an isolated folder on your computer—no prior experience with terminals, Git repositories, or environment variables required.

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

1. **Current local installer test (What we are doing today):** We build a standalone archive on your machine and confirm that the installer script unpacks it and prepares it for execution in an isolated test folder. **This is the only flow available right now.**
2. **Private collaborator installation through GitHub Releases (Upcoming):** Team members will be able to download this same archive from a private GitHub Release without needing development build tools installed. *(Not yet available).*
3. **Public installation through a hosted installer (In the future):** Anyone will be able to install the program with a single terminal command from the internet or via a website (`forge614.dev`). *(Not yet available).*

### What is explicitly NOT available yet:
- No downloadable assets on GitHub Releases.
- No remote `curl ... | bash` installation command.
- No hosted installer on `forge614.dev`.
- No in-app `/update` command inside the chat composer.
- No public npm package (`npm install -g forge614-shell` does not exist).
- No Windows PowerShell installer (`install.ps1`).
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

- **Node.js version check:** You should see a version string starting with `v22.19.0` or newer (for instance, `v22.19.1` or `v23.x`). If your version is older, the installer will refuse to proceed.
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
  - `forge614-shell-1.0.0.tar.gz`: The self-contained package containing the compiled program, metadata, and runtime extensions. It excludes the heavy development `node_modules` directory. This is the exact archive that will eventually be distributed to users.
  - `forge614-shell-1.0.0.tar.gz.sha256`: A cryptographic checksum verifying that the archive has not been damaged or altered.

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
Run: /Users/<user>/.forge614-test/bin/forge614-shell --version
Add /Users/<user>/.forge614-test/bin to PATH to use forge614-shell everywhere.
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

## 7. Optional normal installation

> [!NOTE]
> This step is **strictly optional**. Only proceed if the isolated test in step 6 succeeded and you wish to have Forge614 Shell installed in its standard user directory (`~/.forge614/`).

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

The application is now installed at:
`~/.forge614/bin/forge614-shell`

---

## 8. PATH configuration

### What is PATH?
In plain terms: when you type a command like `ls` or `node`, your computer looks through a list of folders called **PATH**. If a folder is in your PATH, you can simply type `forge614-shell` instead of typing the long path `~/.forge614/bin/forge614-shell`.

Configuring PATH is **optional**. You can always run the program by typing its full path.

### Option A: Temporary setup (current Terminal window only)
```bash
export PATH="$HOME/.forge614/bin:$PATH"
```

### Option B: Permanent setup for macOS (zsh)
Run these two commands to configure your standard macOS shell profile:

```bash
echo 'export PATH="$HOME/.forge614/bin:$PATH"' >> ~/.zshrc
```

```bash
source ~/.zshrc
```

### Verification:
Open a fresh Terminal window and verify:
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
- **Fix:** Install it following [bun.sh](https://bun.sh) and open a fresh Terminal window.

### 3. `node: command not found`
- **Cause:** Node.js is not installed on your Mac.
- **Fix:** Download and install the recommended version (>= 22.19) from [nodejs.org](https://nodejs.org).

### 4. `Forge614 Shell requires Node.js 22.19 or newer`
- **Cause:** An older version of Node.js is active.
- **Fix:** Visit [nodejs.org](https://nodejs.org) and install the latest package for macOS.

### 5. `Release archive not found: ...`
- **Cause:** Step 4 (`bun run bundle:release`) was not run, or the path after `--archive` was mistyped.
- **Fix:** Make sure you are inside the repository directory and run `bun run bundle:release` before installing.

### 6. `Permission denied`
- **Cause:** You ran `./scripts/install.sh` directly without execution permissions.
- **Fix:** Prefix the command with `bash`, as shown throughout this guide: `bash scripts/install.sh ...`.

### 7. Full path works, but `forge614-shell` says `command not found`
- **Cause:** PATH was not made permanent in `~/.zshrc` or the window was not refreshed.
- **Fix:** Run `source ~/.zshrc`, or use the full path `~/.forge614/bin/forge614-shell`.

### 8. I accidentally closed the Terminal window
- **Fix:** No problem. Re-open Terminal, run `cd ~/Desktop/forge614-shell`, and continue from where you left off.

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
~/.forge614-test/
├── bin/
│   └── forge614-shell       <- Active symlink (executable launcher)
└── shell/
    └── 1.0.0/               <- Isolated version 1.0.0 directory
        ├── dist/
        │   └── cli.js       <- Bundled Node.js executable
        ├── extensions/      <- Runtime environment extensions
        └── package.json     <- Version metadata manifest
```

- `bin/`: Contains the symlink that macOS runs when launching the command.
- `shell/1.0.0/`: Holds the exact files for version 1.0.0. Future updates can install side-by-side in separate version folders without overwriting previous releases.
- `dist/cli.js`: The unified Forge614 Shell JavaScript bundle ready to execute with Node.js.

---

## 11. Next steps

Now that this local installation test is verified on your Mac:

1. **Upcoming phase (Private collaborators):** The release archive will be published to private GitHub Releases, allowing invited team members to download and install it with the same installer without cloning the repository.
2. **Future phase (General public):** An automated web-hosted installer (`forge614.dev`) will be introduced to streamline setup for anyone.

For technical details on bundle compilation, SHA-256 generation, and atomic directory switching, see the technical companion document:
👉 [06 — Release 1.0.0 preparation and installer bundle](06-release-1.0.0-bundle-installer.md)
