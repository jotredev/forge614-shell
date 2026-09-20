# Shell visual flow for `forge614-engram init`

**Date:** 2026-09-20
**Status:** Approved for implementation.
**Governs:** A new `forge614-shell init --product engram` command and its visual flow.
**Constrained by:** [`FORGE614_ECOSYSTEM_CONTRACT.md`](../../../FORGE614_ECOSYSTEM_CONTRACT.md), and narrower in scope than [`2026-09-19-shell-setup-lifecycle-design.md`](2026-09-19-shell-setup-lifecycle-design.md).

## 1. Purpose

Forge614 Engram no longer owns a TUI. When a person runs `forge614-engram init`, Engram (outside this repository) detects that Shell is available and hands off to Shell by launching:

```text
forge614-shell init --product engram
```

This document defines what Shell does after that hand-off: a small, explicit lifecycle screen — separate from Shell's normal chat workspace — that asks the two questions Engram's public contract requires, shows a summary, asks for confirmation, and applies the confirmed decisions using only Engram's public non-interactive CLI.

This is the kind of "transitional product-specific command" the ecosystem contract allows (section 4): temporary, but designed to hand the human-facing part to Shell rather than duplicate a TUI in Engram. It does not implement the larger multi-product setup journey in `2026-09-19-shell-setup-lifecycle-design.md` — that document's Engram section remains the eventual target; this flow is the first, narrow slice of it, wired to Engram's current real contract.

## 2. Scope

### In scope

- A new CLI entry point: `forge614-shell init --product engram`.
- Its own visual screens: intro, PostgreSQL question, reinforcement question, summary/confirmation, result.
- Applying confirmed decisions by spawning Engram's public binary only: `init --json`, `init --json --postgres-url <url>`, `reinforcement-enable`.
- Clear success, cancellation and error reporting, with the correct process exit code.

### Explicitly out of scope

- Anything inside `forge614-engram` (detecting Shell, launching Shell, or any change to Engram's own CLI). Not touched by this work.
- Detecting or configuring AI clients (Claude, Codex, etc.) — that is Engines' and the broader setup flow's job, not this one.
- Creating or selecting an Engram project.
- MCP, hooks, or skill configuration.
- A generic `forge614-shell init` for any other product. Only `--product engram` is accepted; no other product name is added "just in case."
- Reading or writing `~/.forge614/engram/` or its SQLite database directly.
- Windows support for this flow (macOS/Linux only, matching Shell's current supported platforms).
- Replacing or starting Shell's normal chat workspace as a fallback for any reason.

## 3. CLI entry point

`forge614-shell init --product <name>`:

- Requires an interactive terminal (`stdin.isTTY && stdout.isTTY`). In a non-interactive terminal it fails immediately with a clear message and a non-zero exit code; it makes no Engram calls and never falls back to chat.
- Requires `--product` with exactly one value. Missing `--product` is a clear error.
- Only `--product engram` is supported today. Any other value (including a recognized future product name) is a clear, explicit error — no silent handling of other products.
- On success this branch never reaches the existing engine-selection / chat startup code in `src/cli.ts`. It is a fully separate path with its own exit.

## 4. Visual flow

All screen copy is in English, consistent with the rest of Shell's UI (per section 7 of the 2026-09-19 design).

### 4.1 Intro screen

States plainly, before asking anything:

- Forge614 Engram stores persistent memory locally on this device.
- Local SQLite + FTS5 storage is always used; this cannot be turned off here.
- This flow does not create or select a project.
- This flow does not detect or configure AI clients.

### 4.2 PostgreSQL question

- Two options: **No** (default, pre-selected) and **Yes, configure PostgreSQL synchronization**.
- Choosing Yes prompts for a single PostgreSQL connection string, entered through a masked input (characters are not echoed). This matches the one piece of data Engram's public contract actually takes: `--postgres-url <URL>` on `init --json`.
- The connection string is held only in memory for this run. It is never written to a log, never shown in the summary screen, and never included in any error message Shell prints — only "PostgreSQL: enabled/disabled" is shown.

### 4.3 Reinforcement question

- Two options: **Yes** (default, pre-selected) and **No**.
- Plain-language explanation shown on this screen: reinforcement makes repeated memories rank higher in search results; it does not verify whether a memory is true.

### 4.4 Summary / confirmation

Shows exactly:

- Local storage: SQLite + FTS5 (always).
- PostgreSQL: enabled or disabled (never the connection string).
- Reinforcement: enabled or disabled.
- The exact public Engram command(s) that will run (see section 5) — with any `--postgres-url` value itself masked, e.g. `--postgres-url ********`.
- A line stating that no AI client, MCP, hook, or project will be configured by this flow.

Options: **Confirm** and **Cancel**. Cancelling here, or pressing Esc/Ctrl+C on any earlier screen, exits without making any Engram call.

### 4.5 Apply and result

After Confirm, Shell runs the mapped Engram command(s) (section 5) and shows progress, then one of:

- **Success** — what was applied, matching what the summary promised.
- **Cancelled** — only reachable before Confirm; no partial state to report.
- **Error** — the failing command and Engram's own error message (Engram already returns `{code, error}` JSON on failure and never echoes secrets back). Shell does not claim success for anything that did not complete.

## 5. Mapping decisions to Engram's public CLI

Engram 1.1.0 exposes everything this flow needs non-interactively; there is no remaining contract gap.

| User decisions | Command(s) Shell runs |
|---|---|
| PostgreSQL disabled | `forge614-engram init --json` |
| PostgreSQL enabled, connection string `<url>` | `forge614-engram init --json --postgres-url <url>` |
| Reinforcement enabled (either PostgreSQL case) | ...followed by `forge614-engram reinforcement-enable` |
| Reinforcement disabled | (no extra command — Engram's `init --json` never enables reinforcement on its own) |

Notes carried over from reading Engram's current source (informational only — this repository does not depend on Engram's internals, only on this CLI surface and its documented `--help`/JSON contract):

- If `--postgres-url` is given and the connection fails, Engram applies **nothing** — not even local SQLite — and exits 1 with a JSON error. Shell must reflect that: it must not report local storage as initialized in that case.
- Reinforcement is always a separate call; `init --json --postgres-url` never enables it implicitly.
- Re-running `init --json` (with or without `--postgres-url`) is safe/idempotent from Shell's point of view; Shell does not need to check prior state itself.

## 6. Module boundaries

Following the repository's existing layering (`tests/architecture/layers.test.ts`: `src/engines` and `src/infrastructure` never import from `ui` or `app`):

- `src/infrastructure/forge614-engram.ts` — spawns the public Engram binary only, with an injectable runner for tests (mirrors `src/infrastructure/forge614-engines.ts`). Locates the binary at `<FORGE614_HOME or ~/.forge614>/engram/bin/forge614-engram`. Exposes functions to run `init --json` (with optional postgres URL) and `reinforcement-enable`, returning structured results and surfacing Engram's own `{code, error}` on failure. Never touches `~/.forge614/engram/*` directly.
- `src/ui/startup/engram-init.ts` — the five screens, built from the same `pi-tui` primitives already used in `src/ui/startup/visual-picker.ts` and `engine-picker.ts` (`SelectList`, `Text`, `startupFrame`, `TuiAltScreen`).
- `src/ui/startup/masked-input.ts` — a small new single-line input component that never renders typed characters, used only for the PostgreSQL connection string. `pi-tui`'s existing `Input` component always renders real characters, so it cannot be reused as-is for a secret.
- `src/app/init-engram.ts` — orchestrator: validates `--product`, requires an interactive terminal, runs the UI flow, calls the infrastructure bridge for confirmed decisions, prints the result, and sets `process.exitCode`. Mirrors how `src/app/native-chat.ts` is wired from `src/cli.ts`.
- `src/cli.ts` — a new top-level `init` branch, parsed and dispatched before the existing chat-startup logic, never falling through to it.

## 7. Exit codes

- `0` — confirmed and applied successfully.
- `130` — cancelled before confirmation (matches the convention Engram itself already uses for its own interactive `init` cancellation).
- `1` — any other error: bad/missing `--product`, non-interactive terminal, or an Engram command failing.

## 8. Testing requirements

Automated tests (Bun test, colocated with the code, following this repo's existing pattern of an injectable terminal fixture for UI and an injectable process runner for the infrastructure bridge) must cover at least:

1. `forge614-shell init --product engram` rejects a non-interactive terminal, with no Engram call made.
2. It rejects a missing or unrecognized `--product` value, with no Engram call made.
3. Cancelling (at any screen, including the summary) makes zero Engram calls.
4. Confirming with local SQLite only (PostgreSQL disabled, reinforcement disabled) runs exactly `forge614-engram init --json` and nothing else.
5. Confirming with PostgreSQL enabled runs `forge614-engram init --json --postgres-url <value>`.
6. Confirming with reinforcement enabled additionally runs `forge614-engram reinforcement-enable`, after the init call.
7. An Engram command failure is shown as a failure (using Engram's own `{code, error}` message) — Shell never prints a success message when a command failed.
8. The `init` command path never starts Shell's normal chat/engine-picker startup.
9. The PostgreSQL connection string never appears in captured stdout/stderr/logs/preview text at any point in the flow, including in error paths.

## 9. Acceptance criteria

1. Running `forge614-engram init` (outside this repo) followed by Shell opening this flow produces the exact screens described in section 4, in order.
2. No command runs before the user reaches and confirms the summary screen.
3. The commands Shell runs match section 5 exactly for every combination of the two decisions.
4. A cancelled or failed run never prints a success message and always exits non-zero.
5. This flow makes no change outside of what the two questions describe: no AI client detection/configuration, no project creation, no direct filesystem/SQLite access under `~/.forge614/engram/`.
