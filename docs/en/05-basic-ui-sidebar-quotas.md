# 05 — Basic UI, sidebar, and quotas

2026-09-17 · Stage 02: base environment implementation (in progress) · Documentation revision: 2 · [Español](../es/05-interfaz-basic-panel-cuotas.md) · [Index](../../README.md)

This document details the implementation of the **Basic visual interface**, the **contextual sidebar**, the **bottom status bar with project identity**, the **grouped command menu and keyboard selection system**, **Codex native skill discovery (`$`)**, **switchable work modes (`Shift+Tab`)**, **independent scroll control**, **non-invasive quota refreshing (`/refresh`)**, and verified software quality backed by **122 automated tests across 31 files** in Forge614-Shell.

---

## 1. The Master Analogy: The Cockpit with Flight Instruments

Imagine the cockpit of a high-performance vehicle or reconnaissance aircraft:
- **The Main Windshield (Chat and Composer):** The Heads-Up Display (*HUD*) directly ahead of the pilot. Projecting straight in front is the forward flight log (chat history) and the control wheel (the framed composer), ergonomically styled so commands and messages can be entered without glancing away.
- **The Steering Wheel Mode Selector (`Shift+Tab`):** Rather than typing verbose configuration commands, a tactile switch on the control wheel allows cycling through operational flight modes on the fly: manual control with strict confirmation, automated assistance in trusted zones, or pure planning modes. If the unrestrained mode (`▶▶ bypass permissions on`) is selected, the warning indicator turns bright red; this mode is never engaged automatically upon ignition.
- **The Specialized Tool Chest (`$` in Codex):** Pressing the `$` key opens the craft's specialized equipment locker (local project skills, user skills, or installed plugins), inserting the exact technical reference into the prompt without flooding telemetry channels.
- **The Instrument Panel (Contextual Sidebar):** To the right sits the diagnostic flight instruments. It does not guess fuel quantities: it probes real engine sensors. If the telemetry sensor sends context data, it draws a circular digital gauge using compact braille characters; if the sensor is absent or the engine does not report it, the gauge honestly displays *"Measurement unavailable"*. Internal vendor-only metrics are suppressed to avoid visual noise, and Shell's own memory footprint is reported with precision.
- **The Navigation Status Bar (Footer):** Below the main windshield, a condensed horizontal bar continuously displays the compact working path (`~/project`), the Git branch in cyan, and the repository status (`Clean` or `X changes` in warning amber).
- **The Steering Dampers (Independent Scrolling):** Looking around the navigation maps on the side panel does not jerk the steering wheel or the windshield. Both panes scroll independently, absorbing inertia so inspecting metrics never disrupts the workspace.

---

## 2. Basic Interface of Forge614-Shell

The initial interface adopted is an **AI-first terminal experience** designed to maximize usable area for reading and code writing:

```
┌────────────────────────────────────────────────────────┬──────────────────────────────────────┐
│ FORGE614 / SHELL                         workspace-dir │ // SESSION                           │
├────────────────────────────────────────────────────────┤ Account   Connected                  │
│                                                        │ Provider  Claude Code / Codex / agy  │
│ ## YOU · 14:25                                         │ Model     claude-3-7-sonnet          │
│ Explain the workspace initialization lifecycle         │ Session   New conversation           │
│                                                        │                                      │
│ ## ASSISTANT · 14:25                                   │ // CONTEXT                           │
│ The initialization sequence consists of three parts... │   ⢀⣴⣶⣦⡀    Conversation              │
│                                                        │   ⣾⣿ 18% ⣿⣷  18% used · 82% free       │
│ │ ▾ Bash tool                                          │   ⠈⠻⣶⡿⠃   36k / 200k tokens         │
│ │ Running · 0.4s                                       │                                      │
│                                                        │ // PLAN USAGE                        │
│                                                        │ 5-hour limit · 32% used              │
│                                                        │ ████████░░░░░░░░░░░░░░░░             │
│                                                        │ Resets in 3h 12m                     │
│                                                        │                                      │
│                                                        │ // RESOURCES                         │
│                                                        │ Shell RAM   48.2 MB                  │
│                                                        │ Engine RAM  Not reported by engine   │
│                                                        │                                      │
│ ╭─ ● Ready ──────────────────────────────────────────╮ │                                      │
│ │                                                    │ │                                      │
│ │ Type a message or command...                       │ │                                      │
│ │                                                    │ │                                      │
│ │ Ⅱ manual mode on   asks before risky actions · ⇥  │ │                                      │
│ ╰────────────────────────────────────────────────────╯ │                                      │
├───────────────────────────────────────────────────────────────────────────────────────────────┤
│ F614 · Claude Code · claude-3-7-sonnet · ctx 18% · ~/project · main · Clean                   │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Visual and Design Characteristics
1. **Forge614 Design Palette (`theme.ts`):**
   - **Terminal background:** Deep dark theme (`#0c1318` / `rgb(12, 19, 24)`), isolated within the alternate screen buffer (`\x1b[?1049h`) and cleanly restoring host terminal colors on exit (`workspaceTerminal`).
   - **Cyan accent:** `#46dee0` (`rgb(70, 222, 224)`) for titles, borders, progress bars, and cursors.
   - **Foreground text:** `#dce6eb` (`rgb(220, 230, 235)`).
   - **Muted text & borders:** `#889eab` (`rgb(136, 158, 171)`) and `#31454e` (`rgb(49, 69, 78)`).
   - **Card & block background:** Muted background `#141f27` (`rgb(20, 31, 39)`).
2. **Startup visual picker (`visual-picker.ts`):**
   - On launching `forge614-shell`, the user is prompted to select:
     - `Basic — Minimal interface` (available and selected by default).
     - `Full — Coming later (disabled)` (disabled; if selected, the picker displays a hint explaining that Full is reserved for future stages and re-prompts for Basic).
3. **The Framed Composer (`composer.ts`):**
   - Cyan outer border with rounded corners (`╭─`, `╮`, `│`, `╰─`, `╯`).
   - Integrated status label in the top rule: `● Ready` when awaiting instructions or `● Working` when AI or tools are active.
   - Native support for newlines with `Shift+Enter` and message submission via `Enter`.
   - Internal helper line: dynamically renders the active work mode (e.g. `Ⅱ manual mode on` with `asks before risky actions · Shift+Tab to cycle`) or command navigation shortcuts (`/help or /commands · Browse commands` on the left and `Shift+Enter newline` on the right).
   - Responsive horizontal margins (`margin = width >= 14 ? 2 : 0`) ensuring perfect visual alignment between the upper chat flow and the lower input box.
   - Mouse event capture preventing low-level terminal text selection artifacts over the editor canvas.
4. **Structured Messages & Cards (`transcript.ts`):**
   - Message headers with role and timestamp (`## YOU · 14:25`, `## ASSISTANT · 14:25`).
   - Code blocks with differentiated background, borders, and rich Markdown rendering (bold, italics, lists, links).
   - **Tool Activity Cards (`ActivityCard`):** Cyan left border `│`, collapsible/expandable title (`▾` / `▸`), inner padded detail with `panelBackground`, ensuring no text touches the card's physical boundaries. Upon completion, replaces the in-flight indicator with final execution status (`Completed` or `Failed`) and duration in seconds.

---

## 3. Contextual Sidebar

The sidebar (`sidebar.ts`) occupies a flexible right column (base 36 columns, min 32, max 42), visible in viewports with width greater than or equal to 100 columns.

It groups into four strict sections, omitting deprecated buttons and redundant elements:

### 1. `// SESSION` (Active Session Details)
Displays only real telemetry reported by the connector or Shell state:
- **Account:** `Connected` (green/cyan) or transient states (`Checking…`, `Unverified`, `Disconnected`).
- **Provider:** Name of connected engine (Claude Code, Codex, Antigravity CLI, Gemini CLI).
- **User:** Email or user handle if reported (e.g. ChatGPT email in Codex); otherwise explicitly shown as `"Not reported"`.
- **Model:** Active model or `"Engine default"`.
- **Reasoning:** Active reasoning/effort level or `"Provider default"`.
- **Session:** Conversation ID or `"New conversation"`.
- **Opened & Shell uptime:** Session start time and uptime in minutes.

### 2. `// CONTEXT` (Braille Context Ring and Window Usage)
- **Braille circular chart (`contextRing` in `metrics.ts`):** Using portable Unicode Braille patterns (`U+2800` to `U+28FF`), renders a 6-row ring with centered percentage, requiring no terminal image protocols (such as Kitty Graphics or Sixel) that fail over SSH or plain terminals.
- **Real measurement:** Displays used tokens against context window limit (`36k / 200k tokens`) and percent used/free.
- **Metric honesty:** If the engine does not report context usage (such as new sessions prior to the first turn, or engines without context APIs), the sidebar displays:
  - `"Measurement unavailable"` or `"Available after first response"`.
  - **Context numbers are never simulated or fabricated.**

### 3. `// PLAN USAGE` (Provider Quota Gauges)
- Renders genuine subscription or account quota limits (`five_hour`, `seven_day`, etc.).
- Cell-based progress bars with cyan blocks `█` and background cells `░`.
- Calculated reset timestamps (`resetLabel`): `"Resets in 3h 12m"`, `"Resets in 2d 4h"`.
- **Internal bucket filtering (`isDisplayableUsage`):** Vendor-internal tracking buckets (such as `nimbus_quill`) are filtered out via `isDisplayableUsage()` and never rendered, avoiding confusion with actual user quotas.
- **Unknown quota labels:** Legitimate non-standard provider identifiers are displayed neutrally (`XYZ (provider)`).
- **API estimates vs Billing:** When inference cost estimates are exposed, they are accompanied by the mandatory disclaimer: `"Not your subscription bill"` to distinguish flat subscription tiers from API token consumption.

### 4. `// RESOURCES` (Memory Footprint)
- Replaces the former project section which has been migrated to the bottom status bar.
- **Shell RAM:** Real-time resident set size of the Shell process (`process.memoryUsage().rss`), obtained through `readRuntimeResources()` and formatted as human-readable megabytes (`formatMemory()`).
- **Engine RAM:** Memory consumed by the underlying engine process. If the engine transport does not report this metric, it displays explicitly `"Not reported by engine"`, strictly forbidding synthetic figures.

### Removal of Sidebar Refresh Button
The interactive `↻ Refresh · /refresh` button previously embedded in the sidebar has been removed to keep the sidebar as a clean, purely read-only telemetry display. Usage quota refresh is invoked strictly through the `/refresh` slash command in the composer, eliminating visual redundancy.

---

## 4. Bottom Status Bar (`ShellStatusBar`)

The status bar (`status-bar.ts`) is positioned at the bottom edge of the terminal below the chat area, consolidating session identity and repository status into a single horizontal workspace row:

```
F614 · Claude Code · claude-3-7-sonnet · ctx 18% · ~/Desktop/forge614-shell · main · Clean
```

### Elements and Semantic Colors:
1. **Shell Indicator:** `F614` prefix in cyan accent (`accent`).
2. **Condensed Telemetry:** Connected provider, active model, reasoning level, and context occupancy percentage (`ctx XX%`), shown only when confirmed.
3. **Project Identity:**
   - **Compact Path:** Current working directory formatted relative to the user's home directory via `homeRelativePath` (e.g. `~/Desktop/forge614-shell`) in muted gray (`muted`).
   - **Git Branch:** Active branch name in cyan (`accent`, e.g. `main` or `Detached HEAD`), retrieved using non-blocking checks (`GIT_OPTIONAL_LOCKS=0`).
   - **Change Status:**
     - Clean working tree: `Clean` in cyan (`accent`).
     - Modified or untracked files: `X changes` (e.g. `7 changes`) in warning amber (`warning`).
   - **Non-Git Directories:** If Git is not installed or the directory is not a repository, branch and change sections are omitted cleanly without printing error text.

---

## 5. Work Modes, Codex Skills, and Keyboard Navigation

### 5.1 Native Work Modes and Cycling with `Shift+Tab`

The user can cycle through native engine modes by pressing `Shift+Tab` whenever the composer is not busy executing an operation.

**Native-First Principle:** Forge614-Shell does not impose an artificial, homogenized mode abstraction. It faithfully mirrors the control modes provided by the active engine:

1. **Claude Code (`ClaudeSession.permissionModes`):**
   - Native SDK permission modes: `default`, `acceptEdits`, `plan`, `dontAsk`, `auto`, `bypassPermissions`.
2. **OpenAI Codex (`configRequirements/read`):**
   - Native combinations of approval policies and sandbox modes from the App Server: `onRequest:readOnly`, `onRequest:workspaceWrite`, `unlessTrusted:readOnly`, `unlessTrusted:workspaceWrite`.
3. **Gemini ACP and Antigravity:**
   - Do not expose dynamic mode switching in their current protocols; `session.workModes()` returns an empty array, and pressing `Shift+Tab` does not alter state or render misleading badges.

#### Visual Presentation and Semantic Colors (`workModePresentation`):
| Native Mode | Literal English Label | Semantic Color | Help Hint |
| :--- | :--- | :--- | :--- |
| `bypassPermissions` | `▶▶ bypass permissions on` | **Danger Red** (`255;102;136`) | `no confirmations · Shift+Tab to cycle` |
| `auto` / `unlessTrusted` | `▶▶ auto mode on` | **Warning Amber** (`warning`) | `the engine decides approvals · Shift+Tab to cycle` / `trusted workspace` |
| `default` / `onRequest` | `Ⅱ manual mode on` | **Muted Gray** (`muted`) | `asks before risky actions · Shift+Tab to cycle` / `asks for approval` |
| `acceptEdits` | `▶▶ accept edits on` | **Purple** (`176;132;255`) | `auto-approves file edits · Shift+Tab to cycle` |
| `plan` | `Ⅱ plan mode on` | **Planning Turquoise** (`52;170;166`) | `plans only; tools cannot run · Shift+Tab to cycle` |
| `dontAsk` | `Ⅱ don't ask mode on` | **Warning Amber** (`warning`) | `denies actions without prior approval · Shift+Tab to cycle` |

> [!CAUTION]
> **Critical Security Implication (`bypassPermissions`):**
> The `bypassPermissions` mode executes tools and shell commands without requesting confirmation. **Forge614-Shell NEVER boots into this mode nor enables it as a default.** It can only be activated if the user explicitly cycles to it with `Shift+Tab`, and is highlighted in vivid danger red as an active security alert.

---

### 5.2 Codex Native Skill Discovery (`$`)

In OpenAI Codex, typing `$` in the composer opens interactive completion for native skills (`CODEX SKILLS`):

1. **Discovery Scopes (`discoverCodexSkills` in `skills.ts`):**
   - **Project:** `.agents/skills` directory in current working folder and recursively up parent paths.
   - **User:** `~/.agents/skills` and `~/.codex/skills`.
   - **System:** `/etc/codex/skills`.
   - **Installed Plugins:** `~/.codex/plugins/cache/**/skills` (traversing plugin subdirectories up to depth 6).
2. **Skill Format:** Scans for `SKILL.md` files and extracts the YAML frontmatter `name:` and `description:`.
3. **Ergonomic Insertion:**
   - The selected skill is inserted as `$skill-name` directly into the composer prompt.
   - **Separation of Concerns:** Skills with `$` are distinct from slash commands (`/`). Slash commands execute control-plane actions in Shell or the engine, while `$skill` injects native contextual instructions into the prompt for Codex to resolve.
   - The raw contents of `SKILL.md` are never dumped verbatim into the user message; the structured `$name` handle is passed natively to the engine.

---

### 5.3 Grouped Command Menu (`/help` and `/commands`)

Typing `/` or invoking `/commands` / `/help` displays a popover menu organized into provider categories:

```
CLAUDE CODE
› /model    Select model
  /effort   Select reasoning
  /resume   Chat history
  /new      New conversation
  /login    Connect account
  /logout   Disconnect locally
  /status   Session details
  /stop     Cancel active turn
FORGE614
  /refresh  Refresh plan usage
  /commands Browse commands
  /quit     Exit Shell
Commands · 1–5 of 11 · ↑/↓ choose · Enter confirm · Esc cancel
```

- **Strict Categorization:**
  - Engine commands are shown first under the active engine banner (`CLAUDE CODE`, `CODEX`, `GEMINI CLI`, `ANTIGRAVITY CLI`).
  - Shell-owned commands are shown second under `FORGE614`: strictly `/refresh`, `/commands`, and `/quit`.
  - **Zero Duplication:** `/model`, `/effort`, `/resume`, etc., reside exclusively under the engine category and are never duplicated under Forge614.
- **Navigation Counter:** The footer shows real-time list position (`Commands · 1–5 of 11 · ↑/↓ choose · Enter confirm · Esc cancel`).
- **Keyboard Navigation:** Up/Down arrows (`↑/↓`), selection with `Enter` or `Tab`, and dismissal with `Esc`.

---

### 5.4 Native Model and Reasoning Pickers (Claude Code)

- **`/model`:** Opens an interactive picker populated from Claude's native catalog (`session.models`), showing human-friendly names (`displayName`) and descriptions (`description`), e.g. `claude-3-7-sonnet · Most intelligent model`. If the catalog has not been fetched yet, Shell runs a control-plane handshake that **never sends prompts or consumes tokens**. If an argument is provided (`/model claude-3-5-haiku`), it validates against the catalog before applying.
- **`/effort` or `/thinking`:** Opens a picker containing only the reasoning effort levels supported by the selected model (`supportedEffortLevels`, such as `default`, `low`, `medium`, `high`, `xhigh`, `max`). If the model lacks reasoning capabilities, Shell states honestly: *"The engine has not reported reasoning options for this model."*, preventing invalid configurations.

---

### 5.5 Permission Prompts and Turn Control

When an engine requests authorization to run a tool on the host system (such as writing a file or executing a shell command), the composer displays:
```
Permission · /yes allow once · /no deny · /stop cancel turn
› /no   Deny
  /yes  Allow this call only
```
- **Keyboard & Slash Shortcuts:** The user can navigate with arrow keys and press Enter, or type `/yes`, `/no`, press `Esc`, or type `/stop`.
- **The `/stop` Command:** Cancels the in-flight turn or authentication sequence; **does not close Shell, does not disconnect the account, and does not revert changes** already made to the filesystem.
- **The Local `/logout` Command:** Disconnects the in-memory Forge614-Shell session; **does not perform native logout on the provider or alter Orca and other terminal sessions**.

---

## 6. Scrolling and Terminal Controls

Physical terminals operate on discrete character cell grids without subpixel smooth scrolling. To achieve fluid ergonomics within these constraints:

1. **Fully Independent Scroll (`IndependentScrollView`):**
   - Chat history (left pane) and contextual sidebar (right pane) have separate scroll hierarchies.
   - **Cross-pane drag fix:** Resolved the issue where scrolling with the mouse wheel on the sidebar dragged the main chat. `IndependentScrollView` absorbs the wheel delta within the pane hovered by the pointer, preventing residual motion from spilling over (`overscroll: "contain"`).
2. **Hidden Scrollbars with Preserved Motion:**
   - Panes are styled with `scrollbar: "hidden"`. Vertical character bars cluttering the layout have been removed while full scrollability via mouse wheel, trackpad, and keyboard is preserved.
3. **Animated Frame Steps (`advance()`):**
   - To mitigate harsh jumps during wheel bursts, `IndependentScrollView` interpolates movement toward the target position via an unref'd timer (`setTimeout` at 16 ms) with 40% fractional steps (`Math.ceil(distance * 0.4)`).
   - Reversing the wheel immediately cancels remaining forward inertia rather than making the user wait for queued animation frames.

---

## 7. Zero-Token Quota Refresh (`/refresh`)

Forge614-Shell standardizes manual usage refreshing without consuming AI tokens:

1. **Invocation:** Via the `/refresh` slash command in the composer.
2. **Zero Prompt & Token Overhead:**
   - **Claude Code (`catalog.ts`):** Performs a control-plane handshake (`loadClaudeCatalog`) with an open input generator that **never yields a user message**. It queries the SDK's internal usage API without triggering model inference.
   - **Codex (`codex/session.ts`):** Sends the RPC request `account/rateLimits/read` directly to Codex App Server, retrieving 5-hour and weekly quotas without starting a turn.
   - **Antigravity (`antigravity/process.ts`):** Runs `agy -p /usage` in a background child process, parsing quota remaining percentages without invoking the chat model.
   - **Gemini CLI (ACP):** If Gemini CLI's ACP server does not expose a quota query, the command informs clearly: `"Usage refresh is not supported by this engine"`.

---

## 8. Architecture, Tests, and Quality

The project enforces strict layer separation (UI, Application, Engines, Infrastructure) with **colocated tests**.

### Automated Verification Summary (`bun run check`):
- **122 passing tests (0 failures)** across **31 test files**, with **559 assertions (`expect()`)**.
- **Strict typecheck:** `tsc --noEmit` passed with 0 errors.
- **Production build:** `bun build src/cli.ts -> dist/cli.js` (148.84 KB).

### Key Regression Suites Verified:
| Test File | Key Scenarios Verified |
| :--- | :--- |
| `src/ui/basic/workspace-chrome.test.ts` | Framed composer as primary writing surface; native work modes with English labels and matching semantic colors; preservation of pasted newlines; narrow and wide viewport fit; rich Markdown rendering; condensed single-line status bar; compact project identity below chat; distinct semantic colors for path, branch, and Git changes. |
| `src/ui/basic/sidebar.test.ts` | Usage refresh callable without rendering a sidebar button; connected sidebar displays real telemetry and hides fabricated data; grouping of session, context, and provider usage; strict exclusion of internal Nimbus Quill bucket; disconnected sidebar hides stale engine details; per-window Shell RAM display without repeating project identity; delegation of project status to the footer. |
| `src/ui/basic/shell-state.test.ts` | Disconnecting clears engine details while preserving no stale usage; connected state exposes only Shell-owned properties; preserved Shell RAM measurement without inventing engine RAM. |
| `src/ui/basic/status-bar.ts` (tested) | Home-relative path formatting (`homeRelativePath`); Git branch and change calculations with semantic colors (cyan for clean branch, amber for modifications). |
| `src/engines/codex/skills.test.ts` | Codex skill discovery reading named `SKILL.md` files from project `.agents/skills`; discovery of skills installed through plugins (`.codex/plugins/cache`). |
| `src/engines/codex/session.test.ts` | Manual quota refresh reading account limits without starting a model turn; local logout and reconnect re-using untouched accounts; visual state cleanup; applying strictly allowed app-server modes; streaming turns and respecting denied permissions. |
| `src/engines/claude/session.test.ts` | Applying selected native permission mode to the next turn; reading context summary before closing stream; locking concurrent writers; denied and cancelled tools cannot become approvals. |
| `src/engines/claude/catalog.test.ts` | Model and quota queries without prompt emission; tolerance for legacy CLI versions. |
| `src/engines/antigravity/process.test.ts` | Remaining quota percentage conversion without prompts; termination of SIGTERM-resistant child processes. |
| `src/engines/antigravity/session.test.ts` | Local logout confirmation blocking model calls until explicit login; agy reconnection without opening external UI. |
| `src/engines/gemini/session.test.ts` | Google-only authentication and native ACP permissions; prompt-free history restoration; rejection of concurrent writers. |

---

## 9. Known Limitations

To maintain technical integrity and avoid overpromising:

1. **Terminal Graphic Constraints:**
   - Emulators cannot universally guarantee image or vector (SVG) rendering across all operating systems and SSH sessions. For this reason, the context ring is drawn with Unicode Braille rather than Kitty or Sixel graphics.
2. **Row-Based Terminal Scrolling:**
   - Terminal viewports scroll by whole character lines. While animated frame steps soften wheel motion, terminal emulators cannot scroll smoothly at the subpixel level like web browsers.
3. **Unreported Engine Metrics:**
   - When a connector (such as Gemini ACP) does not expose quotas, context occupancy, or reasoning selectors, Shell does not simulate them. Unreported metrics display *"Measurement unavailable"* or *"Usage unavailable from provider"*.
4. **Engine RAM in Decoupled Processes:**
   - When an engine runs as a detached daemon or out-of-process server, engine memory cannot be measured directly without elevated system permissions, and is reported honestly as `"Not reported by engine"`.
5. **Deferred Full Interface:**
   - Advanced multi-tabbing, visual worktree management, and multi-window workspace features remain outside the scope of this delivery and remain disabled in the startup picker.
6. **Live Production Authentication:**
   - The 122 automated tests thoroughly verify contracts and state machines through mocks and headless execution; live commercial tokens have not been manually validated across every operating system (macOS, Windows, Linux).
