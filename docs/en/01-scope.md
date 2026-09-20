# 01 — Purpose, boundaries, and ecosystem

Think of a workshop reception desk: Shell welcomes the person, shows choices, and keeps work visible; it does not manufacture the tools or store every workshop record.

Forge614-Shell is Forge614's terminal workspace with AI-assisted programming chat. It runs in the current working directory and owns the visible responsibilities: selection, confirmations, progress, and conversation.

## Current responsibilities

- Starts a chat interface for Claude Code or Codex, two locally installed AI clients.
- Asks Forge614 Engines (the internal dependency that detects assistants and prepares changes) for available assistants.
- Can initialize Forge614 Engram (the separate persistent-memory engine) through its public CLI and then offer its MCP connection (a protocol that lets an AI client use a local tool).
- Preserves the sessions and permissions supplied by each native client; it does not invent models, quotas, or permissions.

## Boundaries

- Shell is not a sandbox (an environment that independently prevents dangerous changes); permissions come from the selected client.
- Shell is not a project, tab, or worktree manager (a Git-separated working copy manager). Each instance works from its own directory.
- Shell does not store subscription credentials or revoke external accounts. `/logout` disconnects only the Shell session.
- Gemini and Antigravity are unsupported. Pi remains only for legacy non-interactive automation.
- Cursor can receive Engram MCP configuration, but cannot be launched as Shell chat.

## Ecosystem relationship

`forge614-ai` will be the future global orchestrator. Shell is the only visual experience; Engines detects and plans, Engram retains memory, and Atlas contextualizes repositories. Products communicate through public CLIs or SDKs (documented program-to-program interfaces), never private-folder imports.

## Maintenance decision

Code, tests, and current public contracts are the source of truth. Earlier decisions and deliveries remain historical material in document 03, but do not describe current capabilities when code has removed them.
