# AGENTS.md — forge614-shell

Instructions for any AI coding assistant (Claude Code, Codex, or otherwise) working in this repository.

## When Forge614 Engines adds a new agent/assistant

Three separate concerns. Do not conflate them — each requires a different (or no) amount of work here.

### 1. MCP capability detection & configuration — automatic, zero Shell code changes

`discoverMcpCapableAgents` (`src/infrastructure/forge614-engines.ts`) has no agent-id allowlist. It shows — and lets the person configure — the `forge614-engram` MCP server for whatever Engines' `detect` + `capabilities --agent <id>` reports as `installed && supportsMcp`. A new Engines-side agent appears automatically in the `forge614-shell init --product engram` MCP picker. Nothing to build here.

### 2. Chat adapter (talking to the assistant live, from inside Shell) — always requires new code, independent of MCP/memory

This is the big piece of work, and it is unrelated to whether the agent supports MCP. Building it means:

- A new `src/engines/<agent>/` directory with a session implementation. Follow `src/engines/codex/session.ts` or `src/engines/claude/session.ts`: login/auth, model catalog, message send/cancel, session resume.
- Adding the agent to `supportedShellAdapters` in `src/infrastructure/forge614-engines.ts`. This map is a **deliberate, separate allowlist** — it controls which Engines-reported ids Shell can *chat* with. It is intentionally distinct from the MCP-capability check in section 1, which has no allowlist.
- Wiring dispatch in `src/cli.ts`, and either `src/app/native-chat.ts` (if the protocol fits the generic `NativeSession`/`runNativeUI` shape Codex already uses) or a dedicated UI module like `src/ui/basic/claude.ts` if the protocol needs its own handling.
- Never reuse a local `PATH` scan for detection. `src/engines/discovery.ts` existed for this once and was deleted — Shell only ever asks Engines (`discoverSelectableEngines`) which engines are installed and chattable.

### 3. Visual "tool in use" feedback during chat (e.g. a distinct indicator when the assistant calls an MCP tool like Engram's memory) — only relevant once section 2 already exists for that agent

One more small, adapter-specific translation is needed, because each assistant reports tool calls in its own protocol shape — there is no universal, protocol-agnostic way to detect "this specific tool call was Engram's":

- **Claude Code** (`@anthropic-ai/claude-agent-sdk`): tool-use events carry `block.name`; MCP tools are namespaced `mcp__<server>__<tool>` — already detectable.
- **Codex** (`app-server` JSON-RPC): confirmed live (2026-09-20) by probing a real `app-server` session with `forge614-engram` configured. `item/started`/`item/completed` notifications for `item.type === "mcpToolCall"` carry the server and tool names as their own fields — `item.server` (e.g. `"forge614-engram"`) and `item.tool` (e.g. `"memory_search"`), plus `item.status` (`"inProgress" | "completed" | "failed"`), `item.arguments`, `item.result`, and `item.error.message`. `src/engines/codex/session.ts:239` currently discards all of this and reads `params.item.command` instead, which does not exist on an `mcpToolCall` item (that field only applies to `commandExecution` items) — this line needs to branch on `item.type` and read `item.server`/`item.tool` for the MCP case instead of a single generic `Tool: ${type}` message.
- A future agent's adapter needing this same feedback should be verified the same way: run its real protocol live with `forge614-engram` configured and inspect the actual tool-call notification shape — never assume it matches Claude's or Codex's field names.
- **Background activity** (agents/processes running without blocking the turn): the same rule applies — a new assistant must declare, with real evidence cited, whether its protocol reports it in a distinguishable way. See `docs/superpowers/specs/2026-09-22-background-activity-indicator-design.md` for the precedent in Claude Code (yes, via `task_started`/`task_updated`/`task_notification`/`background_tasks_changed`) and Codex (no, no local evidence — requires probing `app-server` live before assuming otherwise).

### Rule of thumb

"Engines detected/supports it" never implies "Shell can chat with it." "Shell can chat with it" never implies "Shell shows tool-use feedback for it." Each is a separate, explicit step — never assume one unlocks the next.
