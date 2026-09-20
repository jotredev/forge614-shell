# Shell MCP setup after `forge614-engram init`

**Date:** 2026-09-20
**Status:** Approved for implementation.
**Governs:** Extending `forge614-shell init --product engram` to offer configuring the `forge614-engram` MCP server in detected assistants, using only Forge614 Engines' public CLI.
**Constrained by:** [`FORGE614_ECOSYSTEM_CONTRACT.md`](../../../FORGE614_ECOSYSTEM_CONTRACT.md), and continues [`2026-09-20-shell-engram-init-flow-design.md`](2026-09-20-shell-engram-init-flow-design.md), whose section 2 explicitly left MCP configuration out of scope. This document is that follow-up slice.

## 1. Purpose

After Engram's memory initialization succeeds, Shell offers to register the `forge614-engram` MCP server with any detected, MCP-capable AI assistant — using Forge614 Engines' public `detect` / `plan mcp-install` / `apply` contract only. Engram never configures assistants itself; Engines never shows UI; Shell owns every question, preview, confirmation, and result line.

## 2. Scope

### In scope

- Running the MCP setup step immediately after a successful `applyEngramInit` call inside `forge614-shell init --product engram`.
- Detecting MCP-capable assistants via `forge614-engines detect`.
- Letting the person choose zero, one, or several assistants.
- Requesting a read-only plan per chosen assistant via `forge614-engines plan mcp-install`, previewing it, and requiring one explicit confirmation before any `apply` call.
- Applying confirmed plans via `forge614-engines apply --plan-id <id>` and reporting a clear per-assistant result.
- Leaving a tested, non-interactive building block (`planMcpRemove` + `applyMcpPlan`) for a future uninstall flow to call. No new interactive removal UI now.

### Explicitly out of scope

- A generic MCP manager unrelated to `forge614-engram`.
- Any Shell-side detection of assistants or their capabilities. Shell only reads what `forge614-engines detect` reports.
- Writing to `~/.claude.json`, `~/.codex/config.toml`, `~/.cursor/mcp.json`, or any other assistant config file directly. Only `forge614-engines apply` writes.
- Adding OpenCode or Antigravity to any allowlist.
- A new interactive uninstall TUI (see section 8).
- Changing anything about Engram's own `init --json` / `reinforcement-enable` contract (unchanged from the prior design doc).

## 3. Real-CLI findings this design is based on

Verified two ways: directly against the installed `forge614-engines` 1.1.0 binary (read-only calls, plus one `apply` call made in error during exploration and immediately reverted by hand — see the implementation report), and by reading the actual Engines source in the sibling `forge614-engines` repository on this machine (dev version 1.3.0) to confirm the contract precisely rather than guess at undocumented shapes:

- `forge614-engines detect` returns `{schemaVersion: 1, agents: [{id, label, installed, executable, configDir, configFound}]}`. **It never includes `supportsMcp`, in either the installed 1.1.0 binary or current source** — that is not a detection field.
- `supportsMcp` is reported by a **separate** command: `forge614-engines capabilities --agent <id>`, returning `{schemaVersion: 1, id, label, supportsMcp, supportsHooks, supportsHeadlessExec}` for one agent at a time. Confirmed working today against the installed 1.1.0 binary (`capabilities --agent claude-code` → `supportsMcp: true`). So Shell's filter is two calls: `detect` for the installed agents, then one `capabilities --agent <id>` per installed agent to read `supportsMcp`.
- `forge614-engines plan mcp-install --agent <id> --name <name> --command <path> --args <arg>` returns, on success, `{schemaVersion: 1, plan: {planId, agentId, action, noop, writes: [{path, beforeHash, afterContent}]}}`. `afterContent` is the **entire resulting config file**, which may contain unrelated secrets already stored there (confirmed directly: a real `~/.claude.json` had plaintext GitHub/GitLab tokens in unrelated `mcpServers` entries). **Shell must never read, log, or render `writes[].afterContent` or `writes[].beforeHash`.** The preview shows only the file path and the fixed entry Shell itself is requesting (name `forge614-engram`, the resolved Engram binary path, and `["mcp"]`), never the file's actual contents.
- On any failure (unknown agent, unrecognized removal target, plan not found, config conflict, etc.), Engines exits with a non-zero status and still writes a `{schemaVersion, error: {code, message}}` object to **stdout** (not stderr, unlike Engram). Shell must parse stdout for the error object even when the process exit status is non-zero. Confirmed error codes from source: `CONFLICT`, `STALE_PLAN`, `UNRECOGNIZED_ENTRY`, `PLAN_NOT_FOUND`, `UNKNOWN_AGENT`, `UNKNOWN_COMMAND`, `INTERNAL_ERROR`.
- `forge614-engines apply --plan-id <id>` returns `{schemaVersion: 1, result: {planId, applied, changedFiles}}` on success. Apply re-checks each write's `beforeHash` against the file's *current* content and throws `STALE_PLAN` if it changed since the plan was computed — an ordinary, generically-handled error case for Shell, not one requiring special code.
- `forge614-engines plan mcp-remove` takes the **same four flags as `plan mcp-install`** (`--agent`, `--name`, `--command`, `--args`): removal validates that the *entire* existing entry (not just its name) matches what this system would have installed, and refuses with `UNRECOGNIZED_ENTRY` otherwise. It does not accept just `--agent`/`--name`.

## 4. Filtering assistants

Shell shows an assistant only when: `forge614-engines detect` reports it `installed === true`, and a subsequent `forge614-engines capabilities --agent <id>` call for that same id reports `supportsMcp === true`. Both are read literally from Engines' responses; Shell adds no heuristic, no fallback, and no client-id allowlist — whatever ids Engines' `detect` reports as installed are checked, and whichever come back `supportsMcp: true` are offered. If a `capabilities` call itself fails for one agent (e.g. Engines doesn't recognize the id), that agent is silently excluded rather than shown or crashing the whole detection step — Engines' own refusal to answer is treated the same as "not confirmed capable."

## 5. Flow

Runs only after `applyEngramInit` resolves successfully. A failure of Engram's own init still aborts before this step, exactly as today.

1. Call `forge614-engines detect`, then `forge614-engines capabilities --agent <id>` for each installed agent (`discoverMcpCapableAgents`, section 4). If the `detect` call fails, Engram's init is still reported as successful; Shell prints that MCP configuration could not be offered and why, and exits `0` — a failure to detect assistants must not undo a successful memory initialization.
2. If detection returns zero eligible assistants, print that no compatible AI assistant was found and stop. No further Engines calls.
3. Otherwise show a multi-select screen (new `MultiSelectList` component; `pi-tui` has no built-in multi-select) listing every eligible assistant by label. The person may check zero, one, or several, then press Enter to confirm the selection, or Esc/Ctrl+C to skip the whole MCP step.
   - Esc/Ctrl+C here: print "MCP setup was skipped." and stop. Zero Engines calls beyond the earlier `detect`.
   - Enter with zero boxes checked: a valid, distinct choice — print that no assistant was selected and stop. Zero further Engines calls.
4. For each selected assistant, call `forge614-engines plan mcp-install` with `--name forge614-engram`, `--command <resolved Engram binary path>`, `--args mcp`. The binary path is computed the same way `forge614-engram.ts` already resolves it (`FORGE614_HOME` env override, else `~/.forge614`), exported from that module so this flow never re-implements the lookup.
   - A plan with `noop: true` needs no confirmation or apply call; record it immediately as "already configured".
   - A plan call that throws (any error response, including a conflict) is recorded as "blocked" with Engines' own message, and is not applied.
   - A plan call that succeeds with `noop: false` is pending and enters the preview.
5. If there is at least one pending plan, show one combined preview (assistant label + target file path only, never file contents) with a single Confirm/Cancel choice, matching the existing summary-screen pattern in `engram-init.ts`.
   - Cancel: every pending assistant is recorded as "skipped". Zero `apply` calls.
   - Confirm: call `forge614-engines apply --plan-id <id>` for each pending plan, independently. One assistant's apply failure does not stop or hide the others' results — each is recorded on its own ("configured" or "error" with Engines' message).
6. Print one result line per eligible assistant detected in step 1 (not just the selected ones): `configured`, `already configured`, `skipped`, or `not configured — <Engines message>` (used for both a blocked plan and a failed apply).

This mirrors `2026-09-20-shell-engram-init-flow-design.md`'s existing "one explicit confirmation before any write" rule, applied to the MCP step specifically: nothing is written before that single Confirm.

## 6. Module boundaries

- `src/contracts/mcp-agent.ts` — `McpCapableAgent { id, label, executable }`, shared between the infrastructure and UI layers (mirrors why `AvailableEngine` already lives in `contracts`).
- `src/infrastructure/forge614-engines.ts` — adds `discoverMcpCapableAgents`, `planMcpInstall`, `applyMcpPlan`, `planMcpRemove`, and the future-uninstall helper `removeEngramMcpFromAgent`, all spawning the public `forge614-engines` binary only, with the same injectable runner used by `discoverSelectableEngines` today.
- `src/infrastructure/forge614-engram.ts` — exports its existing binary-path resolution (`locateEngramBinary`) so the app layer can compute the exact `--command` value without duplicating the lookup.
- `src/ui/startup/multi-select.ts` — new `MultiSelectList` component (checkbox list: arrow keys move, Space toggles, Enter submits the checked set, Esc cancels).
- `src/ui/startup/mcp-setup.ts` — two pure screens built from `MultiSelectList` / `SelectList` / `Text` / `startupFrame`: `chooseMcpAgents` and `showMcpPreviewConfirm`. Like `engram-init.ts`, this file never calls infrastructure directly — it only asks and returns.
- `src/app/init-engram.ts` — orchestrates: calls the infrastructure functions, drives the two UI screens, and prints the final result lines (plain `console.log`, matching the existing final success line — no third TUI screen for the result).

## 7. Testing requirements

Automated (Bun test, fakes only — no test may touch a real file under a real `$HOME`):

1. Engram succeeds, no PostgreSQL, one assistant chosen and applied: exactly one `plan mcp-install` call, one `apply` call, "configured" reported.
2. PostgreSQL enabled with reinforcement: the connection string never appears in MCP-step output either (it never reaches this step at all, since it is Engram-only, but the combined `init-engram.test.ts` suite re-asserts this end to end).
3. Zero assistants chosen: Engram initializes; zero `plan`/`apply` calls.
4. Second run against a plan that reports `noop: true`: reported "already configured"; zero `apply` calls.
5. A plan call that throws (simulated conflict): shown in preview data as blocked; zero `apply` calls for that assistant.
6. Cancelling at the preview/confirm screen: zero `apply` calls; every pending assistant reported "skipped".
7. Two assistants selected, one plan+apply succeeds and the other's apply fails: both results reported correctly, independently.
8. All process-spawning tests use an injected fake runner; UI tests use the existing `TestTerminal` fixture. No test writes to a real path under `homedir()`.
9. `bun test`, `bun run typecheck`, and `git diff --check` all pass.

## 8. Future uninstall interface (not built now)

`forge614-engines plan mcp-remove --agent <id> --name forge614-engram --command <path> --args mcp` (the same four flags as install — see section 3) followed by `forge614-engines apply --plan-id <id>` is the documented removal path. This task adds `planMcpRemove` and a small composed, non-interactive `removeEngramMcpFromAgent(agentId, server, options)` helper (plan + apply, surfacing `UNRECOGNIZED_ENTRY` and other Engines errors as thrown errors) so a future uninstall command can call it directly. No interactive removal screen is added in this task.

## 9. Acceptance criteria

1. Running `forge614-shell init --product engram` end to end, after a successful Engram init, shows the assistant multi-select, then (if anything is pending) one combined preview/confirm, then a per-assistant result line — in that order, matching section 5.
2. No `forge614-engines plan` or `apply` call happens before the person reaches and confirms the relevant screen.
3. `writes[].afterContent` and `writes[].beforeHash` never reach any Shell-rendered text or thrown error message.
4. Re-running the flow against an already-configured assistant reports "already configured" and makes no `apply` call (idempotent).
5. A failure for one assistant is reported for that assistant only; other assistants' results are unaffected and still reported.
6. Engram's own success/failure reporting (from the prior design doc) is unchanged; the MCP step never turns a successful Engram init into a failed command, and never runs before Engram's own confirmation and apply.
