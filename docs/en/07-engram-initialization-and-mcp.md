# 07 — Engram initialization and memory integration

Like connecting several radios to one station, this flow prepares memory once and connects only the clients the person chooses.

## Purpose and entry point

Run:

```bash
forge614-shell init --product engram
```

The command requires an interactive terminal. It first shows the Engram flow: mandatory local SQLite and FTS5 storage (a text-search index), optional PostgreSQL synchronization, and optional reinforcement (ranks repeated memories higher; it does not prove they are true). After confirmation, Shell runs `forge614-engram init --json` and, if chosen, `forge614-engram reinforcement-enable`.

Cancelling before confirmation prints `Cancelled. No changes were made.` and returns exit code 130. If Engram initialization succeeds, a later memory-integration failure does not make it fail.

## What "memory integration" means

Engram's memory integration has two parts, and Shell installs both per assistant:

- The `forge614-engram` MCP server (a local standard connection that lets an AI client call a tool), so the assistant can read and save memories.
- Engram's universal memory instructions, so the assistant knows when to use them.

Shell never builds the MCP entry or the instructions content itself, and never reads an assistant's configuration files or Engram's internal files directly. It only calls `forge614-engines` and reads its JSON output.

## Memory-integration flow step by step

1. Shell calls `forge614-engines detect` and requires `schemaVersion: 1`.
2. For every installed assistant, it calls `forge614-engines capabilities --agent <id>`.
3. It offers only responses with `supportsMcp: true`. This list can include Cursor and does not depend on a chat adapter existing.
4. The person can select zero, one, or many assistants. Esc cancels memory setup; selecting zero writes nothing.
5. For every selection, Shell requests a read-only plan covering both parts at once:

```text
forge614-engines plan memory-install --agent <id>
```

   No name, command, or args flags are sent: Engines derives the `forge614-engram` MCP server and Engram's memory instructions itself.

6. One combined preview covers every selected assistant. For each one it shows the paths Engines plans to change, the MCP status (`will add`, `already configured`, or `blocked`), the memory-instructions status (`will add`, `already present`, `not supported by this assistant`, or `blocked`), and an overall status (`complete`, `partial`, or `unsupported`). Engines' own explanation for a blocked or unsupported component is shown on its own line. The screen states that nothing has been changed yet.
7. After one explicit confirmation, Shell independently applies each pending (non-noop) plan:

```text
forge614-engines apply --plan-id <id>
```

8. After each successful apply, Shell asks Engines what is actually on disk:

```text
forge614-engines verify memory-integration --agent <id>
```

9. Every selected assistant is verified this way — even one whose plan needed no writes at all, because the memory hook's *runtime* evidence is a separate question from whether its files are correctly written. When that verification shows the hook is installed but not yet runtime-observed (whether it never ran, or ran once and the evidence since expired), Shell hands the terminal to that assistant's own real binary once (never Shell's own in-app chat), lets it start for real, and verifies again once it exits. For Codex specifically, this is also how its own native hook-trust prompt gets a chance to appear — Shell never approves, skips, or bypasses it.
10. It finally reports one verified outcome per assistant: `configured — MCP and memory instructions available`, `configured; pending verification — <why>`, `partially configured — <what is missing>`, `not supported — <reason>`, `skipped`, or `not configured — <Engines' own error or conflict message>`.
11. When this run actually wrote something, Shell closes with a reminder to close and reopen each configured assistant's session so it loads the new MCP server and memory instructions. A run that changed nothing does not print it.

## Cursor is never presented as complete

Cursor has no officially supported mechanism to auto-load global instructions. Its MCP server can be configured; its memory instructions cannot. Shell therefore reports Cursor as `partially configured` and states that reason, even when Engines calls that state the complete achievable one for this assistant. Shell never invents unofficial files or hooks to compensate, and never presents Cursor as a fully complete memory integration. Its hook component is also reported `unsupported`, for the same reason.

## The memory hook and its runtime evidence

Forge614 Engines' `plan memory-install` and `verify memory-integration` also cover a third component: a `SessionStart` hook, installed for Claude Code and Codex alongside the MCP server and instructions. Shell detects support for this component structurally — by checking whether a `hook` field is present in Engines' own JSON — never by checking an Engines version number. If the installed Engines predates this feature, Shell shows: "Forge614 Engines needs to be updated. Run "forge614-shell update", then try again."

Engines can confirm the hook file itself is correctly written, but it cannot cryptographically prove a real client session ran it — so it reports two independent things: whether the hook is *structurally* installed, and a separate `runtimeStatus`:

- `runtime-observed` — a real session ran the hook recently (under 7 days) and Engram returned context. Only this state, combined with the MCP server and instructions both being in place, is reported as `configured`.
- `pending-runtime-verification` — the hook is installed but no fresh evidence exists. Its own `reason` distinguishes a hook that has *never* run (`no-evidence`, the state of every freshly-configured assistant, including the very first `plan memory-install` of a brand-new installation) from one that *has* run before but whose evidence window lapsed (`evidence-expired`). Either way, Shell's wording is the same and equally honest: nothing was lost and nothing failed — the MCP server and memory instructions remain exactly as configured, only the runtime check itself needs to run again. Shell hands the terminal to the assistant once to renew it, then verifies again.
- `needs-user-trust` — Codex specifically requires reviewing and trusting a new hook once, through its own `/hooks` command, before running it. This is a genuinely different situation from expired evidence — an unresolved trust decision, not a stale timer — and Shell never words or reports the two the same way. Shell has no way to grant or skip that trust, and never tries to.
- `unsupported` — this assistant (Cursor today) has no officially supported, stable session-start hook mechanism Engines can install.

When a selected assistant's hook is `pending-runtime-verification` (for any reason) or `needs-user-trust`, Shell hands the terminal to that assistant's own real binary — the actual `claude` or `codex` executable, not Shell's own chat interface — waits for it to exit, and verifies again. This is deliberate: Shell's own chat adapters talk to Codex over a machine-to-machine protocol that cannot show Codex's native trust prompt, and there is no need to prove Claude's SDK-driven session behaves identically to the real CLI when the real CLI is one process spawn away. Nothing about this hand-off requires a second confirmation — the person already confirmed the memory-integration change once, before anything was applied.

Evidence expires after 7 days. This never deletes memory or configuration — it only means Shell will report `configured; pending verification` again until a new real session runs the hook. `runtime-observed` is not cryptographic proof the client actually used the retrieved memory; it only means Engines observed a real, compatible `SessionStart` invocation and Engram returned context for it.

## Security and outcomes

Shell never displays or logs configuration-file `afterContent` (proposed content) or `beforeHash` (the previous-content fingerprint); the preview shows paths and statuses only. A PostgreSQL connection string entered during Engram initialization is sent only to Engram and never reaches the screen or the log at any point in the run. This applies to the hook component too — its write can touch an assistant's entire local settings file (for example Claude Code's `~/.claude/settings.json`, which also holds every existing hook and permission rule), so its `afterContent`/`beforeHash` are exactly as sensitive as the MCP entry's, and never shown.

`configured` appears only when Engines' own `verify memory-integration` confirms both parts. An error, `applied: false`, or a verification that does not confirm both parts is never reported as success. One failed assistant does not hide the other assistants' outcomes.

The infrastructure also contains `planMcpRemove` and `removeEngramMcpFromAgent`, internal foundations for future uninstallation. There is no public memory-removal command or interface yet; it must not be documented as available.

Configuration makes memory available to the selected client; it does not guarantee Shell can chat with that client or display its activity. Both capabilities require their own adapter and investigation of the assistant protocol.

## Real interpretation example

If Claude Code is already fully configured and Codex has a pending plan, the preview shows both. On confirmation Shell applies only Codex's plan, then verifies it. If Codex's apply fails, the result keeps `Claude Code: configured — MCP and memory instructions available` and reports `Codex: not configured — <Engines' message>`.
