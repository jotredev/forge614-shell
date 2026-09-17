# 03 — Stage 2 first delivery: Launcher and Pi integration

Date: 2026-09-17 · Stage 02: base environment implementation (in progress) · Documentation revision: 1 · [Español](../es/03-etapa-2-primera-entrega.md) · [Index](../../README.md)

This document records the first technical delivery of Stage 2 for Forge614-Shell. Stage 2 is **not completed as a whole**; this delivery establishes the executable launcher, profile and history isolation, the identity extension, and verification on top of Pi.

---

## 1. Delivery summary

Forge614-Shell now includes its first functional binary (`forge614-shell`), built in TypeScript on top of Bun and Node.js. It bundles and runs the Pi engine (`@earendil-works/pi-coding-agent` v0.85.1) under a custom identity, with a configuration profile and session storage completely separated from the user's standard Pi installation.

Strict typechecking, 4 automated Bun tests, and bundling to `dist/cli.js` were executed and passed.

---

## 2. Implemented by Forge614-Shell

Forge614-Shell provides the custom branding, isolation, and packaging layer detailed below:

### Launcher and packaging (`src/cli.ts` and `src/launcher.ts`)
- **Direct Pi dependency:** Pi (`@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`) is declared as a direct dependency in `package.json`. Users do not need a global Pi installation.
- **Dynamic resolution:** The CLI resolves the Pi root and binary entry point via `import.meta.resolve`, preparing the runtime without machine-dependent hardcoded paths.
- **In-process invocation:** Runs Pi directly via `await import(...)`, allowing Pi to take full control of the interactive terminal (TUI) and handle OS interruption signals (`SIGINT`, `SIGTERM`) without requiring a daemon or detached background agent.
- **Command-line flags:** Supports standard flags (`--help` / `-h`, `--version` / `-v`), session flags (`--continue` / `-c`, `--resume` / `-r`), and transparent argument pass-through to the Pi engine.

### Strict profile and session isolation
- **Dedicated profile path:** Defaults to `~/.forge614-shell/agent`, configurable via the `FORGE614_SHELL_HOME` environment variable (which must be an absolute path; otherwise, the launcher throws explicitly to prevent drift across directories).
- **Decoupled from ambient Pi:** User settings in `~/.pi` (ambient providers, models, and global configs) are neither overwritten nor read as Shell's active profile.
- **Partitioning by working directory (`cwd`):** Sessions are partitioned automatically by the directory from which the command is executed, allowing each project or worktree to maintain its own local history.
- **Isolation from global extensions and themes:** The launcher automatically passes `--no-extensions`, `--no-skills`, `--no-prompt-templates`, and `--no-themes` to Pi, ensuring that global Pi extensions or skills do not contaminate the Forge614-Shell experience.

### Custom identity and status extension (`extensions/forge614-shell.ts`)
- **Custom TUI header:** In interactive terminal mode, renders a styled header with `Forge614-Shell` (accent bold) and subtitle `Powered by Pi · /login · /resume · /model · /thinking` (dim).
- **Terminal window title:** Dynamically sets the window or tab title to `Forge614-Shell`.
- **Visual status indicator:** Listens to agent lifecycle events (`agent_start` and `agent_settled`) and updates the status bar:
  - `Forge614 · ready` while awaiting instructions.
  - `Forge614 · working` while processing or running tools.
- **`/forge614-status` command:** Registers an interactive in-chat command reporting:
  - Current project (`cwd`).
  - Active configuration profile (`PI_CODING_AGENT_DIR`).
  - Selected model (or prompt to run `/login` if no credentials exist).
  - Persistent memory status (*not connected (Engram deferred)*).

### One active session per instance (usage model with Orca or host terminal)
- In accordance with the updated scope (Revision 2 of Stage 01), Forge614-Shell does not build an internal project manager, tabs, or Git worktree manager.
- The user opens a tab or window in their terminal (such as Orca, Ghostty, iTerm, or tmux) or in their IDE for each branch or worktree, and runs `forge614-shell`. Each instance maintains an active, isolated session for that path.

### English interface
- In this first delivery, the TUI, system messages, and inherited Pi commands are presented in English, without an ES/EN language toggle at this stage.

---

## 3. Natively inherited from Pi

Forge614-Shell deliberately delegates foundational coding agent capabilities to Pi (`@earendil-works/pi-coding-agent`):

- **Agent loop and reasoning:** ReAct planning (*Reason + Act*), turn management, and reasoning levels (*thinking tokens*) when supported by the model.
- **Native filesystem tools:**
  - File reading (`read_file`).
  - Code editing and writing (`edit_file`, `write_file`).
  - Shell command execution (`bash`).
- **Authentication and providers:** Interactive `/login` command to configure API keys for Anthropic, OpenAI, Google Gemini, and other providers supported by Pi.
- **Internal command catalog:** `/model`, `/thinking`, `/resume`, `/new`, `/quit`, etc.
- **Terminal UI rendering (TUI):** Interactive input handling, scroll buffers, ANSI colors, and differential rendering via `@earendil-works/pi-tui`.
- **Trust controls:** Execution permissions and warnings regarding untrusted directories inherited directly from Pi.

---

## 4. Technical verification performed

All verification was conducted on a macOS system using Bun 1.3.8 and TypeScript 5.9.3:

1. **Strict typecheck:**
   ```bash
   bun run typecheck # tsc --noEmit (0 errors)
   ```
2. **Automated tests (4/4 passed):**
   ```bash
   bun test # 4 pass, 0 fail, 27 expect() calls
   ```
   - `tests/launcher.test.ts` (3 tests):
     - Asserts propagation of the selected worktree `cwd` and usage of Shell's profile rather than ambient Pi.
     - Asserts compatibility with custom absolute profiles (`FORGE614_SHELL_HOME`).
     - Asserts strict rejection of relative profile paths to avoid project drift.
   - `tests/runtime.test.ts` (1 integration test):
     - Spawns a real Pi subprocess in RPC mode (`--mode rpc`) communicating over `stdin`/`stdout`.
     - Confirms loading of Forge614-Shell extension, window title, isolated session directory, omission of ambient skills/extensions, and successful execution of `/forge614-status`.
     - Validates that sentinel files in an ambient Pi profile remain untouched.
3. **Build:**
   ```bash
   bun run build # bun build src/cli.ts --target=node --packages=external --outdir=dist -> dist/cli.js (2.86 KB)
   ```
4. **Interactive launch on macOS:**
   - Manual verification of interactive TUI startup and clean exit.

### What was NOT tested in this delivery:
- **Live authentication:** Real API keys were not configured, and `/login` was not executed against an external provider.
- **Model conversations:** No LLM API calls were made and no live tokens were consumed during this phase.

---

## 5. Outstanding tasks (to complete Stage 02)

The following technical tasks remain before Stage 2 of Forge614-Shell can be marked complete:

1. **Automatic end-user installer:** Build an easy installation mechanism (installer script or global package) that eliminates manual build steps.
2. **Cross-platform validation:** Test and verify execution, packaging, and test suites on **Windows** and **Linux** (currently only verified on macOS).
3. **Live authentication and chat verification:** Complete end-to-end testing of authentication with at least one live provider and an interactive chat session with tool execution.
4. **Exit warning with active work:** Implement a custom confirmation or warning if the user attempts to close the session while the agent is executing tools or active work.
5. **Bilingual ES/EN toggle:** Design how to provide Spanish UI text and prompts within the Shell experience.
6. **Forge614-Engram integration:** Explicitly reserved for the end, once Shell's foundation is fully stabilized.
