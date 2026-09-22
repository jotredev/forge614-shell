# 05 — Basic interface and chat

Like a car dashboard, the Basic interface shows what the engine reports; it does not invent a gauge when no sensor exists.

The Basic interface is the only available visual interface. The startup picker asks for confirmation even with one option. Claude Code and Codex are the chat assistants.

## Public in-chat controls

| Control | Effect |
| --- | --- |
| `/login` | Connects Shell to the existing native account or offers the official flow. |
| `/logout` | Disconnects only this Shell session; it does not revoke the account. |
| `/new`, `/resume` | Starts or resumes a client conversation. |
| `/model`, `/effort` | Shows or adjusts options reported by the client. |
| `/status` | Shows client-reported state. |
| `/stop`, `/quit` | Interrupts the active turn or exits. |
| `/refresh` | Requests the quotas that Codex or Claude report again; it sends no chat prompt. |
| `$` | Opens Codex skill discovery (reusable instructions). |

The status bar, sidebar, and history show project, model, context, and quotas when the client exposes them. “Not reported” means exactly that the client did not provide the value. The interface has no Gemini or Antigravity screens or commands.

## Engram memory activity

Like seeing the archive-room light turn on, the chat activity card shows when the assistant is using a memory tool without revealing configuration content.

When Claude Code or Codex calls a tool from the `forge614-engram` MCP server, the card shows `🧠` and a readable name: for example, `🧠 memory search` instead of `mcp__forge614-engram__memory_search`. The brain identifies only the known Engram server; it does not guess that other servers are memory. Another MCP displays `server: tool`, for example `github: create_issue`.

Claude Code obtains the information from the SDK tool name: `mcp__<server>__<tool>`. Codex obtains it from `item.server` and `item.tool` in its `mcpToolCall` `app-server` notifications (the JSON-RPC protocol behind its interface). Those fields were verified with a real session before the indicator was implemented. Shared logic lives in `src/engines/mcp-labels.ts` and has dedicated tests.

## Sessions and permissions

Codex lists and resumes threads in the current directory; it rejects a thread from another project or one active in another client. Codex work modes come from its configuration requirements and can combine approval policy with sandboxing. Claude retains its native history. Before an action requiring confirmation, Shell shows the question in the interface.

## Visible startup and welcome

Like waiting for an elevator while its arrow is moving, startup makes it clear that Shell is still working while it asks which engines are available.

In an interactive terminal, Shell displays the `Detecting installed AI engines…` spinner before opening the picker. Detection uses an asynchronous child process (`execFile`), rather than a synchronous wait that would freeze the process, so the animation can continue updating. On non-TTY output, it prints the same message once without animation. When the query finishes, the indicator is cleared and the normal flow continues.

The welcome frame renders `FORGE614` in bold and shows the Shell version as `v<version>` on the right when the terminal is wide enough. This identifies the application; it does not claim a Claude Code or Codex version.

## Transcript: activity, changes, and errors

Like a flight log, the history distinguishes routine events from moments that need inspection or a decision.

Routine tool calls—searches, reads, Bash, MCP/Engram, and similar events—render as a non-interactive bullet and, when available, one detail-preview line underneath. They have no border, background, or expand control: the summarized activity is all that is presented. Permission requests retain a full card because the person needs to read the context before deciding.

When Claude Code reports an `Edit` or `Write`, Shell shows a line-level diff instead of the tool's raw JSON: removed lines are red, added lines are green, context lines are muted, and a gutter shows line numbers. To keep the chat responsive, ordinary changes use a longest-common-subsequence comparison, oversized files fall back to a coarse view, and the display limits the diff to 60 rows before noting that more remain.

Claude Code and Codex both use an independent transcript view. Once you scroll away from the newest message, the floating `↓ New messages · jump to latest` button appears centered beneath the header; clicking it returns to the end. It hides automatically when the view is following the end again.

Errors such as a stopped turn, invalid command, invalid pending-permission response, or connection failure are inserted in red. `ChatText` accepts a base color so Markdown formatting preserves that visual signal instead of blending an error into an ordinary reply.

## Live status, model, and reasoning

Like the signal light on an operations console, the composer tells you whether writing can proceed, the engine is busy, or a human decision is needed.

`Ready` is green; `Working` is amber and replaces the static dot with a spinner; `Awaiting permission` is red. During an active turn, Claude Code and Codex refresh the status every half second and show elapsed time, for example `Working · 12s`. The counter stops when the turn finishes or is cancelled.

The `/model` and `/effort` menus are deliberate choices: they number options, align the primary column, and mark the active value with `✓` even while the cursor is on another option. This keeps the focused option distinct from the setting that will actually be used.

For Claude Code, the sidebar first tries to show the catalog's friendly name—for example, `Opus (1M context)`—rather than a technical identifier. If the selected value or telemetry has no exact catalog match, it turns the identifier into a readable fallback without inventing a product name.

Shell remembers selected model and reasoning independently for `claude` and `codex` in `~/.forge614/shell/preferences.json` (or under `FORGE614_HOME` when that is set). This is Shell-owned preference data; it does not modify the native CLI configuration. Reading and writing are best-effort conveniences: a missing or malformed file, a failed write, or a model no longer offered lets the session continue with available values.

In the sidebar, no explicit reasoning level is labeled `Default (auto)`. Claude Code's reasoning picker shows `Default (recommended)` and explains `Claude Code decides — shown in the sidebar after you send a message`: Claude does not report the concrete level it will resolve in advance, so Shell states that fact rather than guessing.

## Sidebar metrics

Like keeping consumption instruments beside the fuel gauge, the sidebar groups usage information together and leaves RAM as a process resource.

The latest-response tokens (`Last turn`, input and output) and estimated amount sit under `PLAN USAGE`, before `RESOURCES`; they are no longer mixed with Shell or engine RAM. The amount is labeled `Est. API cost` and always includes `Reference only, not billed`: it is a reference estimate, not a charge billed by Shell.

Compact counts use `1M`, not `1000k`, and retain one decimal only when it adds information: `1.5k`, `43k`, `1M`, and `1.5M`. The context ring and filled portions of usage bars share an alert scale: normal below 85%, amber from 85%, and red from 100%. Color therefore conveys proximity to the limit, rather than merely a visual preference.

## Background activity

When the active engine reports background work (Claude Code subagents, backgrounded processes), the sidebar shows one row per activity with its state (running, done, failed) and elapsed time; clicking it expands to show the result if the engine delivered it. The status bar adds a counter with an animated dot while activity is running. If the engine does not report this distinctly, the sidebar says so explicitly instead of silently showing an empty list — see `docs/superpowers/specs/2026-09-22-background-activity-indicator-design.md`.
