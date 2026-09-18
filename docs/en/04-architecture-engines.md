# 04 — Architecture, multi-engine support, and session management

Date: 2026-09-17 · Stage 02: architecture, multi-engine adapters, and session control · Documentation revision: 2 · [Español](../es/04-arquitectura-motores.md) · [Index](../../README.md)

This document details the technical restructuring of Forge614-Shell, evolving from a single-engine launcher into a **Layered Architecture** with modular adapters for multiple artificial intelligence engines: Claude Code, OpenAI Codex, Antigravity CLI, Google Gemini CLI, and the legacy Pi engine. It also documents in depth the **shared profile authentication model**, the interactive **local disconnect command (`/logout`)**, **existing account reconnection (`/login`)**, and verified automated test boundaries.

---

## 1. Master Analogy: The Multi-Brand Diagnostic Console with Native Adapters

Picture a professional automotive diagnostic console in a mechanic's workshop:

- **The Unified Console (UI and App layers):** The mechanic looks at a single screen with standardized controls (the initial visual interface picker and interactive chat commands such as `/login`, `/logout`, `/model`, `/effort`, `/resume`, `/status`, `/stop`, `/quit`). The visual experience remains consistent and predictable regardless of the connected engine.
- **The Brand-Specific Adapter Cables (Engines layer):** Rather than forcing every car to conform to a fictional, one-size-fits-all generic plug, the console provides dedicated adapter cables engineered for each manufacturer:
  - The **Claude** cable connects directly to Anthropic's on-board computer using their official SDK (`@anthropic-ai/claude-agent-sdk`).
  - The **Codex** cable links to OpenAI's internal server (*App Server*) across a bidirectional communication channel (*JSON-RPC over stdio*).
  - The **Antigravity** cable interacts with Google's official CLI (`agy`) in structured stream mode (*stream-json*).
  - The **Gemini** cable hooks into Google's agent control protocol (*ACP — Agent Client Protocol* v1).
  - The **Pi** connector starts the classic toolset as an isolated fallback.
- **The Shared Workshop vs Isolated Benches (Authentication Profiles):** The workshop shares the same master tools, service manuals, and garage credentials that the mechanic already uses at their main work bench (such as Orca or other terminal windows). Unplugging an engine from the diagnostic console (*local logout*) simply removes the key from that specific console's ignition to prevent unintended acceleration; it does not freeze the garage bank account, change the building locks, or shut off the vehicles in neighboring service bays.
- **The Electrical Safeguards (Infrastructure and Environment Sanitization):** Before starting any engine, the console checks for crossed wires or overvoltages (it explicitly rejects conflicting environment keys, such as pay-per-token API credentials when operating in subscription account mode) and handles official browser authentication flows securely.

---

## 2. System architecture and structure

Forge614-Shell strictly adheres to a **Layered Architecture** pattern featuring engine-specific adapters.

> [!IMPORTANT]
> **Strict architectural boundary:** This system is **NOT** Clean Architecture or pure Hexagonal Architecture. There is no domain-pure entity layer or universal abstraction asserting that all AI engines are identical drop-in replacements. Instead, it is a pragmatic, hierarchical separation where higher layers consume lower layers, and each engine adapter encapsulates its native protocol quirks.

```
┌─────────────────────────────────────────────────────────────┐
│                         src/cli.ts                          │
│         (CLI entry point, argument parser and picker)       │
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
│  - discovery.ts (executable detection on PATH)              │
│  - process.ts (safe spawning and environment sanitization)  │
│  - logout.ts (shared local logout confirmation helper)      │
│  ┌────────────┬─────────────┬──────────────┬──────────────┐ │
│  │ claude/    │ codex/      │ antigravity/ │ gemini/ & pi │ │
│  │ SDK + CLI  │ App Server  │ agy stream   │ ACP / Legacy │ │
│  └────────────┴─────────────┴──────────────┴──────────────┘ │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    src/infrastructure/                      │
│  - browser.ts (safe OS browser launcher for OAuth links)    │
│  - rpc.ts (JsonRpcPeer: bidirectional transport over stdio) │
└─────────────────────────────────────────────────────────────┘
```

### Layer dependency boundaries

An automated architectural test (`tests/architecture/layers.test.ts`) enforces two structural rules:
1. The `engines/` and `infrastructure/` layers never import any code from `ui/` or `app/`.
2. Each supported native engine (`claude`, `codex`, `antigravity`, `gemini`) strictly owns its own session implementation (`session.ts`).

### Core module descriptions

| Module | File path | Technical responsibility |
| --- | --- | --- |
| **CLI Entry** | `src/cli.ts` | Parses startup arguments, handles immediate flags (`--help`, `--version`), verifies interactive TTY capabilities, and invokes the visual selectors or legacy Pi startup. |
| **App Options** | `src/app/options.ts` | Validates and extracts the `--engine` option (`claude`, `codex`, `antigravity`, `gemini`, `pi`). |
| **App Native Chat** | `src/app/native-chat.ts` | Composition root: spawns the background engine process, hooks the JSON-RPC or stream peer, and binds `CodexSession`, `AntigravitySession`, or `GeminiSession` to the UI without coupling the UI to process management. |
| **Engines Types** | `src/engines/types.ts` | Defines canonical interfaces: `NativeSession` (lifecycle, `logout?()`, `login()`), `NativeModel`, `NativeEvent`, `Approve`, and `Emit`. |
| **Engines Discovery** | `src/engines/discovery.ts` | Scans system `PATH` for supported executable binaries (`claude`, `codex`, `agy`). On Windows, resolves npm packages without triggering `.cmd` command shims. |
| **Engines Process** | `src/engines/process.ts` | Prepares subprocess environment, rejects conflicting billing-route variables (such as API keys), and spins up `JsonRpcPeer`. |
| **Engines Logout** | `src/engines/logout.ts` | Shared `confirmedLogout` helper: requests interactive consent informing the user that disconnection is strictly local to the current Shell session. |
| **Engine Claude** | `src/engines/claude/` | Integrates with Claude Code via SDK; manages subscription preflight checks (`auth.ts`), turns and tool approvals (`session.ts`), and telemetry for tokens, context, and quota limits (`telemetry.ts`). |
| **Engine Codex** | `src/engines/codex/` | Spawns `codex app-server` and drives JSON-RPC communication over stdio for ChatGPT account verification, model listings, streaming deltas, `/login`, and local `/logout`. |
| **Engine Antigravity** | `src/engines/antigravity/` | Integrates with Google Antigravity CLI (`agy`) via `stream-json` (`process.ts`), checks accounts without rogue terminal ownership (`account-command.ts`), and manages interactive chat (`session.ts`). |
| **Engine Gemini** | `src/engines/gemini/` | Drives Google Gemini CLI via `gemini --acp --approval-mode default` using Agent Client Protocol (ACP v1) with `oauth-personal` authentication. |
| **Engine Pi** | `src/engines/pi/` | Legacy connector wrapping `@earendil-works/pi-coding-agent`, preserving isolated profile storage in `~/.forge614-shell/agent`. |
| **UI Startup** | `src/ui/startup/` | Interactive terminal selectors shown before chat: visual interface picker (`visual-picker.ts`) and engine picker (`engine-picker.ts`). |
| **UI Basic** | `src/ui/basic/` | AI-first split terminal interface: workspace (`workspace.ts`), contextual sidebar (`sidebar.ts`), framed composer (`composer.ts`), activity cards (`transcript.ts`), braille metrics (`metrics.ts`), session state (`shell-state.ts`), condensed status bar (`status-bar.ts`), and Forge614 theme (`theme.ts`). Detailed in [05-basic-ui-sidebar-quotas.md](05-basic-ui-sidebar-quotas.md). |
| **Infrastructure Browser** | `src/infrastructure/browser.ts` | Safely opens the default operating system browser (`open`, `rundll32`, or `xdg-open`) strictly for verified OAuth endpoints (`auth.openai.com` and `accounts.google.com`) without shell interpolation. |
| **Infrastructure Project** | `src/infrastructure/project-info.ts` | Non-blocking Git branch and changed files resolution, with graceful fallback when Git is unavailable. |
| **Infrastructure RPC** | `src/infrastructure/rpc.ts` | `JsonRpcPeer`: bidirectional JSON-RPC client and server over standard streams (`stdin`/`stdout`), featuring request correlation, timeouts, and buffer protection. |

---

## 3. Authentication and shared profile architecture decision

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

## 4. The local `/logout` command in Forge614-Shell

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

## 5. Reconnection via `/login`

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

## 6. Confirmation, cancellation, and security

1. **Cancellation semantics:**
   - Replying `/no` to `/logout` confirmation cancels the disconnect and keeps the session active.
   - Typing `/stop` aborts pending authentication probes.
   - If an account probe was aborted by `/stop` or signal cancellation, a late successful response cannot reconnect the session.
2. **Confidentiality safeguards:**
   - Account check subprocesses run with isolated streams (`stdio: ["ignore", "pipe", "pipe"]` in `account-command.ts`).
   - Stderr diagnostic streams are never dumped raw to the screen if they risk containing private tokens or settings.
3. **Clear user communication:** All UI status messages distinguish between disconnecting the Shell session and logging out of the provider account.

---

## 7. Testing conventions and verified test suite (*Colocated Tests*)

### Test suite layout (30 colocated test files)

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
│   ├── project-info.test.ts          # Non-blocking Git checks and no-repo fallback
│   └── rpc.test.ts
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
- **Automated Tests:** **124 tests passing across 32 files** (0 failures, 566 `expect()` assertions).
- **Production Build:** `dist/cli.js` bundled cleanly (149.48 KB).

> [!WARNING]
> **Verification boundaries:** These 124 automated tests verify logical contracts, state machines, local disconnection semantics, independent scroll, prompt-free quota queries, buffer bounds, mock transports, and 1.0.0 release bundling. **They do NOT constitute full manual validation of live accounts across all operating systems (Windows, Linux)**. See [05-basic-ui-sidebar-quotas.md](05-basic-ui-sidebar-quotas.md) and [06-release-1.0.0-bundle-installer.md](06-release-1.0.0-bundle-installer.md) for detailed specifications.

---

## 8. Pending scope and roadmap

1. **Orca-style visual workspace and worktree manager:** Out of scope; the model remains **one active session per terminal instance**.
2. **Cross-platform validation:** Validating executable detection and process controls across Windows and Linux distributions.
3. **Local inference runtimes:** Connectors for local open-source models (Ollama, vLLM).
4. **Bilingual UI localization (ES/EN):** The interactive terminal chat currently displays in English.
5. **Long-term memory integration (Forge614-Engram):** Formally deferred until multi-engine stabilization is complete.
