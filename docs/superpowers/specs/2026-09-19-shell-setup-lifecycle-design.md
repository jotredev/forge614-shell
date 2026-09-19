# Forge614 Shell setup and lifecycle design

**Date:** 2026-09-19  
**Status:** Approved product direction; implementation waits for the published Forge614 Engines contract.  
**Governs:** Human-guided installation, initialization, configuration, repair and confirmation flows in `forge614-shell`.  
**Constrained by:** [`FORGE614_ECOSYSTEM_CONTRACT.md`](../../../FORGE614_ECOSYSTEM_CONTRACT.md).

## 1. Purpose

Forge614 Shell is the Forge614-owned visual surface for preparing and maintaining the ecosystem. It is not a mandatory daily workspace. After a person completes setup, they may work directly in ADE Orca, Claude Code, Codex, or another native host without opening Shell.

Shell gathers human decisions, presents exact previews, obtains explicit confirmation, and displays structured results. It never becomes the owner of engine detection, memory persistence, contextualization, or global orchestration.

## 2. Scope

This design defines the visual workflow and its boundaries. A later implementation may build the screens only after the corresponding public contracts exist.

### In scope

- A guided first-time setup flow launched from Shell.
- Re-running the same flow for configuration and repair.
- Clear progress, warnings, previews, confirmations, failure recovery, and final results.
- Human choices for installed AI clients, memory mode, and optional contextualization.
- A post-setup handoff explaining that the user can return to their preferred native AI host.

### Explicitly out of scope

- Implementing `forge614-ai` or claiming the future global `forge614 init` command.
- Creating, installing, or depending on `forge614-engines` before it publishes a compatible release and JSON contract.
- Writing MCP, hooks, skills, agent configuration, memory, or Atlas context directly from Shell.
- Replacing the existing optional Shell chat workspace.
- Requiring Shell to remain open after setup.
- Adding a competing UI inside Engines, Engram, or Atlas.

## 3. Product boundary

```text
Human
  ↓ decisions and confirmations
Forge614 Shell
  ↓ structured, confirmed requests
Forge614 Engines / Engram / Atlas
  ↓ structured state, plans, progress and results
Forge614 Shell
  ↓ clear outcome and native-host handoff
Human works in Orca, Claude Code, Codex, or another configured client
```

Shell owns the presentation and collection of answers. The product that owns a capability owns the operation:

| Human-facing decision in Shell | Owning product | Shell's role |
|---|---|---|
| Which installed AI clients should receive an integration | Engines | Show detected clients and send selected IDs |
| What configuration would change | Engines | Render the read-only preview |
| Approve or reject a configuration change | Engines | Collect explicit confirmation, then request apply |
| Local-only versus synchronized persistent memory | Engram | Collect the chosen mode and show its plan/result |
| Enable repository contextualization and choose a usable agent | Atlas, using Engines | Collect choices and render lifecycle/progress |
| Product compatibility, missing-component resolution, global lifecycle | Future forge614-ai | Not implemented by Shell |

Shell must never inspect private directories, parse another product's configuration, or make a filesystem change in another product's subtree.

## 4. Guided setup journey

The same journey supports first-time setup, configuration changes, and repair. It is driven by product state, not by a hard-coded assumption that every component exists.

### 4.1 Entry and preflight

Shell explains that setup configures optional integrations and that daily work can continue in the user's normal AI client afterward. It asks no irreversible question before it has collected current state.

Shell obtains structured read-only status from available products. Until those public contracts exist, the production flow remains unavailable rather than fabricating results or silently falling back to private implementation details.

The preflight screen must identify, separately:

- Shell's installed version;
- each detected AI client and its relevant capabilities;
- whether Engines, Engram, and Atlas are installed and compatible;
- whether an existing Forge614-managed integration is detected;
- missing components, incompatible versions, unavailable capabilities, and the next safe action.

### 4.2 Select AI clients

Shell displays only clients reported by Engines. Each entry includes a label, executable/configuration availability, supported integration capabilities, and any blocking warning.

The user may select zero or more clients. Selecting zero is valid when the person only wants local Shell use or wants to configure memory first. Shell must not imply that a client is installed, signed in, or capable unless Engines reports it.

### 4.3 Select ecosystem components

Shell presents only choices supplied by the owning product's capability/status contract:

| Component | Possible human choice | Recipient |
|---|---|---|
| Persistent memory | Do not enable / local-only / synchronization if offered | Engram |
| Repository contextualization | Do not enable / enable for this repository if offered | Atlas |
| Agent for contextualization | One compatible headless-capable agent reported by Engines | Atlas |

Unavailable options remain visible with a plain explanation when this helps the user understand why they cannot continue. Shell must not expose a cloud option merely because it knows the label; Engram determines whether that option is offered.

### 4.4 Read-only consolidated preview

Before any write, Shell requests plans from the owning products and combines them into one readable preview. The preview groups changes by owner and target:

```text
Forge614 Engines
  Claude Code: add Forge614-managed MCP entry
  Codex: no change

Forge614 Engram
  Create local memory store under ~/.forge614/engram/

Forge614 Atlas
  No change
```

Every listed change must state its target, whether it is a create/update/remove/no-op, and whether it is blocked or reversible. Shell never invents a diff; it renders data returned by each product.

### 4.5 Explicit confirmation and application

The confirmation screen names every product that will make a change. Confirmation is required before Shell sends any apply request. A cancelled confirmation makes no writes.

After confirmation, Shell calls each owner's confirmed operation and renders structured progress. If one product fails, Shell shows:

- the product that failed;
- the operation that failed;
- which preceding operations completed;
- any owner-provided rollback or retry action;
- a safe way to exit without claiming setup succeeded.

Shell must not attempt compensating writes inside another product's directory. Rollback belongs to the product that owns the files.

### 4.6 Completion and handoff

On success, Shell reports the configured clients and components, then clearly states:

```text
Setup is complete. You may now close Forge614 Shell and work directly in
your configured AI client, such as Claude Code or Codex inside ADE Orca.
```

The completion screen lists only verified next actions returned by the configured products. It does not claim that an integration works until that product reports success.

## 5. Day-to-day behavior after setup

Shell remains optional. A user can open a terminal in ADE Orca and run a native client such as `claude` or `codex`; the client's Forge614-managed MCP, hook, skill, or other approved integration is what reaches the ecosystem.

No running Shell process is required for normal memory lookup, contextualization requests, or native-agent work. If an operation needs a new configuration decision or repair, the user opens Shell's lifecycle flow again.

The existing Shell chat continues to be an optional Forge614 workspace. It does not become a prerequisite or a proxy for a user's normal Claude/Codex session.

## 6. Required public inputs and outputs

Shell will consume versioned, structured contracts. The exact schemas are owned by their providers; Shell must reject unsupported schema versions with an explanatory status rather than guessing.

| Provider | Shell consumes | Shell produces |
|---|---|---|
| Engines | Client detection, capabilities, plans, apply progress/result | Selected clients, approved plan IDs, explicit confirmation |
| Engram | Initialization capabilities, status, plan, progress/result, MCP availability | Memory mode selection and explicit confirmation |
| Atlas | Availability, lifecycle state, supported agent requirements, plan, progress/result | Enable/disable choice, selected compatible agent, pause/resume request |
| Future forge614-ai | Product discovery, compatible-version resolution, global lifecycle plans | Human-approved lifecycle decision |

Shell may use local fake providers in UI tests only. Production code must replace a fake provider with the provider's published executable/API, not with copied adapter logic.

## 7. Implementation constraints

1. No setup UI imports `src/engines/*` directly.
2. A Shell-owned gateway boundary separates setup presentation from product providers.
3. No production fallback to local agent discovery/configuration is permitted once the setup flow is introduced; absent compatible contracts produce a visible blocked state.
4. Existing native-chat behavior remains unchanged unless a separate approved design modifies it.
5. All copy is in English, consistent with Shell's UI.
6. Every screen must support cancellation without writes before confirmation.

## 8. Acceptance criteria for the future implementation

1. A fresh setup clearly tells the person it is optional to use Shell after completion.
2. Shell never writes an agent config, Engram store, or Atlas state itself.
3. A preview names each owner and every requested change before confirmation.
4. Cancelling before confirmation produces zero apply calls.
5. A missing or incompatible provider is displayed as blocked; no private-file fallback is attempted.
6. An external-client handoff is shown only after providers report success.
7. The existing Shell chat can still start independently of the setup flow.
8. UI tests cover no clients detected, no optional components selected, a blocked provider, cancellation, partial failure, and successful completion.

## 9. Delivery dependency order

1. Publish the updated ecosystem contract identically in every Forge614 repository.
2. Forge614 Engines publishes its detection, capability, preview, and confirmed-apply contracts.
3. Engram exposes its non-visual initialization/status contract and MCP availability.
4. Atlas exposes availability and contextualization lifecycle contracts.
5. Shell implements this visual setup lifecycle against those published contracts.
6. Forge614-ai later becomes the global lifecycle coordinator without replacing Shell's human-facing setup flow.

Until steps 2–4 are complete, this document is a binding UI design, not authorization to create private cross-product integrations.
