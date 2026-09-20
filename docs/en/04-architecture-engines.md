# 04 — Architecture, multi-engine support, and session management

Date: 2026-09-19 · Stage 02: architecture, multi-engine adapters, Engines integration, and session control · Documentation revision: 3 · [Español](../es/04-arquitectura-motores.md) · [Index](../../README.md)

This document details the technical restructuring of Forge614-Shell, evolving from a single-engine launcher into a **Layered Architecture** with modular adapters for artificial intelligence engines. It details the **real integration with Forge614 Engines** as an internal non-interactive dependency for local agent detection under a versioned public contract (`schemaVersion: 1`), the active chat adapters (Claude Code and OpenAI Codex), the **shared profile authentication model**, the interactive **local disconnect command (`/logout`)**, **existing account reconnection (`/login`)**, the **diagnostic guide without local fallback**, and verified automated test boundaries (133 tests passing across 35 files, 597 assertions).

---

## 1. Master Analogy: The Multi-Brand Diagnostic Console with Internal Detection Module

Picture a professional automotive diagnostic console in a high-tech workshop:

- **The Unified Console (UI and App layers):** The mechanic looks at a single touch screen with standardized controls (the initial "Basic" visual interface picker and interactive chat commands such as `/login`, `/logout`, `/model`, `/effort`, `/resume`, `/status`, `/stop`, `/quit`). The visual experience remains consistent and predictable.
- **The Internal Diagnostic Scanner (Forge614 Engines):** Rather than walking out into the parking lot to guess what cars are parked by squinting at license plates (legacy local detection on `PATH`), the console queries an internal electronic diagnostic module (`~/.forge614/engines/bin/forge614-engines detect`). This scanner speaks an official, strict protocol (`schemaVersion: 1`) and reports verified ready vehicles.
- **The Brand-Specific Adapter Cables (Engines and Chat Adapters layer):** For a detected vehicle to appear on the console's launch screen, the workshop must possess the specific compatible adapter cable:
  - The **Claude Code** cable connects directly to Anthropic's on-board computer using their official SDK (`@anthropic-ai/claude-agent-sdk`).
  - The **Codex** cable links to OpenAI's internal server (*App Server*) across a bidirectional communication channel (*JSON-RPC over stdio*).
  - If the scanner detects a vehicle such as **Cursor**, the console recognizes its physical presence but **does not display it in the startup picker** because the chat adapter cable for Cursor is still in design.
  - Legacy or experimental engines from older schemas (such as **Antigravity CLI**) no longer appear in this initial selector governed by Engines, as they belonged to the legacy local disk scan.
- **The Integrity Alarm Without Home-Made Substitutes (No-Fallback Rule):** If the internal diagnostic scanner is disconnected, damaged, or returns an incompatible protocol, the console strictly refuses to improvise or guess vehicle availability using loose cable noise. It issues a clear warning stating that it must be repaired by reinstalling the console (`Forge614 Shell`).
- **The Shared Workshop vs Isolated Benches (Authentication Profiles):** The workshop shares the same master tools, service manuals, and garage credentials that the mechanic already uses at their main work bench (such as ADE Orca or other terminal windows). Unplugging an engine from the diagnostic console (*local logout*) simply removes the key from that specific console's ignition; it does not freeze the garage bank account, change the building locks, or shut off the vehicles in neighboring service bays. After using the console for initial setup or engine tuning, the mechanic can turn off the screen and continue working directly with their native tools in Orca or standard terminals.
- **The Electrical Safeguards (Infrastructure and Environment Sanitization):** Before starting any engine, the console checks for crossed wires or overvoltages (it explicitly rejects conflicting environment keys, such as pay-per-token API credentials when operating in subscription account mode) and handles official browser authentication flows securely.

---

## 2. System architecture and structure

Forge614-Shell strictly adheres to a **Layered Architecture** pattern featuring engine-specific adapters and contract querying infrastructure.

> [!IMPORTANT]
> **Strict architectural boundary:** This system is **NOT** Clean Architecture or pure Hexagonal Architecture. There is no domain-pure entity layer or universal abstraction asserting that all AI engines are identical drop-in replacements. Instead, it is a pragmatic, hierarchical separation where higher layers consume lower layers, and each engine adapter encapsulates its native protocol quirks.

```
┌─────────────────────────────────────────────────────────────┐
│                         src/cli.ts                          │
│         (CLI entry point, argument parser and TUI picker)   │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
               ▼                               ▼
┌──────────────────────────────┐ ┌────────────────────────────┐
│          src/app/            │ │          src/ui/           │
│  - options.ts (CLI args)     │ │  - startup/ (TUI pickers)  │
│  - native-chat.ts (compos-   │ │  - basic/native.ts (chat)  │
│    ition root: Codex/agy/Gem)│ │  - basic/claude.ts (Claude)│
└──────────────┬───────────────┘ └─────────────┬──────────────┘
               │                               │
               ▼                               │
┌──────────────────────────────────────────────┴──────────────┐
│                        src/engines/                         │
│  - types.ts (session contracts, models, and event types)    │
│  - process.ts (safe spawning and environment sanitization)  │
│  - logout.ts (shared local logout confirmation helper)      │
│  - discovery.ts (legacy local PATH detector)                │
│  ┌────────────┬─────────────┬──────────────┬──────────────┐ │
│  │ claude/    │ codex/      │ antigravity/ │ gemini/ & pi │ │
│  │ SDK + CLI  │ App Server  │ agy stream   │ ACP / Legacy │ │
│  └────────────┴─────────────┴──────────────┴──────────────┘ │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    src/infrastructure/                      │
│  - forge614-engines.ts (Engines detect v1 public contract)  │
│  - browser.ts (safe OS browser launcher for OAuth links)    │
│  - rpc.ts (JsonRpcPeer: bidirectional transport over stdio) │
│  - project-info.ts (non-blocking Git checks)                │
└─────────────────────────────────────────────────────────────┘
                               │
                               ▼
               ~/.forge614/engines/bin/forge614-engines detect
                     (Internal component, NOT in PATH)
```

### Layer dependency boundaries

An automated architectural test (`tests/architecture/layers.test.ts`) enforces two structural rules:
1. The `engines/` and `infrastructure/` layers never import any code from `ui/` or `app/`.
2. Each supported native engine (`claude`, `codex`, `antigravity`, `gemini`) strictly owns its own session implementation (`session.ts`).
3. Discovering selectable agents for the startup picker is delegated to `src/infrastructure/forge614-engines.ts`, consuming the official Forge614 Engines contract.

### Core module descriptions

| Module | File path | Technical responsibility |
| --- | --- | --- |
| **CLI Entry** | `src/cli.ts` | Parses startup arguments, handles immediate flags (`--help`, `--version`), verifies interactive TTY capabilities, queries available engines via `discoverSelectableEngines`, and invokes visual selectors or legacy Pi startup. |
| **App Options** | `src/app/options.ts` | Validates and extracts the `--engine` option (`claude`, `codex`, `antigravity`, `gemini`, `pi`). |
| **App Native Chat** | `src/app/native-chat.ts` | Composition root: spawns the background engine process, hooks the JSON-RPC or stream peer, and binds `CodexSession`, `AntigravitySession`, or `GeminiSession` to the UI without coupling the UI to process management. |
| **Engines Types** | `src/engines/types.ts` | Defines canonical interfaces: `NativeSession` (lifecycle, `logout?()`, `login()`), `NativeModel`, `NativeEvent`, `Approve`, and `Emit`. |
| **Engines Process** | `src/engines/process.ts` | Prepares subprocess environment, rejects conflicting billing-route variables (such as API keys), and spins up `JsonRpcPeer`. |
| **Engines Logout** | `src/engines/logout.ts` | Shared `confirmedLogout` helper: requests interactive consent informing the user that disconnection is strictly local to the current Shell session. |
| **Engines Discovery (Legacy)** | `src/engines/discovery.ts` | Legacy local detector on `PATH`. **No longer used to populate the startup engine picker**; the interactive picker is populated exclusively through the Forge614 Engines public contract. |
| **Engine Claude** | `src/engines/claude/` | Integrates with Claude Code via SDK; manages subscription preflight checks (`auth.ts`), turns and tool approvals (`session.ts`), and telemetry for tokens, context, and quota limits (`telemetry.ts`). |
| **Engine Codex** | `src/engines/codex/` | Spawns `codex app-server` and drives JSON-RPC communication over stdio for ChatGPT account verification, model listings, streaming deltas, `/login`, and local `/logout`. |
| **Engine Antigravity** | `src/engines/antigravity/` | Internal implementation for Antigravity CLI (`agy`) via `stream-json` (`process.ts`) and interactive chat (`session.ts`). Not part of the initial Engines selector. |
| **Engine Gemini** | `src/engines/gemini/` | Drives Google Gemini CLI via `gemini --acp --approval-mode default` using Agent Client Protocol (ACP v1) with `oauth-personal` authentication. |
| **Engine Pi** | `src/engines/pi/` | Legacy connector wrapping `@earendil-works/pi-coding-agent`, preserving isolated profile storage in `~/.forge614-shell/agent`. |
| **UI Startup** | `src/ui/startup/` | Interactive terminal selectors shown before chat: visual interface picker (`visual-picker.ts`) and engine picker (`engine-picker.ts`). Displays engines detected by Engines with active Shell chat adapters. |
| **UI Basic** | `src/ui/basic/` | AI-first split terminal interface: workspace (`workspace.ts`), contextual sidebar (`sidebar.ts`), framed composer (`composer.ts`), activity cards (`transcript.ts`), braille metrics (`metrics.ts`), session state (`shell-state.ts`), condensed status bar (`status-bar.ts`), and Forge614 theme (`theme.ts`). Detailed in [05-basic-ui-sidebar-quotas.md](05-basic-ui-sidebar-quotas.md). |
| **Infrastructure Engines** | `src/infrastructure/forge614-engines.ts` | Calls public contract `~/.forge614/engines/bin/forge614-engines detect`, validates `schemaVersion: 1`, filters agents without chat adapters, and enforces the strict no-fallback rule on failures. |
| **Infrastructure Browser** | `src/infrastructure/browser.ts` | Safely opens the default operating system browser (`open`, `rundll32`, or `xdg-open`) strictly for verified OAuth endpoints (`auth.openai.com` and `accounts.google.com`) without shell interpolation. |
| **Infrastructure Project** | `src/infrastructure/project-info.ts` | Non-blocking Git branch and changed files resolution, with graceful fallback when Git is unavailable. |
| **Infrastructure RPC** | `src/infrastructure/rpc.ts` | `JsonRpcPeer`: bidirectional JSON-RPC client and server over standard streams (`stdin`/`stdout`), featuring request correlation, timeouts, and buffer protection. |

---

## 3. Shell ↔ Forge614 Engines relationship, startup flow, and diagnostic guide

In accordance with the ecosystem contract (`FORGE614_ECOSYSTEM_CONTRACT.md`), the relationship between Shell and Engines is strictly bounded:

### 3.1 Engines as an internal dependency and strict PATH isolation
- **Decoupled internal component:** `forge614-engines` is an internal non-interactive dependency for safely detecting and inspecting local AI clients. It has no terminal UI (TUI) and contains no interactive chat logic.
- **Installation location:** It is automatically installed and placed under `~/.forge614/engines/bin/forge614-engines`.
- **Strict PATH isolation:** `forge614-shell` is the **only command added to the user's `PATH`** (pointing to `~/.forge614/shell/bin/`). By deliberate design, `forge614-engines` is **never added to `PATH`**, and the user **must not execute it directly** in the terminal.
- **Internal invocation:** Shell is the only component that programmatically executes the Engines binary via isolated child processes (`src/infrastructure/forge614-engines.ts`).

### 3.2 Startup flow and public contract query (`schemaVersion: 1`)
When the user executes `forge614-shell`, an interactive two-step launch sequence begins:

1. **Visual interface picker:**
   - The terminal first presents `Choose your visual interface`, where the user selects `Basic` (the `Full` interface remains disabled for future stages).
2. **Engines public contract query (`detect`):**
   - To populate `Choose your AI engine`, Shell **no longer uses its legacy local detector on PATH** (`src/engines/discovery.ts`).
   - Instead, Shell programmatically spawns:
     ```bash
     ~/.forge614/engines/bin/forge614-engines detect
     ```
   - Engines returns a versioned JSON report with `schemaVersion: 1`:
     ```json
     {
       "schemaVersion": 1,
       "agents": [
         { "id": "claude-code", "label": "Claude Code", "installed": true, "executable": "/usr/local/bin/claude" },
         { "id": "codex", "label": "Codex", "installed": true, "executable": "/usr/local/bin/codex" },
         { "id": "cursor", "label": "Cursor", "installed": true, "executable": "/Applications/Cursor.app/Contents/MacOS/Cursor" }
       ]
     }
     ```
3. **Strict mapping to supported chat adapters:**
   - Shell parses the report and filters **strictly** for agents where `installed: true` and for which Shell already implements a native interactive chat adapter:
     - `claude-code` maps to the `claude` chat adapter (Claude Code).
     - `codex` maps to the `codex` chat adapter (OpenAI Codex).
   - **Cursor status:** Even if Engines detects and reports Cursor as installed (`id: "cursor"`), **Cursor does not appear in the startup picker** because Shell does not yet have a chat adapter for Cursor.
   - **Antigravity CLI status:** Antigravity CLI **no longer appears in the startup picker**. It belonged to the legacy local PATH detector and is not an option in the official picker driven by Engines. While low-level session and process code in `src/engines/antigravity/` is preserved for specialized internal parity, the interactive startup selector does not expose it.

### 3.3 Diagnostic guide: strict No-Fallback rule on Engines failure
If Forge614 Engines is missing, broken, or returns an incompatible schema, Shell enforces strict architectural integrity: **Shell never falls back to local PATH detection**.

| Engines state | Technical cause | Shell behavior and error message | Required repair action |
| :--- | :--- | :--- | :--- |
| **Missing or non-executable** (`status !== 0`) | The binary is absent from `~/.forge614/engines/bin/forge614-engines`, permissions are denied, or the process crashed on launch. | Throws fatal startup error:<br>`Forge614 Engines is unavailable. Reinstall Forge614 Shell to repair its required dependency.` | Reinstall Forge614 Shell using the official curl installer (`curl -fsSL https://github.com/jotredev/forge614-shell/releases/latest/download/install.sh \| bash`). The installer automatically fetches and configures a valid Engines release. |
| **Incompatible schema version** (`schemaVersion !== 1`) | Installed Engines returns an unsupported schema version (e.g. 2). | Throws fatal startup error:<br>`Forge614 Engines is incompatible with this Shell version. Reinstall Forge614 Shell to repair its required dependency.` | Reinstall Forge614 Shell to synchronize compatible ecosystem releases. |
| **Malformed output or invalid JSON** | Stdout from `forge614-engines detect` is not valid JSON or `agents` is not an array. | Throws fatal startup error:<br>`Forge614 Engines returned an invalid detection result.` | Reinstall Forge614 Shell to repair the corrupted dependency. |
| **No compatible engines installed** (empty `agents` or none with chat adapter) | Engines detected 0 installed agents matching Shell's chat adapters. | Cleanly reports in terminal:<br>`Forge614 Engines found no Shell-compatible AI engines. Install Claude Code or Codex, then restart Forge614-Shell.` | Install Claude Code (`npm i -g @anthropic-ai/claude-code`) or Codex, log in, then restart Shell. |
| **Manual CLI execution by user** | User types `forge614-engines` directly in their terminal. | Terminal responds:<br>`forge614-engines: command not found` | Expected behavior: Engines is an internal component not added to PATH. All human-facing flows run through `forge614-shell`. |

### 3.4 Operational freedom in native clients after setup
Forge614 Shell empowers users without acting as an operational silo:
- Shell serves as the visual cockpit for initial setup, engine selection, config verification, and unified chat.
- After completing setup or configuration in Shell, users **can continue working directly in ADE Orca, Claude Code, OpenAI Codex, or standard terminals**. Shell does not replace or lock in those native clients.

---

## 4. Authentication and shared profile architecture decision

During development, options for fully isolating Shell credentials from other applications (like Orca) were investigated thoroughly:

### Technical findings
- **Claude Code:** Supports `CLAUDE_CONFIG_DIR`, which partitions configuration, conversation history, and macOS Keychain items. This allows running two distinct accounts in parallel.
- **Codex:** Supports `CODEX_HOME` and `cli_auth_credentials_store="file"`, storing credentials in a dedicated `auth.json` file.
- **Antigravity:** Relies on the operating system secure keyring. No official documented mechanism exists to segment keyring entries on an application-by-application basis.

### The architectural decision
The project explicitly chose **NOT to implement isolated profile directories (`CLAUDE_CONFIG_DIR` or `CODEX_HOME`) and instead retain the shared native environment**:
1. **Ecosystem coherence:** The user specifically wants global skills, Model Context Protocol (MCP) servers, tools, and configurations configured in their environment to be available seamlessly across Forge614-Shell, Orca, and standard terminals, rather than living in fragmented configuration silos.
2. **No manipulation of global variables:** Shell does not alter global environment variables, tamper with shared keychain entries, or modify browser cookies.
3. **Accepted technical consequence:** Forge614-Shell **does not provide independent account switching** separate from other applications using that same native CLI profile. Signing out at the provider level would disconnect all applications; therefore, the required and implemented solution is **local session disconnection within Shell**.

> [!NOTE]
> **Mandatory conceptual distinctions:**
> - **Local Shell Disconnect:** An in-memory state within the active Forge614-Shell session that blocks sending messages and clears active models/telemetry, without touching disk credentials or revoking tokens.
> - **Native Engine Credentials:** Files and OS keychain items maintained by official CLIs (`~/.claude`, `~/.codex`, macOS/Linux/Windows keyring).
> - **Browser Session and Cookies:** Web session state in Google, Anthropic, or OpenAI residing in the user's browser, which dictates whether web login prompts ask for credentials or sign in automatically.

---

## 5. The local `/logout` command in Forge614-Shell

Implemented consistently across **Claude Code**, **Codex**, and **Antigravity CLI**:

### Operational behavior
1. **Mandatory consent prompt:** Typing `/logout` prompts the user for explicit confirmation:
   ```
   Disconnect <engine> only in this Forge614-Shell session? Your native account, Orca, other terminals and saved chats will not be changed. Use /login here to reconnect with your existing account.
   /yes = allow once · /no = deny
   ```
2. **Strictly local scope:**
   - **DOES NOT** invoke `claude auth logout`, `codex logout`, or `agy /logout`.
   - **DOES NOT** revoke OAuth tokens or delete credentials from disk or keychain.
   - **DOES NOT** sign out Orca, Ghostty, iTerm, VS Code, or browser sessions.
   - **DOES NOT** delete saved conversation history or project files.
3. **Immediate session effects:**
   - Transitions internal state to `disconnected` (or `signedOut`).
   - The status bar displays: `Disconnected locally · use /login to reconnect Shell. Native account unchanged.`
   - Blocks prompt submission (`send()` rejects with: *"Use /login to reconnect this Shell session before sending a message"*).
   - Clears active in-memory models, accumulated telemetry, and active conversation IDs.
4. **Protection against in-flight turns:** If an active conversation turn or login check is running, Shell requires waiting or cancelling with `/stop` before disconnecting.
5. **Non-persistent:** Relaunching Shell checks the existing native system authentication on startup.

---

## 6. Reconnection via `/login`

The `/login` command restores connectivity in Forge614-Shell with comprehensive verification:

### Reconnection workflow
1. **Non-invasive account inspection:** Shell probes the native CLI's authentication state without opening windows:
   - **Codex:** Issues `account/read` over the App Server RPC.
   - **Claude Code:** Runs `claude auth status --json` via `claudeLoginState()`.
   - **Antigravity:** Executes an account probe via `antigravityLoginState()`.
2. **Seamless reuse:** If the native engine already holds valid credentials, Shell reconnects immediately:
   - Resets `disconnected = false`.
   - Emits informative message: *"Connected to <engine> in Shell using your existing account. No new login is needed."*
   - Does not open browser windows or force the user to re-enter credentials.
3. **No prompt side-effects:** Reconnecting via `/login` **does not send messages to the model** or resume tasks automatically.
4. **Failure handling:** If the probe returns an unknown state or error, Shell alerts the user that verification failed and does not report a false connection.
5. **Interactive flow when credentials are genuinely required:**
   - **Claude Code:** Suspends the TUI and launches `claude auth login` with inherited stdio. On return, it verifies authentication and restores the TUI.
   - **Codex:** Initiates OAuth via `account/login/start` and calls `openLoginBrowser`, allowing `/stop` cancellation.
   - **Antigravity:** Since `agy` only offers interactive login in its native interface, Shell prompts with explicit confirmation (*"Google sign-in is required. Antigravity only offers interactive login through native agy. Open it temporarily?..."*), suspends the TUI, runs `agy`, and on exit checks account status.

---

## 7. Confirmation, cancellation, and security

1. **Cancellation semantics:**
   - Replying `/no` to `/logout` confirmation cancels the disconnect and keeps the session active.
   - Typing `/stop` aborts pending authentication probes.
   - If an account probe was aborted by `/stop` or signal cancellation, a late successful response cannot reconnect the session.
2. **Confidentiality safeguards:**
   - Account check subprocesses run with isolated streams (`stdio: ["ignore", "pipe", "pipe"]` in `account-command.ts`).
   - Stderr diagnostic streams are never dumped raw to the screen if they risk containing private tokens or settings.
3. **Clear user communication:** All UI status messages distinguish between disconnecting the Shell session and logging out of the provider account.

---

## 8. Testing conventions and verified test suite (*Colocated Tests*)

### Test suite layout (35 colocated test files)

```
src/
├── app/
│   ├── options.test.ts
│   └── native-chat.ts
├── engines/
│   ├── discovery.test.ts
│   ├── process.test.ts
│   ├── logout.ts
│   ├── logout.test.ts                # Consent, cancellation, and error bounds
│   ├── claude/
│   │   ├── auth.test.ts              # Preflight, login states, and cancellation safety
│   │   ├── catalog.test.ts           # Model and quota queries without prompt emission
│   │   ├── session.test.ts           # Turns, context stream, and concurrent write locks
│   │   └── telemetry.test.ts
│   ├── codex/
│   │   ├── session.test.ts           # Local logout, reconnect, /refresh quotas, visual state
│   │   └── skills.test.ts            # Discovery of project, user, and plugin SKILL.md files
│   ├── antigravity/
│   │   ├── account-command.test.ts   # Headless probes without TTY and buffer bounds
│   │   ├── process.test.ts           # Stream-json protocol, /usage quota, and cancel
│   │   └── session.test.ts           # Local logout, agy reconnect, and message blocking
│   ├── gemini/
│   │   ├── config.test.ts
│   │   ├── login-feedback.test.ts
│   │   └── session.test.ts
│   └── pi/
│       └── launcher.test.ts
├── infrastructure/
│   ├── browser.test.ts
│   ├── forge614-engines.test.ts      # Engines detect schema v1 contract and no-fallback rule
│   ├── project-info.test.ts          # Non-blocking Git checks and no-repo fallback
│   ├── rpc.test.ts
│   └── updater.test.ts
└── ui/
    ├── basic/
    │   ├── claude.test.ts            # Claude logout consent, cancel, and reconnect
    │   ├── metrics.test.ts           # Neutral quota titles, bar limits, and braille ring
    │   ├── native.test.ts            # Command loop, local /logout, and /login
    │   ├── shell-state.test.ts       # Disconnect state cleanup and data isolation
    │   ├── sidebar.test.ts           # /refresh deduplication, telemetry, and sections
    │   ├── transcript.test.ts        # Role labels, timestamps, and collapsible tool cards
    │   └── workspace-chrome.test.ts  # Independent scroll, hidden scrollbars, composer
    └── startup/
        ├── engine-picker.test.ts
        └── visual-picker.test.ts
tests/
├── architecture/
│   └── layers.test.ts                # Layer boundaries and session.ts ownership
├── integration/
│   ├── public-installer.test.ts      # Public installer and Engines bootstrap
│   ├── release-bundle.test.ts        # Isolated tarball bundle installation and version reporting
│   └── runtime.test.ts               # Subprocess Pi integration test
└── support/
    └── rpc-fixture.ts
```

### Verified test pipeline

```bash
bun run check
# Runs: bun run typecheck && bun test && bun run build
```

- **Strict Typecheck:** `tsc --noEmit` passes with 0 errors.
- **Automated Tests:** **133 tests passing across 35 files** (0 failures, 597 `expect()` assertions).
- **Production Build:** `dist/cli.js` bundled cleanly.

> [!WARNING]
> **Verification boundaries:** These 133 automated tests verify logical contracts, Engines detect public contract, state machines, local disconnection semantics, independent scroll, prompt-free quota queries, buffer bounds, mock transports, and 1.0.0 release bundling. **They do NOT constitute full manual validation of live accounts across all operating systems (Windows, Linux)**. See [05-basic-ui-sidebar-quotas.md](05-basic-ui-sidebar-quotas.md) and [06-release-1.0.0-bundle-installer.md](06-release-1.0.0-bundle-installer.md) for detailed specifications.

---

## 9. Pending scope and roadmap

1. **Orca-style visual workspace and worktree manager:** Out of scope; the model remains **one active session per terminal instance**.
2. **Cross-platform validation:** Validating executable detection and process controls across Windows and Linux distributions.
3. **Local inference runtimes:** Connectors for local open-source models (Ollama, vLLM).
4. **Bilingual UI localization (ES/EN):** The interactive terminal chat currently displays in English.
5. **Long-term memory integration (Forge614-Engram):** Formally deferred until multi-engine stabilization is complete.
