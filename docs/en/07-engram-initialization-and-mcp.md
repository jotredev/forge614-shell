# 07 — Engram initialization and MCP configuration

Like connecting several radios to one station, this flow prepares memory once and connects only the clients the person chooses.

## Purpose and entry point

Run:

```bash
forge614-shell init --product engram
```

The command requires an interactive terminal. It first shows the Engram flow: mandatory local SQLite and FTS5 storage (a text-search index), optional PostgreSQL synchronization, and optional reinforcement (ranks repeated memories higher; it does not prove they are true). After confirmation, Shell runs `forge614-engram init --json` and, if chosen, `forge614-engram reinforcement-enable`.

Cancelling before confirmation prints `Cancelled. No changes were made.` and returns exit code 130. If Engram initialization succeeds, a later MCP failure does not make it fail.

## MCP flow step by step

1. Shell calls `forge614-engines detect` and requires `schemaVersion: 1`.
2. For every installed assistant, it calls `forge614-engines capabilities --agent <id>`.
3. It offers only responses with `supportsMcp: true`. This list can include Cursor and does not depend on a chat adapter existing.
4. The person can select zero, one, or many assistants. Esc cancels MCP setup; selecting zero writes nothing.
5. For every selection, Shell requests a read-only plan:

```text
forge614-engines plan mcp-install --agent <id> --name forge614-engram \
  --command <real-path-to-forge614-engram> --args mcp
```

6. The combined preview shows the assistant and only the file path that would change, or `already configured`, or `blocked` with its reason.
7. After one explicit confirmation, Shell independently applies each pending plan:

```text
forge614-engines apply --plan-id <id>
```

8. It finally reports one status per assistant: `configured`, `already configured`, `skipped`, or `not configured — <reason>`.

## Security and outcomes

Shell never displays or logs configuration-file `afterContent` (proposed content) or `beforeHash` (the previous-content fingerprint). `configured` appears only when Engines returns `applied: true`; an error or `applied: false` is `not configured`. One failed assistant does not hide other assistants' outcomes.

The infrastructure also contains `planMcpRemove` and `removeEngramMcpFromAgent`, internal foundations for future uninstallation. There is no public MCP-removal command or interface yet; it must not be documented as available.

## Real interpretation example

If Claude Code is already configured and Codex has a pending plan, the preview shows both. On confirmation Shell does not apply Claude and applies only Codex's plan. If Codex fails, the result retains `Claude Code: already configured` and reports `Codex: not configured — ...`.
