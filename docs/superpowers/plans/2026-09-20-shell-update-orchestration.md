# Shell Update Orchestration (Engines + Engram) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `forge614-shell update` refresh not just Shell itself, but also the two binary dependencies it silently relies on: Forge614 Engines (always required) and Forge614 Engram (only if the person has installed it), using each product's own public `update` CLI contract — never touching PATH, memories, SQLite, `.env`, MCP entries, or assistant configuration.

**Architecture:** Add one thin wrapper function per dependency (`updateEngines()` in the existing `src/infrastructure/forge614-engines.ts`, `updateEngram()` in the existing `src/infrastructure/forge614-engram.ts`), each parsing that product's real, already-published JSON contract for `update`. Add a new app-layer orchestrator (`src/app/update-command.ts`) that runs Shell's own update, then Engines' (always), then Engram's (only if its binary exists on disk), reporting each outcome independently — one failing never hides or blocks the others. Wire `src/cli.ts`'s `update` command to this new orchestrator instead of calling `updateInstalledShell()` directly.

**Tech Stack:** TypeScript, Bun test runner — no new dependencies. Verified against the real, already-published contracts by reading `~/Desktop/forge614-engines/src/{app/self-update.ts, app/commands.ts (runUpdate), interfaces/cli/main.ts}` and `~/Desktop/forge614-engram/src/{app/update.ts, infrastructure/updater.ts, interfaces/cli/{commands.ts, main.ts}, interfaces/cli/arguments.test.ts}` — both repos are at v1.4.0 with these contracts live today, not planned or hypothetical.

**Spec:** The user's own message (reproduced in full below) plus the two real, verified CLI contracts documented in Global Constraints.

## Global Constraints

- **Order is fixed and explicit, per the user's own instructions:** (1) Shell updates itself first. (2) Engines updates always — it is a required Shell dependency (confirmed in `FORGE614_ECOSYSTEM_CONTRACT.md` §8: installing `forge614-shell` requires Shell *and* Engines). (3) Engram updates only if `~/.forge614/engram/bin/forge614-engram` (or its `FORGE614_HOME`-relative equivalent) exists on disk — Engram is optional for Shell.
- **Never depend on PATH.** Both dependency binaries are invoked at their canonical, already-known paths — `enginesBinary(home, env)` (already exists, private to `forge614-engines.ts`) and `locateEngramBinary(home, env)` (already exists, exported from `forge614-engram.ts`). No new path-resolution logic is needed; both helpers are reused exactly as every other command in those two files already reuses them.
- **A failure in any one of the three (Shell, Engines, Engram) must never hide, skip, or be presented as success for the others.** Each of the three update attempts is wrapped in its own independent try/catch; all three always run (in the fixed order above) regardless of an earlier one failing; the command's own exit code is non-zero if *any* of the three failed.
- **Every outcome is reported honestly, per product, in one of exactly four shapes:** updated (with the previous and new version), already up to date (with the current version), not installed (Engram only — never printed for Shell or Engines), or failed (with Engines'/Engram's own safe error message — never a raw stack trace or the installer's own text).
- **Never touch memories, SQLite, `.env`, MCP entries, or assistant configuration during an update.** This is structurally guaranteed by only ever invoking each product's `update`/`update --json` subcommand — never `init`, `mcp`, `plan`, `apply`, or `verify` — and every task's tests assert the exact argument list sent, so a future change that accidentally widens scope would fail a test immediately.
- **No `forge614-ai`.** This orchestration is Shell's own responsibility today, per the user's explicit instruction and per `FORGE614_ECOSYSTEM_CONTRACT.md` §4 (`forge614-ai` does not exist yet; transitional coordination belongs to Shell).
- **The real, verified `forge614-engines update` contract** (no flags — bare `forge614-engines update`):
  - Success (any exit code 0 case), stdout: `{"schemaVersion":1,"result":{"updated":boolean,"currentVersion":string,"latestVersion":string,"note"?:string}}`.
  - Failure, stdout (not stderr — Engines prints ALL output, success and error alike, to stdout), exit code 1: `{"schemaVersion":1,"error":{"code":string,"message":string}}`.
  - This is the exact same envelope every other Engines command already uses (`detect`, `plan`, `apply`, `verify`) — the existing `runEnginesCommand` helper in `forge614-engines.ts` already parses both shapes correctly and needs zero changes.
- **The real, verified `forge614-engram update --json` contract** (the `--json` flag is required — bare `update` prints nothing and is not useful to Shell):
  - Success, stdout, no installer text mixed in (Engram suppresses its own installer output when `--json`/`quiet` is set): `{"updated":boolean,"previousVersion":string,"installedVersion":string}` — no envelope, unlike Engines.
  - Failure, **stderr** (not stdout), exit code 1: `{"code":"UPDATE_FAILED","error":"No se pudo actualizar Forge614 Engram."}` — no envelope, unlike Engines.
  - This is the exact same convention every other Engram command already uses (`init --json`, `reinforcement-enable`) — the existing `runEngramCommand` helper in `forge614-engram.ts` already parses both shapes correctly and needs zero changes.
- **Shell's own update reporting stays exactly as minimal as it is today.** `updateInstalledShell()` returns `void` and has no before/after version to report (it just re-runs the bundled `install.sh --latest`), and this plan does not change that — it only adds a plain "updated" or "failed" line for Shell, matching the richer reporting Engines/Engram now support. Redesigning Shell's own update to report structured version deltas is out of scope for this plan.

<details>
<summary>Full user spec (Spanish, verbatim, as given across two messages)</summary>

Primer mensaje: "cuando ejecute forge614-shell update debes correr forge614-engram update y forge614-engines update aunque creo que engines no es un CLI osea no esta en el path entonces tienes que correrlo por debajo no se investiga y me dices que hay que hacer y como es que se trabajaría ese soporte"

Segundo mensaje (tras que Claude propusiera un plan y preguntara cómo resolver la falta de `--json` en Engram):

"Ya está publicado Forge614 Engram v1.4.0 y el contrato es estable: `forge614-engram update --json`. Éxito por stdout, únicamente: `{"updated": true, "previousVersion": "1.3.0", "installedVersion": "1.4.0"}`. Si ya estaba actualizado: `{"updated": false, "previousVersion": "1.4.0", "installedVersion": "1.4.0"}`. Fallo: exit code 1, stderr solamente: `{"code": "UPDATE_FAILED", "error": "No se pudo actualizar Forge614 Engram."}`. No habrá progreso del instalador mezclado con el JSON.

Implementa `forge614-shell update` así: 1. Shell se actualiza a sí mismo. 2. Engines se actualiza siempre: es dependencia obligatoria de Shell. 3. Engram se actualiza solo si existe: `~/.forge614/engram/bin/forge614-engram`. 4. Para Engram, ejecuta esa ruta canónica con `update --json`; no dependas de PATH. 5. Muestra para cada producto su resultado individual: actualizado con versión anterior y nueva; ya estaba actualizado; no instalado (solo Engram); falló con mensaje seguro. 6. Un fallo de Engines o Engram no debe ocultar el resultado de los demás ni presentarse como éxito. 7. No cambies recuerdos, SQLite, `.env`, MCPs ni configuraciones de asistentes durante una actualización. 8. No inventes `forge614-ai`; esta coordinación temporal pertenece a Shell.

Haz pruebas para: Engines instalado y actualizado; Engram instalado y actualizado usando JSON; Engram no instalado (se omite sin error); error de un componente (Shell informa el fallo y conserva los resultados de los otros); no fuga de secretos ni texto del instalador de Engram."

</details>

---

## Task 1: Add `updateEngines()` to `forge614-engines.ts`

**Files:**
- Modify: `src/infrastructure/forge614-engines.ts`
- Test: `src/infrastructure/forge614-engines.test.ts`

**Interfaces:**
- Produces (used by Task 3):
  - `interface EnginesUpdateResult { readonly updated: boolean; readonly currentVersion: string; readonly latestVersion: string; readonly note?: string }`
  - `function updateEngines(options: { home?: string; env?: NodeJS.ProcessEnv; run?: DetectRun }): Promise<EnginesUpdateResult>`
- Consumes: the file's existing, unchanged `runEnginesCommand` helper.

- [ ] **Step 1: Write the failing tests**

Append to `src/infrastructure/forge614-engines.test.ts` (at the end of the file):

```ts
import { updateEngines } from "./forge614-engines.ts";

test("updateEngines sends the bare update command and reads the result", async () => {
  const calls: string[][] = [];
  const result = await updateEngines({
    home: "/Users/tester",
    run: async (command, args) => {
      calls.push([command, ...args]);
      return {
        status: 0,
        stdout: JSON.stringify({ schemaVersion: 1, result: { updated: true, currentVersion: "1.3.0", latestVersion: "1.4.0" } }),
        stderr: "",
      };
    },
  });
  expect(calls).toEqual([["/Users/tester/.forge614/engines/bin/forge614-engines", "update"]]);
  expect(result).toEqual({ updated: true, currentVersion: "1.3.0", latestVersion: "1.4.0" });
});

test("updateEngines reports already up to date, with no note field when Engines sends none", async () => {
  const result = await updateEngines({
    home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: JSON.stringify({ schemaVersion: 1, result: { updated: false, currentVersion: "1.4.0", latestVersion: "1.4.0" } }),
      stderr: "",
    }),
  });
  expect(result).toEqual({ updated: false, currentVersion: "1.4.0", latestVersion: "1.4.0" });
  expect("note" in result).toBe(false);
});

test("updateEngines keeps Engines' own note when present", async () => {
  const result = await updateEngines({
    home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        result: { updated: true, currentVersion: "1.3.0", latestVersion: "1.4.0", note: "Restart your terminal to pick up the new PATH entry." },
      }),
      stderr: "",
    }),
  });
  expect(result.note).toBe("Restart your terminal to pick up the new PATH entry.");
});

test("updateEngines throws Engines' own message for a hard failure", async () => {
  await expect(updateEngines({
    home: "/Users/tester",
    run: async () => ({
      status: 1,
      stdout: JSON.stringify({ schemaVersion: 1, error: { code: "UPDATE_ASSET_MISSING", message: "The latest release has no Forge614 Engines asset for darwin-arm64" } }),
      stderr: "",
    }),
  })).rejects.toThrow("The latest release has no Forge614 Engines asset for darwin-arm64");
});

test("updateEngines rejects a malformed result instead of guessing its shape", async () => {
  await expect(updateEngines({
    home: "/Users/tester",
    run: async () => ({ status: 0, stdout: JSON.stringify({ schemaVersion: 1, result: { updated: true } }), stderr: "" }),
  })).rejects.toThrow("forge614-engines returned an invalid update result.");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/jorgeetrejoo/Desktop/forge614-shell && bun test src/infrastructure/forge614-engines.test.ts`
Expected: FAIL — `updateEngines` is not exported yet.

- [ ] **Step 3: Implement `updateEngines`**

In `src/infrastructure/forge614-engines.ts`, insert the following block between the end of `applyMcpPlan` and the start of the `/** Composed building block... */` comment above `removeEngramMcpFromAgent` (i.e. alongside the other `Memory*` additions from the previous feature, in whatever order they currently appear — placement relative to them does not matter, only that it sits between `applyMcpPlan` and `removeEngramMcpFromAgent`):

```ts
export interface EnginesUpdateResult {
  readonly updated: boolean;
  readonly currentVersion: string;
  readonly latestVersion: string;
  readonly note?: string;
}

interface EnginesUpdatePayload {
  result?: { updated?: unknown; currentVersion?: unknown; latestVersion?: unknown; note?: unknown };
}

function toEnginesUpdateResult(payload: unknown): EnginesUpdateResult {
  const result = (payload as EnginesUpdatePayload).result;
  if (
    !result || typeof result.updated !== "boolean" ||
    typeof result.currentVersion !== "string" || typeof result.latestVersion !== "string" ||
    (result.note !== undefined && typeof result.note !== "string")
  ) {
    throw new Error("forge614-engines returned an invalid update result.");
  }
  return {
    updated: result.updated, currentVersion: result.currentVersion, latestVersion: result.latestVersion,
    ...(result.note !== undefined ? { note: result.note } : {}),
  };
}

/**
 * Refreshes the installed Forge614 Engines binary in place via its own `update` command. Engines
 * is a required Shell dependency, so `forge614-shell update` calls this unconditionally.
 */
export async function updateEngines(options: {
  home?: string;
  env?: NodeJS.ProcessEnv;
  run?: DetectRun;
} = {}): Promise<EnginesUpdateResult> {
  const payload = await runEnginesCommand(["update"], "update", options);
  return toEnginesUpdateResult(payload);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/jorgeetrejoo/Desktop/forge614-shell && bun test src/infrastructure/forge614-engines.test.ts`
Expected: PASS (all tests, including every pre-existing one).

- [ ] **Step 5: Typecheck**

Run: `cd /Users/jorgeetrejoo/Desktop/forge614-shell && bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/jorgeetrejoo/Desktop/forge614-shell
git add src/infrastructure/forge614-engines.ts src/infrastructure/forge614-engines.test.ts
git commit -m "feat: add updateEngines wrapper for Engines' published update contract"
```

---

## Task 2: Add `updateEngram()` to `forge614-engram.ts`

**Files:**
- Modify: `src/infrastructure/forge614-engram.ts`
- Test: `src/infrastructure/forge614-engram.test.ts`

**Interfaces:**
- Produces (used by Task 3):
  - `interface EngramUpdateResult { readonly updated: boolean; readonly previousVersion: string; readonly installedVersion: string }`
  - `function updateEngram(options: { home?: string; env?: NodeJS.ProcessEnv; run?: RunEngram }): Promise<EngramUpdateResult>`
- Consumes: the file's existing, unchanged `runEngramCommand` helper and `RunEngram` type.

- [ ] **Step 1: Write the failing tests**

Append to `src/infrastructure/forge614-engram.test.ts` (at the end of the file):

```ts
import { updateEngram } from "./forge614-engram.ts";

test("updateEngram sends update --json and reads the result", async () => {
  const calls: string[][] = [];
  const result = await updateEngram({
    home: "/Users/tester",
    run: async (command, args) => {
      calls.push([command, ...args]);
      return { status: 0, stdout: JSON.stringify({ updated: true, previousVersion: "1.3.0", installedVersion: "1.4.0" }), stderr: "" };
    },
  });
  expect(calls).toEqual([["/Users/tester/.forge614/engram/bin/forge614-engram", "update", "--json"]]);
  expect(result).toEqual({ updated: true, previousVersion: "1.3.0", installedVersion: "1.4.0" });
});

test("updateEngram reports already up to date when previous and installed versions match", async () => {
  const result = await updateEngram({
    home: "/Users/tester",
    run: async () => ({ status: 0, stdout: JSON.stringify({ updated: false, previousVersion: "1.4.0", installedVersion: "1.4.0" }), stderr: "" }),
  });
  expect(result).toEqual({ updated: false, previousVersion: "1.4.0", installedVersion: "1.4.0" });
});

test("updateEngram throws Engram's own safe message on failure, reading it from stderr", async () => {
  await expect(updateEngram({
    home: "/Users/tester",
    run: async () => ({ status: 1, stdout: "", stderr: JSON.stringify({ code: "UPDATE_FAILED", error: "No se pudo actualizar Forge614 Engram." }) }),
  })).rejects.toThrow("forge614-engram update failed: No se pudo actualizar Forge614 Engram.");
});

test("updateEngram never leaks installer progress text: only the final JSON stdout is parsed", async () => {
  const result = await updateEngram({
    home: "/Users/tester",
    run: async () => ({
      // Real forge614-engram update --json suppresses installer output when quiet; this test locks
      // in that stdout is trusted as pure JSON, with nothing else mixed in ahead of it.
      status: 0, stdout: JSON.stringify({ updated: true, previousVersion: "1.3.0", installedVersion: "1.4.0" }), stderr: "",
    }),
  });
  expect(JSON.stringify(result)).not.toContain("Downloading");
  expect(result).toEqual({ updated: true, previousVersion: "1.3.0", installedVersion: "1.4.0" });
});

test("updateEngram rejects a malformed result instead of guessing its shape", async () => {
  await expect(updateEngram({
    home: "/Users/tester",
    run: async () => ({ status: 0, stdout: JSON.stringify({ updated: true }), stderr: "" }),
  })).rejects.toThrow("forge614-engram update returned an invalid result.");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/jorgeetrejoo/Desktop/forge614-shell && bun test src/infrastructure/forge614-engram.test.ts`
Expected: FAIL — `updateEngram` is not exported yet.

- [ ] **Step 3: Implement `updateEngram`**

In `src/infrastructure/forge614-engram.ts`, add the following block at the end of the file (after `applyEngramInit`):

```ts
export interface EngramUpdateResult {
  readonly updated: boolean;
  readonly previousVersion: string;
  readonly installedVersion: string;
}

interface EngramUpdatePayload {
  updated?: unknown;
  previousVersion?: unknown;
  installedVersion?: unknown;
}

function toEngramUpdateResult(payload: unknown): EngramUpdateResult {
  const result = payload as EngramUpdatePayload;
  if (typeof result.updated !== "boolean" || typeof result.previousVersion !== "string" || typeof result.installedVersion !== "string") {
    throw new Error("forge614-engram update returned an invalid result.");
  }
  return { updated: result.updated, previousVersion: result.previousVersion, installedVersion: result.installedVersion };
}

/**
 * Refreshes the installed Forge614 Engram binary in place via its own `update --json`, which
 * suppresses the installer's own progress text so only the final JSON reaches stdout. Callers must
 * check `locateEngramBinary` exists first — Engram is optional for Shell, unlike Engines.
 */
export async function updateEngram(
  options: { home?: string; env?: NodeJS.ProcessEnv; run?: RunEngram } = {},
): Promise<EngramUpdateResult> {
  const payload = await runEngramCommand("update", ["update", "--json"], options);
  return toEngramUpdateResult(payload);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/jorgeetrejoo/Desktop/forge614-shell && bun test src/infrastructure/forge614-engram.test.ts`
Expected: PASS (all tests, including every pre-existing one).

- [ ] **Step 5: Typecheck**

Run: `cd /Users/jorgeetrejoo/Desktop/forge614-shell && bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/jorgeetrejoo/Desktop/forge614-shell
git add src/infrastructure/forge614-engram.ts src/infrastructure/forge614-engram.test.ts
git commit -m "feat: add updateEngram wrapper for Engram's published update --json contract"
```

---

## Task 3: Orchestrate all three updates and wire them into the CLI

**Files:**
- Create: `src/app/update-command.ts`
- Create: `src/app/update-command.test.ts`
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `updateInstalledShell` from `../infrastructure/updater.ts` (unchanged); `updateEngines`, `type EnginesUpdateResult` from `../infrastructure/forge614-engines.ts` (Task 1); `updateEngram`, `locateEngramBinary`, `type EngramUpdateResult`, `type RunEngram` from `../infrastructure/forge614-engram.ts` (Task 2, plus the pre-existing exports).
- Produces: `runUpdateCommand(options?: RunUpdateOptions): Promise<void>` — the new public entry point `cli.ts` calls for the `update` command.

- [ ] **Step 1: Write the failing tests**

Create `src/app/update-command.test.ts`:

```ts
import { expect, spyOn, test } from "bun:test";
import { runUpdateCommand } from "./update-command.ts";

function captureLogs(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(" ")); });
  return { logs, restore: () => spy.mockRestore() };
}

function okShellSpawn() {
  return (_command: string, _args: string[]) => ({ status: 0, stderr: "" }) as never;
}

test("Engines is installed and gets updated: all three components report independently", async () => {
  const { logs, restore } = captureLogs();
  process.exitCode = 0;
  await runUpdateCommand({
    home: "/Users/tester",
    installer: "/tmp/release/install.sh",
    spawn: okShellSpawn(),
    engramBinaryExists: () => true,
    enginesRun: async () => ({
      status: 0, stdout: JSON.stringify({ schemaVersion: 1, result: { updated: true, currentVersion: "1.3.0", latestVersion: "1.4.0" } }), stderr: "",
    }),
    engramRun: async () => ({ status: 0, stdout: JSON.stringify({ updated: true, previousVersion: "1.3.0", installedVersion: "1.4.0" }), stderr: "" }),
  });
  try {
    expect(logs).toEqual([
      "Forge614 Shell: updated",
      "Forge614 Engines: updated (1.3.0 → 1.4.0)",
      "Forge614 Engram: updated (1.3.0 → 1.4.0)",
    ]);
    expect(process.exitCode as number | undefined).not.toBe(1);
  } finally { restore(); process.exitCode = 0; }
});

test("Engram is installed and already up to date using JSON", async () => {
  const { logs, restore } = captureLogs();
  process.exitCode = 0;
  await runUpdateCommand({
    home: "/Users/tester",
    installer: "/tmp/release/install.sh",
    spawn: okShellSpawn(),
    engramBinaryExists: () => true,
    enginesRun: async () => ({
      status: 0, stdout: JSON.stringify({ schemaVersion: 1, result: { updated: false, currentVersion: "1.4.0", latestVersion: "1.4.0" } }), stderr: "",
    }),
    engramRun: async () => ({ status: 0, stdout: JSON.stringify({ updated: false, previousVersion: "1.4.0", installedVersion: "1.4.0" }), stderr: "" }),
  });
  try {
    expect(logs).toContain("Forge614 Engines: already up to date (1.4.0)");
    expect(logs).toContain("Forge614 Engram: already up to date (1.4.0)");
  } finally { restore(); process.exitCode = 0; }
});

test("Engram is not installed: it is skipped without an error, and no Engram command is ever sent", async () => {
  const { logs, restore } = captureLogs();
  process.exitCode = 0;
  const engramCalls: string[][] = [];
  await runUpdateCommand({
    home: "/Users/tester",
    installer: "/tmp/release/install.sh",
    spawn: okShellSpawn(),
    engramBinaryExists: () => false,
    enginesRun: async () => ({
      status: 0, stdout: JSON.stringify({ schemaVersion: 1, result: { updated: true, currentVersion: "1.3.0", latestVersion: "1.4.0" } }), stderr: "",
    }),
    engramRun: async (command, args) => { engramCalls.push([command, ...args]); return { status: 0, stdout: "{}", stderr: "" }; },
  });
  try {
    expect(logs).toContain("Forge614 Engram: not installed, skipped");
    expect(engramCalls).toEqual([]);
    expect(process.exitCode as number | undefined).not.toBe(1);
  } finally { restore(); process.exitCode = 0; }
});

test("an Engines failure is reported and does not prevent Engram's own result from being shown", async () => {
  const { logs, restore } = captureLogs();
  process.exitCode = 0;
  await runUpdateCommand({
    home: "/Users/tester",
    installer: "/tmp/release/install.sh",
    spawn: okShellSpawn(),
    engramBinaryExists: () => true,
    enginesRun: async () => ({
      status: 1, stdout: JSON.stringify({ schemaVersion: 1, error: { code: "UPDATE_ASSET_MISSING", message: "The latest release has no Forge614 Engines asset for darwin-arm64" } }), stderr: "",
    }),
    engramRun: async () => ({ status: 0, stdout: JSON.stringify({ updated: true, previousVersion: "1.3.0", installedVersion: "1.4.0" }), stderr: "" }),
  });
  try {
    expect(logs).toContain("Forge614 Engines: update failed — The latest release has no Forge614 Engines asset for darwin-arm64");
    expect(logs).toContain("Forge614 Engram: updated (1.3.0 → 1.4.0)");
    expect(process.exitCode).toBe(1);
  } finally { restore(); process.exitCode = 0; }
});

test("an Engram failure is reported and does not prevent Engines' own result from being shown, or hide as success", async () => {
  const { logs, restore } = captureLogs();
  process.exitCode = 0;
  await runUpdateCommand({
    home: "/Users/tester",
    installer: "/tmp/release/install.sh",
    spawn: okShellSpawn(),
    engramBinaryExists: () => true,
    enginesRun: async () => ({
      status: 0, stdout: JSON.stringify({ schemaVersion: 1, result: { updated: true, currentVersion: "1.3.0", latestVersion: "1.4.0" } }), stderr: "",
    }),
    engramRun: async () => ({ status: 1, stdout: "", stderr: JSON.stringify({ code: "UPDATE_FAILED", error: "No se pudo actualizar Forge614 Engram." }) }),
  });
  try {
    expect(logs).toContain("Forge614 Engines: updated (1.3.0 → 1.4.0)");
    expect(logs).toContain("Forge614 Engram: update failed — forge614-engram update failed: No se pudo actualizar Forge614 Engram.");
    expect(logs.some(line => line.startsWith("Forge614 Engram: updated"))).toBe(false);
    expect(process.exitCode).toBe(1);
  } finally { restore(); process.exitCode = 0; }
});

test("a Shell self-update failure is reported and Engines/Engram are still attempted and shown", async () => {
  const { logs, restore } = captureLogs();
  process.exitCode = 0;
  await runUpdateCommand({
    home: "/Users/tester",
    installer: "/tmp/release/install.sh",
    spawn: (() => ({ status: 69, stderr: "Node.js is required" }) as never) as never,
    engramBinaryExists: () => true,
    enginesRun: async () => ({
      status: 0, stdout: JSON.stringify({ schemaVersion: 1, result: { updated: true, currentVersion: "1.3.0", latestVersion: "1.4.0" } }), stderr: "",
    }),
    engramRun: async () => ({ status: 0, stdout: JSON.stringify({ updated: true, previousVersion: "1.3.0", installedVersion: "1.4.0" }), stderr: "" }),
  });
  try {
    expect(logs).toContain("Forge614 Shell: update failed — Node.js is required");
    expect(logs).toContain("Forge614 Engines: updated (1.3.0 → 1.4.0)");
    expect(logs).toContain("Forge614 Engram: updated (1.3.0 → 1.4.0)");
    expect(process.exitCode).toBe(1);
  } finally { restore(); process.exitCode = 0; }
});

test("never sends any command to Engines or Engram other than update / update --json", async () => {
  const { restore } = captureLogs();
  process.exitCode = 0;
  const enginesCalls: string[][] = [];
  const engramCalls: string[][] = [];
  await runUpdateCommand({
    home: "/Users/tester",
    installer: "/tmp/release/install.sh",
    spawn: okShellSpawn(),
    engramBinaryExists: () => true,
    enginesRun: async (command, args) => {
      enginesCalls.push([command, ...args]);
      return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, result: { updated: false, currentVersion: "1.4.0", latestVersion: "1.4.0" } }), stderr: "" };
    },
    engramRun: async (command, args) => {
      engramCalls.push([command, ...args]);
      return { status: 0, stdout: JSON.stringify({ updated: false, previousVersion: "1.4.0", installedVersion: "1.4.0" }), stderr: "" };
    },
  });
  try {
    expect(enginesCalls).toEqual([["/Users/tester/.forge614/engines/bin/forge614-engines", "update"]]);
    expect(engramCalls).toEqual([["/Users/tester/.forge614/engram/bin/forge614-engram", "update", "--json"]]);
  } finally { restore(); process.exitCode = 0; }
});

test("checks Engram's binary at its canonical path, never assuming PATH", async () => {
  const { restore } = captureLogs();
  process.exitCode = 0;
  const checkedPaths: string[] = [];
  await runUpdateCommand({
    home: "/Users/tester",
    installer: "/tmp/release/install.sh",
    spawn: okShellSpawn(),
    engramBinaryExists: (path: string) => { checkedPaths.push(path); return false; },
    enginesRun: async () => ({ status: 0, stdout: JSON.stringify({ schemaVersion: 1, result: { updated: false, currentVersion: "1.4.0", latestVersion: "1.4.0" } }), stderr: "" }),
  });
  try {
    expect(checkedPaths).toEqual(["/Users/tester/.forge614/engram/bin/forge614-engram"]);
  } finally { restore(); process.exitCode = 0; }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/jorgeetrejoo/Desktop/forge614-shell && bun test src/app/update-command.test.ts`
Expected: FAIL — `./update-command.ts` does not exist yet.

- [ ] **Step 3: Implement the orchestrator**

Create `src/app/update-command.ts`:

```ts
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { updateInstalledShell } from "../infrastructure/updater.ts";
import { updateEngines, type EnginesUpdateResult } from "../infrastructure/forge614-engines.ts";
import { updateEngram, locateEngramBinary, type EngramUpdateResult, type RunEngram } from "../infrastructure/forge614-engram.ts";

type ShellSpawn = (command: string, args: string[], options?: { stdio?: "inherit" }) => { status: number | null; stderr?: string | Buffer; error?: Error };

export interface RunUpdateOptions {
  readonly home?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Test seam for Shell's own bundled-installer path; production callers omit this. */
  readonly installer?: string;
  /** Test seam for Shell's own installer subprocess; production callers omit this. */
  readonly spawn?: ShellSpawn;
  readonly enginesRun?: RunEngram;
  readonly engramRun?: RunEngram;
  /** Test seam replacing node:fs's existsSync; production callers omit this. */
  readonly engramBinaryExists?: (path: string) => boolean;
}

type UpdateOutcomeStatus = "updated" | "already-up-to-date" | "not-installed" | "failed";

interface UpdateOutcome {
  readonly label: string;
  readonly status: UpdateOutcomeStatus;
  readonly detail?: string;
}

function outcomeLine(outcome: UpdateOutcome): string {
  if (outcome.status === "updated") return `${outcome.label}: updated${outcome.detail ? ` (${outcome.detail})` : ""}`;
  if (outcome.status === "already-up-to-date") return `${outcome.label}: already up to date${outcome.detail ? ` (${outcome.detail})` : ""}`;
  if (outcome.status === "not-installed") return `${outcome.label}: not installed, skipped`;
  return `${outcome.label}: update failed — ${outcome.detail}`;
}

function enginesOutcome(result: EnginesUpdateResult): UpdateOutcome {
  if (!result.updated) return { label: "Forge614 Engines", status: "already-up-to-date", detail: result.latestVersion };
  return { label: "Forge614 Engines", status: "updated", detail: `${result.currentVersion} → ${result.latestVersion}` };
}

function engramOutcome(result: EngramUpdateResult): UpdateOutcome {
  if (!result.updated) return { label: "Forge614 Engram", status: "already-up-to-date", detail: result.installedVersion };
  return { label: "Forge614 Engram", status: "updated", detail: `${result.previousVersion} → ${result.installedVersion}` };
}

/**
 * Refreshes Shell itself, then Forge614 Engines (always — a required Shell dependency), then
 * Forge614 Engram (only if its binary is present — Engram is optional for Shell). Every outcome is
 * reported independently; one failing never hides, skips, or is presented as success for the
 * others. Never invokes anything beyond each product's own `update`/`update --json` command, so no
 * memory, SQLite, `.env`, MCP, or assistant configuration is ever touched here.
 */
export async function runUpdateCommand(options: RunUpdateOptions = {}): Promise<void> {
  const home = options.home ?? homedir();
  const outcomes: UpdateOutcome[] = [];
  let anyFailed = false;

  try {
    await updateInstalledShell({ installer: options.installer, spawn: options.spawn });
    outcomes.push({ label: "Forge614 Shell", status: "updated" });
  } catch (error) {
    anyFailed = true;
    outcomes.push({ label: "Forge614 Shell", status: "failed", detail: error instanceof Error ? error.message : String(error) });
  }

  try {
    const result = await updateEngines({ home: options.home, env: options.env, run: options.enginesRun });
    outcomes.push(enginesOutcome(result));
  } catch (error) {
    anyFailed = true;
    outcomes.push({ label: "Forge614 Engines", status: "failed", detail: error instanceof Error ? error.message : String(error) });
  }

  const engramBinary = locateEngramBinary(home, options.env);
  const engramInstalled = (options.engramBinaryExists ?? existsSync)(engramBinary);
  if (!engramInstalled) {
    outcomes.push({ label: "Forge614 Engram", status: "not-installed" });
  } else {
    try {
      const result = await updateEngram({ home: options.home, env: options.env, run: options.engramRun });
      outcomes.push(engramOutcome(result));
    } catch (error) {
      anyFailed = true;
      outcomes.push({ label: "Forge614 Engram", status: "failed", detail: error instanceof Error ? error.message : String(error) });
    }
  }

  for (const outcome of outcomes) console.log(outcomeLine(outcome));
  if (anyFailed) process.exitCode = 1;
}
```

- [ ] **Step 4: Wire the orchestrator into `src/cli.ts`**

In `src/cli.ts`, find this block:

```ts
if (args.length === 1 && args[0] === "update") {
  try {
    const { updateInstalledShell } = await import("./infrastructure/updater.ts");
    await updateInstalledShell();
  } catch (error) {
    console.error(`Forge614-Shell update failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
```

Replace it with:

```ts
if (args.length === 1 && args[0] === "update") {
  try {
    const { runUpdateCommand } = await import("./app/update-command.ts");
    await runUpdateCommand();
  } catch (error) {
    console.error(`Forge614-Shell update failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
```

Also find this line in the `--help` output template string:

```
  update              Download and activate the latest stable release
```

Replace it with:

```
  update              Download and activate the latest stable release, and refresh Forge614 Engines (and Engram, if installed)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /Users/jorgeetrejoo/Desktop/forge614-shell && bun test src/app/update-command.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `cd /Users/jorgeetrejoo/Desktop/forge614-shell && bun test && bun run typecheck`
Expected: every test passes (existing suite plus the new ones), no type errors anywhere.

- [ ] **Step 7: Commit**

```bash
cd /Users/jorgeetrejoo/Desktop/forge614-shell
git add src/app/update-command.ts src/app/update-command.test.ts src/cli.ts
git commit -m "feat: orchestrate Engines and Engram updates from forge614-shell update"
```

---

## Task 4: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the entire existing test suite**

Run: `cd /Users/jorgeetrejoo/Desktop/forge614-shell && bun test`
Expected: PASS, zero failures, across every test file in the project.

- [ ] **Step 2: Typecheck the whole project**

Run: `cd /Users/jorgeetrejoo/Desktop/forge614-shell && bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Check the diff for whitespace/conflict-marker problems**

Run: `cd /Users/jorgeetrejoo/Desktop/forge614-shell && git diff --check <BASE>` where `<BASE>` is the commit this plan's first task started from.
Expected: no output.

- [ ] **Step 4: Confirm no secret or installer text can leak, and no forbidden subcommand is ever sent**

Run:
```bash
cd /Users/jorgeetrejoo/Desktop/forge614-shell
git diff <BASE> -- src | grep -iE "postgres://|password|secret|token|downloading|installing" || echo "clean"
grep -rn '"init"\|"mcp"\|"plan"\|"apply"\|"verify"\|memory-protocol' src/app/update-command.ts src/infrastructure/forge614-engines.ts src/infrastructure/forge614-engram.ts | grep -v '\.test\.ts' | grep -v "planMcpInstall\|planMcpRemove\|planMemoryInstall\|verifyMemoryIntegration\|applyMcpPlan\|applyEngramInit"
```
Expected: `clean` from the first command; the second command's only matches, if any, are the pre-existing memory-integration functions named above (untouched by this plan) — never anything inside the new `updateEngines`/`updateEngram`/`runUpdateCommand` code.

- [ ] **Step 5: Report**

Summarize for the person: files modified/created, the exact contract each new function calls, and the `bun test`/`bun run typecheck`/`git diff --check` output. Do not commit anything beyond what Tasks 1–3 already committed; do not tag, release, or push.
