# 04 — Current architecture and engines

Think of a telephone exchange: Shell receives and displays the conversation; Engines identifies which lines exist; each AI client carries its own call.

## Layers

| Layer | Current responsibility |
| --- | --- |
| CLI (`src/cli.ts`) | Exposes help, version, `update`, `uninstall`, `init`, and interactive startup. |
| App and UI | Asks for the visual style and assistant; renders chat, status, and confirmations. |
| Infrastructure | Runs public Engines, Engram, updater, and native-process contracts. |
| Adapters | Claude Code, Codex, and Antigravity translate their protocols into Shell UI. |

## Detection and chat

At interactive startup Shell runs `~/.forge614/engines/bin/forge614-engines detect` and requires `schemaVersion: 1` (the response-format version). It displays only `claude-code`, `codex`, and `antigravity`, because they are the identifiers with a chat adapter. With `--engine claude|codex|antigravity`, Shell checks `detect` and `capabilities --agent <id>` before constructing a terminal, choosing a language, or saving preferences. If Engines is absent or does not respond, Shell reports `engines-unavailable`; an unsupported id (including `pi`), a missing adapter, or anything other than `fullySupported: true` reports `engine-not-fully-supported`. It does not run a second discovery against `PATH` (the system list of runnable programs).

Claude Code uses its official subscription flow, Codex uses `app-server` with ChatGPT sign-in, and Antigravity uses ACP (`agy acp`, JSON-RPC 2.0 over stdio) with Google subscription login (`agy acp --login`). All retain credentials managed by their native client and refuse API-key overrides. `/login` (Claude Code) or `/f614:login` (Codex and Antigravity) reuses the existing account or opens the official flow; `/logout` clears only Shell-session state.

## Launch mechanisms

Shell has three chat adapters for interactive conversation: Claude Code (Anthropic's official SDK keeping one live query open for the conversation), Codex (JSON-RPC over `app-server`), and Antigravity (JSON-RPC 2.0 over `agy acp`, providing the model and `thought_level` catalog, `default`/`accept-edits`/`auto`/`plan` work modes, streaming, history/resume, Engram MCP `🧠` tool cards, and once-per-conversation memory injection via `_meta.antigravity.systemPrompt.append` only when Engines' `SessionStart` hook is not active). Shell never spawns a native client's own binary during `init --product engram` or for memory-hook verification; it only delegates interactive sign-in when the user explicitly requests it (`/login` in Claude Code, `/f614:login` in Antigravity). Whether a memory hook's runtime evidence has actually been observed is status information Engines reports, never something Shell forces by launching a native process; see [doc 07](07-engram-initialization-and-mcp.md).

## Which assistants Shell lists

Every assistant list Shell shows contains only assistants Engines reports as fully supported (`fullySupported: true` in `capabilities --agent <id>`); today that is Claude Code, Codex, and Antigravity. Engines decides, never Shell. Pi is no longer a Shell chat engine; `pi-tui` remains the terminal UI library, and `pi-coding-agent` is used only for image thumbnails. Gemini CLI has no Shell directories, processes, authentication, or picker entries.

## Rule for new assistants

When Forge614 Engines gains an assistant, three capabilities remain separate. First, if Engines reports it `installed` and `fullySupported: true`, Shell discovers it and can offer Engram setup automatically: there is no allowlist or Shell code change. If `capabilities` lacks a boolean `fullySupported`, the installed Engines is too old and Shell asks for `forge614-shell update`; if the call itself fails, that assistant is simply not listed. Second, chatting with it always requires a new chat adapter (the layer that translates its protocol into the UI): session, authentication, models, cancellation, resume, and an explicit Shell-adapter entry; the chat selector requires both the adapter and full support. MCP does not replace that work.

Third, in-chat tool feedback exists only after that adapter exists. Every protocol reports tool calls differently; its actual shape must be investigated live with Engram configured before writing the translation. There is no safe generic detector for every assistant. The complete rule for coding assistants is in [`AGENTS.md`](../../AGENTS.md).

## Process security

Adapters reject environment variables that reroute authentication or provider selection, such as API keys or base URLs. Native processes do not print unfiltered `stderr` because it can contain private settings. Approvals and sandboxing depend on the native client; Shell makes no additional isolation promise.
