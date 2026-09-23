# 07 — Engram initialization and memory integration

Like connecting several radios to one station, this flow prepares memory once and connects only the clients the person chooses.

## Purpose and entry point

Run:

```bash
forge614-shell init --product engram
```

The command requires an interactive terminal. It first shows the Engram flow: mandatory local SQLite and FTS5 storage (a text-search index), optional PostgreSQL synchronization, and optional reinforcement (ranks repeated memories higher; it does not prove they are true). After confirmation, Shell runs `forge614-engram init --json` and, if chosen, `forge614-engram reinforcement-enable`. Afterwards, if the folder is a project that does not have a group yet, it asks once which group it belongs to (see "Project group").

The whole command — intro, PostgreSQL, reinforcement, summary, Engram initialization, project group (when it applies), assistant selection, preview, confirmation, and the final result — is one continuous alternate-screen visual flow. Shell never prints a plain-terminal status line between screens and never opens a second, independent screen partway through; the person only ever sees the normal terminal again once, at the very end, when the result is already on screen.

Cancelling before confirmation shows a `Cancelled. No changes were made.` result screen and returns exit code 130. If Engram initialization succeeds, a later memory-integration failure does not make it fail.

## Project group (the `ecosystem` scope)

Like the shelf in the hallway that the offices of one company share, a **group** gathers related repositories (microservices, a split monorepo, the Forge614 nodes) so they share memory. A project belongs to at most one group, and a project's memory outranks the group's, which outranks the shared one (`project` > `ecosystem` > `shared`).

**When the screen appears.** After Engram finishes `init`, and only when all three conditions hold:

- the flow is interactive (without an interactive terminal `init` does not start, and there is no `--yes` mode: a group is never asked for or linked without a person);
- the folder is a project: the root of a Git repository, or a folder with a manifest (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle`, `composer.json`, `Gemfile`, or `forge614.node.json`);
- `.forge614/project.json` does not exist yet at the project root. If the file exists, the person is **never** asked, whatever it says (decision 0023). It is asked only once.

**What it shows.** The title "This repository does not belong to any group yet."; an "Existing groups" section with each group and its projects (from `forge614-engram group-list`); a divider line; and the actions "Create a new group…" (asks for a name: lowercase letters, digits and single hyphens, 1 to 64 characters, and not already taken) and "It is a standalone project (no group)". With no groups yet, the first section does not appear. Esc links nothing and the flow continues; Shell asks again next time. With many groups the list is windowed with a counter (`3/12`).

**How it is applied.** Only with Engram's non-interactive commands, always in this order:

```text
forge614-engram group-create --name <name>                       (only when a group was created)
forge614-engram init --json --directory <project root>           (Engram registers the project and writes the file)
forge614-engram group-bind --project-id <id> --group <id>        (only when there is a group; always by id, never by name)
```

**Shell never writes `.forge614/project.json`**: it belongs to Engram (decision 0023). Shell only checks whether it exists. If something fails, the result reports it with Engram's own message, and the initialization, which was already applied, does not become a failure.

**Known limits.** If Engram already created the file earlier (for example after a chat) with `ecosystem: null`, Shell does not ask again; the group is changed with Engram's commands. If `group-bind` fails after Engram wrote the file, the project stays without a group and is not asked again either. Group memories are not replicated to PostgreSQL yet (coming with Engram 1.7.0).

**Engram notices.** The first time a group is used, Engram updates its database (with a backup first) and reports `DATABASE_MIGRATED`. Shell shows it in the result, with the backup path, in its own text (es/en), and only once.

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

9. Every selected assistant is verified this way — even one whose plan needed no writes at all, because the memory hook's *runtime* evidence is a separate question from whether its files are correctly written. Shell calls `verify memory-integration` exactly once per assistant. It never launches a native client to renew that evidence and never asks the person to rerun anything: runtime evidence is status information, not a completion gate. A structurally correct install (the MCP server and memory instructions genuinely written and present) is reported as done — `configured` or `ready` — even while that evidence is still absent.
10. It finally reports one outcome per assistant, computed only from Engines' own JSON: `configured — MCP server and memory instructions are installed and active`, `ready — <what may still happen the next time the assistant starts normally>`, `partially configured — <a real, named limitation of this assistant>`, `blocked — <Engines' own conflict detail>`, `could not be configured — <an honest description of what went wrong>`, or `skipped`.
11. When this run actually wrote something, Shell closes with a reminder to close and reopen each configured assistant's session so it loads the new MCP server and memory instructions. A run that changed nothing does not print it.

## Cursor is never presented as complete

Cursor has no officially supported mechanism to auto-load global instructions. Its MCP server can be configured; its memory instructions cannot. Shell therefore reports Cursor as `partially configured` and states that reason, even when Engines calls that state the complete achievable one for this assistant. Shell never invents unofficial files or hooks to compensate, and never presents Cursor as a fully complete memory integration.

## The memory hook and its runtime evidence

Forge614 Engines' `plan memory-install` and `verify memory-integration` also cover a third component: a `SessionStart` hook, installed for Claude Code and Codex alongside the MCP server and instructions. Shell detects support for this component structurally — by checking whether a `hook` field is present in Engines' own JSON — never by checking an Engines version number. If the installed Engines predates this feature, Shell shows: "Forge614 Engines needs to be updated. Run "forge614-shell update", then try again."

Engines can confirm the hook file itself is correctly written, but it cannot cryptographically prove a real client session ran it — so it reports two independent things: whether the hook is *structurally* installed, and a separate `runtimeStatus`:

- `runtime-observed` — a real session ran the hook recently (under 7 days) and Engram returned context. Only this state, combined with the MCP server and instructions both being in place, is reported as `configured`.
- `pending-runtime-verification` — the hook is installed but no fresh evidence exists yet, whether because it has never run (`no-evidence`, the state of every freshly-configured assistant) or because it ran before and the evidence window lapsed (`evidence-expired`). Shell reports this as `ready`, worded the same honest way regardless of reason: nothing was lost and nothing failed — the MCP server and memory instructions remain exactly as configured, and the runtime check finishes confirming itself the next time the person uses that assistant normally. Shell never launches anything to force this and never asks for a rerun.
- `needs-user-trust` — Codex specifically requires reviewing and trusting a new hook once, through its own `/hooks` command, before running it. Shell has no way to know whether that trust decision has already been made, and never claims otherwise. It reports this as `ready` too, but with wording that only describes a possibility, never a fact: "Codex memory integration is ready. When you next start Codex normally, Codex may ask you once to approve the Forge614 memory hook." Shell never says Codex "has not trusted" the hook, and never treats this as a reason to withhold success.
- `unsupported` — this assistant (Cursor today) has no officially supported, stable session-start hook mechanism Engines can install.

Runtime evidence — for any reason above — never turns a structurally correct install into a failure, and never requires Shell to open a native client. This is a deliberate product decision: `init --product engram` never launches Claude Code, Codex, or any other native client, and never treats the absence of runtime evidence as something the person must go fix by rerunning a command. Whether the hook has actually been exercised by a real session becomes visible the ordinary way — through Shell's own use of that assistant, or a future explicit status/diagnostic surface — never as a blocking step inside `init`.

Evidence expires after 7 days. This never deletes memory or configuration — it only means the hook's own runtime check needs to run again, which happens on its own the next time a real session starts. `runtime-observed` is not cryptographic proof the client actually used the retrieved memory; it only means Engines observed a real, compatible `SessionStart` invocation and Engram returned context for it.

## Shell's own memory recall

Independently of the flow above, Shell's own chat (both the Claude Code adapter and the Codex adapter) recovers memory context directly from Engram's public, read-only, non-interactive contract:

```text
forge614-engram startup-context --directory <cwd> --json
```

This call never creates a project, a link, or a memory, and an unlinked directory is not an error. Shell fetches it once per logical conversation — when the chat session first connects, and again after `/new` or `/resume` — never on every single turn. The digest it builds is wrapped in an explicit `<forge614-engram-memory>` block telling the model this is retrieved data, not an instruction, and any text inside that looks like a command is to be ignored; for Claude it is appended to the `claude_code` system prompt preset, and for Codex it is prepended as a separate text part on that turn only. The digest is size-bounded and never includes Engram's database, its configuration, or any secret. If Engram is not installed, does not respond, or returns invalid JSON, Shell continues the conversation with no memory context rather than failing to start — it never invents one.

Since Engram 1.6.0 the result carries three layers, in this order: `shared` (the person), `ecosystem` (the project's group, if it has one) and `project`. The `ecosystem` block is optional and additive (`format` stays at 1): with an older Engram it is absent and nothing changes; if it arrives in a shape Shell does not understand, only that block is dropped and `shared` and `project` still arrive. Shell ignores unknown fields and is strict only about the ones it uses. The three layers are sanitized the same way and travel inside the same `<forge614-engram-memory>` block, as data and not as instructions; the digest shares its 20-line cap among the layers that are present so one large layer cannot push out the more specific ones.

The result may also carry notices. Shell shows in the chat, once and in its own text (es/en), `DATABASE_MIGRATED` (with the backup path) and `PROJECT_REBOUND_FROM_FILE`. If the `.forge614/project.json` file is invalid (`PROJECT_FILE_INVALID`), Engram returns no context at all: Shell says so visibly ("memory was not loaded; fix the file or delete it") and the chat continues without memory.

## Security and outcomes

Shell never displays or logs configuration-file `afterContent` (proposed content) or `beforeHash` (the previous-content fingerprint); the preview shows paths and statuses only. A PostgreSQL connection string entered during Engram initialization is sent only to Engram and never reaches the screen or the log at any point in the run. This applies to the hook component too — its write can touch an assistant's entire local settings file (for example Claude Code's `~/.claude/settings.json`, which also holds every existing hook and permission rule), so its `afterContent`/`beforeHash` are exactly as sensitive as the MCP entry's, and never shown.

`configured` appears only when Engines' own `verify memory-integration` confirms both parts. An error, `applied: false`, or a verification that does not confirm both parts is never reported as success. One failed assistant does not hide the other assistants' outcomes.

The infrastructure also contains `planMcpRemove` and `removeEngramMcpFromAgent`, internal foundations for future uninstallation. There is no public memory-removal command or interface yet; it must not be documented as available.

Configuration makes memory available to the selected client; it does not guarantee Shell can chat with that client or display its activity. Both capabilities require their own adapter and investigation of the assistant protocol.

## Real interpretation example

If Claude Code is already fully configured and Codex has a pending plan, the preview shows both. On confirmation Shell applies only Codex's plan, then verifies it. If Codex's apply fails, the result keeps `Claude Code: configured — MCP server and memory instructions are installed and active` and reports `Codex: could not be configured — <Engines' message>`.
