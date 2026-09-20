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

Claude Code uses its official subscription flow and Codex uses `app-server` with ChatGPT sign-in. Both retain credentials managed by their native client. `/login` reuses the existing account or opens the official flow; `/logout` clears only Shell-session state.

## Pi, Cursor, and removed engines

`--engine pi` is a legacy non-interactive automation path. Cursor is not Shell chat, although Engines can report it for MCP. Gemini and Antigravity no longer have Shell directories, processes, authentication, or picker entries.

## Process security

Adapters reject environment variables that reroute authentication or provider selection, such as API keys or base URLs. Native processes do not print unfiltered `stderr` because it can contain private settings. Approvals and sandboxing depend on the native client; Shell makes no additional isolation promise.
