# 04 — Current architecture and engines

Think of a telephone exchange: Shell receives and displays the conversation; Engines identifies which lines exist; each AI client carries its own call.

## Layers

| Layer | Current responsibility |
| --- | --- |
| CLI (`src/cli.ts`) | Exposes help, version, `update`, `uninstall`, `init`, and interactive startup. |
| App and UI | Asks for the visual style and assistant; renders chat, status, and confirmations. |
| Infrastructure | Runs public Engines, Engram, updater, and native-process contracts. |
| Adapters | Claude Code and Codex translate their protocols into Shell UI. |

## Detection and chat

At interactive startup Shell runs `~/.forge614/engines/bin/forge614-engines detect` and requires `schemaVersion: 1` (the response-format version). It displays only `claude-code` and `codex`, because they are the only identifiers with a chat adapter. If Engines is absent, incompatible, or invalid, Shell fails with repair guidance; it does not run a second discovery against `PATH` (the system list of runnable programs).

Claude Code uses its official subscription flow and Codex uses `app-server` with ChatGPT sign-in. Both retain credentials managed by their native client. `/login` (Claude Code) or `/f614:login` (Codex) reuses the existing account or opens the official flow; `/logout` clears only Shell-session state.

## Launch mechanisms

Shell has two chat adapters for interactive conversation: Claude Code (which uses Anthropic's official SDK and keeps one query open for the whole conversation; it opens it again in the background only if you change the effort, it does not answer a stop, or with `/new` and `/resume`; if it dies, or the account is lost, it opens it again with the next message or when the account is connected) and Codex (which uses JSON-RPC over `app-server`). Shell never spawns a native client's own real binary and hands it the terminal — not during `init --product engram`, not for memory-hook verification, and not anywhere else. Whether a memory hook's runtime evidence has actually been observed is status information Engines reports, never something Shell forces by launching a native process; see [doc 07](07-engram-initialization-and-mcp.md).

## Which assistants Shell lists

Every assistant list Shell shows contains only assistants Engines reports as fully supported (`fullySupported: true` in `capabilities --agent <id>`); today that is Claude Code and Codex. Engines decides, never Shell. Gemini and Antigravity no longer have Shell directories, processes, authentication, or picker entries.

## Rule for new assistants

When Forge614 Engines gains an assistant, three capabilities remain separate. First, if Engines reports it `installed` and `fullySupported: true`, Shell discovers it and can offer Engram setup automatically: there is no allowlist or Shell code change. If `capabilities` lacks a boolean `fullySupported`, the installed Engines is too old and Shell asks for `forge614-shell update`; if the call itself fails, that assistant is simply not listed. Second, chatting with it always requires a new chat adapter (the layer that translates its protocol into the UI): session, authentication, models, cancellation, resume, and an explicit Shell-adapter entry; the chat selector requires both the adapter and full support. MCP does not replace that work.

Third, in-chat tool feedback exists only after that adapter exists. Every protocol reports tool calls differently; its actual shape must be investigated live with Engram configured before writing the translation. There is no safe generic detector for every assistant. The complete rule for coding assistants is in [`AGENTS.md`](../../AGENTS.md).

## Process security

Adapters reject environment variables that reroute authentication or provider selection, such as API keys or base URLs. Native processes do not print unfiltered `stderr` because it can contain private settings. Approvals and sandboxing depend on the native client; Shell makes no additional isolation promise.
