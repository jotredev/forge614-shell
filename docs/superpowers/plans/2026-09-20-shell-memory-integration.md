# Shell Memory Integration (Engines `plan memory-install`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `forge614-shell init --product engram`'s MCP-only setup step (`plan mcp-install`) with Engines' full memory-integration contract (`plan memory-install` → `apply` → `verify memory-integration`), which installs both the `forge614-engram` MCP server and Engram's universal memory instructions in one plan per assistant.

**Architecture:** Add two thin wrapper functions to the existing `src/infrastructure/forge614-engines.ts` (`planMemoryInstall`, `verifyMemoryIntegration`), mirroring the file's existing style (`planMcpInstall`, `applyMcpPlan`). Replace the MCP-only picker/preview UI (`src/ui/startup/mcp-setup.ts`) with a memory-integration picker/preview (`src/ui/startup/memory-setup.ts`) that shows MCP status, instructions status, and overall status per assistant. Rewire `src/app/init-engram.ts`'s post-init step to call the new plan → single confirmation → apply → verify sequence, deriving Shell's own reported outcome from the *verify* result rather than trusting a bare "complete" string — this is required because Engines' verify step considers Cursor "complete" once its MCP is present (Cursor structurally has no instructions mechanism), but the person configuring Shell must never be told Cursor's integration is complete.

**Tech Stack:** TypeScript, Bun test runner, `@earendil-works/pi-tui` for the terminal UI, Engines' public CLI (`forge614-engines`) as a subprocess — verified by reading the real contract in `~/Desktop/forge614-engines/src/{app/plan-memory-install.ts, app/verify-memory-integration.ts, modules/config-writer/types.ts, modules/memory-protocol/status.ts, interfaces/cli/{commands,main}.ts}`.

**Spec:** The user's Spanish spec (reproduced in full below the Global Constraints) — this plan implements it exactly, resolving one real ambiguity (see "Verify vs. plan status semantics" below).

## Global Constraints

- Never call `plan mcp-install` or `plan mcp-remove` from the Engram init flow. (`planMcpInstall` itself stays in `forge614-engines.ts` unmodified and untested-for-removal — it mirrors `planMcpRemove`/`removeEngramMcpFromAgent`, both already unused by any Shell flow today and deliberately kept as documented future building blocks. Deleting it is out of scope: the instruction is to remove its *use* from the init flow, not to delete a still-valid, still-tested wrapper over a still-valid Engines command.)
- Never build or write MCP entries directly; never read Claude Code/Codex/Cursor config files; never read Engram's internal files. Shell only calls `forge614-engines` and parses its JSON stdout.
- Never call or display `forge614-engram memory-protocol --json` — Engines fetches that internally (confirmed: `plan-memory-install.ts` calls `fetchMemoryProtocol` itself).
- Never show PostgreSQL connection strings, tokens, secrets, or connection strings in any output, preview, or log.
- The MCP name is always `forge614-engram` (Engines derives this itself from its own `ENGRAM_MCP_SERVER` constant — Shell never passes a name/command/args for memory-install, only `--agent <id>`).
- No new TUI framework — reuse `startupFrame`, `SelectList`, `MultiSelectList`, `Text` exactly as the existing `mcp-setup.ts` does.
- No new assistants, no `forge614-ai`, no changes to `forge614-engines`/`forge614-engram`/`forge614-atlas`, no release/tag/push.
- **Verify vs. plan status semantics (read before Task 3):** Engines' `plan memory-install` computes `overallStatus` as `"complete" | "partial" | "unsupported"`, where an `"unsupported"` component (e.g., Cursor's instructions) counts as *not* ok — so Cursor's plan is genuinely `"partial"`. Engines' `verify memory-integration` computes a *different* `overallStatus` of `"complete" | "partial" | "absent"`, where an unsupported component counts as ok ("the complete achievable state for this agent" — this is Engines' own documented rationale, confirmed in `verify-memory-integration.test.ts`). So after a real install, Engines' verify step reports Cursor as `"complete"`. The human spec is unambiguous that Shell must never present Cursor as fully complete. Task 3's `verificationOutcome` resolves this: Shell downgrades a verify `"complete"` to its own `"partial"` outcome whenever `instructions.supported === false`, and always explains why. This is not inventing data — it is deriving Shell's own honest label from Engines' own structured fields (`mcp.present`, `instructions.supported`, `instructions.present`) instead of parroting the bare summary string for this one documented case.
- "Conflictos y advertencias" in the preview (spec step 5) are surfaced via each component's `blocked` status `details` text — Engines' real contract has no separate "warnings" array, so this plan does not invent one.

<details>
<summary>Full user spec (Spanish, verbatim)</summary>

Actualiza Forge614 Shell para consumir la integración completa de memoria publicada por forge614-engines. Engines es la única fuente de verdad para detectar asistentes e instalar sus integraciones. La integración de memoria usa siempre el MCP canónico `forge614-engram` (nunca `engram`). Engines publica: `detect`, `plan memory-install --agent <id>`, `apply --plan-id <id>`, `verify memory-integration --agent <id>`. `plan memory-install` prepara en un único plan el MCP, las instrucciones universales, las rutas a modificar, conflictos, estado del MCP, estado de instrucciones y resultado global (`complete`/`partial`/`unsupported`). Shell no debe leer/escribir configuraciones de Claude/Codex/Cursor ni archivos internos de Engram.

Flujo esperado: (1) flujo visual actual de Engram (SQLite, Postgres opcional, refuerzo opcional, resumen/confirmación); (2) `forge614-engines detect`; (3) elegir asistentes detectados; (4) por cada uno, `plan memory-install --agent <id>` sin modificar nada; (5) una única vista previa clara (asistente, rutas, estado MCP, estado instrucciones, estado global, conflictos/advertencias, aviso de que nada ha cambiado aún); (6) una única confirmación humana; (7) `apply --plan-id <id>` por cada plan aprobado; (8) `verify memory-integration --agent <id>` tras cada apply exitoso; (9) mostrar el resultado real (complete/partial/unsupported, o el error de Engines sin afirmar que quedó configurado); (10) indicar que hay que cerrar/reabrir la sesión del asistente.

Reglas: elimina el uso de `plan mcp-install`/`plan mcp-remove` del flujo de init; no construir MCP ni ejecutar `memory-protocol --json`; nunca mostrar contraseñas/secretos; no crear TUI nueva; no crear `forge614-ai`; no agregar asistentes; no modificar otros repos; no release/push. Caso Cursor: si Engines da `partial` porque Cursor no soporta instrucciones globales, explicarlo, nunca presentarlo como completo, no inventar hooks/archivos no oficiales. Compatibilidad: instalaciones nuevas usan solo `forge614-engram`, sin migraciones.

Pruebas obligatorias: init sin asistentes seleccionados; Claude Code complete; Codex complete; Cursor partial sin afirmaciones falsas; conflicto → no aplica cambios; cancelar preview → cero escrituras; fallo de Engines → Engram queda inicializado pero el asistente no se marca configurado; apply correcto seguido de verify correcto; verify partial o absent comunicado correctamente; ninguna contraseña Postgres en salida/preview/logs; suite existente + typecheck + `git diff --check`.

</details>

---

## Task 1: Add `planMemoryInstall` and `verifyMemoryIntegration` to `forge614-engines.ts`

**Files:**
- Modify: `src/infrastructure/forge614-engines.ts`
- Test: `src/infrastructure/forge614-engines.test.ts`

**Interfaces:**
- Produces (used by Task 2 and Task 3):
  - `type MemoryComponentStatus = { kind: "unsupported"; reason: string } | { kind: "noop" } | { kind: "write" } | { kind: "blocked"; reason: string; details: string }`
  - `type MemoryOverallStatus = "complete" | "partial" | "unsupported"`
  - `interface MemoryInstallPlan { planId: string; agentId: string; noop: boolean; mcp: { path: string; status: MemoryComponentStatus }; instructions: { paths: string[]; status: MemoryComponentStatus }; overallStatus: MemoryOverallStatus }`
  - `interface MemoryVerification { agentId: string; mcp: { path: string; present: boolean }; instructions: { supported: boolean; paths: string[]; present: boolean }; overallStatus: "complete" | "partial" | "absent" }`
  - `function planMemoryInstall(options: { agentId: string; home?: string; env?: NodeJS.ProcessEnv; run?: DetectRun }): Promise<MemoryInstallPlan>`
  - `function verifyMemoryIntegration(options: { agentId: string; home?: string; env?: NodeJS.ProcessEnv; run?: DetectRun }): Promise<MemoryVerification>`
- Consumes: the file's existing `runEnginesCommand` helper (already defined above `planMcpInstall` in this file) — reused unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `src/infrastructure/forge614-engines.test.ts` (after the existing `removeEngramMcpFromAgent` tests, i.e. at the end of the file):

```ts
import { planMemoryInstall, verifyMemoryIntegration } from "./forge614-engines.ts";

test("planMemoryInstall sends only --agent and reads the full plan", async () => {
  const calls: string[][] = [];
  const plan = await planMemoryInstall({
    agentId: "claude-code",
    home: "/Users/tester",
    run: async (command, args) => {
      calls.push([command, ...args]);
      return {
        status: 0,
        stdout: JSON.stringify({
          schemaVersion: 1,
          plan: {
            planId: "plan-1",
            agentId: "claude-code",
            action: "memory-install",
            noop: false,
            writes: [{ path: "/Users/tester/.claude.json", beforeHash: "x", afterContent: "SECRET" }],
            metadata: {
              mcp: { path: "/Users/tester/.claude.json", status: { kind: "write" } },
              instructions: { paths: ["/Users/tester/.claude/CLAUDE.md"], status: { kind: "write" } },
              overallStatus: "complete",
            },
          },
        }),
        stderr: "",
      };
    },
  });
  expect(calls).toEqual([[
    "/Users/tester/.forge614/engines/bin/forge614-engines", "plan", "memory-install", "--agent", "claude-code",
  ]]);
  expect(plan).toEqual({
    planId: "plan-1",
    agentId: "claude-code",
    noop: false,
    mcp: { path: "/Users/tester/.claude.json", status: { kind: "write" } },
    instructions: { paths: ["/Users/tester/.claude/CLAUDE.md"], status: { kind: "write" } },
    overallStatus: "complete",
  });
});

test("planMemoryInstall never exposes afterContent or beforeHash", async () => {
  const plan = await planMemoryInstall({
    agentId: "claude-code", home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        plan: {
          planId: "plan-1", agentId: "claude-code", action: "memory-install", noop: false,
          writes: [{ path: "/p", beforeHash: "h", afterContent: "SECRET" }],
          metadata: {
            mcp: { path: "/p", status: { kind: "write" } },
            instructions: { paths: ["/q"], status: { kind: "write" } },
            overallStatus: "complete",
          },
        },
      }),
      stderr: "",
    }),
  });
  expect(JSON.stringify(plan)).not.toContain("SECRET");
  expect(JSON.stringify(plan)).not.toContain("beforeHash");
});

test("planMemoryInstall reports partial for an assistant whose instructions are unsupported (e.g. Cursor)", async () => {
  const plan = await planMemoryInstall({
    agentId: "cursor", home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        plan: {
          planId: "plan-cursor", agentId: "cursor", action: "memory-install", noop: false,
          writes: [{ path: "/Users/tester/.cursor/mcp.json", beforeHash: "", afterContent: "{}" }],
          metadata: {
            mcp: { path: "/Users/tester/.cursor/mcp.json", status: { kind: "write" } },
            instructions: {
              paths: [],
              status: { kind: "unsupported", reason: "Cursor has no officially supported, stable, file-based mechanism to auto-load global instructions." },
            },
            overallStatus: "partial",
          },
        },
      }),
      stderr: "",
    }),
  });
  expect(plan.overallStatus).toBe("partial");
  expect(plan.instructions.status).toEqual({
    kind: "unsupported",
    reason: "Cursor has no officially supported, stable, file-based mechanism to auto-load global instructions.",
  });
});

test("planMemoryInstall surfaces a blocked component's conflict details", async () => {
  const plan = await planMemoryInstall({
    agentId: "claude-code", home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        plan: {
          planId: "plan-1", agentId: "claude-code", action: "memory-install", noop: true, writes: [],
          metadata: {
            mcp: {
              path: "/Users/tester/.claude.json",
              status: { kind: "blocked", reason: "mcp-conflict", details: 'An existing "forge614-engram" MCP entry with different content is already present at /Users/tester/.claude.json' },
            },
            instructions: { paths: ["/Users/tester/.claude/CLAUDE.md"], status: { kind: "noop" } },
            overallStatus: "partial",
          },
        },
      }),
      stderr: "",
    }),
  });
  expect(plan.mcp.status.kind).toBe("blocked");
  expect(plan.mcp.status).toEqual({
    kind: "blocked", reason: "mcp-conflict",
    details: 'An existing "forge614-engram" MCP entry with different content is already present at /Users/tester/.claude.json',
  });
});

test("planMemoryInstall throws Engines' own message for a hard failure", async () => {
  await expect(planMemoryInstall({
    agentId: "unknown-agent", home: "/Users/tester",
    run: async () => ({ status: 1, stdout: JSON.stringify({ schemaVersion: 1, error: { code: "UNKNOWN_AGENT", message: "Unknown agent: unknown-agent" } }), stderr: "" }),
  })).rejects.toThrow("Unknown agent: unknown-agent");
});

test("planMemoryInstall rejects a malformed plan instead of guessing its shape", async () => {
  await expect(planMemoryInstall({
    agentId: "claude-code", home: "/Users/tester",
    run: async () => ({ status: 0, stdout: JSON.stringify({ schemaVersion: 1, plan: { planId: "plan-1", agentId: "claude-code", action: "memory-install", noop: true, writes: [] } }), stderr: "" }),
  })).rejects.toThrow("forge614-engines returned an invalid plan.");
});

test("verifyMemoryIntegration sends only --agent and reads the verification", async () => {
  const calls: string[][] = [];
  const verification = await verifyMemoryIntegration({
    agentId: "claude-code", home: "/Users/tester",
    run: async (command, args) => {
      calls.push([command, ...args]);
      return {
        status: 0,
        stdout: JSON.stringify({
          schemaVersion: 1,
          verification: {
            agentId: "claude-code",
            mcp: { path: "/Users/tester/.claude.json", present: true },
            instructions: { supported: true, paths: ["/Users/tester/.claude/CLAUDE.md"], present: true },
            overallStatus: "complete",
          },
        }),
        stderr: "",
      };
    },
  });
  expect(calls).toEqual([[
    "/Users/tester/.forge614/engines/bin/forge614-engines", "verify", "memory-integration", "--agent", "claude-code",
  ]]);
  expect(verification).toEqual({
    agentId: "claude-code",
    mcp: { path: "/Users/tester/.claude.json", present: true },
    instructions: { supported: true, paths: ["/Users/tester/.claude/CLAUDE.md"], present: true },
    overallStatus: "complete",
  });
});

test("verifyMemoryIntegration reports complete for Cursor once its MCP is present, per Engines' own achievable-state semantics", async () => {
  const verification = await verifyMemoryIntegration({
    agentId: "cursor", home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        verification: {
          agentId: "cursor",
          mcp: { path: "/Users/tester/.cursor/mcp.json", present: true },
          instructions: { supported: false, paths: [], present: false },
          overallStatus: "complete",
        },
      }),
      stderr: "",
    }),
  });
  // Shell's own downgrade of this case to a non-"configured" outcome is app-layer logic (Task 3),
  // not this wrapper's job — this wrapper only reports Engines' contract faithfully.
  expect(verification.overallStatus).toBe("complete");
  expect(verification.instructions.supported).toBe(false);
});

test("verifyMemoryIntegration reports absent when nothing was ever installed", async () => {
  const verification = await verifyMemoryIntegration({
    agentId: "claude-code", home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        verification: {
          agentId: "claude-code",
          mcp: { path: "/Users/tester/.claude.json", present: false },
          instructions: { supported: true, paths: ["/Users/tester/.claude/CLAUDE.md"], present: false },
          overallStatus: "absent",
        },
      }),
      stderr: "",
    }),
  });
  expect(verification.overallStatus).toBe("absent");
});

test("verifyMemoryIntegration rejects a malformed result instead of guessing its shape", async () => {
  await expect(verifyMemoryIntegration({
    agentId: "claude-code", home: "/Users/tester",
    run: async () => ({ status: 0, stdout: JSON.stringify({ schemaVersion: 1, verification: { agentId: "claude-code" } }), stderr: "" }),
  })).rejects.toThrow("forge614-engines returned an invalid verification result.");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/jorgeetrejoo/Desktop/forge614-shell && bun test src/infrastructure/forge614-engines.test.ts`
Expected: FAIL — `planMemoryInstall`/`verifyMemoryIntegration` are not exported yet.

- [ ] **Step 3: Implement `planMemoryInstall` and `verifyMemoryIntegration`**

In `src/infrastructure/forge614-engines.ts`, insert the following block between the end of `applyMcpPlan` (line 247, just before the `/**\n * Composed building block...` comment that starts `removeEngramMcpFromAgent`) and `removeEngramMcpFromAgent`:

```ts
export type MemoryComponentStatus =
  | { readonly kind: "unsupported"; readonly reason: string }
  | { readonly kind: "noop" }
  | { readonly kind: "write" }
  | { readonly kind: "blocked"; readonly reason: string; readonly details: string };

export type MemoryOverallStatus = "complete" | "partial" | "unsupported";

export interface MemoryInstallPlan {
  readonly planId: string;
  readonly agentId: string;
  readonly noop: boolean;
  readonly mcp: { readonly path: string; readonly status: MemoryComponentStatus };
  readonly instructions: { readonly paths: string[]; readonly status: MemoryComponentStatus };
  readonly overallStatus: MemoryOverallStatus;
}

export interface MemoryVerification {
  readonly agentId: string;
  readonly mcp: { readonly path: string; readonly present: boolean };
  readonly instructions: { readonly supported: boolean; readonly paths: string[]; readonly present: boolean };
  readonly overallStatus: "complete" | "partial" | "absent";
}

interface MemoryPlanPayload {
  plan?: {
    planId?: unknown;
    agentId?: unknown;
    noop?: unknown;
    metadata?: {
      mcp?: { path?: unknown; status?: unknown };
      instructions?: { paths?: unknown; status?: unknown };
      overallStatus?: unknown;
    };
  };
}

interface MemoryVerifyPayload {
  verification?: {
    agentId?: unknown;
    mcp?: { path?: unknown; present?: unknown };
    instructions?: { supported?: unknown; paths?: unknown; present?: unknown };
    overallStatus?: unknown;
  };
}

const MEMORY_COMPONENT_KINDS = new Set(["unsupported", "noop", "write", "blocked"]);
const MEMORY_OVERALL_STATUSES = new Set(["complete", "partial", "unsupported"]);
const VERIFY_OVERALL_STATUSES = new Set(["complete", "partial", "absent"]);

function toMemoryComponentStatus(value: unknown): MemoryComponentStatus {
  if (!value || typeof value !== "object" || typeof (value as { kind?: unknown }).kind !== "string" || !MEMORY_COMPONENT_KINDS.has((value as { kind: string }).kind)) {
    throw new Error("forge614-engines returned an invalid plan.");
  }
  const status = value as { kind: string; reason?: unknown; details?: unknown };
  if (status.kind === "unsupported") {
    if (typeof status.reason !== "string") throw new Error("forge614-engines returned an invalid plan.");
    return { kind: "unsupported", reason: status.reason };
  }
  if (status.kind === "blocked") {
    if (typeof status.reason !== "string" || typeof status.details !== "string") throw new Error("forge614-engines returned an invalid plan.");
    return { kind: "blocked", reason: status.reason, details: status.details };
  }
  return { kind: status.kind as "noop" | "write" };
}

function toMemoryInstallPlan(payload: unknown): MemoryInstallPlan {
  const plan = (payload as MemoryPlanPayload).plan;
  if (!plan || typeof plan.planId !== "string" || !plan.planId || typeof plan.agentId !== "string" || typeof plan.noop !== "boolean" || !plan.metadata) {
    throw new Error("forge614-engines returned an invalid plan.");
  }
  const { mcp, instructions, overallStatus } = plan.metadata;
  if (
    !mcp || typeof mcp.path !== "string" ||
    !instructions || !Array.isArray(instructions.paths) || !instructions.paths.every((p): p is string => typeof p === "string") ||
    typeof overallStatus !== "string" || !MEMORY_OVERALL_STATUSES.has(overallStatus)
  ) {
    throw new Error("forge614-engines returned an invalid plan.");
  }
  return {
    planId: plan.planId,
    agentId: plan.agentId,
    noop: plan.noop,
    mcp: { path: mcp.path, status: toMemoryComponentStatus(mcp.status) },
    instructions: { paths: instructions.paths, status: toMemoryComponentStatus(instructions.status) },
    overallStatus: overallStatus as MemoryOverallStatus,
  };
}

/**
 * Requests a read-only, all-in-one memory-integration plan (the `forge614-engram` MCP server plus
 * Engram's universal memory instructions) for one agent. Engines fetches Engram's memory protocol
 * itself; Shell never calls `forge614-engram memory-protocol --json`. Never writes anything.
 */
export async function planMemoryInstall(options: {
  agentId: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  run?: DetectRun;
}): Promise<MemoryInstallPlan> {
  const payload = await runEnginesCommand(["plan", "memory-install", "--agent", options.agentId], "plan memory-install", options);
  return toMemoryInstallPlan(payload);
}

function toMemoryVerification(payload: unknown): MemoryVerification {
  const verification = (payload as MemoryVerifyPayload).verification;
  if (
    !verification ||
    typeof verification.agentId !== "string" ||
    !verification.mcp || typeof verification.mcp.path !== "string" || typeof verification.mcp.present !== "boolean" ||
    !verification.instructions || typeof verification.instructions.supported !== "boolean" || typeof verification.instructions.present !== "boolean" ||
    !Array.isArray(verification.instructions.paths) || !verification.instructions.paths.every((p): p is string => typeof p === "string") ||
    typeof verification.overallStatus !== "string" || !VERIFY_OVERALL_STATUSES.has(verification.overallStatus)
  ) {
    throw new Error("forge614-engines returned an invalid verification result.");
  }
  return {
    agentId: verification.agentId,
    mcp: { path: verification.mcp.path, present: verification.mcp.present },
    instructions: { supported: verification.instructions.supported, paths: verification.instructions.paths, present: verification.instructions.present },
    overallStatus: verification.overallStatus as MemoryVerification["overallStatus"],
  };
}

/**
 * Asks Engines what is actually present on disk for one agent's memory integration — the source of
 * truth after an apply. Shell never assumes success from a plan or an apply result alone.
 */
export async function verifyMemoryIntegration(options: {
  agentId: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  run?: DetectRun;
}): Promise<MemoryVerification> {
  const payload = await runEnginesCommand(["verify", "memory-integration", "--agent", options.agentId], "verify memory-integration", options);
  return toMemoryVerification(payload);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/jorgeetrejoo/Desktop/forge614-shell && bun test src/infrastructure/forge614-engines.test.ts`
Expected: PASS (all tests, including the pre-existing ones).

- [ ] **Step 5: Typecheck**

Run: `cd /Users/jorgeetrejoo/Desktop/forge614-shell && bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/jorgeetrejoo/Desktop/forge614-shell
git add src/infrastructure/forge614-engines.ts src/infrastructure/forge614-engines.test.ts
git commit -m "feat: add planMemoryInstall and verifyMemoryIntegration wrappers for Engines' memory-integration contract"
```

---

## Task 2: Replace the MCP-only picker/preview UI with a memory-integration picker/preview

**Files:**
- Create: `src/ui/startup/memory-setup.ts`
- Create: `src/ui/startup/memory-setup.test.ts`
- Delete: `src/ui/startup/mcp-setup.ts`
- Delete: `src/ui/startup/mcp-setup.test.ts`

**Interfaces:**
- Consumes: `McpCapableAgent` from `../../contracts/mcp-agent.ts` (unchanged); `MemoryComponentStatus`, `MemoryOverallStatus` from `../../infrastructure/forge614-engines.ts` (Task 1).
- Produces (used by Task 3):
  - `function chooseMemoryAgents(agents: readonly McpCapableAgent[], terminal?: Terminal): Promise<string[] | undefined>`
  - `type MemoryPreviewItem = { agentLabel: string; kind: "pending"; mcpPath: string; instructionsPaths: string[]; mcp: MemoryComponentStatus; instructions: MemoryComponentStatus; overallStatus: MemoryOverallStatus } | { agentLabel: string; kind: "resolved"; mcp: MemoryComponentStatus; instructions: MemoryComponentStatus; overallStatus: MemoryOverallStatus } | { agentLabel: string; kind: "blocked"; detail: string }`
  - `function showMemoryPreviewConfirm(items: readonly MemoryPreviewItem[], terminal?: Terminal): Promise<boolean>`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/startup/memory-setup.test.ts`:

```ts
import { expect, test } from "bun:test";
import type { Terminal } from "@earendil-works/pi-tui";
import { chooseMemoryAgents, showMemoryPreviewConfirm } from "./memory-setup.ts";
import type { MemoryPreviewItem } from "./memory-setup.ts";

class TestTerminal implements Terminal {
  columns = 100; rows = 30; kittyProtocolActive = false;
  input: (data: string) => void = () => {}; output = "";
  start(input: (data: string) => void) { this.input = input; }
  stop() {}
  async drainInput() {}
  write(data: string) { this.output += data; }
  moveBy() {} hideCursor() {} showCursor() {} clearLine() {}
  clearFromCursor() {} clearScreen() {} setTitle() {} setProgress() {}
}
const tick = () => new Promise(resolve => setTimeout(resolve, 25));
const agents = [
  { id: "claude-code", label: "Claude Code", executable: "/bin/claude" },
  { id: "codex", label: "Codex", executable: "/bin/codex" },
];

test("shows every agent and submits the checked ids", async () => {
  const terminal = new TestTerminal();
  const result = chooseMemoryAgents(agents, terminal);
  await tick();
  expect(terminal.output).toContain("Claude Code");
  expect(terminal.output).toContain("Codex");
  terminal.input("\x1b[B"); terminal.input(" "); // check Codex
  terminal.input("\r");
  expect(await result).toEqual(["codex"]);
});

test("submitting with nothing checked returns an empty array, not undefined", async () => {
  const terminal = new TestTerminal();
  const result = chooseMemoryAgents(agents, terminal);
  await tick();
  terminal.input("\r");
  expect(await result).toEqual([]);
});

test("escape returns undefined without selecting anything", async () => {
  const terminal = new TestTerminal();
  const result = chooseMemoryAgents(agents, terminal);
  await tick();
  terminal.input("\x1b");
  expect(await result).toBeUndefined();
});

test("the preview screen shows a pending plan's paths, MCP status, instructions status, and overall status", async () => {
  const terminal = new TestTerminal();
  const items: MemoryPreviewItem[] = [{
    agentLabel: "Claude Code", kind: "pending",
    mcpPath: "/Users/tester/.claude.json", instructionsPaths: ["/Users/tester/.claude/CLAUDE.md"],
    mcp: { kind: "write" }, instructions: { kind: "write" }, overallStatus: "complete",
  }];
  const result = showMemoryPreviewConfirm(items, terminal);
  await tick();
  expect(terminal.output).toContain("Claude Code");
  expect(terminal.output).toContain("/Users/tester/.claude.json");
  expect(terminal.output).toContain("/Users/tester/.claude/CLAUDE.md");
  expect(terminal.output).toContain("complete");
  terminal.input("\r");
  expect(await result).toBe(true);
});

test("an unsupported instructions component explains why, and a blocked component shows its details, never a file content field", async () => {
  const terminal = new TestTerminal();
  const items: MemoryPreviewItem[] = [
    {
      agentLabel: "Cursor", kind: "pending",
      mcpPath: "/Users/tester/.cursor/mcp.json", instructionsPaths: [],
      mcp: { kind: "write" },
      instructions: { kind: "unsupported", reason: "Cursor has no officially supported mechanism to auto-load global instructions." },
      overallStatus: "partial",
    },
    { agentLabel: "Codex", kind: "blocked", detail: "A different MCP already uses this name." },
  ];
  const result = showMemoryPreviewConfirm(items, terminal);
  await tick();
  expect(terminal.output).toContain("Cursor has no officially supported mechanism to auto-load global instructions.");
  expect(terminal.output).toContain("partial");
  expect(terminal.output).toContain("Codex");
  expect(terminal.output).toContain("A different MCP already uses this name.");
  expect(terminal.output).not.toContain("afterContent");
  expect(terminal.output).not.toContain("beforeHash");
  terminal.input("\r");
  expect(await result).toBe(true);
});

test("a resolved (already-configured) item shows its status without a paths line implying a pending write", async () => {
  const terminal = new TestTerminal();
  const items: MemoryPreviewItem[] = [{
    agentLabel: "Claude Code", kind: "resolved",
    mcp: { kind: "noop" }, instructions: { kind: "noop" }, overallStatus: "complete",
  }];
  const result = showMemoryPreviewConfirm(items, terminal);
  await tick();
  expect(terminal.output).toContain("already configured");
  expect(terminal.output).toContain("already present");
  terminal.input("\r");
  expect(await result).toBe(true);
});

test("cancelling the preview returns false", async () => {
  const terminal = new TestTerminal();
  const items: MemoryPreviewItem[] = [{
    agentLabel: "Claude Code", kind: "pending",
    mcpPath: "/Users/tester/.claude.json", instructionsPaths: ["/Users/tester/.claude/CLAUDE.md"],
    mcp: { kind: "write" }, instructions: { kind: "write" }, overallStatus: "complete",
  }];
  const result = showMemoryPreviewConfirm(items, terminal);
  await tick();
  terminal.input("\x1b[B"); terminal.input("\r"); // move to Cancel, submit
  expect(await result).toBe(false);
});

test("the preview always states that nothing has changed yet", async () => {
  const terminal = new TestTerminal();
  const items: MemoryPreviewItem[] = [{ agentLabel: "Claude Code", kind: "resolved", mcp: { kind: "noop" }, instructions: { kind: "noop" }, overallStatus: "complete" }];
  const result = showMemoryPreviewConfirm(items, terminal);
  await tick();
  expect(terminal.output).toContain("Nothing has been changed yet");
  terminal.input("\r");
  await result;
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/jorgeetrejoo/Desktop/forge614-shell && bun test src/ui/startup/memory-setup.test.ts`
Expected: FAIL — `./memory-setup.ts` does not exist yet.

- [ ] **Step 3: Implement `memory-setup.ts`**

Create `src/ui/startup/memory-setup.ts`:

```ts
import { ProcessTerminal, SelectList, Text, matchesKey } from "@earendil-works/pi-tui";
import type { Terminal } from "@earendil-works/pi-tui";
import type { McpCapableAgent } from "../../contracts/mcp-agent.ts";
import type { MemoryComponentStatus, MemoryOverallStatus } from "../../infrastructure/forge614-engines.ts";
import { MultiSelectList } from "./multi-select.ts";
import { startupFrame } from "./frame.ts";
import { accent, success } from "../basic/theme.ts";

const plain = (text: string) => text;
const listTheme = { selectedPrefix: accent, selectedText: accent, description: plain, scrollInfo: plain, noMatch: plain };
const multiSelectTheme = { cursor: accent, checked: success, plain };

/** Lets the person choose zero or more assistants to configure with Engram's memory integration (MCP + instructions). Makes no Engines call itself. */
export async function chooseMemoryAgents(
  agents: readonly McpCapableAgent[], terminal: Terminal = new ProcessTerminal(),
): Promise<string[] | undefined> {
  const list = new MultiSelectList(agents.map(agent => ({ value: agent.id, label: agent.label })), multiSelectTheme);
  const hint = new Text("Space to toggle · Enter to confirm your selection (zero or more) · Esc to skip memory setup");
  const body = new Text("Choose which detected AI assistants should get Forge614 Engram's memory integration: the forge614-engram MCP server and its universal memory instructions.");
  const tui = startupFrame(terminal, "Configure Engram memory integration", list, hint, body);
  let finish!: (values: string[] | undefined) => void;
  const selection = new Promise<string[] | undefined>(resolve => { finish = resolve; });
  list.onSubmit = values => finish(values);
  list.onCancel = () => finish(undefined);
  tui.addInputListener(data => {
    if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) { finish(undefined); return { consume: true }; }
    return undefined;
  });
  const terminate = () => finish(undefined);
  process.once("SIGTERM", terminate);
  try { tui.start(); return await selection; }
  finally { process.removeListener("SIGTERM", terminate); tui.stop({ preserveScreen: true }); }
}

export type MemoryPreviewItem =
  | {
      readonly agentLabel: string;
      readonly kind: "pending";
      readonly mcpPath: string;
      readonly instructionsPaths: string[];
      readonly mcp: MemoryComponentStatus;
      readonly instructions: MemoryComponentStatus;
      readonly overallStatus: MemoryOverallStatus;
    }
  | {
      readonly agentLabel: string;
      readonly kind: "resolved";
      readonly mcp: MemoryComponentStatus;
      readonly instructions: MemoryComponentStatus;
      readonly overallStatus: MemoryOverallStatus;
    }
  | { readonly agentLabel: string; readonly kind: "blocked"; readonly detail: string };

// MCP is never reported "unsupported": Engines only reaches the planning stage for agents whose
// capabilities already confirmed MCP support, so this component's status is always noop/write/blocked.
function mcpStatusLabel(status: MemoryComponentStatus): string {
  if (status.kind === "write") return "will add";
  if (status.kind === "noop") return "already configured";
  return `blocked — ${(status as { details: string }).details}`;
}

function instructionsStatusLabel(status: MemoryComponentStatus): string {
  if (status.kind === "write") return "will add";
  if (status.kind === "noop") return "already present";
  if (status.kind === "unsupported") return `not supported by this assistant — ${status.reason}`;
  return `blocked — ${status.details}`;
}

function previewLine(item: MemoryPreviewItem): string {
  if (item.kind === "blocked") return `${item.agentLabel}: blocked — ${item.detail}`;
  const paths = item.kind === "pending"
    ? [...(item.mcp.kind === "write" ? [item.mcpPath] : []), ...(item.instructions.kind === "write" ? item.instructionsPaths : [])]
    : [];
  return [
    `${item.agentLabel}:`,
    `  paths to change: ${paths.length ? paths.join(", ") : "(none)"}`,
    `  MCP forge614-engram: ${mcpStatusLabel(item.mcp)}`,
    `  memory instructions: ${instructionsStatusLabel(item.instructions)}`,
    `  overall: ${item.overallStatus}`,
  ].join("\n");
}

function previewText(items: readonly MemoryPreviewItem[]): string {
  return [...items.map(previewLine), "Nothing has been changed yet. Confirming applies only the pending assistants above."].join("\n\n");
}

/**
 * Shows every selected assistant's memory-integration plan — paths, MCP status, instructions
 * status, and overall status — using only what Engines reported, never file content. Asks one
 * explicit confirmation, which applies only the pending (non-noop) plans.
 */
export async function showMemoryPreviewConfirm(
  items: readonly MemoryPreviewItem[], terminal: Terminal = new ProcessTerminal(),
): Promise<boolean> {
  const body = new Text(previewText(items));
  const list = new SelectList([
    { value: "confirm", label: "Confirm" },
    { value: "cancel", label: "Cancel" },
  ], 2, listTheme);
  const tui = startupFrame(terminal, "Confirm memory integration", list, undefined, body);
  let finish!: (value: boolean) => void;
  const selection = new Promise<boolean>(resolve => { finish = resolve; });
  list.onSelect = item => finish(item.value === "confirm");
  list.onCancel = () => finish(false);
  tui.addInputListener(data => {
    if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) { finish(false); return { consume: true }; }
    return undefined;
  });
  const terminate = () => finish(false);
  process.once("SIGTERM", terminate);
  try { tui.start(); return await selection; }
  finally { process.removeListener("SIGTERM", terminate); tui.stop({ preserveScreen: true }); }
}
```

- [ ] **Step 4: Delete the old MCP-only UI module**

```bash
cd /Users/jorgeetrejoo/Desktop/forge614-shell
git rm src/ui/startup/mcp-setup.ts src/ui/startup/mcp-setup.test.ts
```

(Task 3 removes the only import of it, `src/app/init-engram.ts`, in the same change set — so run this `git rm` together with Task 3's edits, or leave the old files in place until Task 3 lands if executing tasks strictly in order. Either way, both old files must be gone by the end of Task 3.)

- [ ] **Step 5: Run the new tests to verify they pass**

Run: `cd /Users/jorgeetrejoo/Desktop/forge614-shell && bun test src/ui/startup/memory-setup.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `cd /Users/jorgeetrejoo/Desktop/forge614-shell && bun run typecheck`
Expected: errors only in `src/app/init-engram.ts` (still importing the now-deleted `mcp-setup.ts`) — resolved by Task 3. If Task 3 is executed immediately after, this is expected transient breakage; do not commit Task 2 alone if `mcp-setup.ts` was already deleted in Step 4. Recommended: hold the `git rm` from Step 4 as part of Task 3's commit instead, so every commit leaves the tree typechecking cleanly.

- [ ] **Step 7: Commit**

```bash
cd /Users/jorgeetrejoo/Desktop/forge614-shell
git add src/ui/startup/memory-setup.ts src/ui/startup/memory-setup.test.ts
git commit -m "feat: add memory-integration picker/preview UI alongside the existing MCP-only one"
```

(The old `mcp-setup.ts`/`mcp-setup.test.ts` deletion is committed in Task 3, alongside removing their only caller, so no commit in this history ever fails to typecheck.)

---

## Task 3: Rewire `init-engram.ts` to the full memory-install → apply → verify flow

**Files:**
- Modify: `src/app/init-engram.ts`
- Modify: `src/app/init-engram.test.ts`
- Modify: `src/cli.ts` (one help-text line)
- Delete: `src/ui/startup/mcp-setup.ts`, `src/ui/startup/mcp-setup.test.ts` (if not already deleted in Task 2)

**Interfaces:**
- Consumes: `chooseMemoryAgents`, `showMemoryPreviewConfirm`, `MemoryPreviewItem` from `../ui/startup/memory-setup.ts` (Task 2); `planMemoryInstall`, `verifyMemoryIntegration`, `applyMcpPlan`, `discoverMcpCapableAgents`, `MemoryInstallPlan`, `MemoryVerification` from `../infrastructure/forge614-engines.ts` (Task 1 + pre-existing).
- Produces: `runInitCommand(args, options)` (public entry point, signature unchanged).

- [ ] **Step 1: Write the failing tests**

Replace everything in `src/app/init-engram.test.ts` from the line `test("choosing one MCP-capable assistant plans and applies exactly that one", ...)` through the end of the file (i.e. keep the file's first ~172 lines — the `requireEngramProduct` tests and every Engram-init-only test up to and including `"the init command never imports Shell's normal chat startup modules"` — completely unchanged) with the following:

```ts
function captureLogs(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(" ")); });
  return { logs, restore: () => spy.mockRestore() };
}

function detectPayload(agents: { id: string; label: string; executable: string }[]) {
  return { schemaVersion: 1, agents: agents.map(a => ({ ...a, installed: true })) };
}

function capabilitiesPayload(agentId: string) {
  return { schemaVersion: 1, id: agentId, label: agentId, supportsMcp: true, supportsHooks: true, supportsHeadlessExec: true };
}

function planPayload(agentId: string, opts: {
  planId?: string; noop?: boolean;
  mcpStatus?: { kind: string; reason?: string; details?: string };
  instructionsStatus?: { kind: string; reason?: string; details?: string };
  overallStatus?: string; mcpPath?: string; instructionsPaths?: string[];
} = {}) {
  return {
    schemaVersion: 1,
    plan: {
      planId: opts.planId ?? `plan-${agentId}`,
      agentId,
      action: "memory-install",
      noop: opts.noop ?? false,
      writes: [],
      metadata: {
        mcp: { path: opts.mcpPath ?? `/Users/tester/.${agentId}.json`, status: opts.mcpStatus ?? { kind: "write" } },
        instructions: { paths: opts.instructionsPaths ?? [`/Users/tester/.${agentId}/instructions.md`], status: opts.instructionsStatus ?? { kind: "write" } },
        overallStatus: opts.overallStatus ?? "complete",
      },
    },
  };
}

function applyPayload(planId: string, applied = true) {
  return { schemaVersion: 1, result: { planId, applied, changedFiles: applied ? ["/Users/tester/changed.json"] : [] } };
}

function verifyPayload(agentId: string, opts: {
  mcpPresent?: boolean; instructionsSupported?: boolean; instructionsPresent?: boolean; overallStatus?: string;
} = {}) {
  return {
    schemaVersion: 1,
    verification: {
      agentId,
      mcp: { path: `/Users/tester/.${agentId}.json`, present: opts.mcpPresent ?? true },
      instructions: {
        supported: opts.instructionsSupported ?? true,
        paths: [`/Users/tester/.${agentId}/instructions.md`],
        present: opts.instructionsPresent ?? true,
      },
      overallStatus: opts.overallStatus ?? "complete",
    },
  };
}

function agentIdFrom(args: string[]): string {
  return args[args.indexOf("--agent") + 1]!;
}

async function driveEngramScreens(terminal: TestTerminal): Promise<void> {
  await tick();
  terminal.input("\r"); await tick(); // Continue
  terminal.input("\r"); await tick(); // PostgreSQL: No (default)
  terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // Reinforcement: No
  terminal.input("\r"); await tick(); // Engram summary: Confirm
}

test("selecting no assistants initializes Engram without configuring any memory integration", async () => {
  const terminal = new TestTerminal();
  const enginesCalls: string[][] = [];
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (command, args) => {
      enginesCalls.push([command, ...args]);
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
    },
  });
  await driveEngramScreens(terminal);
  terminal.input("\r"); // memory picker: submit with nothing checked
  try { await run; } finally { restore(); }
  expect(enginesCalls).toEqual([
    ["/Users/tester/.forge614/engines/bin/forge614-engines", "detect"],
    ["/Users/tester/.forge614/engines/bin/forge614-engines", "capabilities", "--agent", "claude-code"],
  ]);
  expect(logs).toContain("No assistant was selected. No memory integration was configured.");
});

test("Claude Code and Codex both plan, apply, and verify to a complete memory integration", async () => {
  const terminal = new TestTerminal();
  const { logs, restore } = captureLogs();
  const enginesCalls: string[][] = [];
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (command, args) => {
      enginesCalls.push([command, ...args]);
      if (args[0] === "detect") {
        return {
          status: 0,
          stdout: JSON.stringify(detectPayload([
            { id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" },
            { id: "codex", label: "Codex", executable: "/usr/local/bin/codex" },
          ])),
          stderr: "",
        };
      }
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload(agentIdFrom(args))), stderr: "" };
      if (args[0] === "plan") { const id = agentIdFrom(args); return { status: 0, stdout: JSON.stringify(planPayload(id)), stderr: "" }; }
      if (args[0] === "apply") return { status: 0, stdout: JSON.stringify(applyPayload(args[args.indexOf("--plan-id") + 1]!)), stderr: "" };
      const id = agentIdFrom(args);
      return { status: 0, stdout: JSON.stringify(verifyPayload(id)), stderr: "" };
    },
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\x1b[B"); terminal.input(" "); terminal.input("\r"); await tick(); // check both, submit
  terminal.input("\r"); // preview: Confirm
  try { await run; } finally { restore(); }
  expect(enginesCalls.filter(c => c[1] === "memory-install").map(c => agentIdFrom(c)).sort()).toEqual(["claude-code", "codex"]);
  expect(enginesCalls.filter(c => c[1] === "memory-integration").map(c => agentIdFrom(c)).sort()).toEqual(["claude-code", "codex"]);
  expect(logs).toContain("Claude Code: configured — MCP and memory instructions available");
  expect(logs).toContain("Codex: configured — MCP and memory instructions available");
  expect(logs).toContain("Close and reopen each configured assistant's session so it loads the new MCP server and memory instructions.");
});

test("Cursor's memory integration is reported partial, never as fully complete", async () => {
  const terminal = new TestTerminal();
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "cursor", label: "Cursor", executable: "/Applications/Cursor.app/Contents/MacOS/Cursor" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("cursor")), stderr: "" };
      if (args[0] === "plan") {
        return {
          status: 0,
          stdout: JSON.stringify(planPayload("cursor", {
            instructionsStatus: { kind: "unsupported", reason: "Cursor has no officially supported mechanism to auto-load global instructions." },
            overallStatus: "partial",
          })),
          stderr: "",
        };
      }
      if (args[0] === "apply") return { status: 0, stdout: JSON.stringify(applyPayload("plan-cursor")), stderr: "" };
      // Engines' own verify semantics: Cursor's instructions are structurally unsupported, so a
      // present MCP entry is "the complete achievable state for this agent" — Shell must not
      // pass this "complete" straight through.
      return { status: 0, stdout: JSON.stringify(verifyPayload("cursor", { instructionsSupported: false, instructionsPresent: false, overallStatus: "complete" })), stderr: "" };
    },
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r"); await tick(); // check Cursor, submit
  terminal.input("\r"); // preview: Confirm
  try { await run; } finally { restore(); }
  expect(logs).toContain("Cursor: partially configured — this assistant has no official mechanism to auto-load global instructions");
  expect(logs.some(line => line.startsWith("Cursor: configured"))).toBe(false);
});

test("a conflict on every component makes no apply call and reports the conflict", async () => {
  const terminal = new TestTerminal();
  const enginesCalls: string[][] = [];
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (command, args) => {
      enginesCalls.push([command, ...args]);
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
      return {
        status: 0,
        stdout: JSON.stringify(planPayload("claude-code", {
          noop: true,
          mcpStatus: { kind: "blocked", reason: "mcp-conflict", details: 'An existing "forge614-engram" MCP entry with different content is already present.' },
          instructionsStatus: { kind: "blocked", reason: "instructions-conflict", details: "An existing managed instructions block could not be reconciled." },
          overallStatus: "unsupported",
        })),
        stderr: "",
      };
    },
  });
  await driveEngramScreens(terminal);
  // Both components are blocked, so the plan is noop:true — the memory picker's submit is the
  // last screen: no preview/confirm screen appears (there is nothing pending to apply), so no
  // further terminal input is sent here.
  terminal.input(" "); terminal.input("\r"); // check Claude Code, submit
  try { await run; } finally { restore(); }
  expect(enginesCalls.some(c => c[0] === "apply" || c.includes("apply"))).toBe(false);
  expect(logs).toContain('Claude Code: not supported — MCP: An existing "forge614-engram" MCP entry with different content is already present.; instructions: An existing managed instructions block could not be reconciled.');
});

test("cancelling the memory preview makes zero writes", async () => {
  const terminal = new TestTerminal();
  const enginesCalls: string[][] = [];
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (command, args) => {
      enginesCalls.push([command, ...args]);
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
      return { status: 0, stdout: JSON.stringify(planPayload("claude-code")), stderr: "" };
    },
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r"); await tick(); // check Claude Code, submit
  terminal.input("\x1b[B"); terminal.input("\r"); // preview: move to Cancel, submit
  try { await run; } finally { restore(); }
  expect(enginesCalls.some(c => c.includes("apply"))).toBe(false);
  expect(logs).toContain("Claude Code: skipped");
});

test("a plan-level Engines failure for one assistant is reported without failing the already-successful Engram init", async () => {
  const terminal = new TestTerminal();
  const enginesCalls: string[][] = [];
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (command, args) => {
      enginesCalls.push([command, ...args]);
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
      return { status: 1, stdout: JSON.stringify({ schemaVersion: 1, error: { code: "ENGRAM_PROTOCOL_UNAVAILABLE", message: "Could not reach forge614-engram to read its memory protocol." } }), stderr: "" };
    },
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r"); // check Claude Code, submit (no preview: nothing was planned)
  try { await run; } finally { restore(); }
  expect(enginesCalls.some(c => c.includes("apply"))).toBe(false);
  expect(logs).toContain("Forge614 Engram memory initialization is complete.");
  expect(logs).toContain("Claude Code: not configured — Could not reach forge614-engram to read its memory protocol.");
  expect(process.exitCode as number | undefined).not.toBe(1);
});

test("an apply that reports applied: false is shown as not configured, without calling verify", async () => {
  const terminal = new TestTerminal();
  const enginesCalls: string[][] = [];
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (command, args) => {
      enginesCalls.push([command, ...args]);
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
      if (args[0] === "plan") return { status: 0, stdout: JSON.stringify(planPayload("claude-code")), stderr: "" };
      return { status: 0, stdout: JSON.stringify(applyPayload("plan-claude-code", false)), stderr: "" };
    },
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r"); await tick(); // check Claude Code, submit
  terminal.input("\r"); // preview: Confirm
  try { await run; } finally { restore(); }
  expect(enginesCalls.some(c => c.includes("memory-integration"))).toBe(false);
  expect(logs).toContain("Claude Code: not configured — Forge614 Engines reported the change was not applied.");
});

test("verify reporting absent after a successful apply is communicated, never as success", async () => {
  const terminal = new TestTerminal();
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
      if (args[0] === "plan") return { status: 0, stdout: JSON.stringify(planPayload("claude-code")), stderr: "" };
      if (args[0] === "apply") return { status: 0, stdout: JSON.stringify(applyPayload("plan-claude-code")), stderr: "" };
      return { status: 0, stdout: JSON.stringify(verifyPayload("claude-code", { mcpPresent: false, instructionsPresent: false, overallStatus: "absent" })), stderr: "" };
    },
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r"); await tick(); // check Claude Code, submit
  terminal.input("\r"); // preview: Confirm
  try { await run; } finally { restore(); }
  expect(logs).toContain("Claude Code: not configured — Forge614 Engines could not confirm any memory integration for this assistant.");
});

test("verify reporting partial after a successful apply explains exactly what is missing", async () => {
  const terminal = new TestTerminal();
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
      if (args[0] === "plan") return { status: 0, stdout: JSON.stringify(planPayload("claude-code")), stderr: "" };
      if (args[0] === "apply") return { status: 0, stdout: JSON.stringify(applyPayload("plan-claude-code")), stderr: "" };
      return { status: 0, stdout: JSON.stringify(verifyPayload("claude-code", { instructionsPresent: false, overallStatus: "partial" })), stderr: "" };
    },
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r"); await tick(); // check Claude Code, submit
  terminal.input("\r"); // preview: Confirm
  try { await run; } finally { restore(); }
  expect(logs).toContain("Claude Code: partially configured — the memory instructions are not installed");
});

test("two selected assistants report independently when one apply fails", async () => {
  const terminal = new TestTerminal();
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      if (args[0] === "detect") {
        return {
          status: 0,
          stdout: JSON.stringify(detectPayload([
            { id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" },
            { id: "codex", label: "Codex", executable: "/usr/local/bin/codex" },
          ])),
          stderr: "",
        };
      }
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload(agentIdFrom(args))), stderr: "" };
      if (args[0] === "plan") { const id = agentIdFrom(args); return { status: 0, stdout: JSON.stringify(planPayload(id)), stderr: "" }; }
      if (args[0] === "apply") {
        const planId = args[args.indexOf("--plan-id") + 1]!;
        if (planId === "plan-codex") return { status: 1, stdout: JSON.stringify({ schemaVersion: 1, error: { code: "STALE_PLAN", message: "File changed since the plan was computed: /Users/tester/.codex/config.toml" } }), stderr: "" };
        return { status: 0, stdout: JSON.stringify(applyPayload(planId)), stderr: "" };
      }
      return { status: 0, stdout: JSON.stringify(verifyPayload(agentIdFrom(args))), stderr: "" };
    },
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\x1b[B"); terminal.input(" "); terminal.input("\r"); await tick(); // check both, submit
  terminal.input("\r"); // preview: Confirm
  try { await run; } finally { restore(); }
  expect(logs).toContain("Claude Code: configured — MCP and memory instructions available");
  expect(logs).toContain("Codex: not configured — File changed since the plan was computed: /Users/tester/.codex/config.toml");
});

// pi-tui defers a screen's first paint to a `setTimeout`/`process.nextTick` callback outside any
// promise chain, so throwing from `write()` on matching text can never be caught by a `try/catch`
// around `runMemorySetupStep` (confirmed: it surfaces as an unrelated, uncatchable async exception).
// `start()` is called synchronously inside `chooseMemoryAgents`'s own `tui.start()` call instead, so
// throwing there on the picker's turn reproduces a memory-setup UI failure that the fix can catch.
// The Engram flow renders exactly four screens (intro, PostgreSQL, reinforcement, summary) before
// the memory picker starts its own TUI, so the fifth `start()` call is the picker's.
class ThrowingMemoryScreenTerminal extends TestTerminal {
  private starts = 0;
  start(input: (data: string) => void) {
    this.starts += 1;
    if (this.starts === 5) throw new Error("terminal write failed");
    super.start(input);
  }
}

test("an exception during the memory picker screen never fails an already-successful Engram init", async () => {
  const terminal = new ThrowingMemoryScreenTerminal();
  const { logs, restore } = captureLogs();
  process.exitCode = 0;
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
    },
  });
  await driveEngramScreens(terminal);
  try { await run; } finally { restore(); }
  expect(process.exitCode as number | undefined).not.toBe(1);
  expect(logs.some(line => line.includes("Memory setup could not be completed"))).toBe(true);
  process.exitCode = 0; // reset so this test's exit code doesn't leak into the overall `bun test` process exit status
});
```

This block replaces the old MCP-specific tests (`"choosing one MCP-capable assistant..."` through the end of the file) one-for-one in coverage, using the new `plan memory-install` / `apply` / `verify memory-integration` contract.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/jorgeetrejoo/Desktop/forge614-shell && bun test src/app/init-engram.test.ts`
Expected: FAIL — `init-engram.ts` still calls `planMcpInstall`/`chooseMcpAgents`/`showMcpPreviewConfirm`, none of which match these new expectations.

- [ ] **Step 3: Rewrite `init-engram.ts`**

Replace the full contents of `src/app/init-engram.ts` with:

```ts
import type { Terminal } from "@earendil-works/pi-tui";
import { runEngramInitFlow } from "../ui/startup/engram-init.ts";
import { chooseMemoryAgents, showMemoryPreviewConfirm } from "../ui/startup/memory-setup.ts";
import type { MemoryPreviewItem } from "../ui/startup/memory-setup.ts";
import { applyEngramInit, type RunEngram } from "../infrastructure/forge614-engram.ts";
import {
  applyMcpPlan, discoverMcpCapableAgents, planMemoryInstall, verifyMemoryIntegration,
  type MemoryInstallPlan, type MemoryVerification,
} from "../infrastructure/forge614-engines.ts";
import type { McpCapableAgent } from "../contracts/mcp-agent.ts";

const SUPPORTED_PRODUCTS = ["engram"] as const;

/** Validates `forge614-shell init --product <name>` arguments; throws a clear error otherwise. */
export function requireEngramProduct(args: string[]): void {
  const remaining = [...args];
  // Both `--product <name>` and `--product=<name>` are accepted.
  const equalsIndex = remaining.findIndex(arg => arg.startsWith("--product="));
  const spaceIndex = remaining.indexOf("--product");
  let product = "";
  if (equalsIndex !== -1) {
    product = remaining[equalsIndex]!.slice("--product=".length);
    remaining.splice(equalsIndex, 1);
  } else if (spaceIndex !== -1 && remaining[spaceIndex + 1]) {
    product = remaining[spaceIndex + 1]!;
    remaining.splice(spaceIndex, 2);
  }
  if (!product) {
    throw new Error("forge614-shell init requires --product <name>.");
  }
  if (remaining.length) {
    throw new Error(`forge614-shell init does not accept: ${remaining.join(" ")}`);
  }
  if (!SUPPORTED_PRODUCTS.includes(product as (typeof SUPPORTED_PRODUCTS)[number])) {
    throw new Error(`forge614-shell init --product ${product} is not supported. Only "engram" is supported today.`);
  }
}

export interface RunInitOptions {
  readonly terminal?: Terminal;
  /** Overrides the real TTY check; the sole source of truth for the interactivity gate when given. */
  readonly interactive?: boolean;
  readonly run?: RunEngram;
  readonly enginesRun?: RunEngram;
  readonly home?: string;
  readonly env?: NodeJS.ProcessEnv;
}

type MemoryOutcomeStatus = "configured" | "partial" | "unsupported" | "not-configured" | "skipped";

interface MemoryOutcome {
  readonly label: string;
  readonly status: MemoryOutcomeStatus;
  readonly detail?: string;
}

function outcomeLine(outcome: MemoryOutcome): string {
  if (outcome.status === "configured") return `${outcome.label}: configured — MCP and memory instructions available`;
  if (outcome.status === "partial") return `${outcome.label}: partially configured — ${outcome.detail}`;
  if (outcome.status === "unsupported") return `${outcome.label}: not supported — ${outcome.detail}`;
  if (outcome.status === "skipped") return `${outcome.label}: skipped`;
  return `${outcome.label}: not configured — ${outcome.detail}`;
}

function planDetail(plan: MemoryInstallPlan): string {
  const parts: string[] = [];
  if (plan.mcp.status.kind === "blocked") parts.push(`MCP: ${plan.mcp.status.details}`);
  if (plan.instructions.status.kind === "blocked") parts.push(`instructions: ${plan.instructions.status.details}`);
  if (plan.instructions.status.kind === "unsupported") parts.push(`instructions: ${plan.instructions.status.reason}`);
  return parts.join("; ") || "Forge614 Engines could not fully configure this assistant.";
}

/** Resolves an agent whose plan needs no writes (`noop: true`) directly from the plan — nothing to apply or verify. */
function planOutcome(label: string, plan: MemoryInstallPlan): MemoryOutcome {
  if (plan.overallStatus === "complete") return { label, status: "configured" };
  if (plan.overallStatus === "unsupported") return { label, status: "unsupported", detail: planDetail(plan) };
  return { label, status: "partial", detail: planDetail(plan) };
}

function verificationDetail(verification: MemoryVerification): string {
  const parts: string[] = [];
  if (!verification.mcp.present) parts.push("the MCP server is not configured");
  if (!verification.instructions.supported) parts.push("this assistant has no official mechanism to auto-load global instructions");
  else if (!verification.instructions.present) parts.push("the memory instructions are not installed");
  return parts.join("; ") || "Forge614 Engines could not confirm full memory integration.";
}

/**
 * Turns a post-apply verification into the outcome Shell reports. Never trusts a bare "complete"
 * from Engines when this assistant structurally cannot auto-load instructions (e.g. Cursor) — Shell
 * always calls that partial and explains why, instead of claiming full completion.
 */
function verificationOutcome(label: string, verification: MemoryVerification): MemoryOutcome {
  if (verification.overallStatus === "absent") {
    return { label, status: "not-configured", detail: "Forge614 Engines could not confirm any memory integration for this assistant." };
  }
  if (verification.overallStatus === "complete" && verification.instructions.supported) {
    return { label, status: "configured" };
  }
  return { label, status: "partial", detail: verificationDetail(verification) };
}

/**
 * Offers Engram's full memory integration (the forge614-engram MCP server plus its universal
 * memory instructions) in every detected, MCP-capable assistant, using Engines' single
 * `plan memory-install` / `apply` / `verify memory-integration` contract end to end. Shell never
 * builds MCP entries or instructions content itself, and never reads Claude/Codex/Cursor config or
 * Engram's internal files directly — it only calls forge614-engines and reads its JSON stdout. Runs
 * only after Engram's own init has already succeeded; a detection failure here is reported but never
 * turns an already-successful Engram init into a command failure.
 */
async function runMemorySetupStep(
  terminal: Terminal | undefined,
  options: { home?: string; env?: NodeJS.ProcessEnv; enginesRun?: RunEngram },
): Promise<MemoryOutcome[]> {
  let agents: McpCapableAgent[];
  try {
    agents = await discoverMcpCapableAgents({ home: options.home, env: options.env, run: options.enginesRun });
  } catch (error) {
    console.log(`Memory setup could not be offered: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
  if (agents.length === 0) {
    console.log("No compatible AI assistants were found to configure with memory integration.");
    return [];
  }
  const selectedIds = await chooseMemoryAgents(agents, terminal);
  if (selectedIds === undefined) {
    console.log("Memory setup was skipped.");
    return agents.map(agent => ({ label: agent.label, status: "skipped" as const }));
  }
  if (selectedIds.length === 0) {
    console.log("No assistant was selected. No memory integration was configured.");
    return agents.map(agent => ({ label: agent.label, status: "skipped" as const }));
  }
  const selectedSet = new Set(selectedIds);
  const outcomeMap = new Map<string, MemoryOutcome>();
  const planned: { agent: McpCapableAgent; plan: MemoryInstallPlan }[] = [];
  for (const agent of agents) {
    if (!selectedSet.has(agent.id)) { outcomeMap.set(agent.id, { label: agent.label, status: "skipped" }); continue; }
    try {
      const plan = await planMemoryInstall({ agentId: agent.id, home: options.home, env: options.env, run: options.enginesRun });
      planned.push({ agent, plan });
    } catch (error) {
      outcomeMap.set(agent.id, { label: agent.label, status: "not-configured", detail: error instanceof Error ? error.message : String(error) });
    }
  }
  const pending = planned.filter(p => !p.plan.noop);
  const resolved = planned.filter(p => p.plan.noop);
  for (const r of resolved) outcomeMap.set(r.agent.id, planOutcome(r.agent.label, r.plan));
  if (pending.length > 0) {
    const blockedAgents = agents.filter(agent => selectedSet.has(agent.id) && outcomeMap.get(agent.id)?.status === "not-configured");
    const previewItems: MemoryPreviewItem[] = [
      ...pending.map(p => ({
        agentLabel: p.agent.label, kind: "pending" as const,
        mcpPath: p.plan.mcp.path, instructionsPaths: p.plan.instructions.paths,
        mcp: p.plan.mcp.status, instructions: p.plan.instructions.status, overallStatus: p.plan.overallStatus,
      })),
      ...resolved.map(r => ({
        agentLabel: r.agent.label, kind: "resolved" as const,
        mcp: r.plan.mcp.status, instructions: r.plan.instructions.status, overallStatus: r.plan.overallStatus,
      })),
      ...blockedAgents.map(agent => ({ agentLabel: agent.label, kind: "blocked" as const, detail: outcomeMap.get(agent.id)!.detail! })),
    ];
    const confirmed = await showMemoryPreviewConfirm(previewItems, terminal);
    if (!confirmed) {
      for (const p of pending) outcomeMap.set(p.agent.id, { label: p.agent.label, status: "skipped" });
    } else {
      for (const p of pending) {
        try {
          const applied = await applyMcpPlan({ planId: p.plan.planId, home: options.home, env: options.env, run: options.enginesRun });
          if (!applied.applied) {
            outcomeMap.set(p.agent.id, { label: p.agent.label, status: "not-configured", detail: "Forge614 Engines reported the change was not applied." });
            continue;
          }
          const verification = await verifyMemoryIntegration({ agentId: p.agent.id, home: options.home, env: options.env, run: options.enginesRun });
          outcomeMap.set(p.agent.id, verificationOutcome(p.agent.label, verification));
        } catch (error) {
          outcomeMap.set(p.agent.id, { label: p.agent.label, status: "not-configured", detail: error instanceof Error ? error.message : String(error) });
        }
      }
    }
  }
  return agents.map(agent => outcomeMap.get(agent.id)!);
}

/** Entry point for `forge614-shell init --product engram`. Makes no Engram call before confirmation. */
export async function runInitCommand(args: string[], options: RunInitOptions = {}): Promise<void> {
  requireEngramProduct(args);
  // Explicit `interactive` wins; an injected terminal implies interactive; otherwise the real TTYs decide.
  const interactive = options.interactive ?? (options.terminal ? true : Boolean(process.stdin.isTTY && process.stdout.isTTY));
  if (!interactive) {
    throw new Error("forge614-shell init requires an interactive terminal.");
  }
  const flow = await runEngramInitFlow(options.terminal);
  if (!flow.confirmed) {
    process.exitCode = 130;
    console.log("Cancelled. No changes were made.");
    return;
  }
  await applyEngramInit(flow.decisions, { run: options.run, home: options.home, env: options.env });
  console.log("Forge614 Engram memory initialization is complete.");
  try {
    const outcomes = await runMemorySetupStep(options.terminal, { home: options.home, env: options.env, enginesRun: options.enginesRun });
    for (const outcome of outcomes) console.log(outcomeLine(outcome));
    if (outcomes.some(outcome => outcome.status === "configured" || outcome.status === "partial")) {
      console.log("Close and reopen each configured assistant's session so it loads the new MCP server and memory instructions.");
    }
  } catch (error) {
    console.log(`Memory setup could not be completed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
```

Note what changed structurally from the old file: `homedir` and `locateEngramBinary` are no longer imported — Engines derives the MCP server definition itself for `memory-install`, so Shell no longer needs to compute the Engram binary path for this step.

- [ ] **Step 4: Update the CLI help text**

In `src/cli.ts`, find this line (inside the template string printed for `--help`/`-h`):

```
  init --product <name>  Set up a Forge614 product's local memory and, for engram, its MCP setup
```

Replace it with:

```
  init --product <name>  Set up a Forge614 product's local memory and, for engram, its memory integration (MCP + instructions)
```

- [ ] **Step 5: Delete the old MCP-only UI module (if Task 2 left it in place)**

```bash
cd /Users/jorgeetrejoo/Desktop/forge614-shell
[ -f src/ui/startup/mcp-setup.ts ] && git rm src/ui/startup/mcp-setup.ts src/ui/startup/mcp-setup.test.ts
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd /Users/jorgeetrejoo/Desktop/forge614-shell && bun test src/app/init-engram.test.ts`
Expected: PASS — all tests, including the unmodified `--product` validation tests and the PostgreSQL-secrecy tests earlier in the file.

- [ ] **Step 7: Typecheck**

Run: `cd /Users/jorgeetrejoo/Desktop/forge614-shell && bun run typecheck`
Expected: no errors anywhere in the project.

- [ ] **Step 8: Commit**

```bash
cd /Users/jorgeetrejoo/Desktop/forge614-shell
git add src/app/init-engram.ts src/app/init-engram.test.ts src/cli.ts
git status --short  # confirm mcp-setup.ts / mcp-setup.test.ts show as deleted (D), not untracked
git add src/ui/startup/mcp-setup.ts src/ui/startup/mcp-setup.test.ts 2>/dev/null || true
git commit -m "feat: rewire Engram init's assistant setup to Engines' plan memory-install / apply / verify contract"
```

---

## Task 4: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the entire existing test suite**

Run: `cd /Users/jorgeetrejoo/Desktop/forge614-shell && bun test`
Expected: PASS, zero failures, across every test file in the project (not just the three touched by this plan).

- [ ] **Step 2: Typecheck the whole project**

Run: `cd /Users/jorgeetrejoo/Desktop/forge614-shell && bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Check the diff for whitespace/conflict-marker problems**

Run: `cd /Users/jorgeetrejoo/Desktop/forge614-shell && git diff --check HEAD~3`

(Adjust `HEAD~3` to the actual number of commits this plan produced — one for each of Task 1/2/3 — if execution squashed or split commits differently. The intent is: check every line this plan touched.)

Expected: no output (no trailing whitespace, no leftover conflict markers).

- [ ] **Step 4: Grep the whole diff for anything that looks like a secret, as a last line of defence**

Run: `cd /Users/jorgeetrejoo/Desktop/forge614-shell && git diff HEAD~3 -- src | grep -iE "postgres://|password|secret|token" || echo "clean"`

Expected: `clean` — the memory-integration flow never touches PostgreSQL connection strings (that's the separate, untouched Engram-init flow), and Tasks 1–3 never parse or forward `writes[].afterContent`/`beforeHash`.

- [ ] **Step 5: Confirm no forbidden Engines subcommands remain in the init flow**

Run: `cd /Users/jorgeetrejoo/Desktop/forge614-shell && grep -rn '"mcp-install"\|"mcp-remove"\|memory-protocol' src/app/init-engram.ts src/ui/startup/memory-setup.ts src/infrastructure/forge614-engines.ts | grep -v "\.test\.ts"`

Expected: no matches in `init-engram.ts`/`memory-setup.ts` (the two files this plan's runtime flow touches). A match may legitimately remain in `forge614-engines.ts` only inside `planMcpInstall`/`planMcpRemove`/`removeEngramMcpFromAgent` (the pre-existing, deliberately-kept future building blocks documented in Global Constraints) — confirm any hit is one of those three, not a new call site.

- [ ] **Step 6: Report**

Summarize for the person: files modified/created/deleted, which Engines contract command each new function calls, and the exact `bun test` / `bun run typecheck` / `git diff --check` output. Do not commit anything beyond what Tasks 1–3 already committed; do not tag, release, or push.
