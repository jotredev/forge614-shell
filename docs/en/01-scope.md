# 01 — Forge614-Shell scope and decisions

Date: 2026-09-17 · Stage 01: product definition · Documentation revision: 1

This document records agreements with the user. It describes the intended product, not implemented features. Its counterpart is [Alcance y decisiones](../es/01-alcance.md).

## Purpose

Forge614-Shell will be a custom terminal workspace with chat for AI-assisted programming. Users will open `forge614-shell` to converse and work on their projects. Pi will provide the underlying model conversation and tools engine; the specific integration mechanism remains undecided.

The experience will combine chat, tools, provider and model selection, reasoning levels when supported by the model, sessions, and visible work status.

## Agreed decisions

| ID | Decision |
| --- | --- |
| D-001 | Forge614-Shell will be an independent project, usable without Forge614-AI or Forge614-Engram. |
| D-002 | Pi will be the underlying engine. Shell will have its own identity and interface. It will not build its own AI model. |
| D-003 | The intended command to open the experience is `forge614-shell`. |
| D-004 | Shell will open projects of any technology or structure without requiring Forge614 conventions. |
| D-005 | A project may have several work items open simultaneously. Each work item will have its own chat and may have its own branch and worktree. |
| D-006 | Switching work items in the interface must not stop other active work. |
| D-007 | Conversations can be saved and resumed without Engram. Chat history and knowledge memory are distinct capabilities. |
| D-008 | Without Git, Shell will still provide chat and file-based work; branch and worktree operations will be unavailable. |
| D-009 | Forge614-Engram will be optional for standalone Shell. Integration will be addressed last, when the Engram project is ready. |
| D-010 | Development will be incremental, with ES/EN documentation in the repository and coordinated publication to Notion through the user's other AI. |
| D-011 | TypeScript and Bun are the agreed technology preference. Their specific use and compatibility with Pi must be validated before selecting dependencies or packaging. |
| D-012 | All documentation will be numbered and indexed. Each ES/EN pair will share a number; the README will serve as the main index. |

## Expected working experience

- Sidebar navigation for projects and their work items.
- A separate chat for each work item, with session resumption.
- Several active work items in one project, each with its own working copy when using a worktree.
- Status, branch, and changes corresponding to the selected work item.
- Provider, model, and reasoning selection according to available capabilities.
- Tools, results, errors, and interactive questions visible within the chat workflow.
- Context, usage, and cost information when exposed by the engine or provider.
- Worker visibility when that capability is introduced and available; its implementation and orchestration policy are not defined yet.

A user work item is not necessarily a subagent. A mandatory one-session-per-worktree relationship has not been established either.

## References and boundaries

The eight screenshots `IMG_0276.jpg` and `IMG_0277.PNG` through `IMG_0283.PNG` were reviewed as Gentle Shell references: main chat, bottom input, status panel, agents, tasks, and interactive controls. The subsequent Orca screenshot provides the reference for navigating projects and work items on different branches. The images have not been added to the repository.

Useful behaviors will inform the product without literally copying the visual identity. Screenshots alone do not establish isolation, persistence, or internal behavior guarantees.

The preceding technical research included these code revisions:

- [Gentle Shell — ce47bae](https://github.com/Gentleman-Programming/gentle-shell/tree/ce47bae0168d4a60b43cc45d660d83901c8868dd): reference for the experience and integration on top of Pi.
- [Gentle-AI — 712ebdc](https://github.com/Gentleman-Programming/gentle-ai/tree/712ebdc78ebe57005c8f9364e21ed4b2d392ca5b): reference for installation and component boundaries.
- [Pi — e4c75a7](https://github.com/earendil-works/pi/tree/e4c75a73222ae2c72abb5f5314fa35ee8effc508): reference for the engine, sessions, extensions, SDK, and RPC. The historical `badlogic/pi-mono` link redirected to this project during research.

These revisions record what was investigated; they neither pin our future dependencies nor imply adopting the entire upstream architecture.

## Ecosystem separation

Shell must retain standalone operation. In the future, Forge614-AI may provide engineering orchestration, with Shell displaying its status, context, workers, reviews, and actions.

The complete Forge614-AI installation must prepare Shell, Pi, and Engram, as agreed in the ecosystem discussion. This repository does not design or implement that installer at this stage.

For standalone Shell, the future agreement is to offer persistent memory during setup: prepare Engram if selected, or operate without it otherwise. That connector will not be implemented or designed now. Pending integration points include memory availability, connection status, and exposed operations, subject to Engram's actual contract.

## Open decisions

- Pi extensions, SDK usage, or processes over RPC; no final architecture has been selected.
- Concurrent work management and behavior when closing, restarting, or recovering a session.
- Worktree creation, reuse, and removal; relationships between project, work item, branch, and sessions.
- Change viewer scope: complete Git status, session-attributed changes, or both.
- Access boundaries and write coordination: a worktree separates working copies but is not itself a sandbox.
- Automatic Pi installation and updates, version compatibility, platforms, and Shell distribution.
- Presentation of credentials, model capabilities, usage, and errors without inventing unavailable data.
- Notion page location and structure, pending coordination with the other AI.

## Working approach

Each stage will have agreed scope, a reviewable result, proportionate verification, and equivalent ES/EN documentation. Decisions, limitations, and outstanding issues will be recorded before moving to the next stage.

Notion updates will use an explicit handoff. Preparing content is not publication: synchronization will only be marked confirmed after receiving links and confirmation from the other AI.

### Documentation convention

- The [README](../../README.md) is the entry point and main index.
- Documents live in `docs/es/` and `docs/en/`, named `NN-topic.md` in lowercase with hyphen-separated words.
- Each topic receives a stable number shared by its ES/EN versions: `01-alcance.md` and `01-scope.md`.
- New documents are added to the index in both languages and receive the next available number. Existing documents are not renumbered to insert another topic.
- Document numbers do not represent implementation stages: a stage may produce several documents.
- Notion preserves the same number and a translated title for each page, plus the index linking both versions.
- Every documentation change updates its counterpart, affected links, and Notion synchronization status. Unpublished changes remain marked as pending.

## Stage 01 result

- Scope and decisions documented in ES/EN in the repository.
- Notion handoff prepared in [02-notion-handoff.md](02-notion-handoff.md).
- Notion publication: pending confirmation.
- User review: pending.
- No implementation, dependencies, final architecture, or approved development plan.
