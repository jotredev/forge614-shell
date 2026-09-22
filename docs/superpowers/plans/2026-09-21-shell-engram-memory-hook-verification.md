# Engram Memory-Hook Runtime Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend forge614-shell's existing `init --product engram` flow so it plans, applies, and honestly reports the `SessionStart` memory-hook component (structural install *and* real runtime evidence) that Forge614 Engines added to `plan memory-install` / `verify memory-integration`, and automatically hands the terminal to Claude Code or Codex once so that hook can actually fire — without Shell ever approving, faking, or hiding the real state.

**Architecture:** This is an extension of an already-shipped, already-tested feature (`src/app/init-engram.ts` + `src/infrastructure/forge614-engines.ts` + `src/ui/startup/memory-setup.ts`), not a new one. Three additions: (1) the Engines JSON contract wrapper learns a new required `hook` component with a `runtimeStatus`; (2) a new, minimal infrastructure module hands the real terminal to the native `claude`/`codex` binary (never Shell's own SDK/RPC-driven chat adapters, which cannot surface Codex's native hook-trust prompt and are not proven to fire Claude's `SessionStart`); (3) the orchestration in `init-engram.ts` calls `verify` for *every* selected agent (not just freshly-applied ones), and — only when the hook is structurally installed but not yet runtime-observed — launches that hand-off once and re-verifies.

**Tech Stack:** TypeScript, Bun (`bun test`, `bun build`), `node:child_process`, `@earendil-works/pi-tui`. No new dependencies.

**Spec:** The user's original Spanish request (reproduced faithfully in intent, corrected against the *real, verified* Engines memory-hook JSON contract — introduced in Engines v1.9.0, with v1.10.0 now the current stable release; Shell depends on the contract shape itself, never on either version number — see Global Constraints below for exactly where the request's assumptions were wrong) plus `~/Desktop/forge614-engines/docs/en/05-public-cli-reference.md` (the authoritative, live public contract for `plan memory-install`, `apply`, `verify memory-integration`, and the `SessionStart` hook section), and this repo's own `docs/en/07-engram-initialization-and-mcp.md` (the current, shipped behavior this plan extends).

## Global Constraints

- **Shell depends on the memory-hook *contract*, never on an Engines version number.** The memory-hook component (`hook`/`runtimeStatus` in `plan memory-install` and `verify memory-integration`) was introduced in Engines v1.9.0; the current stable release is v1.10.0, and releases will keep moving — no task in this plan may check, compare, or hardcode any Engines version string. Compatibility is detected structurally: if a `plan`/`verify` response has no `hook` field at all, the installed Engines predates this feature. In that case Shell shows exactly this message, verbatim: `"Forge614 Engines needs to be updated. Run \"forge614-shell update\", then try again."` — never a generic parse-error message, and never a silent guess at what the missing field might have meant. `forge614-shell update` (already wired to the existing `updateEngines()`) is what fetches the latest compatible stable release; this plan does not change when or whether that command runs automatically.
- **The three runtime states the request named (`runtime-observed`, `pending-runtime-verification`, `needs-user-trust`) are real**, confirmed by directly invoking a rebuilt `forge614-engines` binary (the first build to carry this contract, v1.9.0) on this machine. They live at `plan.metadata.hook.runtimeStatus.kind` and `verification.hook.runtimeStatus.kind`, **not** as top-level `overallStatus` values — `overallStatus` stays `"complete" | "partial" | "unsupported"` (plan) / `"complete" | "partial" | "absent"` (verify), exactly as already typed in this repo. `"blocked"` is a *component* status (`mcp.status.kind` / `instructions.status.kind` / `hook.status.kind`), never an `overallStatus` value — the request's state table conflated these two levels; do not reproduce that conflation in code, UI text, or docs.
- **`pending-runtime-verification` covers more than "never happened yet."** Its `reason` field distinguishes `no-evidence` (a fresh install, never observed) from `evidence-expired` (was observed before; the 7-day window simply lapsed) and three corruption/mismatch reasons. Shell's wording and behavior must be honest about this distinction: a lapsed check is never described as lost memory or a failed installation — memory, MCP, and instructions all remain exactly as configured, only the *recent proof* expired. Codex's `needs-user-trust` (a real, unresolved trust gap) must never be shown or worded the same as an expired check (a stale timer, nothing to approve) — Task 4 carries a dedicated set of tests for exactly this distinction, not just a claim that the same code path happens to cover it.
- **Never render or log `writes[].afterContent` or `beforeHash`, for any component, ever.** This is not theoretical: a real `plan memory-install --agent cursor` on this machine returned the user's entire `~/.cursor/mcp.json`, including live GitHub and GitLab personal access tokens, inside `afterContent`. A real `plan memory-install --agent claude-code` (once the hook write is pending) returns the user's *entire* `~/.claude/settings.json` — every hook, every permission rule — as `afterContent`, because the hook component writes into that file. This repo already enforces this rule (`docs/en/07` "Security and outcomes"); this plan's new preview code (Task 3) must keep enforcing it for the `hook` write specifically, since it is now the single most sensitive file Engines touches.
- **Shell never calls `forge614-engines memory-hook-run` directly, never reads `~/.forge614/engines/hook-evidence/*`, never reads `~/.forge614/engram/engram.db`, and never calls `forge614-engram memory-protocol`/`startup-context` directly.** Only `detect`, `capabilities`, `plan memory-install`, `apply`, `verify memory-integration` — exactly the existing wrapper's surface, extended, never bypassed.
- **Shell never auto-approves, auto-trusts, or bypasses Codex's native hook-trust prompt** (no `--dangerously-bypass-hook-trust` or equivalent, ever). The mechanism this plan adds (Task 2) hands the *entire real terminal* to the native `codex`/`claude` binary specifically so any native trust prompt is the user's own client asking the user directly — Shell is not in the loop at that moment at all.
- **Layering rule already enforced by `tests/architecture/layers.test.ts`:** files under `src/infrastructure/` and `src/engines/` must never import from `.../ui/` or `.../app/`. The new `src/infrastructure/native-handoff.ts` (Task 2) must only import `node:child_process`.
- **No public memory-removal/uninstall command exists yet.** `planMcpRemove`/`removeEngramMcpFromAgent` remain internal foundations only; this plan does not add or document a public removal flow.
- **PostgreSQL connection-string handling is unrelated and untouched** by this plan.
- Every existing test in `src/infrastructure/forge614-engines.test.ts` and `src/app/init-engram.test.ts` that fabricates a `plan`/`verification` JSON payload predates the `hook` field and will need it added (Task 1 and Task 4 enumerate every one by name).

---

## File structure

- Modify: `src/infrastructure/forge614-engines.ts` — add `HookRuntimeStatus`, `HookRuntimeReason` types; extend `MemoryInstallPlan`/`MemoryVerification` with `hook`; extend the two `to*` parsers; add the outdated-Engines error message.
- Modify: `src/infrastructure/forge614-engines.test.ts` — add `hook` fixtures to every existing memory-install/verify test; add new tests for the outdated-Engines error and each `runtimeStatus.kind`.
- Create: `src/infrastructure/native-handoff.ts` — `runInteractiveHandoff(executable, cwd, env)`, foreground `spawn` with inherited stdio.
- Create: `src/infrastructure/native-handoff.test.ts`.
- Modify: `src/ui/startup/memory-setup.ts` — extend `MemoryPreviewItem`, add `hookStatusLabel`, extend `previewLine`.
- Modify: `src/ui/startup/memory-setup.test.ts` — extend preview-text assertions.
- Modify: `src/app/init-engram.ts` — extend `MemoryOutcomeStatus`, add `hookRuntimeDetail`/rework `verificationDetail`/`verificationOutcome`, add `verifyAndMaybeRelaunch`, remove now-dead `planOutcome`/`planDetail`, rewire `runMemorySetupStep`'s `resolved`/`pending` handling through the unified verify(+relaunch) path.
- Modify: `src/app/init-engram.test.ts` — update every existing fixture/expectation Task 4 lists, add the required scenarios (including three dedicated to evidence-expired) plus the secrets-leak scenario.
- Modify: `docs/en/07-engram-initialization-and-mcp.md`, `docs/es/07-inicializacion-engram-y-mcp.md`.
- Modify: `docs/en/04-architecture-engines.md`, `docs/es/04-arquitectura-motores.md` (short addition documenting the native hand-off mechanism).

---

### Task 1: Extend the Engines contract wrapper with the `hook` component

**Files:**
- Modify: `src/infrastructure/forge614-engines.ts`
- Test: `src/infrastructure/forge614-engines.test.ts`

**Interfaces:**
- Produces: `export type HookRuntimeReason = "no-evidence" | "evidence-expired" | "evidence-corrupt" | "evidence-wrong-agent" | "evidence-fingerprint-mismatch" | "evidence-context-not-received";`
- Produces: `export type HookRuntimeStatus = { readonly kind: "pending-runtime-verification"; readonly reason: HookRuntimeReason } | { readonly kind: "needs-user-trust" } | { readonly kind: "runtime-observed" } | { readonly kind: "unsupported" } | { readonly kind: "absent" };`
- Produces: `MemoryInstallPlan.hook: { readonly path: string; readonly status: MemoryComponentStatus; readonly runtimeStatus: HookRuntimeStatus }`
- Produces: `MemoryVerification.hook: { readonly supported: boolean; readonly path: string; readonly present: boolean; readonly dryRunOk: boolean; readonly runtimeStatus: HookRuntimeStatus }`
- Consumes (unchanged): `MemoryComponentStatus`, `MemoryOverallStatus`, `MemoryOverallStatus` sets already defined in this file.

- [ ] **Step 1: Write the failing tests for the new parser behavior**

Add to `src/infrastructure/forge614-engines.test.ts`, right after the existing `"planMemoryInstall rejects a malformed plan instead of guessing its shape"` test (around line 392):

```ts
test("planMemoryInstall parses the hook component and its runtime status", async () => {
  const plan = await planMemoryInstall({
    agentId: "codex", home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        plan: {
          planId: "plan-1", agentId: "codex", action: "memory-install", noop: false,
          writes: [{ path: "/Users/tester/.codex/config.toml", beforeHash: "x", afterContent: "SECRET" }],
          metadata: {
            mcp: { path: "/Users/tester/.codex/config.toml", status: { kind: "noop" } },
            instructions: { paths: ["/Users/tester/.codex/AGENTS.md"], status: { kind: "noop" } },
            hook: { path: "/Users/tester/.codex/config.toml", status: { kind: "write" }, runtimeStatus: { kind: "needs-user-trust" } },
            overallStatus: "partial",
          },
        },
      }),
      stderr: "",
    }),
  });
  expect(plan.hook).toEqual({
    path: "/Users/tester/.codex/config.toml",
    status: { kind: "write" },
    runtimeStatus: { kind: "needs-user-trust" },
  });
});

test("planMemoryInstall parses a pending-runtime-verification reason", async () => {
  const plan = await planMemoryInstall({
    agentId: "claude-code", home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        plan: {
          planId: "plan-1", agentId: "claude-code", action: "memory-install", noop: false, writes: [],
          metadata: {
            mcp: { path: "/Users/tester/.claude.json", status: { kind: "noop" } },
            instructions: { paths: ["/Users/tester/.claude/CLAUDE.md"], status: { kind: "noop" } },
            hook: { path: "/Users/tester/.claude/settings.json", status: { kind: "write" }, runtimeStatus: { kind: "pending-runtime-verification", reason: "no-evidence" } },
            overallStatus: "partial",
          },
        },
      }),
      stderr: "",
    }),
  });
  expect(plan.hook.runtimeStatus).toEqual({ kind: "pending-runtime-verification", reason: "no-evidence" });
});

test("planMemoryInstall parses the evidence-expired reason distinctly from no-evidence", async () => {
  const plan = await planMemoryInstall({
    agentId: "claude-code", home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        plan: {
          planId: "plan-1", agentId: "claude-code", action: "memory-install", noop: true, writes: [],
          metadata: {
            mcp: { path: "/Users/tester/.claude.json", status: { kind: "noop" } },
            instructions: { paths: ["/Users/tester/.claude/CLAUDE.md"], status: { kind: "noop" } },
            hook: { path: "/Users/tester/.claude/settings.json", status: { kind: "noop" }, runtimeStatus: { kind: "pending-runtime-verification", reason: "evidence-expired" } },
            overallStatus: "partial",
          },
        },
      }),
      stderr: "",
    }),
  });
  expect(plan.hook.runtimeStatus).toEqual({ kind: "pending-runtime-verification", reason: "evidence-expired" });
});

test("planMemoryInstall rejects a pending-runtime-verification status with an unrecognized reason", async () => {
  await expect(planMemoryInstall({
    agentId: "claude-code", home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        plan: {
          planId: "plan-1", agentId: "claude-code", action: "memory-install", noop: false, writes: [],
          metadata: {
            mcp: { path: "/x", status: { kind: "noop" } },
            instructions: { paths: [], status: { kind: "noop" } },
            hook: { path: "/y", status: { kind: "write" }, runtimeStatus: { kind: "pending-runtime-verification", reason: "made-up-reason" } },
            overallStatus: "partial",
          },
        },
      }),
      stderr: "",
    }),
  })).rejects.toThrow("forge614-engines returned an invalid plan.");
});

test("planMemoryInstall never hardcodes an Engines version check — it detects the contract purely by the hook field's presence", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("./forge614-engines.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/1\.9\.0|1\.10\.0/);
});

test("planMemoryInstall tells the user to update Engines when the hook component is entirely missing (Engines predates the memory-hook contract)", async () => {
  await expect(planMemoryInstall({
    agentId: "claude-code", home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        plan: {
          planId: "plan-1", agentId: "claude-code", action: "memory-install", noop: false, writes: [],
          metadata: {
            mcp: { path: "/Users/tester/.claude.json", status: { kind: "noop" } },
            instructions: { paths: ["/Users/tester/.claude/CLAUDE.md"], status: { kind: "noop" } },
            overallStatus: "complete",
          },
        },
      }),
      stderr: "",
    }),
  })).rejects.toThrow('Forge614 Engines needs to be updated. Run "forge614-shell update", then try again.');
});

test("verifyMemoryIntegration parses the hook component including dryRunOk and runtime-observed", async () => {
  const verification = await verifyMemoryIntegration({
    agentId: "claude-code", home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        verification: {
          agentId: "claude-code",
          mcp: { path: "/Users/tester/.claude.json", present: true },
          instructions: { supported: true, paths: ["/Users/tester/.claude/CLAUDE.md"], present: true },
          hook: { supported: true, path: "/Users/tester/.claude/settings.json", present: true, dryRunOk: true, runtimeStatus: { kind: "runtime-observed" } },
          overallStatus: "complete",
        },
      }),
      stderr: "",
    }),
  });
  expect(verification.hook).toEqual({
    supported: true, path: "/Users/tester/.claude/settings.json", present: true, dryRunOk: true,
    runtimeStatus: { kind: "runtime-observed" },
  });
});

test("verifyMemoryIntegration parses evidence-expired the same way it parses no-evidence (both are pending-runtime-verification with different reasons)", async () => {
  const verification = await verifyMemoryIntegration({
    agentId: "claude-code", home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        verification: {
          agentId: "claude-code",
          mcp: { path: "/Users/tester/.claude.json", present: true },
          instructions: { supported: true, paths: ["/Users/tester/.claude/CLAUDE.md"], present: true },
          hook: { supported: true, path: "/Users/tester/.claude/settings.json", present: true, dryRunOk: true, runtimeStatus: { kind: "pending-runtime-verification", reason: "evidence-expired" } },
          overallStatus: "partial",
        },
      }),
      stderr: "",
    }),
  });
  expect(verification.hook.runtimeStatus).toEqual({ kind: "pending-runtime-verification", reason: "evidence-expired" });
});

test("verifyMemoryIntegration tells the user to update Engines when the hook component is entirely missing", async () => {
  await expect(verifyMemoryIntegration({
    agentId: "claude-code", home: "/Users/tester",
    run: async () => ({
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
    }),
  })).rejects.toThrow('Forge614 Engines needs to be updated. Run "forge614-shell update", then try again.');
});

test("verifyMemoryIntegration still rejects a genuinely malformed result as invalid, not as an outdated-Engines hint", async () => {
  await expect(verifyMemoryIntegration({
    agentId: "claude-code", home: "/Users/tester",
    run: async () => ({ status: 0, stdout: JSON.stringify({ schemaVersion: 1, verification: { agentId: "claude-code" } }), stderr: "" }),
  })).rejects.toThrow("forge614-engines returned an invalid verification result.");
});
```

- [ ] **Step 2: Run the new tests to see them fail**

Run: `bun test src/infrastructure/forge614-engines.test.ts`
Expected: FAIL — `plan.hook` / `verification.hook` are `undefined`, and the outdated-Engines message never throws (both existing parsers currently ignore any `hook` key and never require it).

- [ ] **Step 3: Add the new types and update both parsers**

In `src/infrastructure/forge614-engines.ts`, immediately after the `MemoryOverallStatus` type declaration (currently line 271), add:

```ts
export type HookRuntimeReason =
  | "no-evidence" | "evidence-expired" | "evidence-corrupt"
  | "evidence-wrong-agent" | "evidence-fingerprint-mismatch" | "evidence-context-not-received";

export type HookRuntimeStatus =
  | { readonly kind: "pending-runtime-verification"; readonly reason: HookRuntimeReason }
  | { readonly kind: "needs-user-trust" }
  | { readonly kind: "runtime-observed" }
  | { readonly kind: "unsupported" }
  | { readonly kind: "absent" };

const HOOK_RUNTIME_KINDS = new Set(["pending-runtime-verification", "needs-user-trust", "runtime-observed", "unsupported", "absent"]);
const PENDING_RUNTIME_REASONS = new Set([
  "no-evidence", "evidence-expired", "evidence-corrupt", "evidence-wrong-agent", "evidence-fingerprint-mismatch", "evidence-context-not-received",
]);

// Compatibility with Engines is detected structurally (does a `hook` field exist at all?), never by
// comparing a version string — Engines' own release number is not this file's business.
const OUTDATED_ENGINES_MESSAGE = 'Forge614 Engines needs to be updated. Run "forge614-shell update", then try again.';

function toHookRuntimeStatus(value: unknown): HookRuntimeStatus {
  if (!value || typeof value !== "object" || typeof (value as { kind?: unknown }).kind !== "string" || !HOOK_RUNTIME_KINDS.has((value as { kind: string }).kind)) {
    throw new Error("forge614-engines returned an invalid plan.");
  }
  const status = value as { kind: string; reason?: unknown };
  if (status.kind === "pending-runtime-verification") {
    if (typeof status.reason !== "string" || !PENDING_RUNTIME_REASONS.has(status.reason)) {
      throw new Error("forge614-engines returned an invalid plan.");
    }
    return { kind: "pending-runtime-verification", reason: status.reason as HookRuntimeReason };
  }
  return { kind: status.kind as "needs-user-trust" | "runtime-observed" | "unsupported" | "absent" };
}
```

Update `MemoryInstallPlan` (currently lines 273-280) to add the `hook` field:

```ts
export interface MemoryInstallPlan {
  readonly planId: string;
  readonly agentId: string;
  readonly noop: boolean;
  readonly mcp: { readonly path: string; readonly status: MemoryComponentStatus };
  readonly instructions: { readonly paths: string[]; readonly status: MemoryComponentStatus };
  readonly hook: { readonly path: string; readonly status: MemoryComponentStatus; readonly runtimeStatus: HookRuntimeStatus };
  readonly overallStatus: MemoryOverallStatus;
}
```

Update `MemoryVerification` (currently lines 282-287) to add the `hook` field:

```ts
export interface MemoryVerification {
  readonly agentId: string;
  readonly mcp: { readonly path: string; readonly present: boolean };
  readonly instructions: { readonly supported: boolean; readonly paths: string[]; readonly present: boolean };
  readonly hook: { readonly supported: boolean; readonly path: string; readonly present: boolean; readonly dryRunOk: boolean; readonly runtimeStatus: HookRuntimeStatus };
  readonly overallStatus: "complete" | "partial" | "absent";
}
```

Update `MemoryPlanPayload`/`MemoryVerifyPayload` (currently lines 289-309) to declare the new optional key on the wire shape:

```ts
interface MemoryPlanPayload {
  plan?: {
    planId?: unknown;
    agentId?: unknown;
    noop?: unknown;
    metadata?: {
      mcp?: { path?: unknown; status?: unknown };
      instructions?: { paths?: unknown; status?: unknown };
      hook?: { path?: unknown; status?: unknown; runtimeStatus?: unknown };
      overallStatus?: unknown;
    };
  };
}

interface MemoryVerifyPayload {
  verification?: {
    agentId?: unknown;
    mcp?: { path?: unknown; present?: unknown };
    instructions?: { supported?: unknown; paths?: unknown; present?: unknown };
    hook?: { supported?: unknown; path?: unknown; present?: unknown; dryRunOk?: unknown; runtimeStatus?: unknown };
    overallStatus?: unknown;
  };
}
```

Rewrite `toMemoryInstallPlan` (currently lines 331-352):

```ts
function toMemoryInstallPlan(payload: unknown): MemoryInstallPlan {
  const plan = (payload as MemoryPlanPayload).plan;
  if (!plan || typeof plan.planId !== "string" || !plan.planId || typeof plan.agentId !== "string" || typeof plan.noop !== "boolean" || !plan.metadata) {
    throw new Error("forge614-engines returned an invalid plan.");
  }
  const { mcp, instructions, hook, overallStatus } = plan.metadata;
  if (
    !mcp || typeof mcp.path !== "string" ||
    !instructions || !Array.isArray(instructions.paths) || !instructions.paths.every((p): p is string => typeof p === "string") ||
    typeof overallStatus !== "string" || !MEMORY_OVERALL_STATUSES.has(overallStatus)
  ) {
    throw new Error("forge614-engines returned an invalid plan.");
  }
  if (hook === undefined) {
    throw new Error(OUTDATED_ENGINES_MESSAGE);
  }
  if (typeof hook.path !== "string") {
    throw new Error("forge614-engines returned an invalid plan.");
  }
  return {
    planId: plan.planId,
    agentId: plan.agentId,
    noop: plan.noop,
    mcp: { path: mcp.path, status: toMemoryComponentStatus(mcp.status) },
    instructions: { paths: instructions.paths, status: toMemoryComponentStatus(instructions.status) },
    hook: { path: hook.path, status: toMemoryComponentStatus(hook.status), runtimeStatus: toHookRuntimeStatus(hook.runtimeStatus) },
    overallStatus: overallStatus as MemoryOverallStatus,
  };
}
```

Rewrite `toMemoryVerification` (currently lines 369-387):

```ts
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
  if (verification.hook === undefined) {
    throw new Error(OUTDATED_ENGINES_MESSAGE);
  }
  const hook = verification.hook;
  if (
    typeof hook.supported !== "boolean" || typeof hook.path !== "string" ||
    typeof hook.present !== "boolean" || typeof hook.dryRunOk !== "boolean"
  ) {
    throw new Error("forge614-engines returned an invalid verification result.");
  }
  return {
    agentId: verification.agentId,
    mcp: { path: verification.mcp.path, present: verification.mcp.present },
    instructions: { supported: verification.instructions.supported, paths: verification.instructions.paths, present: verification.instructions.present },
    hook: { supported: hook.supported, path: hook.path, present: hook.present, dryRunOk: hook.dryRunOk, runtimeStatus: toHookRuntimeStatus(hook.runtimeStatus) },
    overallStatus: verification.overallStatus as MemoryVerification["overallStatus"],
  };
}
```

- [ ] **Step 4: Update every existing test fixture in this file to include a valid `hook`**

Add this exact `hook` object to the `metadata` of every existing `plan memory-install` fixture in `src/infrastructure/forge614-engines.test.ts`, and this exact `hook` object to the `verification` of every existing `verify memory-integration` fixture — matching each test's own scenario:

| Test name (line, pre-edit) | Add to `metadata`/`verification` |
| --- | --- |
| `"planMemoryInstall sends only --agent and reads the full plan"` (256) | `hook: { path: "/Users/tester/.claude/settings.json", status: { kind: "write" }, runtimeStatus: { kind: "pending-runtime-verification", reason: "no-evidence" } }` — and add the matching `hook: { path: "/Users/tester/.claude/settings.json", status: { kind: "write" }, runtimeStatus: { kind: "pending-runtime-verification", reason: "no-evidence" } }` to the `expect(plan).toEqual({...})` block |
| `"planMemoryInstall never exposes afterContent or beforeHash"` (297) | `hook: { path: "/r", status: { kind: "write" }, runtimeStatus: { kind: "pending-runtime-verification", reason: "no-evidence" } }` (no assertion change needed — the test only checks the serialized plan never contains `"SECRET"`/`"beforeHash"`) |
| `"planMemoryInstall reports partial for an assistant whose instructions are unsupported (e.g. Cursor)"` (321) | `hook: { path: "", status: { kind: "unsupported", reason: "Cursor has no officially supported, stable session-start hook mechanism this installer configures" }, runtimeStatus: { kind: "unsupported" } }` |
| `"planMemoryInstall surfaces a blocked component's conflict details"` (351) | `hook: { path: "/Users/tester/.claude/settings.json", status: { kind: "noop" }, runtimeStatus: { kind: "pending-runtime-verification", reason: "no-evidence" } }` |
| `"verifyMemoryIntegration sends only --agent and reads the verification"` (394) | `hook: { supported: true, path: "/Users/tester/.claude/settings.json", present: true, dryRunOk: true, runtimeStatus: { kind: "runtime-observed" } }` — and the matching object in the `expect(verification).toEqual({...})` block |
| `"verifyMemoryIntegration reports complete for Cursor once its MCP is present, per Engines' own achievable-state semantics"` (426) | `hook: { supported: false, path: "", present: false, dryRunOk: false, runtimeStatus: { kind: "unsupported" } }` |
| `"verifyMemoryIntegration reports absent when nothing was ever installed"` (449) | `hook: { supported: true, path: "/Users/tester/.claude/settings.json", present: false, dryRunOk: false, runtimeStatus: { kind: "absent" } }` |

Leave `"planMemoryInstall throws Engines' own message for a hard failure"` (380), `"planMemoryInstall rejects a malformed plan instead of guessing its shape"` (387, has no `metadata` at all), and `"verifyMemoryIntegration rejects a malformed result instead of guessing its shape"` (469, has no `mcp`/`instructions` at all) exactly as they are — none of them reach the new `hook === undefined` check, because they fail validation before that point.

- [ ] **Step 5: Run the full file and confirm everything passes**

Run: `bun test src/infrastructure/forge614-engines.test.ts`
Expected: PASS, all tests including the 10 new ones from Step 1.

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: PASS (this surfaces any other file that constructs a `MemoryInstallPlan`/`MemoryVerification` object literal without `hook` — none should exist yet since `init-engram.ts` isn't touched until Task 4, but confirm).

- [ ] **Step 7: Commit**

```bash
git add src/infrastructure/forge614-engines.ts src/infrastructure/forge614-engines.test.ts
git commit -m "feat: parse the memory-hook component and its runtime status from Engines"
```

---

### Task 2: Add the native terminal hand-off

**Files:**
- Create: `src/infrastructure/native-handoff.ts`
- Test: `src/infrastructure/native-handoff.test.ts`

**Interfaces:**
- Produces: `export type SpawnHandoff = (executable: string, cwd: string, env: NodeJS.ProcessEnv) => Promise<void>;` and `export const runInteractiveHandoff: SpawnHandoff`.
- Consumed by: Task 4 (`src/app/init-engram.ts`).

- [ ] **Step 1: Write the failing tests**

```ts
// src/infrastructure/native-handoff.test.ts
import { expect, test } from "bun:test";
import { runInteractiveHandoff } from "./native-handoff.ts";

test("resolves once the child process exits, whatever its exit code", async () => {
  await expect(runInteractiveHandoff("/usr/bin/true", process.cwd(), process.env)).resolves.toBeUndefined();
});

test("rejects with a clear message when the executable does not exist", async () => {
  await expect(runInteractiveHandoff("/definitely/not/a/real/native-client", process.cwd(), process.env))
    .rejects.toThrow("could not be started");
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `bun test src/infrastructure/native-handoff.test.ts`
Expected: FAIL — the module does not exist yet.

- [ ] **Step 3: Implement it**

```ts
// src/infrastructure/native-handoff.ts
import { spawn } from "node:child_process";

export type SpawnHandoff = (executable: string, cwd: string, env: NodeJS.ProcessEnv) => Promise<void>;

/**
 * Hands the real terminal to a native AI client's own binary — never Shell's own SDK/RPC-driven
 * chat adapters. Those talk to Codex over `app-server` JSON-RPC, which has no way to surface
 * Codex's native `/hooks` trust prompt, and drive Claude through the Agent SDK rather than the
 * plain interactive CLI. This is the only way to guarantee the client's own real SessionStart
 * fires and, for Codex, that any hook-trust prompt is the user's own client asking the user
 * directly. Resolves once the client exits, whatever the exit code — the caller decides success
 * by asking Engines to `verify` again afterward, never from this function's return value alone.
 */
export const runInteractiveHandoff: SpawnHandoff = (executable, cwd, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, [], { cwd, env, stdio: "inherit", windowsHide: false });
    child.once("error", error => reject(new Error(`${executable} could not be started: ${error.message}`)));
    child.once("exit", () => resolve());
  });
```

- [ ] **Step 4: Run to confirm success**

Run: `bun test src/infrastructure/native-handoff.test.ts`
Expected: PASS.

- [ ] **Step 5: Confirm the layering rule still holds**

Run: `bun test tests/architecture/layers.test.ts`
Expected: PASS (this file imports only `node:child_process`).

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/native-handoff.ts src/infrastructure/native-handoff.test.ts
git commit -m "feat: add a foreground terminal hand-off to a native AI client binary"
```

---

### Task 3: Show the memory-hook status in the preview screen

**Files:**
- Modify: `src/ui/startup/memory-setup.ts`
- Test: `src/ui/startup/memory-setup.test.ts`

**Interfaces:**
- Consumes: `MemoryComponentStatus` from `../../infrastructure/forge614-engines.ts` (unchanged import, reused for `hook.status` since it is the same union).
- Produces: extended `MemoryPreviewItem` (both `"pending"` and `"resolved"` variants gain a `hook: MemoryComponentStatus` field; `"pending"` also gains `hookPath: string`).

- [ ] **Step 1: Write the failing test**

Read `src/ui/startup/memory-setup.test.ts` first to find its existing preview-text assertions, then add (adjust the exact existing helper/import names to match what that file already uses for driving `showMemoryPreviewConfirm`):

```ts
test("the preview shows the memory-hook status on its own segment of the summary line", async () => {
  const terminal = new TestTerminal();
  const run = showMemoryPreviewConfirm([
    {
      agentLabel: "Claude Code", kind: "pending",
      mcpPath: "/Users/tester/.claude.json", instructionsPaths: ["/Users/tester/.claude/CLAUDE.md"],
      hookPath: "/Users/tester/.claude/settings.json",
      mcp: { kind: "noop" }, instructions: { kind: "noop" },
      hook: { kind: "write" },
      overallStatus: "partial",
    },
  ], terminal);
  await tick();
  expect(terminal.output).toContain("memory hook: will add");
  terminal.input("\r");
  await run;
});

test("the preview never shows a hook write's afterContent or beforeHash — only its status", async () => {
  const terminal = new TestTerminal();
  const run = showMemoryPreviewConfirm([
    {
      agentLabel: "Codex", kind: "pending",
      mcpPath: "/Users/tester/.codex/config.toml", instructionsPaths: ["/Users/tester/.codex/AGENTS.md"],
      hookPath: "/Users/tester/.codex/config.toml",
      mcp: { kind: "noop" }, instructions: { kind: "noop" },
      hook: { kind: "write" },
      overallStatus: "partial",
    },
  ], terminal);
  await tick();
  expect(terminal.output).not.toContain("afterContent");
  expect(terminal.output).not.toContain("beforeHash");
  terminal.input("\r");
  await run;
});
```

(Use whatever `tick()`/`TestTerminal` helper this test file already defines — do not redefine a second one.)

- [ ] **Step 2: Run to confirm failure**

Run: `bun test src/ui/startup/memory-setup.test.ts`
Expected: FAIL — `hook`/`hookPath` are not part of `MemoryPreviewItem` yet, so this won't even typecheck.

- [ ] **Step 3: Extend the type and rendering**

In `src/ui/startup/memory-setup.ts`, replace the `MemoryPreviewItem` union (currently lines 35-52):

```ts
export type MemoryPreviewItem =
  | {
      readonly agentLabel: string;
      readonly kind: "pending";
      readonly mcpPath: string;
      readonly instructionsPaths: string[];
      readonly hookPath: string;
      readonly mcp: MemoryComponentStatus;
      readonly instructions: MemoryComponentStatus;
      readonly hook: MemoryComponentStatus;
      readonly overallStatus: MemoryOverallStatus;
    }
  | {
      readonly agentLabel: string;
      readonly kind: "resolved";
      readonly mcp: MemoryComponentStatus;
      readonly instructions: MemoryComponentStatus;
      readonly hook: MemoryComponentStatus;
      readonly overallStatus: MemoryOverallStatus;
    }
  | { readonly agentLabel: string; readonly kind: "blocked"; readonly detail: string };
```

Add, right after `instructionsStatusLabel` (currently ending at line 76):

```ts
function hookStatusLabel(status: MemoryComponentStatus): string {
  switch (status.kind) {
    case "write": return "will add";
    case "noop": return "already installed";
    case "blocked": return "blocked";
    case "unsupported": return "not supported by this assistant";
  }
}
```

Update `previewLine` (currently lines 90-105) to include the hook path and status:

```ts
function previewLine(item: MemoryPreviewItem): string {
  if (item.kind === "blocked") return `${item.agentLabel}: blocked — ${item.detail}`;
  const paths = item.kind === "pending"
    ? [
        ...(item.mcp.kind === "write" ? [item.mcpPath] : []),
        ...(item.instructions.kind === "write" ? item.instructionsPaths : []),
        ...(item.hook.kind === "write" ? [item.hookPath] : []),
      ]
    : [];
  const lines = [
    `${item.agentLabel} — overall: ${item.overallStatus}`,
    `  paths to change: ${paths.length ? paths.join(", ") : "(none)"}`,
    `  MCP forge614-engram: ${mcpStatusLabel(item.mcp)} · memory instructions: ${instructionsStatusLabel(item.instructions)} · memory hook: ${hookStatusLabel(item.hook)}`,
  ];
  const mcpDetail = statusDetail(item.mcp);
  if (mcpDetail) lines.push(`    ${mcpDetail}`);
  const instructionsDetail = statusDetail(item.instructions);
  if (instructionsDetail) lines.push(`    ${instructionsDetail}`);
  const hookDetail = statusDetail(item.hook);
  if (hookDetail) lines.push(`    ${hookDetail}`);
  return lines.join("\n");
}
```

`statusDetail` already handles any `MemoryComponentStatus` generically (it switches on `.kind`, not on which field it came from), so it needs no change and naturally covers `hook.status`.

- [ ] **Step 4: Run to confirm success**

Run: `bun test src/ui/startup/memory-setup.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/startup/memory-setup.ts src/ui/startup/memory-setup.test.ts
git commit -m "feat: show the memory-hook status in the Engram integration preview"
```

---

### Task 4: Verify every selected agent's hook at runtime, and hand off to the client once when it is pending

This is the core behavioral change. It replaces the `resolved`/`pending` split's *outcome computation* (not its preview-gating role, which is unchanged) with one unified path: every selected agent gets a real `verify memory-integration` call, and if that verify reports the hook as `pending-runtime-verification` or `needs-user-trust`, Shell hands the terminal to that agent's real binary once and verifies again.

**Files:**
- Modify: `src/app/init-engram.ts`
- Test: `src/app/init-engram.test.ts`

**Interfaces:**
- Consumes: `HookRuntimeStatus`, `MemoryVerification` from `../infrastructure/forge614-engines.ts` (Task 1); `runInteractiveHandoff` from `../infrastructure/native-handoff.ts` (Task 2).
- Produces: `MemoryOutcomeStatus` gains `"pending-verification"`; `verifyAndMaybeRelaunch(agent, options): Promise<MemoryOutcome>` (new, module-private).
- Removes: `planOutcome`, `planDetail` (dead once every agent goes through `verify`).

- [ ] **Step 1: Update the shared test fixture helpers first**

In `src/app/init-engram.test.ts`, update `planPayload` (currently lines 188-209) to always emit a `hook` block, defaulting to fully-resolved-and-observed so every *existing* test that doesn't care about hooks keeps behaving exactly as before:

```ts
function planPayload(agentId: string, opts: {
  planId?: string; noop?: boolean;
  mcpStatus?: { kind: string; reason?: string; details?: string };
  instructionsStatus?: { kind: string; reason?: string; details?: string };
  hookStatus?: { kind: string; reason?: string; details?: string };
  hookRuntimeStatus?: { kind: string; reason?: string };
  overallStatus?: string; mcpPath?: string; instructionsPaths?: string[]; hookPath?: string;
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
        hook: {
          path: opts.hookPath ?? `/Users/tester/.${agentId}/hook-target`,
          status: opts.hookStatus ?? { kind: "write" },
          runtimeStatus: opts.hookRuntimeStatus ?? { kind: "pending-runtime-verification", reason: "no-evidence" },
        },
        overallStatus: opts.overallStatus ?? "complete",
      },
    },
  };
}
```

Update `verifyPayload` (currently lines 215-231) the same way, defaulting to `runtime-observed` (the "everything really is fine" default) so every existing test that expects a plain `"configured"` outcome keeps passing unchanged:

```ts
function verifyPayload(agentId: string, opts: {
  mcpPresent?: boolean; instructionsSupported?: boolean; instructionsPresent?: boolean;
  hookSupported?: boolean; hookPresent?: boolean; hookDryRunOk?: boolean;
  hookRuntimeStatus?: { kind: string; reason?: string };
  overallStatus?: string;
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
      hook: {
        supported: opts.hookSupported ?? true,
        path: `/Users/tester/.${agentId}/hook-target`,
        present: opts.hookPresent ?? true,
        dryRunOk: opts.hookDryRunOk ?? true,
        runtimeStatus: opts.hookRuntimeStatus ?? { kind: "runtime-observed" },
      },
      overallStatus: opts.overallStatus ?? "complete",
    },
  };
}
```

Every existing call site of `planPayload(...)`/`verifyPayload(...)` in this file that does not pass hook-related options now gets a fully-resolved, `runtime-observed` hook by default — meaning every existing test's expected `"configured"`/`"partial"`/`"not-configured"` outcomes are unaffected **except** the two noted in Step 6 below, which specifically tested the old "noop plans never call verify" shortcut that Step 3 removes on purpose.

- [ ] **Step 2: Write the new failing tests (the 8 required scenarios, plus three dedicated to evidence-expired specifically — a shared code path is not itself proof of correct behavior)**

Add these to `src/app/init-engram.test.ts`:

```ts
test("a freshly-configured Claude Code starts pending-runtime-verification and is never shown as complete before evidence exists", async () => {
  const terminal = new TestTerminal();
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
      if (args[0] === "plan") return { status: 0, stdout: JSON.stringify(planPayload("claude-code", { hookStatus: { kind: "write" }, hookRuntimeStatus: { kind: "pending-runtime-verification", reason: "no-evidence" } })), stderr: "" };
      if (args[0] === "apply") return { status: 0, stdout: JSON.stringify(applyPayload("plan-claude-code")), stderr: "" };
      // verify is called twice: once right after apply, once after the hand-off. Both times nothing
      // was ever really observed on this fake machine, so both report the same pending state.
      return { status: 0, stdout: JSON.stringify(verifyPayload("claude-code", { hookRuntimeStatus: { kind: "pending-runtime-verification", reason: "no-evidence" } })), stderr: "" };
    },
    launch: async () => {}, // fake hand-off: the client "opened and closed" instantly
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r"); await tick(); // check Claude Code, submit
  terminal.input("\r"); // preview: Confirm
  try { await run; } finally { restore(); }
  expect(logs).toContain("Claude Code: configured; pending verification — the MCP server and memory instructions are already configured and untouched — only the runtime check needs to run again; open this assistant once more so Forge614 Engines can confirm it");
  expect(logs.some(line => line.startsWith("Claude Code: configured —"))).toBe(false);
});

test("Claude Code is reported fully configured once the hand-off's re-verify observes the runtime evidence", async () => {
  const terminal = new TestTerminal();
  const { logs, restore } = captureLogs();
  let verifyCalls = 0;
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
      if (args[0] === "plan") return { status: 0, stdout: JSON.stringify(planPayload("claude-code", { hookStatus: { kind: "write" }, hookRuntimeStatus: { kind: "pending-runtime-verification", reason: "no-evidence" } })), stderr: "" };
      if (args[0] === "apply") return { status: 0, stdout: JSON.stringify(applyPayload("plan-claude-code")), stderr: "" };
      verifyCalls += 1;
      // First verify (right after apply): still pending. Second verify (after the hand-off): observed.
      const runtimeStatus = verifyCalls === 1 ? { kind: "pending-runtime-verification", reason: "no-evidence" } : { kind: "runtime-observed" };
      return { status: 0, stdout: JSON.stringify(verifyPayload("claude-code", { hookRuntimeStatus: runtimeStatus })), stderr: "" };
    },
    launch: async () => {},
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r"); await tick(); // check Claude Code, submit
  terminal.input("\r"); // preview: Confirm
  try { await run; } finally { restore(); }
  expect(verifyCalls).toBe(2);
  expect(logs).toContain("Claude Code: configured — MCP and memory instructions available");
});

test("Codex reporting needs-user-trust is launched automatically, with no extra confirmation prompt, and Shell never attempts to approve the hook itself", async () => {
  const terminal = new TestTerminal();
  const { logs, restore } = captureLogs();
  const launches: { executable: string }[] = [];
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "codex", label: "Codex", executable: "/usr/local/bin/codex" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("codex")), stderr: "" };
      if (args[0] === "plan") return { status: 0, stdout: JSON.stringify(planPayload("codex", { hookStatus: { kind: "write" }, hookRuntimeStatus: { kind: "needs-user-trust" } })), stderr: "" };
      if (args[0] === "apply") return { status: 0, stdout: JSON.stringify(applyPayload("plan-codex")), stderr: "" };
      return { status: 0, stdout: JSON.stringify(verifyPayload("codex", { hookRuntimeStatus: { kind: "runtime-observed" } })), stderr: "" };
    },
    launch: async executable => { launches.push({ executable }); },
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r"); await tick(); // check Codex, submit
  terminal.input("\r"); // preview: Confirm — this is the ONLY confirmation in the whole run
  try { await run; } finally { restore(); }
  expect(launches).toEqual([{ executable: "/usr/local/bin/codex" }]);
  expect(logs.some(line => line.includes("trust its new memory hook"))).toBe(true);
  expect(logs).toContain("Codex: configured — MCP and memory instructions available");
});

test("Codex still needing trust after the hand-off is reported as pending, never as success or a hard error", async () => {
  const terminal = new TestTerminal();
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "codex", label: "Codex", executable: "/usr/local/bin/codex" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("codex")), stderr: "" };
      if (args[0] === "plan") return { status: 0, stdout: JSON.stringify(planPayload("codex", { hookStatus: { kind: "write" }, hookRuntimeStatus: { kind: "needs-user-trust" } })), stderr: "" };
      if (args[0] === "apply") return { status: 0, stdout: JSON.stringify(applyPayload("plan-codex")), stderr: "" };
      // The user closed Codex without running /hooks: it is still untrusted both times.
      return { status: 0, stdout: JSON.stringify(verifyPayload("codex", { hookRuntimeStatus: { kind: "needs-user-trust" } })), stderr: "" };
    },
    launch: async () => {},
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r"); await tick(); // check Codex, submit
  terminal.input("\r"); // preview: Confirm
  try { await run; } finally { restore(); }
  expect(logs).toContain("Codex: configured; pending verification — Codex has not trusted the memory hook yet — approve it inside Codex, then run this command again");
});

test("evidence-expired for an already-fully-configured Claude Code is reported as a stale check, never as lost memory or a failed install, and triggers exactly one renewal hand-off", async () => {
  const terminal = new TestTerminal();
  const { logs, restore } = captureLogs();
  const launches: { executable: string }[] = [];
  let verifyCalls = 0;
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
      if (args[0] === "plan") {
        // Everything is already on disk (mcp/instructions/hook all noop) — only the 7-day evidence
        // window lapsed. `plan.noop` is true: nothing for `apply` to write, so this goes through the
        // `resolved` branch, not the preview/confirm/apply branch.
        return {
          status: 0,
          stdout: JSON.stringify(planPayload("claude-code", {
            noop: true,
            mcpStatus: { kind: "noop" }, instructionsStatus: { kind: "noop" },
            hookStatus: { kind: "noop" }, hookRuntimeStatus: { kind: "pending-runtime-verification", reason: "evidence-expired" },
            overallStatus: "partial",
          })),
          stderr: "",
        };
      }
      verifyCalls += 1;
      // First verify (before any hand-off): still expired. Second verify (after the renewal
      // hand-off): a fresh session ran, so Engines now reports runtime-observed.
      const runtimeStatus = verifyCalls === 1
        ? { kind: "pending-runtime-verification", reason: "evidence-expired" }
        : { kind: "runtime-observed" };
      const overallStatus = verifyCalls === 1 ? "partial" : "complete";
      return { status: 0, stdout: JSON.stringify(verifyPayload("claude-code", { hookRuntimeStatus: runtimeStatus, overallStatus })), stderr: "" };
    },
    launch: async executable => { launches.push({ executable }); },
  });
  await driveEngramScreens(terminal);
  // Nothing is pending (plan.noop is true), so no preview/confirm screen appears — the picker's
  // submit is the last screen before the unified verify(+relaunch) path runs on its own.
  terminal.input(" "); terminal.input("\r");
  try { await run; } finally { restore(); }
  expect(verifyCalls).toBe(2);
  expect(launches).toEqual([{ executable: "/usr/local/bin/claude" }]);
  const allText = logs.join("\n");
  expect(allText).not.toMatch(/lost|failed|not configured/i);
  expect(logs).toContain("Claude Code: configured — MCP and memory instructions available");
});

test("evidence-expired that produces no fresh evidence after the hand-off stays honestly pending, with a clear cause, never a false success", async () => {
  const terminal = new TestTerminal();
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
      if (args[0] === "plan") {
        return {
          status: 0,
          stdout: JSON.stringify(planPayload("claude-code", {
            noop: true,
            mcpStatus: { kind: "noop" }, instructionsStatus: { kind: "noop" },
            hookStatus: { kind: "noop" }, hookRuntimeStatus: { kind: "pending-runtime-verification", reason: "evidence-expired" },
            overallStatus: "partial",
          })),
          stderr: "",
        };
      }
      // The user closed the client immediately; the check stays expired both times.
      return { status: 0, stdout: JSON.stringify(verifyPayload("claude-code", { hookRuntimeStatus: { kind: "pending-runtime-verification", reason: "evidence-expired" }, overallStatus: "partial" })), stderr: "" };
    },
    launch: async () => {},
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r");
  try { await run; } finally { restore(); }
  expect(logs).toContain("Claude Code: configured; pending verification — the MCP server and memory instructions are already configured and untouched — only the runtime check needs to run again; open this assistant once more so Forge614 Engines can confirm it");
});

test("Codex's expired evidence is never reported or worded as a lack of trust — needs-user-trust stays its own distinct case", async () => {
  const terminal = new TestTerminal();
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "codex", label: "Codex", executable: "/usr/local/bin/codex" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("codex")), stderr: "" };
      if (args[0] === "plan") {
        return {
          status: 0,
          stdout: JSON.stringify(planPayload("codex", {
            noop: true,
            mcpStatus: { kind: "noop" }, instructionsStatus: { kind: "noop" },
            hookStatus: { kind: "noop" }, hookRuntimeStatus: { kind: "pending-runtime-verification", reason: "evidence-expired" },
            overallStatus: "partial",
          })),
          stderr: "",
        };
      }
      return { status: 0, stdout: JSON.stringify(verifyPayload("codex", { hookRuntimeStatus: { kind: "pending-runtime-verification", reason: "evidence-expired" }, overallStatus: "partial" })), stderr: "" };
    },
    launch: async () => {},
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r");
  try { await run; } finally { restore(); }
  expect(logs.some(line => line.includes("has not trusted the memory hook"))).toBe(false);
  expect(logs).toContain("Codex: configured; pending verification — the MCP server and memory instructions are already configured and untouched — only the runtime check needs to run again; open this assistant once more so Forge614 Engines can confirm it");
});

test("a genuine MCP/hook conflict is never written and is reported with Engines' own concrete cause", async () => {
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
          mcpStatus: { kind: "noop" }, instructionsStatus: { kind: "noop" },
          hookStatus: { kind: "blocked", reason: "hook-conflict", details: "An existing SessionStart hook with different content is already present in /Users/tester/.claude/settings.json" },
          hookRuntimeStatus: { kind: "absent" },
          overallStatus: "partial",
        })),
        stderr: "",
      };
    },
  });
  await driveEngramScreens(terminal);
  // The plan is noop:true (nothing Engines can write), so no preview/confirm screen appears, and no
  // apply call is made, but Task 4's unified path still calls verify to report the real state.
  terminal.input(" "); terminal.input("\r"); await tick();
  await tick();
  try { await run; } finally { restore(); }
  expect(enginesCalls.some(c => c.includes("apply"))).toBe(false);
  expect(logs.some(line => line.startsWith("Claude Code: configured —"))).toBe(false);
});

test("Cursor never appears as a complete automatic memory integration, even with the hook component present", async () => {
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
            hookStatus: { kind: "unsupported", reason: "Cursor has no officially supported, stable session-start hook mechanism this installer configures" },
            hookRuntimeStatus: { kind: "unsupported" },
            overallStatus: "partial",
          })),
          stderr: "",
        };
      }
      if (args[0] === "apply") return { status: 0, stdout: JSON.stringify(applyPayload("plan-cursor")), stderr: "" };
      return {
        status: 0,
        stdout: JSON.stringify(verifyPayload("cursor", {
          instructionsSupported: false, instructionsPresent: false,
          hookSupported: false, hookRuntimeStatus: { kind: "unsupported" },
          overallStatus: "complete",
        })),
        stderr: "",
      };
    },
    launch: async () => { throw new Error("Cursor must never be launched by this flow."); },
  });
  await driveEngramScreens(terminal);
  terminal.input(" "); terminal.input("\r"); await tick(); // check Cursor, submit
  terminal.input("\r"); // preview: Confirm
  try { await run; } finally { restore(); }
  expect(logs.some(line => line.startsWith("Cursor: configured"))).toBe(false);
  expect(logs).toContain("Cursor: partially configured — this assistant has no official mechanism to auto-load global instructions");
});

test("no run of this flow ever prints a PostgreSQL connection string, a token, or an afterContent/beforeHash value, across every log line and every terminal frame", async () => {
  const terminal = new TestTerminal();
  const postgresUrl = "postgres://user:sup3rsecret@host:5432/db";
  const fakeSecret = "github_pat_FAKE_VALUE_FOR_TEST_ONLY";
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (_command, args) => {
      if (args[0] === "detect") return { status: 0, stdout: JSON.stringify(detectPayload([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }])), stderr: "" };
      if (args[0] === "capabilities") return { status: 0, stdout: JSON.stringify(capabilitiesPayload("claude-code")), stderr: "" };
      if (args[0] === "plan") {
        return {
          status: 0,
          stdout: JSON.stringify({
            schemaVersion: 1,
            plan: {
              planId: "plan-claude-code", agentId: "claude-code", action: "memory-install", noop: false,
              writes: [{ path: "/Users/tester/.claude/settings.json", beforeHash: "abc123", afterContent: `{"env":{"GITHUB_TOKEN":"${fakeSecret}"}}` }],
              metadata: {
                mcp: { path: "/Users/tester/.claude.json", status: { kind: "noop" } },
                instructions: { paths: ["/Users/tester/.claude/CLAUDE.md"], status: { kind: "noop" } },
                hook: { path: "/Users/tester/.claude/settings.json", status: { kind: "write" }, runtimeStatus: { kind: "pending-runtime-verification", reason: "no-evidence" } },
                overallStatus: "partial",
              },
            },
          }),
          stderr: "",
        };
      }
      if (args[0] === "apply") return { status: 0, stdout: JSON.stringify(applyPayload("plan-claude-code")), stderr: "" };
      return { status: 0, stdout: JSON.stringify(verifyPayload("claude-code", { hookRuntimeStatus: { kind: "runtime-observed" } })), stderr: "" };
    },
    launch: async () => {},
  });
  await tick();
  terminal.input("\r"); await tick(); // Continue
  terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // PostgreSQL: Yes
  terminal.input(postgresUrl);
  terminal.input("\r"); await tick(); // submit connection string
  terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // Reinforcement: No
  terminal.input("\r"); await tick(); // Engram summary: Confirm
  terminal.input(" "); terminal.input("\r"); await tick(); // memory picker: check Claude Code, submit
  terminal.input("\r"); // preview: Confirm
  try { await run; } finally { restore(); }
  for (const forbidden of [postgresUrl, "sup3rsecret", fakeSecret, "afterContent", "beforeHash", "abc123"]) {
    expect(terminal.output).not.toContain(forbidden);
    expect(logs.join("\n")).not.toContain(forbidden);
  }
});

test("Shell never calls memory-hook-run and never reads the hook-evidence directory itself", async () => {
  const source = await readFile(new URL("./init-engram.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/memory-hook-run/);
  expect(source).not.toMatch(/hook-evidence/);
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `bun test src/app/init-engram.test.ts`
Expected: FAIL — `RunInitOptions` has no `launch` field yet, `runMemorySetupStep` never calls `verify` for `resolved` (noop) plans, and there is no hand-off logic at all.

- [ ] **Step 4: Rewrite the orchestration**

In `src/app/init-engram.ts`:

Update imports (currently lines 1-10) to add the new module and type:

```ts
import type { Terminal } from "@earendil-works/pi-tui";
import { runEngramInitFlow } from "../ui/startup/engram-init.ts";
import { chooseMemoryAgents, showMemoryPreviewConfirm } from "../ui/startup/memory-setup.ts";
import type { MemoryPreviewItem } from "../ui/startup/memory-setup.ts";
import { applyEngramInit, type RunEngram } from "../infrastructure/forge614-engram.ts";
import {
  applyEnginesPlan, discoverMcpCapableAgents, planMemoryInstall, verifyMemoryIntegration,
  type MemoryInstallPlan, type MemoryVerification,
} from "../infrastructure/forge614-engines.ts";
import { runInteractiveHandoff, type SpawnHandoff } from "../infrastructure/native-handoff.ts";
import type { McpCapableAgent } from "../contracts/mcp-agent.ts";
```

Add `launch` to `RunInitOptions` (currently lines 39-47):

```ts
export interface RunInitOptions {
  readonly terminal?: Terminal;
  /** Overrides the real TTY check; the sole source of truth for the interactivity gate when given. */
  readonly interactive?: boolean;
  readonly run?: RunEngram;
  readonly enginesRun?: RunEngram;
  readonly home?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Injects the terminal hand-off for tests; defaults to the real `runInteractiveHandoff`. */
  readonly launch?: SpawnHandoff;
}
```

Extend `MemoryOutcomeStatus` (currently line 49):

```ts
type MemoryOutcomeStatus = "configured" | "pending-verification" | "partial" | "unsupported" | "not-configured" | "skipped";
```

Update `outcomeLine` (currently lines 63-69):

```ts
function outcomeLine(outcome: MemoryOutcome): string {
  if (outcome.status === "configured") return `${outcome.label}: configured — MCP and memory instructions available`;
  if (outcome.status === "pending-verification") return `${outcome.label}: configured; pending verification — ${outcome.detail}`;
  if (outcome.status === "partial") return `${outcome.label}: partially configured — ${outcome.detail}`;
  if (outcome.status === "unsupported") return `${outcome.label}: not supported — ${outcome.detail}`;
  if (outcome.status === "skipped") return `${outcome.label}: skipped`;
  return `${outcome.label}: not configured — ${outcome.detail}`;
}
```

Delete `planDetail` and `planOutcome` entirely (currently lines 71-89) — no caller remains after Step 4's rewrite of `runMemorySetupStep` below.

Replace `verificationDetail`/`verificationOutcome` (currently lines 91-112) with:

```ts
/**
 * A lapsed evidence window (`evidence-expired`) and a never-yet-observed hook (`no-evidence`, and
 * the other evidence-* reasons) are both reported through this one honest message: nothing is
 * broken, nothing was lost, only the runtime check itself needs to run again. `needs-user-trust`
 * is a genuinely different situation (an unresolved trust decision only the person can make inside
 * Codex) and must never share this wording — see Global Constraints.
 */
function hookRuntimeDetail(status: MemoryVerification["hook"]["runtimeStatus"]): string | undefined {
  if (status.kind === "pending-runtime-verification") {
    return "the MCP server and memory instructions are already configured and untouched — only the runtime check needs to run again; open this assistant once more so Forge614 Engines can confirm it";
  }
  if (status.kind === "needs-user-trust") {
    return "Codex has not trusted the memory hook yet — approve it inside Codex, then run this command again";
  }
  return undefined;
}

function verificationDetail(verification: MemoryVerification): string {
  const parts: string[] = [];
  if (!verification.mcp.present) parts.push("the MCP server is not configured");
  if (!verification.instructions.supported) parts.push("this assistant has no official mechanism to auto-load global instructions");
  else if (!verification.instructions.present) parts.push("the memory instructions are not installed");
  const hookDetail = hookRuntimeDetail(verification.hook.runtimeStatus);
  if (hookDetail) parts.push(hookDetail);
  return parts.join("; ") || "Forge614 Engines could not confirm full memory integration.";
}

/**
 * Turns a post-apply (or post-hand-off) verification into the outcome Shell reports. Never trusts a
 * bare "complete" from Engines when this assistant structurally cannot auto-load instructions (e.g.
 * Cursor) — Shell always calls that partial and explains why. Separately, when the MCP server and
 * instructions are both genuinely in place and the *only* open question is the hook's own runtime
 * evidence — whether it never ran yet, or ran once and the evidence since expired — this is reported
 * as its own "pending-verification" state — never lumped in with a structural "partial" (which means
 * something is actually broken or unsupported), and never worded as data loss.
 */
function verificationOutcome(label: string, verification: MemoryVerification): MemoryOutcome {
  if (verification.overallStatus === "absent") {
    return { label, status: "not-configured", detail: "Forge614 Engines could not confirm any memory integration for this assistant." };
  }
  if (verification.overallStatus === "complete" && verification.instructions.supported) {
    return { label, status: "configured" };
  }
  const structurallyComplete = verification.mcp.present && (!verification.instructions.supported || verification.instructions.present);
  const hookPending = verification.hook.runtimeStatus.kind === "pending-runtime-verification" || verification.hook.runtimeStatus.kind === "needs-user-trust";
  if (structurallyComplete && hookPending) {
    return { label, status: "pending-verification", detail: hookRuntimeDetail(verification.hook.runtimeStatus)! };
  }
  return { label, status: "partial", detail: verificationDetail(verification) };
}

/**
 * Verifies one agent's real state, and — only when everything structural is in place but the hook's
 * runtime evidence is still pending (never observed, or observed once and since expired) or Codex
 * still needs to trust it — hands the terminal to that agent's own native binary once, then verifies
 * again. Never retries beyond that one hand-off: a user who closes the client without letting it
 * finish (or without trusting the hook) sees an honest "pending verification" outcome, never a false
 * success and never a hard error.
 */
async function verifyAndMaybeRelaunch(
  agent: McpCapableAgent,
  options: { home?: string; env?: NodeJS.ProcessEnv; enginesRun?: RunEngram; launch?: SpawnHandoff },
): Promise<MemoryOutcome> {
  const verification = await verifyMemoryIntegration({ agentId: agent.id, home: options.home, env: options.env, run: options.enginesRun });
  const outcome = verificationOutcome(agent.label, verification);
  if (outcome.status !== "pending-verification") return outcome;
  console.log(`Opening ${agent.label} to complete memory verification…`);
  if (verification.hook.runtimeStatus.kind === "needs-user-trust") {
    console.log(`${agent.label} may ask you to trust its new memory hook once — approve it there. Forge614 Shell never approves or skips this step for you.`);
  }
  try {
    await (options.launch ?? runInteractiveHandoff)(agent.executable, process.cwd(), options.env ?? process.env);
  } catch (error) {
    return { label: agent.label, status: "pending-verification", detail: error instanceof Error ? error.message : String(error) };
  }
  const reverified = await verifyMemoryIntegration({ agentId: agent.id, home: options.home, env: options.env, run: options.enginesRun });
  return verificationOutcome(agent.label, reverified);
}
```

Now rewrite `runMemorySetupStep` (currently lines 123-200). Keep everything through building `pending`/`resolved`/the preview/confirm screen exactly as-is (the plan's own `noop` flag still correctly decides whether anything needs writing and whether a confirmation screen is shown at all — that part of the design was already correct). Replace only the two post-plan result loops:

```ts
async function runMemorySetupStep(
  terminal: Terminal | undefined,
  options: { home?: string; env?: NodeJS.ProcessEnv; enginesRun?: RunEngram; launch?: SpawnHandoff },
): Promise<MemorySetupResult> {
  let agents: McpCapableAgent[];
  try {
    agents = await discoverMcpCapableAgents({ home: options.home, env: options.env, run: options.enginesRun });
  } catch (error) {
    console.log(`Memory setup could not be offered: ${error instanceof Error ? error.message : String(error)}`);
    return { outcomes: [], applied: false };
  }
  if (agents.length === 0) {
    console.log("No compatible AI assistants were found to configure with memory integration.");
    return { outcomes: [], applied: false };
  }
  const selectedIds = await chooseMemoryAgents(agents, terminal);
  if (selectedIds === undefined) {
    console.log("Memory setup was skipped.");
    return { outcomes: agents.map(agent => ({ label: agent.label, status: "skipped" as const })), applied: false };
  }
  if (selectedIds.length === 0) {
    console.log("No assistant was selected. No memory integration was configured.");
    return { outcomes: agents.map(agent => ({ label: agent.label, status: "skipped" as const })), applied: false };
  }
  let applied = false;
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
  for (const r of resolved) {
    try { outcomeMap.set(r.agent.id, await verifyAndMaybeRelaunch(r.agent, options)); }
    catch (error) { outcomeMap.set(r.agent.id, { label: r.agent.label, status: "not-configured", detail: error instanceof Error ? error.message : String(error) }); }
  }
  if (pending.length > 0) {
    const blockedAgents = agents.filter(agent => selectedSet.has(agent.id) && outcomeMap.get(agent.id)?.status === "not-configured");
    const previewItems: MemoryPreviewItem[] = [
      ...pending.map(p => ({
        agentLabel: p.agent.label, kind: "pending" as const,
        mcpPath: p.plan.mcp.path, instructionsPaths: p.plan.instructions.paths, hookPath: p.plan.hook.path,
        mcp: p.plan.mcp.status, instructions: p.plan.instructions.status, hook: p.plan.hook.status, overallStatus: p.plan.overallStatus,
      })),
      ...resolved.map(r => ({
        agentLabel: r.agent.label, kind: "resolved" as const,
        mcp: r.plan.mcp.status, instructions: r.plan.instructions.status, hook: r.plan.hook.status, overallStatus: r.plan.overallStatus,
      })),
      ...blockedAgents.map(agent => ({ agentLabel: agent.label, kind: "blocked" as const, detail: outcomeMap.get(agent.id)!.detail! })),
    ];
    const confirmed = await showMemoryPreviewConfirm(previewItems, terminal);
    if (!confirmed) {
      for (const p of pending) outcomeMap.set(p.agent.id, { label: p.agent.label, status: "skipped" });
    } else {
      for (const p of pending) {
        try {
          const applyResult = await applyEnginesPlan({ planId: p.plan.planId, home: options.home, env: options.env, run: options.enginesRun });
          if (!applyResult.applied) {
            outcomeMap.set(p.agent.id, { label: p.agent.label, status: "not-configured", detail: "Forge614 Engines reported the change was not applied." });
            continue;
          }
          const outcome = await verifyAndMaybeRelaunch(p.agent, options);
          // Only a plan this run actually wrote justifies the "restart your assistant" hint.
          if (outcome.status === "configured" || outcome.status === "partial" || outcome.status === "pending-verification") applied = true;
          outcomeMap.set(p.agent.id, outcome);
        } catch (error) {
          outcomeMap.set(p.agent.id, { label: p.agent.label, status: "not-configured", detail: error instanceof Error ? error.message : String(error) });
        }
      }
    }
  }
  return { outcomes: agents.map(agent => outcomeMap.get(agent.id)!), applied };
}
```

Finally, thread `launch` through the one remaining call site in `runInitCommand` (currently line 219):

```ts
const { outcomes, applied } = await runMemorySetupStep(options.terminal, { home: options.home, env: options.env, enginesRun: options.enginesRun, launch: options.launch });
```

- [ ] **Step 5: Run the new tests**

Run: `bun test src/app/init-engram.test.ts`
Expected: the 11 new tests from Step 2 PASS (8 required scenarios plus the 3 evidence-expired cases). Some pre-existing tests now FAIL — proceed to Step 6, which is expected and required, not a regression to chase blindly.

- [ ] **Step 6: Reconcile the two pre-existing tests whose entire premise was "noop plans never call verify"**

`"an assistant whose plan is already complete and needs no writes is reported configured, with no restart hint"` (originally ~line 533) and `"a plan that claims complete while the instructions are unsupported is still never reported as fully configured"` (originally ~line 567) both asserted `enginesCalls.some(c => c.includes("memory-integration"))` is `false` for a noop plan. That invariant is now intentionally false — a noop plan can still have a hook stuck in `pending-runtime-verification`, so Task 4 deliberately always calls `verify` for every selected agent. Update both:

For the first test, since its `planPayload` call passes no hook options, the new default (`hookRuntimeStatus: { kind: "pending-runtime-verification", reason: "no-evidence" }`) now applies — this test's own `verifyPayload`-less `enginesRun` fake only returns the plan payload for every call, so its verify call will get the SAME `planPayload`-shaped JSON parsed as a verification, which will fail. Add an explicit `verify memory-integration` branch to its `enginesRun` fake returning `verifyPayload("claude-code", { hookRuntimeStatus: { kind: "runtime-observed" } })`, remove the `expect(enginesCalls.some(c => c.includes("apply"))).toBe(false);`/`memory-integration` "false" assertion, replace it with `expect(enginesCalls.some(c => c.includes("apply"))).toBe(false);` (keep — apply truly never happens for a noop plan) and `expect(enginesCalls.some(c => c.includes("memory-integration"))).toBe(true);` (now true, and the outcome is still `"configured"` with no restart hint, since `applied` is only set inside the `pending` branch, which this agent never enters).

For the second test (Cursor, `overallStatus: "complete"` but `instructions.status: unsupported`), similarly add a `verify memory-integration` branch returning `verifyPayload("cursor", { instructionsSupported: false, instructionsPresent: false, hookSupported: false, hookRuntimeStatus: { kind: "unsupported" }, overallStatus: "complete" })`; the expected log line and the "never shown as configured" assertion are unaffected.

- [ ] **Step 7: Run the full file and confirm everything passes**

Run: `bun test src/app/init-engram.test.ts`
Expected: PASS, all tests.

- [ ] **Step 8: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/init-engram.ts src/app/init-engram.test.ts
git commit -m "feat: verify the memory hook's runtime state for every agent and hand off once when pending"
```

---

### Task 5: Update the English and Spanish documentation

**Files:**
- Modify: `docs/en/07-engram-initialization-and-mcp.md`
- Modify: `docs/es/07-inicializacion-engram-y-mcp.md`
- Modify: `docs/en/04-architecture-engines.md`
- Modify: `docs/es/04-arquitectura-motores.md`

- [ ] **Step 1: Extend `docs/en/07-engram-initialization-and-mcp.md`**

After the existing step 8 (`forge614-engines verify memory-integration --agent <id>`, currently around line 51), insert a new step and renumber the rest:

```markdown
9. Every selected assistant is verified this way — even one whose plan needed no writes at all, because the memory hook's *runtime* evidence is a separate question from whether its files are correctly written. When that verification shows the hook is installed but not yet runtime-observed (whether it never ran, or ran once and the evidence since expired), Shell hands the terminal to that assistant's own real binary once (never Shell's own in-app chat), lets it start for real, and verifies again once it exits. For Codex specifically, this is also how its own native hook-trust prompt gets a chance to appear — Shell never approves, skips, or bypasses it.
10. It finally reports one verified outcome per assistant: `configured — MCP and memory instructions available`, `configured; pending verification — <why>`, `partially configured — <what is missing>`, `not supported — <reason>`, `skipped`, or `not configured — <Engines' own error or conflict message>`.
11. When this run actually wrote something, Shell closes with a reminder to close and reopen each configured assistant's session so it loads the new MCP server and memory instructions. A run that changed nothing does not print it.
```

Add a new section after "Cursor is never presented as complete" (currently ending around line 58):

```markdown
## The memory hook and its runtime evidence

Forge614 Engines' `plan memory-install` and `verify memory-integration` also cover a third component: a `SessionStart` hook, installed for Claude Code and Codex alongside the MCP server and instructions. Shell detects support for this component structurally — by checking whether a `hook` field is present in Engines' own JSON — never by checking an Engines version number. If the installed Engines predates this feature, Shell shows: "Forge614 Engines needs to be updated. Run `forge614-shell update`, then try again."

Engines can confirm the hook file itself is correctly written, but it cannot cryptographically prove a real client session ran it — so it reports two independent things: whether the hook is *structurally* installed, and a separate `runtimeStatus`:

- `runtime-observed` — a real session ran the hook recently (under 7 days) and Engram returned context. Only this state, combined with the MCP server and instructions both being in place, is reported as `configured`.
- `pending-runtime-verification` — the hook is installed but no fresh evidence exists. Its own `reason` distinguishes a hook that has *never* run (`no-evidence`, the state of every freshly-configured assistant, including the very first `plan memory-install` of a brand-new installation) from one that *has* run before but whose evidence window lapsed (`evidence-expired`). Either way, Shell's wording is the same and equally honest: nothing was lost and nothing failed — the MCP server and memory instructions remain exactly as configured, only the runtime check itself needs to run again. Shell hands the terminal to the assistant once to renew it, then verifies again.
- `needs-user-trust` — Codex specifically requires reviewing and trusting a new hook once, through its own `/hooks` command, before running it. This is a genuinely different situation from expired evidence — an unresolved trust decision, not a stale timer — and Shell never words or reports the two the same way. Shell has no way to grant or skip that trust, and never tries to.
- `unsupported` — this assistant (Cursor today) has no officially supported, stable session-start hook mechanism Engines can install.

When a selected assistant's hook is `pending-runtime-verification` (for any reason) or `needs-user-trust`, Shell hands the terminal to that assistant's own real binary — the actual `claude` or `codex` executable, not Shell's own chat interface — waits for it to exit, and verifies again. This is deliberate: Shell's own chat adapters talk to Codex over a machine-to-machine protocol that cannot show Codex's native trust prompt, and there is no need to prove Claude's SDK-driven session behaves identically to the real CLI when the real CLI is one process spawn away. Nothing about this hand-off requires a second confirmation — the person already confirmed the memory-integration change once, before anything was applied.

Evidence expires after 7 days. This never deletes memory or configuration — it only means Shell will report `configured; pending verification` again until a new real session runs the hook. `runtime-observed` is not cryptographic proof the client actually used the retrieved memory; it only means Engines observed a real, compatible `SessionStart` invocation and Engram returned context for it.
```

Extend the existing "Cursor is never presented as complete" paragraph with one sentence: "Its hook component is also reported `unsupported`, for the same reason." Extend "Security and outcomes" with: "This applies to the hook component too — its write can touch an assistant's entire local settings file (for example Claude Code's `~/.claude/settings.json`, which also holds every existing hook and permission rule), so its `afterContent`/`beforeHash` are exactly as sensitive as the MCP entry's, and never shown."

- [ ] **Step 2: Mirror every change into `docs/es/07-inicializacion-engram-y-mcp.md`**

Translate the same additions, matching this document's existing tone and terminology (`configurado`, `parcialmente configurado`, etc. — reuse the exact Spanish phrasing already in this file for the existing outcome labels; do not invent new translations of terms that already have an established Spanish rendering in this file). Do not mention a specific Engines version number in either language — describe the requirement as "the memory-hook contract" / "el contrato del hook de memoria", consistent with the Global Constraints.

- [ ] **Step 3: Add a short paragraph to `docs/en/04-architecture-engines.md` and `docs/es/04-arquitectura-motores.md`**

Read the existing file first to find where it discusses Shell's engine adapters, then add one paragraph: `native-handoff.ts` is a third, minimal launch mechanism alongside the Claude SDK adapter and the Codex `app-server` RPC adapter — it does not talk any protocol at all, it simply hands the whole terminal to the real client binary via `stdio: "inherit"` and waits for exit. It exists solely so a native client's own startup behavior (hooks, trust prompts) runs exactly as it would if the person had typed the command themselves; it is not a chat surface and Shell reads no output from it.

- [ ] **Step 4: Run the repo's own documentation checks**

Run: `bun run check` includes `bun run typecheck` + `bun test` + `bun run build` per `package.json`'s `check` script — but also check whether a doc-specific verifier exists in this repo (the sibling `forge614-engines` repo has `scripts/verify-documentation.mjs`; confirm whether `forge614-shell`'s own `package.json` scripts include an equivalent before assuming none exists) and run it if so.

- [ ] **Step 5: Commit**

```bash
git add docs/en/07-engram-initialization-and-mcp.md docs/es/07-inicializacion-engram-y-mcp.md docs/en/04-architecture-engines.md docs/es/04-arquitectura-motores.md
git commit -m "docs: document memory-hook runtime verification and the native terminal hand-off"
```

---

### Task 6: Final verification and hand-off note

**Files:** none new — verification only.

- [ ] **Step 1: Full test suite**

Run: `bun test`
Expected: PASS, zero failures, including `tests/architecture/layers.test.ts` and `tests/integration/*`.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Build**

Run: `bun run build`
Expected: PASS (confirms `src/cli.ts`'s dynamic `import("./app/init-engram.ts")` still resolves cleanly with the new `RunInitOptions.launch` field).

- [ ] **Step 4: Whitespace/diff hygiene**

Run: `git diff --check`
Expected: no output (no trailing-whitespace or conflict-marker artifacts).

- [ ] **Step 5: Manual live smoke test (not automatable — requires a real terminal and a real Claude Code or Codex install)**

On a machine with a contract-compatible Forge614 Engines installed (run `forge614-shell update` first if the installed one predates the memory-hook contract — check by confirming `forge614-engines plan memory-install --agent <id>` returns a `hook` field, never by reading a version number) and Claude Code and/or Codex installed: run `forge614-shell init --product engram` for real, select an assistant whose hook is `pending-runtime-verification`, confirm, and observe that Shell actually hands over the terminal, the client actually starts, and — after it exits — Shell reports `configured` (if evidence appeared) or an honest `pending verification` (if it did not). This is the one thing no unit test can prove: that a real `claude`/`codex` process, started this way, really does fire its configured `SessionStart` hook. If it does not, that is a finding for `forge614-engines` or the native client, not a Shell bug — Shell's job ends at handing over the terminal and asking `verify` honestly afterward.

- [ ] **Step 6: Documentation hand-off**

Per this project's existing convention, do not push local doc changes to Notion directly. Once Tasks 1-5 are committed, hand a short prompt to the Notion-sync agent naming: the two changed local paths (`docs/en/07-engram-initialization-and-mcp.md`, `docs/es/07-inicializacion-engram-y-mcp.md`, plus `04` if changed), their existing (already-published) Notion URLs from `docs/notion-map.json`, a plain-language summary of what changed, and the freshly computed `sha256` fingerprint for each changed file (`shasum -a 256 <file>`) so it does not need to recompute them.

- [ ] **Step 7: Report to the requester**

Summarize: files modified, the key technical decisions (the `hook` contract shape as actually observed from a rebuilt Engines binary that carries the memory-hook contract — not as originally assumed, and never gated by a version number in code; the foreground-native-handoff design instead of reusing Shell's existing chat adapters, and why; the "verify every selected agent, not just freshly-applied ones" change and which two pre-existing tests it intentionally altered; the explicit evidence-expired handling and its three dedicated tests), the exact tests run and their results, and the real open coordination point: the machine's *installed* Engines binary must actually expose the memory-hook contract (via `forge614-shell update`, if it currently predates it) before any of this new behavior is reachable in practice — this plan does not change `updateEngines()` or force an upgrade, by design, since auto-upgrading a core dependency mid-flow without being asked would be its own, separate decision.
