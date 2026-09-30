# 08 — Troubleshooting and operational limits

Like a car fault list, this document connects each symptom to the component that can resolve it, without pretending an extinguished light is a repair.

| Symptom | Meaning and action |
| --- | --- |
| Engines absent or schema incompatible | Reinstall Forge614 Shell to repair its dependency; Shell does not search for another executable itself. |
| No chat assistants | Install and authenticate Claude Code or Codex; Shell lists only assistants Engines reports as fully supported. |
| `init` without an interactive terminal | Run the command in a real terminal; the flow requires selection and confirmation. |
| No assistants for Engram setup | No installed assistant returned `fullySupported: true`; Engram may still be initialized. |
| Engines needs to be updated | The installed Engines does not report `fullySupported` (older than 1.14.0). Run `forge614-shell update`. |
| MCP plan blocked | Engines refused the change, for example because an entry has the same name. Read the displayed reason; Shell does not force files. |
| `not configured` outcome | Planning or apply failed, or Engines returned `applied: false`. Other assistants may have completed correctly. |
| Credentials or base URL in environment | The adapter rejects authentication rerouting. Use a clean terminal and official login. |
| Missing quota/context data | The native client did not report it; Shell does not calculate or invent it. |
| «Codex did not answer the stop request…» notice | `/f614:stop` got no answer to `turn/interrupt` within 5 seconds: Shell ended the turn on its side. A timed-out request closes the transport on purpose, so nothing keeps running unattended, and Shell then reconnects by itself: it opens Codex's app-server again and, if there already was a conversation, resumes it (`thread/resume` with the same id; if there was none, it only opens a new connection), and the notice says so («…and reconnected to Codex. Your conversation is still here.»): keep working. Only if it cannot reconnect does the notice end «…and closed the connection. Restart Shell to keep working.» (a side conversation is not reconnected, so there the second wording applies). If the notice says Codex had no turn running, Shell did not close the connection and normally no restart is needed. |
| «Codex accepted the stop request but did not finish the turn…» notice | Codex confirmed `turn/interrupt` but did not end the turn (`turn/completed`) within 5 seconds: Shell ended the turn on its side and did not close the connection to Codex. Normally no restart is needed. |
| An MCP tool does not show 🧠 | Only `forge614-engram` uses that indicator. Other MCP servers show `server: tool`; a new assistant needs an adapter and protocol validation. |
| `init` returns to the prompt with no visible output | Fixed: any failure to enter or leave the alternate screen now forces a clean exit and a message on the plain terminal, with a non-zero exit code. If it still happens, rerun with `FORGE614_SHELL_DEBUG_INIT=1 forge614-shell init --product engram`. Diagnostics are never printed to the screen — mixing them with the alternate-screen render corrupts it — they are written to a private file under `$FORGE614_HOME/shell/logs/` (or `~/.forge614/shell/logs/`), whose path is printed once on the plain terminal when the command exits. The file records TTY state, key classifications (Enter/Esc/Ctrl-D/other), signals, and the exact termination reason, never secrets. |

## Known limits

Shell needs manual tests with real accounts to validate external flows and platforms beyond macOS/Linux. There is no Windows installer, worktree manager, local engine, or MCP-removal UI. `forge614-ai` does not own `forge614 init` yet.

## Maintenance verification

Run from the repository:

```bash
bun run typecheck
bun test
bun run build
```

No documentation verifier is configured in `package.json`; documentation review checks ES/EN pairs, Markdown links, the Notion map, and claims against code and tests.
