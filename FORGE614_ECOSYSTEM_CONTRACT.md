# Forge614 Ecosystem Contract

> **Status:** Approved product direction. This file must be copied unchanged into the root of every Forge614 product repository.  
> **Purpose:** Keep independent projects coordinated without making one project silently take responsibility for another.

## 1. The product hierarchy

`forge614-ai` is the core of the Forge614 ecosystem. It is not a small launcher and it is not ready yet. When it is ready, it will own the global `forge614` command and orchestrate the other products.

```text
forge614-ai                         Core and ecosystem orchestrator
├─ forge614-shell                   The only visual experience
├─ forge614-engines                 Installed-AI discovery and adapters
├─ forge614-engram                  Persistent memory engine
└─ forge614-atlas                   Deep repository contextualization
```

The projects are separate products with separate repositories. They must communicate through explicit public contracts, never through deep imports into another product's private folders.

## 2. Product responsibilities

| Product | Can work on its own? | Has a visual interface? | Owns |
|---|---:|---:|---|
| `forge614-ai` | Not until its core is released | It coordinates the experience | Global orchestration, lifecycle, routing, state, workflows and the future `forge614` command |
| `forge614-shell` | Yes | Yes | Chat, terminal workspace, human-facing setup, confirmations and visible status |
| `forge614-engines` | No | No | Detecting available AI engines and providing safe adapters for them |
| `forge614-engram` | Yes, as a CLI/MCP/memory engine | No | Persistent memory, SQLite, FTS5, project identity, search and optional synchronization |
| `forge614-atlas` | Not completely; it needs Engram and Engines | No | Deeply contextualizing repositories and depositing validated knowledge in Engram |

## 3. One visual experience

Forge614 Shell is the only human-facing visual experience in the ecosystem.

- Other products must not maintain their own TUI.
- Shell presents questions, choices, previews, confirmations, progress, warnings and results.
- Shell can work without Engram or Atlas.
- A product may expose a non-interactive CLI or SDK for automation, but it must not duplicate Shell's setup interface.

## 4. The future global initialization flow

When `forge614-ai` is ready, it will own this command:

```text
forge614 init
```

`forge614 init` will coordinate products and then hand the human-facing flow to Forge614 Shell:

```text
forge614-ai checks installed Forge614 products
        ↓
resolves missing compatible components with clear user notice
        ↓
Forge614 Shell opens the visual flow
        ↓
Forge614 Engines reports available AI engines
        ↓
Shell collects the user's decisions and shows a preview
        ↓
approved components apply only the confirmed changes
```

Until `forge614-ai` exists, no other product may claim to own `forge614 init`. Transitional product-specific commands may remain for compatibility, but they are temporary and must be designed to hand control to Shell where a visual flow is necessary.

## 5. Forge614 Engines

Forge614 Engines is an internal dependency, never a standalone application.

- It is installed automatically when a product requires it.
- It detects installed AI engines, executable availability, configuration locations and capabilities.
- It prepares read-only plans and previews.
- It does not display a TUI.
- It does not write configuration by itself.
- Shell requests a proposed change, shows it to the user and requests explicit confirmation before Engines applies it.
- Atlas consumes Engines to decide which available AI engine can run its non-interactive workers.

## 6. Forge614 Engram

Engram is the persistent memory engine, not a setup interface.

It owns:

- its private storage under `~/.forge614/engram/`;
- local SQLite and FTS5;
- optional PostgreSQL synchronization;
- persistent memories, project identities (`projectId`), shared memories, search and sessions;
- its MCP server and public TypeScript SDK.

It must preserve non-interactive commands and SDK operations for automation, such as:

```text
forge614-engram init --json
forge614-engram mcp
forge614-engram search ...
```

Engram must not own a TUI, discover AI engines or directly present assistant-configuration choices. Shell and Engines own those responsibilities.

During first-time memory initialization, Engram needs only these decisions:

| Need | Decision |
|---|---|
| Private product directory | Always required |
| Local SQLite and FTS5 | Always required |
| PostgreSQL synchronization | Optional |
| Reinforcement from repeated memories | Optional |
| Detecting AI engines | Not an Engram responsibility |
| Configuring AI integrations | Not an Engram responsibility |
| Creating or selecting projects | Not part of initialization |

## 7. Forge614 Atlas

Atlas is the deep-contextualization orchestrator. It works behind Engram; it is neither the memory store nor the visual workspace.

```text
Forge614 Engines finds usable AI engines
        ↓
Forge614 Atlas analyzes a repository and runs non-interactive workers
        ↓
Workers return raw analysis to Atlas
        ↓
Atlas validates, organizes and writes structured knowledge to Engram
        ↓
Engram becomes the durable source of truth for context and progress
```

Atlas rules:

- Atlas consumes the public Engine contract; it does not implement a second engine detector.
- Atlas uses Engram's public TypeScript SDK, not Engram's private files or ad-hoc database access.
- Atlas is the only writer of its structured contextualization results; workers never write directly to Engram.
- Atlas does not create a competing progress database. Its resumable progress belongs in Engram sessions and memories.
- Atlas has no TUI. Shell owns every human decision, progress screen and confirmation.
- Atlas may report structured progress to Shell through an explicit public contract.

## 8. Installation and ownership boundaries

All products live under one shared parent, but each owns only its own directory:

```text
~/.forge614/
├─ shell/
├─ engines/
├─ engram/
└─ atlas/
```

| User installs | Required installed components |
|---|---|
| `forge614-shell` | Shell and Engines |
| `forge614-engram` | Engram, Shell and Engines |
| `forge614-atlas` | Atlas, Engram and Engines; Shell is used for visual flows when available |
| `forge614-engines` | Not installed directly by a person |
| `forge614-ai` | Will coordinate all compatible components when released |

Installation rules:

1. Missing components come from compatible, verified releases.
2. Checksums are verified before installation.
3. The user is told what component and version will be installed.
4. No product replaces another product's files or data.
5. No product deletes `~/.forge614/` as a whole.
6. Each product repairs permissions only inside its own directory.
7. Installing a binary never silently configures AI integrations or creates memories.

## 9. Uninstallation rules

Each product removes only its own directory and its own integration entries.

Engram is a required dependency of Atlas. Therefore, removing Engram while Atlas exists must require this exact explicit confirmation:

```text
REMOVE FORGE614-ENGRAM AND FORGE614-ATLAS
```

That operation removes only:

```text
~/.forge614/engram/
~/.forge614/atlas/
```

It must never remove Shell, Engines, the shared parent directory, or unrelated user files.

## 10. Required public contracts

No repository may depend on another repository's internal source folders.

| Provider | Consumer | Required contract |
|---|---|---|
| Engines | Shell | Detection results, capabilities, read-only change previews and confirmed application/removal operations |
| Engines | Atlas | Available executable engines and safe non-interactive launch capabilities |
| Engram | Shell | Non-interactive memory initialization, status and MCP availability |
| Engram | Atlas | Public TypeScript SDK for projects, sessions, structured memory writes and search |
| Atlas | Shell | Contextualization lifecycle, progress, pause/resume and final report |
| forge614-ai | All products | Future product discovery, compatible-version resolution and global lifecycle contracts |

## 11. Implementation order

No product should implement its final integration before the required public contract exists.

1. `forge614-ai`: define the future core orchestration and product lifecycle contracts.
2. `forge614-engines`: publish detection, preview and application contracts.
3. `forge614-shell`: implement the single visual initialization experience against those contracts.
4. `forge614-engram`: remove its TUI and assistant ownership while preserving CLI, MCP and SDK contracts.
5. `forge614-atlas`: consume Engines and Engram contracts; report lifecycle to Shell.
6. Add end-to-end tests for install, `forge614 init`, setup, update and uninstall across products.

## 12. Working rule for every repository

Before changing a cross-product behavior, the responsible agent must:

1. Read this contract.
2. Identify the public contract it consumes or publishes.
3. Verify that the dependency already exists or declare it blocked.
4. Avoid temporary deep imports, duplicate storage, duplicate detection and duplicate TUI flows.
5. Update this contract in every Forge614 repository only when the product decision itself changes.
