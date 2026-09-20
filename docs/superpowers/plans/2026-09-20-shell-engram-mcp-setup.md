# Shell Engram MCP setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After `forge614-shell init --product engram` finishes initializing Engram's memory, let the person configure the `forge614-engram` MCP server in any detected, MCP-capable AI assistant — using only Forge614 Engines' public `detect` / `capabilities` / `plan mcp-install` / `apply` CLI contract, with one explicit confirmation before any write.

**Architecture:** Extend the existing `src/infrastructure/forge614-engines.ts` bridge with new spawn-only functions (`discoverMcpCapableAgents`, `planMcpInstall`, `applyMcpPlan`, plus `planMcpRemove`/`removeEngramMcpFromAgent` for a future uninstall flow). Add a small custom `MultiSelectList` TUI component (`pi-tui` has no built-in one) and two pure screens in `src/ui/startup/mcp-setup.ts`. Wire both into `src/app/init-engram.ts`, which already owns Engram's own init flow, so the new step runs only after Engram's own confirmed `applyEngramInit` succeeds.

**Tech Stack:** TypeScript (strict, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`), Bun test, `@earendil-works/pi-tui`.

**Spec:** [`docs/superpowers/specs/2026-09-20-shell-engram-mcp-setup-design.md`](../specs/2026-09-20-shell-engram-mcp-setup-design.md) — read it alongside this plan; it documents the real `forge614-engines` CLI shapes this plan codes against (verified both against the installed 1.1.0 binary and by reading the actual Engines source) and the security rule about never surfacing `writes[].afterContent`/`beforeHash`.

## Global Constraints

- Shell only uses `forge614-engines`' and `forge614-engram`'s public CLIs. Never import their internal source, never write `~/.claude.json` / `~/.codex/config.toml` / `~/.cursor/mcp.json` directly.
- The MCP-capable agent filter is exactly: `detect` reports `installed === true`, and a subsequent `capabilities --agent <id>` call for that id reports `supportsMcp === true`. No id allowlist, no fallback for a failed `capabilities` call (exclude the agent instead), no Shell-side detection heuristics. Do not add OpenCode or Antigravity anywhere.
- `writes[].afterContent` and `writes[].beforeHash` from any Engines plan response must never be read into a rendered string or an error message — only `writes[].path` is used.
- The preview screen shown before the single confirmation lists every *selected* assistant's outcome so far (would add / already configured / blocked), not just the ones with a pending write — the person sees the whole picture before confirming. Only the pending (write-needed) ones are affected by that confirmation; already-configured and blocked ones are simply facts, reported either way.
- Nothing is written (no `apply` call) before the person reaches and confirms that combined preview. If nothing is pending (every selected assistant is already configured or blocked), no confirmation screen is shown — there is nothing an "apply" could do — and the results are reported directly.
- One assistant's plan or apply failure must never stop or hide another assistant's result.
- `console.log` is Shell's existing convention for final one-line results (see `runInitCommand`'s existing "Forge614 Engram memory initialization is complete." line) — it is not part of the TUI and is never visible through a fake `Terminal`'s captured output. Any test asserting on these lines must spy on `console.log`, not read `terminal.output`.
- Every test uses an injected fake process runner (`run` / `enginesRun`). No test spawns a real process or touches a real path under `homedir()`.
- Do not commit, push, tag, or release. Report modified files, the tests run, and which public contract each call consumes.

---

### Task 1: `McpCapableAgent` contract

**Files:**
- Create: `src/contracts/mcp-agent.ts`

**Interfaces:**
- Produces: `McpCapableAgent { readonly id: string; readonly label: string; readonly executable: string }` — consumed by Task 3 (infra), Task 6 (UI), and Task 7 (app).

- [ ] **Step 1: Create the contract file**

```ts
/** An assistant Forge614 Engines reports as installed and MCP-capable (`supportsMcp: true`). */
export interface McpCapableAgent {
  readonly id: string;
  readonly label: string;
  readonly executable: string;
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors (this file has no imports to break).

- [ ] **Step 3: Commit**

```bash
git add src/contracts/mcp-agent.ts
git commit -m "feat: add the McpCapableAgent contract"
```

---

### Task 2: Export Engram's binary-path resolution

**Files:**
- Modify: `src/infrastructure/forge614-engram.ts:23-26`

**Interfaces:**
- Produces: `export function locateEngramBinary(home: string, env?: NodeJS.ProcessEnv): string` — consumed by Task 7, so the app layer never re-implements the `FORGE614_HOME` lookup Engram's own binary already uses.

- [ ] **Step 1: Write the failing test**

Add to `src/infrastructure/forge614-engram.test.ts` (top-level, alongside the existing tests):

```ts
import { locateEngramBinary } from "./forge614-engram.ts";

test("locateEngramBinary resolves under the given home by default", () => {
  expect(locateEngramBinary("/Users/tester")).toBe("/Users/tester/.forge614/engram/bin/forge614-engram");
});

test("locateEngramBinary honors FORGE614_HOME over the given home", () => {
  expect(locateEngramBinary("/Users/tester", { FORGE614_HOME: "/custom/forge" } as NodeJS.ProcessEnv)).toBe(
    "/custom/forge/engram/bin/forge614-engram",
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/infrastructure/forge614-engram.test.ts`
Expected: FAIL — `locateEngramBinary` is not exported yet (import error).

- [ ] **Step 3: Export the function**

In `src/infrastructure/forge614-engram.ts`, change:

```ts
function locateEngramBinary(home: string, env?: NodeJS.ProcessEnv): string {
```

to:

```ts
export function locateEngramBinary(home: string, env?: NodeJS.ProcessEnv): string {
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/infrastructure/forge614-engram.test.ts`
Expected: PASS, and every pre-existing test in this file still passes (no behavior changed, only visibility).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/forge614-engram.ts src/infrastructure/forge614-engram.test.ts
git commit -m "feat: export Engram's binary-path resolution for reuse by MCP setup"
```

---

### Task 3: `discoverMcpCapableAgents`

**Files:**
- Modify: `src/infrastructure/forge614-engines.ts`
- Modify: `src/infrastructure/forge614-engines.test.ts`

**Interfaces:**
- Consumes: `McpCapableAgent` from Task 1.
- Produces: `export async function discoverMcpCapableAgents(options: { home?: string; env?: NodeJS.ProcessEnv; run?: DetectRun }): Promise<McpCapableAgent[]>` — consumed by Task 7.

Confirmed by reading the actual Engines source (sibling `forge614-engines` repo, dev version 1.3.0) rather than guessing: `detect` never carries `supportsMcp` — that comes only from a separate `forge614-engines capabilities --agent <id>` call, one agent at a time, returning `{schemaVersion: 1, id, label, supportsMcp, supportsHooks, supportsHeadlessExec}`. Verified this command already works against the installed 1.1.0 binary too (`capabilities --agent claude-code` → `supportsMcp: true`). So this function makes one `detect` call, then one `capabilities` call per agent `detect` reported as `installed: true`.

- [ ] **Step 1: Write the failing tests**

Add to `src/infrastructure/forge614-engines.test.ts`:

```ts
import { discoverMcpCapableAgents } from "./forge614-engines.ts";

test("discoverMcpCapableAgents checks capabilities per installed agent and keeps only supportsMcp:true", async () => {
  const calls: string[][] = [];
  const agents = await discoverMcpCapableAgents({
    home: "/Users/tester",
    run: async (command, args) => {
      calls.push([command, ...args]);
      if (args[0] === "detect") {
        return {
          status: 0,
          stdout: JSON.stringify({
            schemaVersion: 1,
            agents: [
              { id: "claude-code", label: "Claude Code", installed: true, executable: "/usr/local/bin/claude", configDir: "/x", configFound: true },
              { id: "codex", label: "Codex", installed: true, executable: "/usr/local/bin/codex", configDir: "/x", configFound: true },
              { id: "cursor", label: "Cursor", installed: false, executable: undefined, configDir: "/x", configFound: false },
            ],
          }),
          stderr: "",
        };
      }
      const agentId = args[args.indexOf("--agent") + 1];
      return {
        status: 0,
        stdout: JSON.stringify({ schemaVersion: 1, id: agentId, label: agentId, supportsMcp: agentId === "claude-code", supportsHooks: true, supportsHeadlessExec: true }),
        stderr: "",
      };
    },
  });
  expect(calls).toEqual([
    ["/Users/tester/.forge614/engines/bin/forge614-engines", "detect"],
    ["/Users/tester/.forge614/engines/bin/forge614-engines", "capabilities", "--agent", "claude-code"],
    ["/Users/tester/.forge614/engines/bin/forge614-engines", "capabilities", "--agent", "codex"],
  ]);
  expect(agents).toEqual([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }]);
});

test("discoverMcpCapableAgents excludes an agent whose capabilities lookup fails, instead of crashing", async () => {
  const agents = await discoverMcpCapableAgents({
    home: "/Users/tester",
    run: async (_command, args) => {
      if (args[0] === "detect") {
        return {
          status: 0,
          stdout: JSON.stringify({ schemaVersion: 1, agents: [{ id: "claude-code", label: "Claude Code", installed: true, executable: "/usr/local/bin/claude", configDir: "/x", configFound: true }] }),
          stderr: "",
        };
      }
      return { status: 1, stdout: JSON.stringify({ schemaVersion: 1, error: { code: "UNKNOWN_AGENT", message: "Unknown agent: claude-code" } }), stderr: "" };
    },
  });
  expect(agents).toEqual([]);
});

test("discoverMcpCapableAgents rejects an unavailable Engines installation", async () => {
  await expect(discoverMcpCapableAgents({ run: async () => ({ status: 127, stdout: "", stderr: "not found" }) }))
    .rejects.toThrow("Forge614 Engines is unavailable");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/infrastructure/forge614-engines.test.ts`
Expected: FAIL — `discoverMcpCapableAgents` is not exported yet.

- [ ] **Step 3: Implement `discoverMcpCapableAgents`**

In `src/infrastructure/forge614-engines.ts`:

1. Add the import: `import type { McpCapableAgent } from "../contracts/mcp-agent.ts";`
2. Factor the binary-path lookup out of `discoverSelectableEngines` into a shared helper (used again in Task 4), replacing the inline `join(forgeHome, "engines", "bin", "forge614-engines")` computation:

```ts
function enginesBinary(home: string, env?: NodeJS.ProcessEnv): string {
  const forgeHome = env?.FORGE614_HOME ?? join(home, ".forge614");
  return join(forgeHome, "engines", "bin", "forge614-engines");
}
```

   Update `discoverSelectableEngines` to call `enginesBinary(home, options.env)` instead of computing `forgeHome`/`binary` inline.

3. Add the exported function, after `discoverSelectableEngines`:

```ts
/**
 * `detect` never reports MCP capability — that is a separate per-agent call. This function calls
 * `detect` for the installed agents, then `capabilities --agent <id>` for each one, keeping only
 * those Engines confirms with `supportsMcp: true`. An agent whose capabilities call itself fails
 * is excluded rather than shown — Engines' own refusal to answer is not treated as capable.
 */
export async function discoverMcpCapableAgents(options: {
  home?: string;
  env?: NodeJS.ProcessEnv;
  run?: DetectRun;
} = {}): Promise<McpCapableAgent[]> {
  const home = options.home ?? homedir();
  const binary = enginesBinary(home, options.env);
  const run = options.run ?? defaultRun;
  const detectResult = await run(binary, ["detect"]);
  if (detectResult.status !== 0) {
    throw new Error("Forge614 Engines is unavailable. Reinstall Forge614 Shell to repair its required dependency.");
  }
  let report: EnginesReport;
  try {
    report = validateReport(JSON.parse(detectResult.stdout));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Forge614 Engines")) throw error;
    throw new Error("Forge614 Engines returned an invalid detection result.");
  }
  const installed = (report.agents as EnginesAgent[]).filter(
    (agent): agent is EnginesAgent & { id: string; executable: string } =>
      agent.installed === true && typeof agent.id === "string" && Boolean(agent.id) && typeof agent.executable === "string" && Boolean(agent.executable),
  );
  const capable: McpCapableAgent[] = [];
  for (const agent of installed) {
    const capsResult = await run(binary, ["capabilities", "--agent", agent.id]);
    if (capsResult.status !== 0) continue;
    let caps: unknown;
    try {
      caps = JSON.parse(capsResult.stdout);
    } catch {
      continue;
    }
    if (caps && typeof caps === "object" && (caps as { supportsMcp?: unknown }).supportsMcp === true) {
      capable.push({ id: agent.id, label: typeof agent.label === "string" && agent.label ? agent.label : agent.id, executable: agent.executable });
    }
  }
  return capable;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/infrastructure/forge614-engines.test.ts`
Expected: PASS, including every pre-existing test in this file.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/forge614-engines.ts src/infrastructure/forge614-engines.test.ts
git commit -m "feat: detect MCP-capable assistants via Engines' detect + capabilities contract"
```

---

### Task 4: `planMcpInstall`, `applyMcpPlan`, `planMcpRemove`, `removeEngramMcpFromAgent`

**Files:**
- Modify: `src/infrastructure/forge614-engines.ts`
- Modify: `src/infrastructure/forge614-engines.test.ts`

**Interfaces:**
- Produces:
  - `export interface McpPlanResult { readonly planId: string; readonly noop: boolean; readonly filePath: string | null }`
  - `export async function planMcpInstall(options: { agentId: string; name: string; command: string; args: string[]; home?: string; env?: NodeJS.ProcessEnv; run?: DetectRun }): Promise<McpPlanResult>` — throws on any Engines error, including conflicts.
  - `export async function applyMcpPlan(options: { planId: string; home?: string; env?: NodeJS.ProcessEnv; run?: DetectRun }): Promise<{ applied: boolean; changedFiles: string[] }>` — throws on any Engines error.
  - `export async function planMcpRemove(options: { agentId: string; name: string; command: string; args: string[]; home?: string; env?: NodeJS.ProcessEnv; run?: DetectRun }): Promise<McpPlanResult>` — throws on any Engines error (e.g. `UNRECOGNIZED_ENTRY`). Takes the same four flags as `planMcpInstall`: removal validates the *entire* existing entry against `command`/`args`, not just the name (confirmed from Engines' source — see the spec doc section 3).
  - `export async function removeEngramMcpFromAgent(agentId: string, server: { command: string; args: string[] }, options?: { home?: string; env?: NodeJS.ProcessEnv; run?: DetectRun }): Promise<{ applied: boolean; changedFiles: string[] }>` — the future uninstall building block (plan `mcp-remove` for `forge614-engram`, then apply unless the plan is a noop).
- Consumed by Task 7 (`planMcpInstall`, `applyMcpPlan`) and left as a tested, unused-by-this-task building block (`planMcpRemove`, `removeEngramMcpFromAgent`) for a future uninstall command.

- [ ] **Step 1: Write the failing tests**

Add to `src/infrastructure/forge614-engines.test.ts`:

```ts
import { applyMcpPlan, planMcpInstall, planMcpRemove, removeEngramMcpFromAgent } from "./forge614-engines.ts";

test("planMcpInstall sends the exact Engines contract and reads the plan", async () => {
  const calls: string[][] = [];
  const plan = await planMcpInstall({
    agentId: "claude-code", name: "forge614-engram", command: "/Users/tester/.forge614/engram/bin/forge614-engram", args: ["mcp"],
    home: "/Users/tester",
    run: async (command, args) => {
      calls.push([command, ...args]);
      return {
        status: 0,
        stdout: JSON.stringify({
          schemaVersion: 1,
          plan: {
            planId: "plan-1", agentId: "claude-code", action: "mcp-install", noop: false,
            writes: [{ path: "/Users/tester/.claude.json", beforeHash: "x", afterContent: "{ secret: true }" }],
          },
        }),
        stderr: "",
      };
    },
  });
  expect(calls).toEqual([[
    "/Users/tester/.forge614/engines/bin/forge614-engines", "plan", "mcp-install",
    "--agent", "claude-code", "--name", "forge614-engram",
    "--command", "/Users/tester/.forge614/engram/bin/forge614-engram", "--args", "mcp",
  ]]);
  expect(plan).toEqual({ planId: "plan-1", noop: false, filePath: "/Users/tester/.claude.json" });
});

test("planMcpInstall never exposes afterContent or beforeHash", async () => {
  const plan = await planMcpInstall({
    agentId: "claude-code", name: "forge614-engram", command: "/bin/x", args: ["mcp"], home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: JSON.stringify({ schemaVersion: 1, plan: { planId: "plan-1", agentId: "claude-code", action: "mcp-install", noop: false, writes: [{ path: "/p", beforeHash: "h", afterContent: "SECRET" }] } }),
      stderr: "",
    }),
  });
  expect(JSON.stringify(plan)).not.toContain("SECRET");
  expect(JSON.stringify(plan)).not.toContain("beforeHash");
});

test("planMcpInstall reports noop when nothing would change", async () => {
  const plan = await planMcpInstall({
    agentId: "claude-code", name: "forge614-engram", command: "/bin/x", args: ["mcp"], home: "/Users/tester",
    run: async () => ({ status: 0, stdout: JSON.stringify({ schemaVersion: 1, plan: { planId: "plan-1", agentId: "claude-code", action: "mcp-install", noop: true, writes: [] } }), stderr: "" }),
  });
  expect(plan).toEqual({ planId: "plan-1", noop: true, filePath: null });
});

test("planMcpInstall throws Engines' own message for a conflict", async () => {
  await expect(planMcpInstall({
    agentId: "claude-code", name: "forge614-engram", command: "/bin/x", args: ["mcp"], home: "/Users/tester",
    run: async () => ({ status: 1, stdout: JSON.stringify({ schemaVersion: 1, error: { code: "CONFLICT", message: "A different MCP already uses this name." } }), stderr: "" }),
  })).rejects.toThrow("A different MCP already uses this name.");
});

test("applyMcpPlan sends the plan id and reports the changed files", async () => {
  const calls: string[][] = [];
  const result = await applyMcpPlan({
    planId: "plan-1", home: "/Users/tester",
    run: async (command, args) => {
      calls.push([command, ...args]);
      return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, result: { planId: "plan-1", applied: true, changedFiles: ["/Users/tester/.claude.json"] } }), stderr: "" };
    },
  });
  expect(calls).toEqual([["/Users/tester/.forge614/engines/bin/forge614-engines", "apply", "--plan-id", "plan-1"]]);
  expect(result).toEqual({ applied: true, changedFiles: ["/Users/tester/.claude.json"] });
});

test("applyMcpPlan throws Engines' own message when the plan id is unknown", async () => {
  await expect(applyMcpPlan({
    planId: "missing", home: "/Users/tester",
    run: async () => ({ status: 1, stdout: JSON.stringify({ schemaVersion: 1, error: { code: "PLAN_NOT_FOUND", message: 'No plan found with id "missing"' } }), stderr: "" }),
  })).rejects.toThrow('No plan found with id "missing"');
});

test("planMcpRemove sends the same four flags as install and throws when the entry does not match what this system would have installed", async () => {
  const calls: string[][] = [];
  await expect(planMcpRemove({
    agentId: "claude-code", name: "forge614-engram", command: "/Users/tester/.forge614/engram/bin/forge614-engram", args: ["mcp"], home: "/Users/tester",
    run: async (command, args) => {
      calls.push([command, ...args]);
      return {
        status: 1,
        stdout: JSON.stringify({ schemaVersion: 1, error: { code: "UNRECOGNIZED_ENTRY", message: 'Refusing to remove "forge614-engram": it does not match what this system would have installed' } }),
        stderr: "",
      };
    },
  })).rejects.toThrow("does not match what this system would have installed");
  expect(calls).toEqual([[
    "/Users/tester/.forge614/engines/bin/forge614-engines", "plan", "mcp-remove",
    "--agent", "claude-code", "--name", "forge614-engram",
    "--command", "/Users/tester/.forge614/engram/bin/forge614-engram", "--args", "mcp",
  ]]);
});

test("removeEngramMcpFromAgent plans and applies removal in one call", async () => {
  const calls: string[][] = [];
  const result = await removeEngramMcpFromAgent("claude-code", { command: "/Users/tester/.forge614/engram/bin/forge614-engram", args: ["mcp"] }, {
    home: "/Users/tester",
    run: async (command, args) => {
      calls.push([command, ...args]);
      if (args.includes("plan")) {
        return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, plan: { planId: "plan-remove-1", agentId: "claude-code", action: "mcp-remove", noop: false, writes: [{ path: "/Users/tester/.claude.json" }] } }), stderr: "" };
      }
      return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, result: { planId: "plan-remove-1", applied: true, changedFiles: ["/Users/tester/.claude.json"] } }), stderr: "" };
    },
  });
  expect(calls).toEqual([
    [
      "/Users/tester/.forge614/engines/bin/forge614-engines", "plan", "mcp-remove",
      "--agent", "claude-code", "--name", "forge614-engram",
      "--command", "/Users/tester/.forge614/engram/bin/forge614-engram", "--args", "mcp",
    ],
    ["/Users/tester/.forge614/engines/bin/forge614-engines", "apply", "--plan-id", "plan-remove-1"],
  ]);
  expect(result).toEqual({ applied: true, changedFiles: ["/Users/tester/.claude.json"] });
});

test("removeEngramMcpFromAgent skips apply when there is nothing to remove", async () => {
  const calls: string[][] = [];
  const result = await removeEngramMcpFromAgent("claude-code", { command: "/bin/x", args: ["mcp"] }, {
    home: "/Users/tester",
    run: async (command, args) => {
      calls.push([command, ...args]);
      return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, plan: { planId: "plan-remove-1", agentId: "claude-code", action: "mcp-remove", noop: true, writes: [] } }), stderr: "" };
    },
  });
  expect(calls.length).toBe(1);
  expect(result).toEqual({ applied: false, changedFiles: [] });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/infrastructure/forge614-engines.test.ts`
Expected: FAIL — none of the four functions are exported yet.

- [ ] **Step 3: Implement the four functions**

In `src/infrastructure/forge614-engines.ts`, add these interfaces near the top (alongside `EnginesAgent`/`EnginesReport`):

```ts
interface EnginesErrorPayload {
  error?: { code?: unknown; message?: unknown };
}

interface McpPlanPayload {
  plan?: { planId?: unknown; noop?: unknown; writes?: unknown };
}

interface McpApplyPayload {
  result?: { applied?: unknown; changedFiles?: unknown };
}
```

Add, after `discoverMcpCapableAgents`:

```ts
function parseEnginesError(stdout: string, stderr: string): string {
  for (const text of [stdout, stderr]) {
    try {
      const payload = JSON.parse(text) as EnginesErrorPayload;
      if (payload.error && typeof payload.error.message === "string" && payload.error.message) return payload.error.message;
    } catch { /* try the next stream */ }
  }
  return "Forge614 Engines command failed.";
}

async function runEnginesCommand(
  args: string[],
  label: string,
  options: { home?: string; env?: NodeJS.ProcessEnv; run?: DetectRun },
): Promise<unknown> {
  const home = options.home ?? homedir();
  const binary = enginesBinary(home, options.env);
  const result = await (options.run ?? defaultRun)(binary, args);
  if (result.status === null && !result.stdout.trim() && !result.stderr.trim()) {
    throw new Error(`Forge614 Engines is unavailable at ${binary}. Install or reinstall Forge614 Engines to repair this dependency.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error(`forge614-engines ${label} failed: ${parseEnginesError(result.stdout, result.stderr)}`);
  }
  if (parsed && typeof parsed === "object" && "error" in (parsed as Record<string, unknown>)) {
    throw new Error(`forge614-engines ${label} failed: ${parseEnginesError(result.stdout, result.stderr)}`);
  }
  if (result.status !== 0) {
    throw new Error(`forge614-engines ${label} failed: ${parseEnginesError(result.stdout, result.stderr)}`);
  }
  return parsed;
}

export interface McpPlanResult {
  readonly planId: string;
  readonly noop: boolean;
  readonly filePath: string | null;
}

function toMcpPlanResult(payload: unknown): McpPlanResult {
  const plan = (payload as McpPlanPayload).plan;
  if (!plan || typeof plan.planId !== "string" || !plan.planId) {
    throw new Error("forge614-engines returned an invalid plan.");
  }
  const writes = Array.isArray(plan.writes) ? plan.writes : [];
  const firstWrite = writes[0] as { path?: unknown } | undefined;
  const filePath = firstWrite && typeof firstWrite.path === "string" ? firstWrite.path : null;
  return { planId: plan.planId, noop: plan.noop === true, filePath };
}

/** Requests a read-only install plan. Never writes anything; throws Engines' own message on any error, including conflicts. */
export async function planMcpInstall(options: {
  agentId: string;
  name: string;
  command: string;
  args: string[];
  home?: string;
  env?: NodeJS.ProcessEnv;
  run?: DetectRun;
}): Promise<McpPlanResult> {
  const payload = await runEnginesCommand(
    ["plan", "mcp-install", "--agent", options.agentId, "--name", options.name, "--command", options.command, "--args", ...options.args],
    "plan mcp-install",
    options,
  );
  return toMcpPlanResult(payload);
}

/**
 * Requests a read-only removal plan for a future uninstall flow. Takes the same four flags as
 * `planMcpInstall` — Engines validates the entire existing entry against `command`/`args`, not
 * just the name — and throws (e.g. `UNRECOGNIZED_ENTRY`) if it does not match or Engines refuses.
 */
export async function planMcpRemove(options: {
  agentId: string;
  name: string;
  command: string;
  args: string[];
  home?: string;
  env?: NodeJS.ProcessEnv;
  run?: DetectRun;
}): Promise<McpPlanResult> {
  const payload = await runEnginesCommand(
    ["plan", "mcp-remove", "--agent", options.agentId, "--name", options.name, "--command", options.command, "--args", ...options.args],
    "plan mcp-remove",
    options,
  );
  return toMcpPlanResult(payload);
}

/** Applies a previously previewed and confirmed plan. Must never be called before Shell's own confirmation. */
export async function applyMcpPlan(options: {
  planId: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  run?: DetectRun;
}): Promise<{ applied: boolean; changedFiles: string[] }> {
  const payload = await runEnginesCommand(["apply", "--plan-id", options.planId], "apply", options);
  const result = (payload as McpApplyPayload).result;
  if (!result || typeof result.applied !== "boolean") {
    throw new Error("forge614-engines apply returned an invalid result.");
  }
  const changedFiles = Array.isArray(result.changedFiles)
    ? result.changedFiles.filter((entry): entry is string => typeof entry === "string")
    : [];
  return { applied: result.applied, changedFiles };
}

/**
 * Composed building block for a future `forge614-shell` uninstall flow: plans and immediately
 * applies removal of the `forge614-engram` MCP entry for one assistant. `server` must match what
 * was originally installed (same `command`/`args`), since Engines validates the whole entry, not
 * just the name. No interactive UI here — a future uninstall command calls this directly and
 * reports the outcome itself.
 */
export async function removeEngramMcpFromAgent(
  agentId: string,
  server: { command: string; args: string[] },
  options: { home?: string; env?: NodeJS.ProcessEnv; run?: DetectRun } = {},
): Promise<{ applied: boolean; changedFiles: string[] }> {
  const plan = await planMcpRemove({ agentId, name: "forge614-engram", command: server.command, args: server.args, ...options });
  if (plan.noop) return { applied: false, changedFiles: [] };
  return applyMcpPlan({ planId: plan.planId, ...options });
}
```

**Amendment (post-Task 7):** the error-wrapping shown above was superseded during Task 7's integration — see that task's section and the SDD ledger for why. The shipped `runEnginesCommand`/`parseEnginesError` now surface Engines' own message directly and fall back to `forge614-engines ${label} failed.` only when Engines gives no parseable message.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/infrastructure/forge614-engines.test.ts`
Expected: PASS, including every pre-existing test in this file.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/forge614-engines.ts src/infrastructure/forge614-engines.test.ts
git commit -m "feat: plan, apply, and remove MCP entries through Engines' public contract"
```

---

### Task 5: `MultiSelectList` component

**Files:**
- Create: `src/ui/startup/multi-select.ts`
- Create: `src/ui/startup/multi-select.test.ts`

**Interfaces:**
- Produces: `MultiSelectItem { value: string; label: string }`, `MultiSelectTheme { cursor, checked, plain: (text: string) => string }`, `class MultiSelectList implements Component` with `onSubmit?: (values: string[]) => void` and `onCancel?: () => void` — consumed by Task 6.

- [ ] **Step 1: Write the failing tests**

Create `src/ui/startup/multi-select.test.ts`:

```ts
import { expect, test } from "bun:test";
import { MultiSelectList } from "./multi-select.ts";

const theme = { cursor: (t: string) => t, checked: (t: string) => t, plain: (t: string) => t };

test("renders every item unchecked with the cursor on the first row", () => {
  const list = new MultiSelectList([{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }], theme);
  expect(list.render(80)).toEqual(["> [ ] Alpha", "  [ ] Beta"]);
});

test("space toggles the item under the cursor", () => {
  const list = new MultiSelectList([{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }], theme);
  list.handleInput(" ");
  expect(list.render(80)[0]).toBe("> [x] Alpha");
  list.handleInput(" ");
  expect(list.render(80)[0]).toBe("> [ ] Alpha");
});

test("down moves the cursor and does not affect the checked set", () => {
  const list = new MultiSelectList([{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }], theme);
  list.handleInput(" ");
  list.handleInput("\x1b[B");
  expect(list.render(80)).toEqual(["  [x] Alpha", "> [ ] Beta"]);
});

test("the cursor does not move past the last item", () => {
  const list = new MultiSelectList([{ value: "a", label: "Alpha" }], theme);
  list.handleInput("\x1b[B");
  list.handleInput("\x1b[B");
  expect(list.render(80)).toEqual(["> [ ] Alpha"]);
});

test("enter submits exactly the checked values, in item order", () => {
  const list = new MultiSelectList([{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }, { value: "c", label: "Gamma" }], theme);
  list.handleInput("\x1b[B"); list.handleInput(" "); // check Beta
  list.handleInput("\x1b[B"); list.handleInput(" "); // check Gamma
  let submitted: string[] | undefined;
  list.onSubmit = values => { submitted = values; };
  list.handleInput("\r");
  expect(submitted).toEqual(["b", "c"]);
});

test("enter with nothing checked submits an empty array, not a cancellation", () => {
  const list = new MultiSelectList([{ value: "a", label: "Alpha" }], theme);
  let submitted: string[] | undefined;
  let cancelled = false;
  list.onSubmit = values => { submitted = values; };
  list.onCancel = () => { cancelled = true; };
  list.handleInput("\r");
  expect(submitted).toEqual([]);
  expect(cancelled).toBe(false);
});

test("escape cancels without submitting", () => {
  const list = new MultiSelectList([{ value: "a", label: "Alpha" }], theme);
  let cancelled = false;
  let submitted: string[] | undefined;
  list.onCancel = () => { cancelled = true; };
  list.onSubmit = values => { submitted = values; };
  list.handleInput("\x1b");
  expect(cancelled).toBe(true);
  expect(submitted).toBeUndefined();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/ui/startup/multi-select.test.ts`
Expected: FAIL — the module does not exist yet.

- [ ] **Step 3: Implement `MultiSelectList`**

Create `src/ui/startup/multi-select.ts`:

```ts
import { matchesKey } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";

export interface MultiSelectItem {
  readonly value: string;
  readonly label: string;
}

export interface MultiSelectTheme {
  cursor: (text: string) => string;
  checked: (text: string) => string;
  plain: (text: string) => string;
}

/** Checkbox list: arrows move, Space toggles, Enter submits every checked value, Esc cancels. */
export class MultiSelectList implements Component {
  private cursor = 0;
  private readonly checkedValues = new Set<string>();
  onSubmit?: (values: string[]) => void;
  onCancel?: () => void;

  constructor(private readonly items: readonly MultiSelectItem[], private readonly theme: MultiSelectTheme) {}

  invalidate(): void {}

  render(_width: number): string[] {
    return this.items.map((item, index) => {
      const box = this.checkedValues.has(item.value) ? this.theme.checked("[x]") : "[ ]";
      const pointer = index === this.cursor ? "> " : "  ";
      const line = `${pointer}${box} ${item.label}`;
      return index === this.cursor ? this.theme.cursor(line) : this.theme.plain(line);
    });
  }

  handleInput(data: string): void {
    if (matchesKey(data, "up")) { this.cursor = Math.max(0, this.cursor - 1); return; }
    if (matchesKey(data, "down")) { this.cursor = Math.min(this.items.length - 1, this.cursor + 1); return; }
    if (matchesKey(data, "space")) {
      const value = this.items[this.cursor]?.value;
      if (!value) return;
      if (this.checkedValues.has(value)) this.checkedValues.delete(value);
      else this.checkedValues.add(value);
      return;
    }
    if (matchesKey(data, "enter") || matchesKey(data, "return")) {
      this.onSubmit?.(this.items.filter(item => this.checkedValues.has(item.value)).map(item => item.value));
      return;
    }
    if (matchesKey(data, "escape")) { this.onCancel?.(); return; }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/ui/startup/multi-select.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/ui/startup/multi-select.ts src/ui/startup/multi-select.test.ts
git commit -m "feat: add a checkbox multi-select TUI component"
```

---

### Task 6: `chooseMcpAgents` and `showMcpPreviewConfirm` screens

**Files:**
- Create: `src/ui/startup/mcp-setup.ts`
- Create: `src/ui/startup/mcp-setup.test.ts`

**Interfaces:**
- Consumes: `McpCapableAgent` (Task 1), `MultiSelectList`/`MultiSelectItem`/`MultiSelectTheme` (Task 5), `startupFrame` (existing), `accent`/`success` (existing theme).
- Produces:
  - `export async function chooseMcpAgents(agents: readonly McpCapableAgent[], terminal?: Terminal): Promise<string[] | undefined>` — `undefined` means cancelled; an array (possibly empty) means submitted.
  - `export interface McpPreviewItem { readonly agentLabel: string; readonly filePath: string | null; readonly status: "pending" | "already-configured" | "blocked"; readonly detail?: string }`
  - `export async function showMcpPreviewConfirm(items: readonly McpPreviewItem[], terminal?: Terminal): Promise<boolean>` — shows every selected assistant's outcome so far (pending, already configured, or blocked), and gates only the pending ones behind Confirm/Cancel.
  - Both consumed by Task 7.

- [ ] **Step 1: Write the failing tests**

Create `src/ui/startup/mcp-setup.test.ts`:

```ts
import { expect, test } from "bun:test";
import type { Terminal } from "@earendil-works/pi-tui";
import { chooseMcpAgents, showMcpPreviewConfirm } from "./mcp-setup.ts";

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
  const result = chooseMcpAgents(agents, terminal);
  await tick();
  expect(terminal.output).toContain("Claude Code");
  expect(terminal.output).toContain("Codex");
  terminal.input("\x1b[B"); terminal.input(" "); // check Codex
  terminal.input("\r");
  expect(await result).toEqual(["codex"]);
});

test("submitting with nothing checked returns an empty array, not undefined", async () => {
  const terminal = new TestTerminal();
  const result = chooseMcpAgents(agents, terminal);
  await tick();
  terminal.input("\r");
  expect(await result).toEqual([]);
});

test("escape returns undefined without selecting anything", async () => {
  const terminal = new TestTerminal();
  const result = chooseMcpAgents(agents, terminal);
  await tick();
  terminal.input("\x1b");
  expect(await result).toBeUndefined();
});

test("the preview screen shows a pending write's file path", async () => {
  const terminal = new TestTerminal();
  const result = showMcpPreviewConfirm([{ agentLabel: "Claude Code", filePath: "/Users/tester/.claude.json", status: "pending" }], terminal);
  await tick();
  expect(terminal.output).toContain("Claude Code");
  expect(terminal.output).toContain("/Users/tester/.claude.json");
  terminal.input("\r");
  expect(await result).toBe(true);
});

test("the preview screen also shows already-configured and blocked assistants, never a file content field", async () => {
  const terminal = new TestTerminal();
  const result = showMcpPreviewConfirm([
    { agentLabel: "Claude Code", filePath: "/Users/tester/.claude.json", status: "pending" },
    { agentLabel: "Cursor", filePath: null, status: "already-configured" },
    { agentLabel: "Codex", filePath: null, status: "blocked", detail: "A different MCP already uses this name." },
  ], terminal);
  await tick();
  expect(terminal.output).toContain("Cursor");
  expect(terminal.output).toContain("already configured");
  expect(terminal.output).toContain("Codex");
  expect(terminal.output).toContain("A different MCP already uses this name.");
  expect(terminal.output).not.toContain("afterContent");
  expect(terminal.output).not.toContain("beforeHash");
  terminal.input("\r");
  expect(await result).toBe(true);
});

test("cancelling the preview returns false", async () => {
  const terminal = new TestTerminal();
  const result = showMcpPreviewConfirm([{ agentLabel: "Claude Code", filePath: "/Users/tester/.claude.json", status: "pending" }], terminal);
  await tick();
  terminal.input("\x1b[B"); terminal.input("\r"); // move to Cancel, submit
  expect(await result).toBe(false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/ui/startup/mcp-setup.test.ts`
Expected: FAIL — the module does not exist yet.

- [ ] **Step 3: Implement the two screens**

Create `src/ui/startup/mcp-setup.ts`:

```ts
import { ProcessTerminal, SelectList, Text, matchesKey } from "@earendil-works/pi-tui";
import type { Terminal } from "@earendil-works/pi-tui";
import type { McpCapableAgent } from "../../contracts/mcp-agent.ts";
import { MultiSelectList } from "./multi-select.ts";
import { startupFrame } from "./frame.ts";
import { accent, success } from "../basic/theme.ts";

const plain = (text: string) => text;
const listTheme = { selectedPrefix: accent, selectedText: accent, description: plain, scrollInfo: plain, noMatch: plain };
const multiSelectTheme = { cursor: accent, checked: success, plain };

/** Lets the person choose zero or more MCP-capable assistants. Makes no Engines call itself. */
export async function chooseMcpAgents(
  agents: readonly McpCapableAgent[], terminal: Terminal = new ProcessTerminal(),
): Promise<string[] | undefined> {
  const list = new MultiSelectList(agents.map(agent => ({ value: agent.id, label: agent.label })), multiSelectTheme);
  const hint = new Text("Space to toggle · Enter to confirm your selection (zero or more) · Esc to skip MCP setup");
  const body = new Text("Choose which detected AI assistants should get the forge614-engram MCP server.");
  const tui = startupFrame(terminal, "Configure the Engram MCP server", list, hint, body);
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

export interface McpPreviewItem {
  readonly agentLabel: string;
  readonly filePath: string | null;
  readonly status: "pending" | "already-configured" | "blocked";
  readonly detail?: string;
}

function previewLine(item: McpPreviewItem): string {
  if (item.status === "pending") return `${item.agentLabel}: will add MCP "forge614-engram" to ${item.filePath}`;
  if (item.status === "already-configured") return `${item.agentLabel}: already configured (no change)`;
  return `${item.agentLabel}: blocked — ${item.detail}`;
}

function previewText(items: readonly McpPreviewItem[]): string {
  return [
    ...items.map(previewLine),
    "",
    "Confirming applies only the pending assistants above. Nothing is written until you confirm.",
  ].join("\n");
}

/**
 * Shows every selected assistant's outcome so far — pending write, already configured, or
 * blocked — using only the file path Engines reported, never file content. Asks one explicit
 * confirmation, which applies only the pending ones.
 */
export async function showMcpPreviewConfirm(
  items: readonly McpPreviewItem[], terminal: Terminal = new ProcessTerminal(),
): Promise<boolean> {
  const body = new Text(previewText(items));
  const list = new SelectList([
    { value: "confirm", label: "Confirm" },
    { value: "cancel", label: "Cancel" },
  ], 2, listTheme);
  const tui = startupFrame(terminal, "Confirm MCP configuration", list, undefined, body);
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/ui/startup/mcp-setup.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/ui/startup/mcp-setup.ts src/ui/startup/mcp-setup.test.ts
git commit -m "feat: add the MCP assistant picker and preview/confirm screens"
```

---

### Task 7: Wire MCP setup into `forge614-shell init --product engram`

**Files:**
- Modify: `src/app/init-engram.ts`
- Modify: `src/app/init-engram.test.ts`

**Interfaces:**
- Consumes: `discoverMcpCapableAgents`, `planMcpInstall`, `applyMcpPlan`, `McpPlanResult` (Task 3–4), `locateEngramBinary` (Task 2), `chooseMcpAgents`, `showMcpPreviewConfirm`, `McpPreviewItem` (Task 6), `McpCapableAgent` (Task 1).
- Produces: `RunInitOptions.enginesRun?: RunEngram` — the injectable fake for every Engines call in tests.

- [ ] **Step 1: Write the failing tests**

First, update the two existing tests in `src/app/init-engram.test.ts` that reach a successful Engram confirmation, so they stay deterministic once the MCP step exists. Both currently end with `terminal.input("\r"); // Summary: Confirm (default)` immediately before `await run;`. Add, to each of their `runInitCommand` option objects, right after the existing `run:` fake:

```ts
    enginesRun: async () => ({ status: 0, stdout: JSON.stringify({ schemaVersion: 1, agents: [] }), stderr: "" }),
```

This applies to `"confirming with local storage only runs exactly init --json"` and `"confirming with PostgreSQL sends the connection string only to Engram, never to the screen"`. (The other existing tests either fail before Engram's own `applyEngramInit` call or never reach it, so they are unaffected and need no change.)

Also change this file's import line from:

```ts
import { expect, test } from "bun:test";
```

to:

```ts
import { expect, spyOn, test } from "bun:test";
```

Then append these new tests to the end of `src/app/init-engram.test.ts`. Every test that needs to inspect the final per-assistant result lines spies on `console.log` — those lines are printed with `console.log`, which a fake `Terminal` never captures (see this plan's Global Constraints):

```ts
function captureLogs(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(" ")); });
  return { logs, restore: () => spy.mockRestore() };
}

test("choosing one MCP-capable assistant plans and applies exactly that one", async () => {
  const terminal = new TestTerminal();
  const enginesCalls: string[][] = [];
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (command, args) => {
      enginesCalls.push([command, ...args]);
      if (args[0] === "detect") {
        return {
          status: 0,
          stdout: JSON.stringify({ schemaVersion: 1, agents: [
            { id: "claude-code", label: "Claude Code", installed: true, executable: "/usr/local/bin/claude" },
          ] }),
          stderr: "",
        };
      }
      if (args[0] === "capabilities") {
        return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, id: "claude-code", label: "Claude Code", supportsMcp: true, supportsHooks: true, supportsHeadlessExec: true }), stderr: "" };
      }
      if (args[0] === "plan") {
        return {
          status: 0,
          stdout: JSON.stringify({ schemaVersion: 1, plan: { planId: "plan-1", agentId: "claude-code", action: "mcp-install", noop: false, writes: [{ path: "/Users/tester/.claude.json" }] } }),
          stderr: "",
        };
      }
      return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, result: { planId: "plan-1", applied: true, changedFiles: ["/Users/tester/.claude.json"] } }), stderr: "" };
    },
  });
  await tick();
  terminal.input("\r"); await tick(); // Continue
  terminal.input("\r"); await tick(); // PostgreSQL: No
  terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // Reinforcement: No
  terminal.input("\r"); await tick(); // Engram summary: Confirm
  terminal.input(" "); terminal.input("\r"); await tick(); // MCP picker: check Claude Code, submit
  terminal.input("\r"); // MCP preview: Confirm
  await run;
  restore();
  expect(enginesCalls[0]).toEqual(["/Users/tester/.forge614/engines/bin/forge614-engines", "detect"]);
  expect(enginesCalls[1]).toEqual(["/Users/tester/.forge614/engines/bin/forge614-engines", "capabilities", "--agent", "claude-code"]);
  expect(enginesCalls[2]).toEqual([
    "/Users/tester/.forge614/engines/bin/forge614-engines", "plan", "mcp-install",
    "--agent", "claude-code", "--name", "forge614-engram",
    "--command", "/Users/tester/.forge614/engram/bin/forge614-engram", "--args", "mcp",
  ]);
  expect(enginesCalls[3]).toEqual(["/Users/tester/.forge614/engines/bin/forge614-engines", "apply", "--plan-id", "plan-1"]);
  expect(logs).toContain("Claude Code: configured");
});

test("selecting no assistants initializes Engram without configuring any MCP", async () => {
  const terminal = new TestTerminal();
  const enginesCalls: string[][] = [];
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (command, args) => {
      enginesCalls.push([command, ...args]);
      if (args[0] === "detect") {
        return {
          status: 0,
          stdout: JSON.stringify({ schemaVersion: 1, agents: [
            { id: "claude-code", label: "Claude Code", installed: true, executable: "/usr/local/bin/claude" },
          ] }),
          stderr: "",
        };
      }
      return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, id: "claude-code", label: "Claude Code", supportsMcp: true, supportsHooks: true, supportsHeadlessExec: true }), stderr: "" };
    },
  });
  await tick();
  terminal.input("\r"); await tick();
  terminal.input("\r"); await tick();
  terminal.input("\x1b[B"); terminal.input("\r"); await tick();
  terminal.input("\r"); await tick(); // Engram summary confirm
  terminal.input("\r"); // MCP picker: submit with nothing checked
  await run;
  restore();
  expect(enginesCalls).toEqual([
    ["/Users/tester/.forge614/engines/bin/forge614-engines", "detect"],
    ["/Users/tester/.forge614/engines/bin/forge614-engines", "capabilities", "--agent", "claude-code"],
  ]);
  expect(logs).toContain("No assistant was selected. No MCP was configured.");
});

test("an already-configured assistant is reported without an apply call", async () => {
  const terminal = new TestTerminal();
  const enginesCalls: string[][] = [];
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (command, args) => {
      enginesCalls.push([command, ...args]);
      if (args[0] === "detect") {
        return {
          status: 0,
          stdout: JSON.stringify({ schemaVersion: 1, agents: [
            { id: "claude-code", label: "Claude Code", installed: true, executable: "/usr/local/bin/claude" },
          ] }),
          stderr: "",
        };
      }
      if (args[0] === "capabilities") {
        return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, id: "claude-code", label: "Claude Code", supportsMcp: true, supportsHooks: true, supportsHeadlessExec: true }), stderr: "" };
      }
      return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, plan: { planId: "plan-1", agentId: "claude-code", action: "mcp-install", noop: true, writes: [] } }), stderr: "" };
    },
  });
  await tick();
  terminal.input("\r"); await tick();
  terminal.input("\r"); await tick();
  terminal.input("\x1b[B"); terminal.input("\r"); await tick();
  terminal.input("\r"); await tick();
  terminal.input(" "); terminal.input("\r"); // check + submit
  await run;
  restore();
  expect(enginesCalls.filter(call => call.includes("apply")).length).toBe(0);
  expect(logs).toContain("Claude Code: already configured");
});

test("a plan error is shown as not configured and never applied", async () => {
  const terminal = new TestTerminal();
  const enginesCalls: string[][] = [];
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (command, args) => {
      enginesCalls.push([command, ...args]);
      if (args[0] === "detect") {
        return {
          status: 0,
          stdout: JSON.stringify({ schemaVersion: 1, agents: [
            { id: "claude-code", label: "Claude Code", installed: true, executable: "/usr/local/bin/claude" },
          ] }),
          stderr: "",
        };
      }
      if (args[0] === "capabilities") {
        return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, id: "claude-code", label: "Claude Code", supportsMcp: true, supportsHooks: true, supportsHeadlessExec: true }), stderr: "" };
      }
      return { status: 1, stdout: JSON.stringify({ schemaVersion: 1, error: { code: "CONFLICT", message: "A different MCP already uses this name." } }), stderr: "" };
    },
  });
  await tick();
  terminal.input("\r"); await tick();
  terminal.input("\r"); await tick();
  terminal.input("\x1b[B"); terminal.input("\r"); await tick();
  terminal.input("\r"); await tick();
  terminal.input(" "); terminal.input("\r"); // check + submit
  await run;
  restore();
  expect(enginesCalls.filter(call => call.includes("apply")).length).toBe(0);
  expect(logs).toContain("Claude Code: not configured — A different MCP already uses this name.");
});

test("cancelling the MCP preview confirmation applies nothing", async () => {
  const terminal = new TestTerminal();
  const enginesCalls: string[][] = [];
  const { logs, restore } = captureLogs();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    enginesRun: async (command, args) => {
      enginesCalls.push([command, ...args]);
      if (args[0] === "detect") {
        return {
          status: 0,
          stdout: JSON.stringify({ schemaVersion: 1, agents: [
            { id: "claude-code", label: "Claude Code", installed: true, executable: "/usr/local/bin/claude" },
          ] }),
          stderr: "",
        };
      }
      if (args[0] === "capabilities") {
        return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, id: "claude-code", label: "Claude Code", supportsMcp: true, supportsHooks: true, supportsHeadlessExec: true }), stderr: "" };
      }
      return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, plan: { planId: "plan-1", agentId: "claude-code", action: "mcp-install", noop: false, writes: [{ path: "/Users/tester/.claude.json" }] } }), stderr: "" };
    },
  });
  await tick();
  terminal.input("\r"); await tick();
  terminal.input("\r"); await tick();
  terminal.input("\x1b[B"); terminal.input("\r"); await tick();
  terminal.input("\r"); await tick();
  terminal.input(" "); terminal.input("\r"); await tick(); // check + submit MCP picker
  terminal.input("\x1b[B"); terminal.input("\r"); // preview: move to Cancel, submit
  await run;
  restore();
  expect(enginesCalls.filter(call => call.includes("apply")).length).toBe(0);
  expect(logs).toContain("Claude Code: skipped");
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
          stdout: JSON.stringify({ schemaVersion: 1, agents: [
            { id: "claude-code", label: "Claude Code", installed: true, executable: "/usr/local/bin/claude" },
            { id: "codex", label: "Codex", installed: true, executable: "/usr/local/bin/codex" },
          ] }),
          stderr: "",
        };
      }
      if (args[0] === "capabilities") {
        const agentId = args[args.indexOf("--agent") + 1];
        return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, id: agentId, label: agentId, supportsMcp: true, supportsHooks: true, supportsHeadlessExec: true }), stderr: "" };
      }
      if (args[0] === "plan") {
        const agentId = args[args.indexOf("--agent") + 1];
        return {
          status: 0,
          stdout: JSON.stringify({ schemaVersion: 1, plan: { planId: `plan-${agentId}`, agentId, action: "mcp-install", noop: false, writes: [{ path: `/Users/tester/.${agentId}.json` }] } }),
          stderr: "",
        };
      }
      if (args.includes("plan-codex")) {
        return { status: 1, stdout: JSON.stringify({ schemaVersion: 1, error: { code: "WRITE_FAILED", message: "Could not write the Codex config file." } }), stderr: "" };
      }
      return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, result: { planId: "plan-claude-code", applied: true, changedFiles: ["/Users/tester/.claude-code.json"] } }), stderr: "" };
    },
  });
  await tick();
  terminal.input("\r"); await tick();
  terminal.input("\r"); await tick();
  terminal.input("\x1b[B"); terminal.input("\r"); await tick();
  terminal.input("\r"); await tick();
  terminal.input(" "); terminal.input("\x1b[B"); terminal.input(" "); terminal.input("\r"); await tick(); // check both, submit
  terminal.input("\r"); // preview: Confirm
  await run;
  restore();
  expect(logs).toContain("Claude Code: configured");
  expect(logs).toContain("Codex: not configured — Could not write the Codex config file.");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/app/init-engram.test.ts`
Expected: FAIL — `enginesRun` is not a recognized option yet and the MCP step does not exist.

- [ ] **Step 3: Implement the orchestration**

In `src/app/init-engram.ts`, replace the full file contents with:

```ts
import type { Terminal } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { runEngramInitFlow } from "../ui/startup/engram-init.ts";
import { chooseMcpAgents, showMcpPreviewConfirm } from "../ui/startup/mcp-setup.ts";
import type { McpPreviewItem } from "../ui/startup/mcp-setup.ts";
import { applyEngramInit, locateEngramBinary, type RunEngram } from "../infrastructure/forge614-engram.ts";
import { applyMcpPlan, discoverMcpCapableAgents, planMcpInstall, type McpPlanResult } from "../infrastructure/forge614-engines.ts";
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

type McpOutcomeStatus = "configured" | "already-configured" | "skipped" | "not-configured";

interface McpOutcome {
  readonly label: string;
  readonly status: McpOutcomeStatus;
  readonly detail?: string;
}

function outcomeLine(outcome: McpOutcome): string {
  if (outcome.status === "configured") return `${outcome.label}: configured`;
  if (outcome.status === "already-configured") return `${outcome.label}: already configured`;
  if (outcome.status === "skipped") return `${outcome.label}: skipped`;
  return `${outcome.label}: not configured — ${outcome.detail}`;
}

/**
 * Offers configuring the forge614-engram MCP server in every detected, MCP-capable assistant.
 * Runs only after Engram's own init has already succeeded; a detection failure here is reported
 * but never turns an already-successful Engram init into a command failure.
 */
async function runMcpSetupStep(
  terminal: Terminal | undefined,
  options: { home?: string; env?: NodeJS.ProcessEnv; enginesRun?: RunEngram },
): Promise<McpOutcome[]> {
  let agents: McpCapableAgent[];
  try {
    agents = await discoverMcpCapableAgents({ home: options.home, env: options.env, run: options.enginesRun });
  } catch (error) {
    console.log(`MCP configuration could not be offered: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
  if (agents.length === 0) {
    console.log("No compatible AI assistants were found to configure with MCP.");
    return [];
  }
  const selectedIds = await chooseMcpAgents(agents, terminal);
  if (selectedIds === undefined) {
    console.log("MCP setup was skipped.");
    return agents.map(agent => ({ label: agent.label, status: "skipped" }));
  }
  if (selectedIds.length === 0) {
    console.log("No assistant was selected. No MCP was configured.");
    return agents.map(agent => ({ label: agent.label, status: "skipped" }));
  }
  const selectedSet = new Set(selectedIds);
  const engramBinary = locateEngramBinary(options.home ?? homedir(), options.env);
  const outcomes: McpOutcome[] = [];
  const resolved: { agent: McpCapableAgent; status: "already-configured" | "not-configured"; detail?: string }[] = [];
  const pending: { agent: McpCapableAgent; plan: McpPlanResult }[] = [];
  for (const agent of agents) {
    if (!selectedSet.has(agent.id)) { outcomes.push({ label: agent.label, status: "skipped" }); continue; }
    try {
      const plan = await planMcpInstall({
        agentId: agent.id, name: "forge614-engram", command: engramBinary, args: ["mcp"],
        home: options.home, env: options.env, run: options.enginesRun,
      });
      if (plan.noop) resolved.push({ agent, status: "already-configured" });
      else pending.push({ agent, plan });
    } catch (error) {
      resolved.push({ agent, status: "not-configured", detail: error instanceof Error ? error.message : String(error) });
    }
  }
  for (const r of resolved) outcomes.push({ label: r.agent.label, status: r.status, detail: r.detail });
  if (pending.length > 0) {
    const previewItems: McpPreviewItem[] = [
      ...pending.map(p => ({ agentLabel: p.agent.label, filePath: p.plan.filePath, status: "pending" as const })),
      ...resolved.map(r => ({
        agentLabel: r.agent.label, filePath: null,
        status: r.status === "already-configured" ? ("already-configured" as const) : ("blocked" as const),
        detail: r.detail,
      })),
    ];
    const confirmed = await showMcpPreviewConfirm(previewItems, terminal);
    if (!confirmed) {
      for (const p of pending) outcomes.push({ label: p.agent.label, status: "skipped" });
    } else {
      for (const p of pending) {
        try {
          await applyMcpPlan({ planId: p.plan.planId, home: options.home, env: options.env, run: options.enginesRun });
          outcomes.push({ label: p.agent.label, status: "configured" });
        } catch (error) {
          outcomes.push({ label: p.agent.label, status: "not-configured", detail: error instanceof Error ? error.message : String(error) });
        }
      }
    }
  }
  return outcomes;
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
  const outcomes = await runMcpSetupStep(options.terminal, { home: options.home, env: options.env, enginesRun: options.enginesRun });
  for (const outcome of outcomes) console.log(outcomeLine(outcome));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/app/init-engram.test.ts`
Expected: PASS, including every pre-existing test in this file (with the two edits from Step 1 applied).

- [ ] **Step 5: Run the full suite and typecheck**

Run: `bun test && bun run typecheck`
Expected: PASS with no errors, including `tests/architecture/layers.test.ts` (neither `src/infrastructure/forge614-engines.ts` nor any other file under `src/infrastructure` imports from `ui` or `app`).

- [ ] **Step 6: Commit**

```bash
git add src/app/init-engram.ts src/app/init-engram.test.ts
git commit -m "feat: offer MCP setup for detected assistants after Engram init succeeds"
```

---

### Task 8: Help text, full verification, and final report

**Files:**
- Modify: `src/cli.ts:54`

- [ ] **Step 1: Update the help text**

In `src/cli.ts`, change:

```ts
  init --product <name>  Set up a Forge614 product's local memory (engram only)
```

to:

```ts
  init --product <name>  Set up a Forge614 product's local memory and, for engram, its MCP setup
```

- [ ] **Step 2: Run the full test suite**

Run: `bun test`
Expected: every test passes, including all new and modified tests from Tasks 1–7.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Check for whitespace/diff issues**

Run: `git diff --check`
Expected: no output (no trailing whitespace or conflict markers).

- [ ] **Step 5: Confirm no test touched a real user path**

Run: `grep -rn "homedir()" src/infrastructure/forge614-engines.test.ts src/infrastructure/forge614-engram.test.ts src/app/init-engram.test.ts src/ui/startup/mcp-setup.test.ts src/ui/startup/multi-select.test.ts`
Expected: no matches — every test passes an explicit `home:` (or no home-dependent call at all), never the real `homedir()`.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts
git commit -m "docs: mention MCP setup in the init --product help text"
```

- [ ] **Step 7: Report to the user**

Do not commit further, push, tag, or release. Summarize for the user:
- Every file created or modified (Tasks 1–8).
- Every test command run and its result.
- The public contracts consumed: `forge614-engines detect` / `capabilities` / `plan mcp-install` / `plan mcp-remove` / `apply`, and `forge614-engram`'s existing binary path convention (via the now-exported `locateEngramBinary`). The `detect` + per-agent `capabilities` combination (rather than a single `supportsMcp` field on `detect`) was confirmed by reading the actual Engines source in the sibling `forge614-engines` repository, not assumed — see the spec doc section 3.
- This was verified to already work against the installed `forge614-engines` 1.1.0 binary today (`capabilities --agent claude-code` → `supportsMcp: true`), so this feature is expected to function in production immediately, not blocked on a future Engines release.
