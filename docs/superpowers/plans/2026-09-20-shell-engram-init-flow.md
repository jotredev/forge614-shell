# Shell `init --product engram` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `forge614-shell init --product engram`, a standalone visual lifecycle command (separate from Shell's chat workspace) that asks two questions about Engram's memory setup, shows a summary, and — only after explicit confirmation — applies the decisions by spawning Engram's public, non-interactive CLI. Ship it as public release **1.1.0**, tagged, pushed, and published on GitHub Releases marked Latest.

**Architecture:** A pure `EngramInitDecisions` contract type sits between three layers: an `src/infrastructure/forge614-engram.ts` bridge that only spawns Engram's public binary (mirrors the existing `forge614-engines.ts` bridge), an `src/ui/startup/engram-init.ts` set of `pi-tui` screens that only collect decisions (mirrors `visual-picker.ts`/`engine-picker.ts`), and an `src/app/init-engram.ts` orchestrator that validates CLI arguments, requires a TTY, runs the screens, and calls the bridge only after confirmation. `src/cli.ts` gets one new, fully separate `init` branch that never falls through to the existing chat/engine-picker startup path.

**Tech Stack:** TypeScript, Bun (`bun test`, `bun build`), `@earendil-works/pi-tui` (`SelectList`, `Text`, `TuiAltScreen`, `matchesKey`, `decodeKittyPrintable`), Node's `child_process.spawnSync` (via an injectable runner, as already used in `forge614-engines.ts`).

**Spec:** `docs/superpowers/specs/2026-09-20-shell-engram-init-flow-design.md`

## Global Constraints

- All screen copy is in English (matches existing Shell UI copy).
- macOS/Linux only for this flow; no Windows-specific work.
- Only `--product engram` is supported. No other product name is accepted or scaffolded "just in case."
- Never read or write `~/.forge614/engram/` or its SQLite database directly. Communicate with Engram exclusively by spawning its public binary (`<FORGE614_HOME or ~/.forge614>/engram/bin/forge614-engram`).
- Do not modify the `forge614-engram` repository and do not deep-import from it.
- Exit codes: `0` success, `130` cancelled before confirmation, `1` any other error (bad/missing `--product`, non-interactive terminal, or a failing Engram command).
- The PostgreSQL connection string must never appear in rendered terminal output, `console.log`/`console.error` text, or the summary screen — only Engram's own command line receives it.
- The `engines` and `infrastructure` layers must never import from `ui` or `app` (enforced by `tests/architecture/layers.test.ts`; this plan does not touch that rule, only stays inside it).
- Each task below ends with its own commit (small, reviewable, working-tree-clean commits — no `--no-verify`).
- The task owner explicitly confirmed, after being shown the risk (this ships brand-new, previously-unreleased code straight to the public "Latest" release that `curl .../install.sh | bash` and `forge614-shell update` resolve automatically): commit, push to `origin main`, bump the version to **1.1.0**, tag, and publish a GitHub Release marked as **Latest**. This is the explicit exception to Shell's usual release caution (see `docs/en/06-release-1.0.0-bundle-installer.md` §8's own warning against marking an unreviewed build Latest) — proceed only because the task owner confirmed it directly, in this exact scope, not as a general standing permission for future work.
- Follow the existing maintainer release procedure in `docs/en/06-release-1.0.0-bundle-installer.md` §8 exactly (version bump → `bun run check` → `bun run bundle:release` → tag + push → GitHub Release with all 3 assets, marked Latest). Do not invent a different release mechanism.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/contracts/engram-init.ts` (create) | `EngramInitDecisions` type — the only shape passed between the UI, the app orchestrator, and the infrastructure bridge. |
| `src/infrastructure/forge614-engram.ts` (create) | Spawns Engram's public binary only (`init --json`, optional `--postgres-url`, `reinforcement-enable`). Injectable runner for tests. |
| `src/ui/startup/masked-input.ts` (create) | A single-line `pi-tui` `Component` that accepts typed/pasted text but never renders it — used only for the PostgreSQL connection string. |
| `src/ui/startup/frame.ts` (modify) | Add an optional `body` component slot, rendered between the title and the selectable list, for explanatory screen text. Backward compatible — existing callers are unaffected. |
| `src/ui/startup/engram-init.ts` (create) | The five screens (intro, PostgreSQL, reinforcement, summary, and the masked connection-string sub-screen) and `runEngramInitFlow()`, which returns the confirmed decisions or a cancellation. Makes no Engram calls. |
| `src/app/init-engram.ts` (create) | `requireEngramProduct()` (argument validation) and `runInitCommand()` (TTY gate, runs the flow, calls the infrastructure bridge only after confirmation, sets `process.exitCode`). |
| `src/cli.ts` (modify) | New `init` branch, parsed before the existing chat/engine-selection path, dispatching to `runInitCommand`. |
| `package.json` (modify, Task 9 only) | Version bump `1.0.6` → `1.1.0` for the public release. |

---

### Task 1: Engram init decisions contract

**Files:**
- Create: `src/contracts/engram-init.ts`

**Interfaces:**
- Produces: `EngramInitDecisions { readonly postgresUrl: string | null; readonly reinforcement: boolean }` — consumed by Tasks 2, 4, 6.

- [ ] **Step 1: Write the contract file**

```typescript
/** Confirmed decisions for `forge614-shell init --product engram`, ready to apply via Engram's public CLI. */
export interface EngramInitDecisions {
  readonly postgresUrl: string | null;
  readonly reinforcement: boolean;
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/contracts/engram-init.ts
git commit -m "feat: add EngramInitDecisions contract"
```

---

### Task 2: Engram CLI bridge

**Files:**
- Create: `src/infrastructure/forge614-engram.ts`
- Test: `src/infrastructure/forge614-engram.test.ts`

**Interfaces:**
- Consumes: `EngramInitDecisions` from Task 1.
- Produces:
  - `type RunEngram = (command: string, args: string[]) => Promise<{ status: number | null; stdout: string; stderr: string }>`
  - `interface EngramInitApplyResult { readonly initResult: unknown; readonly reinforcementResult: unknown | null }`
  - `applyEngramInit(decisions: EngramInitDecisions, options?: { home?: string; env?: NodeJS.ProcessEnv; run?: RunEngram }): Promise<EngramInitApplyResult>` — consumed by Task 6.

- [ ] **Step 1: Write the failing tests**

```typescript
import { expect, test } from "bun:test";
import { applyEngramInit } from "./forge614-engram.ts";

test("runs init --json only when PostgreSQL and reinforcement are both disabled", async () => {
  const calls: string[][] = [];
  const result = await applyEngramInit(
    { postgresUrl: null, reinforcement: false },
    {
      home: "/Users/tester",
      run: async (command, args) => {
        calls.push([command, ...args]);
        return { status: 0, stdout: JSON.stringify({ initialized: true, storage: "sqlite" }), stderr: "" };
      },
    },
  );
  expect(calls).toEqual([["/Users/tester/.forge614/engram/bin/forge614-engram", "init", "--json"]]);
  expect(result).toEqual({ initResult: { initialized: true, storage: "sqlite" }, reinforcementResult: null });
});

test("adds --postgres-url to the same init call when PostgreSQL is enabled", async () => {
  const calls: string[][] = [];
  await applyEngramInit(
    { postgresUrl: "postgres://user:secret@host/db", reinforcement: false },
    {
      home: "/Users/tester",
      run: async (command, args) => { calls.push([command, ...args]); return { status: 0, stdout: "{}", stderr: "" }; },
    },
  );
  expect(calls).toEqual([[
    "/Users/tester/.forge614/engram/bin/forge614-engram", "init", "--json", "--postgres-url", "postgres://user:secret@host/db",
  ]]);
});

test("runs reinforcement-enable after init when reinforcement is enabled", async () => {
  const calls: string[][] = [];
  const result = await applyEngramInit(
    { postgresUrl: null, reinforcement: true },
    {
      home: "/Users/tester",
      run: async (command, args) => {
        calls.push([command, ...args]);
        return {
          status: 0,
          stdout: args.includes("reinforcement-enable")
            ? JSON.stringify({ enabled: true, schema: 7 })
            : JSON.stringify({ initialized: true }),
          stderr: "",
        };
      },
    },
  );
  expect(calls).toEqual([
    ["/Users/tester/.forge614/engram/bin/forge614-engram", "init", "--json"],
    ["/Users/tester/.forge614/engram/bin/forge614-engram", "reinforcement-enable"],
  ]);
  expect(result.reinforcementResult).toEqual({ enabled: true, schema: 7 });
});

test("does not call reinforcement-enable when init fails, and surfaces Engram's own error", async () => {
  const calls: string[][] = [];
  await expect(applyEngramInit(
    { postgresUrl: "postgres://bad", reinforcement: true },
    {
      home: "/Users/tester",
      run: async (command, args) => {
        calls.push([command, ...args]);
        return { status: 1, stdout: "", stderr: JSON.stringify({ code: "POSTGRES_UNAVAILABLE", error: "No se pudo conectar a PostgreSQL." }) };
      },
    },
  )).rejects.toThrow("No se pudo conectar a PostgreSQL.");
  expect(calls).toEqual([["/Users/tester/.forge614/engram/bin/forge614-engram", "init", "--json", "--postgres-url", "postgres://bad"]]);
});

test("respects FORGE614_HOME when locating the Engram binary", async () => {
  const calls: string[][] = [];
  await applyEngramInit(
    { postgresUrl: null, reinforcement: false },
    { env: { FORGE614_HOME: "/custom/forge" } as NodeJS.ProcessEnv, run: async (command, args) => { calls.push([command, ...args]); return { status: 0, stdout: "{}", stderr: "" }; } },
  );
  expect(calls[0]![0]).toBe("/custom/forge/engram/bin/forge614-engram");
});

test("rejects a result Engram did not report as JSON", async () => {
  await expect(applyEngramInit(
    { postgresUrl: null, reinforcement: false },
    { home: "/Users/tester", run: async () => ({ status: 0, stdout: "not json", stderr: "" }) },
  )).rejects.toThrow("invalid result");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/infrastructure/forge614-engram.test.ts`
Expected: FAIL — `Cannot find module './forge614-engram.ts'` (file does not exist yet).

- [ ] **Step 3: Write the implementation**

```typescript
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type { EngramInitDecisions } from "../contracts/engram-init.ts";

export type RunEngram = (command: string, args: string[]) => Promise<{ status: number | null; stdout: string; stderr: string }>;

export interface EngramInitApplyResult {
  readonly initResult: unknown;
  readonly reinforcementResult: unknown | null;
}

interface EngramErrorPayload {
  code?: unknown;
  error?: unknown;
}

const defaultRun: RunEngram = async (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

function locateEngramBinary(home: string, env?: NodeJS.ProcessEnv): string {
  const forgeHome = env?.FORGE614_HOME ?? join(home, ".forge614");
  return join(forgeHome, "engram", "bin", "forge614-engram");
}

function parseEngramError(stderr: string): string {
  try {
    const payload = JSON.parse(stderr) as EngramErrorPayload;
    if (typeof payload.error === "string" && payload.error) return payload.error;
  } catch { /* fall through to the generic message below */ }
  return "Forge614 Engram command failed.";
}

async function runEngramCommand(
  args: string[],
  options: { home?: string; env?: NodeJS.ProcessEnv; run?: RunEngram },
): Promise<unknown> {
  const binary = locateEngramBinary(options.home ?? homedir(), options.env);
  const result = await (options.run ?? defaultRun)(binary, args);
  if (result.status !== 0) throw new Error(parseEngramError(result.stderr));
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("Forge614 Engram returned an invalid result.");
  }
}

/**
 * Applies confirmed Engram initialization decisions using only its public CLI:
 * `init --json` (optionally with `--postgres-url`), then `reinforcement-enable`
 * when requested. Never touches `~/.forge614/engram/` directly.
 */
export async function applyEngramInit(
  decisions: EngramInitDecisions,
  options: { home?: string; env?: NodeJS.ProcessEnv; run?: RunEngram } = {},
): Promise<EngramInitApplyResult> {
  const initArgs = decisions.postgresUrl !== null
    ? ["init", "--json", "--postgres-url", decisions.postgresUrl]
    : ["init", "--json"];
  const initResult = await runEngramCommand(initArgs, options);
  const reinforcementResult = decisions.reinforcement
    ? await runEngramCommand(["reinforcement-enable"], options)
    : null;
  return { initResult, reinforcementResult };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/infrastructure/forge614-engram.test.ts`
Expected: PASS — all 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/forge614-engram.ts src/infrastructure/forge614-engram.test.ts
git commit -m "feat: bridge to Engram's public non-interactive init/reinforcement CLI"
```

---

### Task 3: Masked input component

**Files:**
- Create: `src/ui/startup/masked-input.ts`
- Test: `src/ui/startup/masked-input.test.ts`

**Interfaces:**
- Produces: `class MaskedInput implements Component { constructor(options?: { placeholder?: string }); onSubmit?: (value: string) => void; onEscape?: () => void; getValue(): string; handleInput(data: string): void; invalidate(): void; render(width: number): string[] }` — consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

```typescript
import { expect, test } from "bun:test";
import { MaskedInput } from "./masked-input.ts";

test("typed characters are held in value but never rendered", () => {
  const input = new MaskedInput();
  for (const char of "secret") input.handleInput(char);
  expect(input.getValue()).toBe("secret");
  const rendered = input.render(40).join("\n");
  expect(rendered).not.toContain("secret");
  expect(rendered).toContain("••••••");
});

test("a pasted or multi-character chunk is accepted in one call", () => {
  const input = new MaskedInput();
  input.handleInput("postgres://user:pw@host/db");
  expect(input.getValue()).toBe("postgres://user:pw@host/db");
  expect(input.render(60).join("\n")).not.toContain("postgres");
});

test("backspace removes the last character", () => {
  const input = new MaskedInput();
  input.handleInput("ab");
  input.handleInput("\x7f");
  expect(input.getValue()).toBe("a");
});

test("Enter submits the real value", () => {
  const input = new MaskedInput();
  let submitted: string | undefined;
  input.onSubmit = value => { submitted = value; };
  input.handleInput("secret");
  input.handleInput("\r");
  expect(submitted).toBe("secret");
});

test("Escape and Ctrl+C cancel without submitting", () => {
  let cancelled = 0;
  const escaped = new MaskedInput();
  escaped.onEscape = () => { cancelled++; };
  escaped.handleInput("x");
  escaped.handleInput("\x1b");
  expect(cancelled).toBe(1);

  const interrupted = new MaskedInput();
  interrupted.onEscape = () => { cancelled++; };
  interrupted.handleInput("\x03");
  expect(cancelled).toBe(2);
});

test("shows the placeholder while empty", () => {
  const input = new MaskedInput({ placeholder: "postgres://user:password@host:5432/database" });
  expect(input.render(60)).toEqual(["postgres://user:password@host:5432/database"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/ui/startup/masked-input.test.ts`
Expected: FAIL — `Cannot find module './masked-input.ts'`.

- [ ] **Step 3: Write the implementation**

```typescript
import { decodeKittyPrintable, matchesKey } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";

export interface MaskedInputOptions {
  placeholder?: string;
}

/** Single-line input that accepts typed or pasted text but never renders it. Used only for secrets. */
export class MaskedInput implements Component {
  private value = "";
  private readonly placeholder: string;
  onSubmit?: (value: string) => void;
  onEscape?: () => void;

  constructor(options: MaskedInputOptions = {}) {
    this.placeholder = options.placeholder ?? "";
  }

  getValue(): string {
    return this.value;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "enter") || matchesKey(data, "return")) { this.onSubmit?.(this.value); return; }
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) { this.onEscape?.(); return; }
    if (matchesKey(data, "backspace") || matchesKey(data, "delete") || data === "\x7f") { this.value = this.value.slice(0, -1); return; }
    if (data.length > 0 && /^[\x20-\x7e]*$/.test(data)) { this.value += data; return; }
    const printable = decodeKittyPrintable(data);
    if (printable) this.value += printable;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const masked = this.value.length ? "•".repeat(this.value.length) : this.placeholder;
    return [masked.slice(0, Math.max(0, width))];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/ui/startup/masked-input.test.ts`
Expected: PASS — all 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/startup/masked-input.ts src/ui/startup/masked-input.test.ts
git commit -m "feat: add a masked single-line input for secret entry"
```

---

### Task 4: Startup frame body slot + Engram init screens

**Files:**
- Modify: `src/ui/startup/frame.ts`
- Create: `src/ui/startup/engram-init.ts`
- Test: `src/ui/startup/engram-init.test.ts`

**Interfaces:**
- Consumes: `MaskedInput` from Task 3, `EngramInitDecisions` from Task 1, `startupFrame` (modified in this task).
- Produces:
  - `startupFrame(terminal: Terminal, title: string, list: Component, hint?: Component, body?: Component): TuiAltScreen` (new optional 5th parameter; existing two call sites in `visual-picker.ts` and `engine-picker.ts` are unaffected).
  - `type EngramInitFlowResult = { readonly confirmed: true; readonly decisions: EngramInitDecisions } | { readonly confirmed: false }`
  - `runEngramInitFlow(terminal?: Terminal): Promise<EngramInitFlowResult>` — consumed by Task 6.

- [ ] **Step 1: Modify `frame.ts` to add the optional `body` slot**

Current content of `src/ui/startup/frame.ts`:

```typescript
import { TuiAltScreen } from "@earendil-works/pi-tui";
import type { Component, Terminal } from "@earendil-works/pi-tui";
import { workspaceTerminal } from "../basic/workspace.ts";
import { accent, border, fit, muted } from "../basic/theme.ts";

/** Shared startup surface; the terminal shell stays outside the alternate screen. */
export function startupFrame(terminal: Terminal, title: string, list: Component, hint?: Component): TuiAltScreen {
  const tui = new TuiAltScreen(workspaceTerminal(terminal));
  tui.addChild({
    invalidate() { list.invalidate(); hint?.invalidate(); },
    render(width) {
      const inner = Math.max(1, width - 8);
      return ["", accent("FORGE614") + " / SHELL", border("─".repeat(inner)), "",
        accent(title), "", ...list.render(inner), "",
        ...(hint?.render(inner) ?? []), "",
        muted("↑/↓ navigate · Enter select · Esc cancel"),
      ].map(line => fit("    " + fit(line, inner), width));
    },
  });
  tui.setFocus(list);
  return tui;
}
```

Replace it with:

```typescript
import { TuiAltScreen } from "@earendil-works/pi-tui";
import type { Component, Terminal } from "@earendil-works/pi-tui";
import { workspaceTerminal } from "../basic/workspace.ts";
import { accent, border, fit, muted } from "../basic/theme.ts";

/** Shared startup surface; the terminal shell stays outside the alternate screen. */
export function startupFrame(terminal: Terminal, title: string, list: Component, hint?: Component, body?: Component): TuiAltScreen {
  const tui = new TuiAltScreen(workspaceTerminal(terminal));
  tui.addChild({
    invalidate() { list.invalidate(); hint?.invalidate(); body?.invalidate(); },
    render(width) {
      const inner = Math.max(1, width - 8);
      return ["", accent("FORGE614") + " / SHELL", border("─".repeat(inner)), "",
        accent(title), "",
        ...(body ? [...body.render(inner), ""] : []),
        ...list.render(inner), "",
        ...(hint?.render(inner) ?? []), "",
        muted("↑/↓ navigate · Enter select · Esc cancel"),
      ].map(line => fit("    " + fit(line, inner), width));
    },
  });
  tui.setFocus(list);
  return tui;
}
```

- [ ] **Step 2: Run the existing startup tests to confirm the change is backward compatible**

Run: `bun test src/ui/startup/visual-picker.test.ts src/ui/startup/engine-picker.test.ts`
Expected: PASS — unchanged, since neither caller passes a 5th argument.

- [ ] **Step 3: Write the failing tests for the Engram init flow**

```typescript
import { expect, test } from "bun:test";
import type { Terminal } from "@earendil-works/pi-tui";
import { runEngramInitFlow } from "./engram-init.ts";

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

test("Enter on every screen accepts the defaults: PostgreSQL No, reinforcement Yes", async () => {
  const terminal = new TestTerminal();
  const result = runEngramInitFlow(terminal);
  await tick();
  expect(terminal.output).toContain("Forge614 Engram stores persistent memory locally on this device.");
  terminal.input("\r"); await tick(); // Continue
  expect(terminal.output).toContain("PostgreSQL synchronization");
  terminal.input("\r"); await tick(); // PostgreSQL: No (default)
  expect(terminal.output).toContain("Memory reinforcement");
  terminal.input("\r"); await tick(); // Reinforcement: Yes (default)
  expect(terminal.output).toContain("Summary");
  expect(terminal.output).toContain("PostgreSQL: disabled");
  expect(terminal.output).toContain("reinforcement: enabled");
  expect(terminal.output).toContain("forge614-engram init --json");
  terminal.input("\r"); // Summary: Confirm (default)
  expect(await result).toEqual({ confirmed: true, decisions: { postgresUrl: null, reinforcement: true } });
});

test("choosing No for reinforcement is honored", async () => {
  const terminal = new TestTerminal();
  const result = runEngramInitFlow(terminal);
  await tick();
  terminal.input("\r"); await tick(); // Continue
  terminal.input("\r"); await tick(); // PostgreSQL: No
  terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // Reinforcement: No
  terminal.input("\r"); // Summary: Confirm
  expect(await result).toEqual({ confirmed: true, decisions: { postgresUrl: null, reinforcement: false } });
});

test("choosing Yes for PostgreSQL asks for a connection string, masks it everywhere, and reports it enabled", async () => {
  const terminal = new TestTerminal();
  const result = runEngramInitFlow(terminal);
  await tick();
  terminal.input("\r"); await tick(); // Continue
  terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // PostgreSQL: Yes
  expect(terminal.output).toContain("PostgreSQL connection string");
  terminal.input("postgres://user:pw@host/db");
  terminal.input("\r"); await tick(); // submit connection string
  terminal.input("\r"); await tick(); // Reinforcement: Yes (default)
  expect(terminal.output).toContain("PostgreSQL: enabled");
  expect(terminal.output).toContain("********");
  terminal.input("\r"); // Summary: Confirm
  expect(await result).toEqual({ confirmed: true, decisions: { postgresUrl: "postgres://user:pw@host/db", reinforcement: true } });
  expect(terminal.output).not.toContain("postgres://user:pw@host/db");
});

test("Escape at the intro screen cancels before any other screen is shown", async () => {
  const terminal = new TestTerminal();
  const result = runEngramInitFlow(terminal);
  await tick();
  terminal.input("\x1b");
  expect(await result).toEqual({ confirmed: false });
  expect(terminal.output).not.toContain("PostgreSQL synchronization");
});

test("Ctrl+C while entering the PostgreSQL connection string cancels the whole flow", async () => {
  const terminal = new TestTerminal();
  const result = runEngramInitFlow(terminal);
  await tick();
  terminal.input("\r"); await tick(); // Continue
  terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // PostgreSQL: Yes
  terminal.input("\x03"); // Ctrl+C on the connection-string screen
  expect(await result).toEqual({ confirmed: false });
  expect(terminal.output).not.toContain("Memory reinforcement");
});

test("Cancel on the summary screen reports no confirmation", async () => {
  const terminal = new TestTerminal();
  const result = runEngramInitFlow(terminal);
  await tick();
  terminal.input("\r"); await tick(); // Continue
  terminal.input("\r"); await tick(); // PostgreSQL: No
  terminal.input("\r"); await tick(); // Reinforcement: Yes
  terminal.input("\x1b[B"); terminal.input("\r"); // Summary: Cancel
  expect(await result).toEqual({ confirmed: false });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `bun test src/ui/startup/engram-init.test.ts`
Expected: FAIL — `Cannot find module './engram-init.ts'`.

- [ ] **Step 5: Write the implementation**

```typescript
import { ProcessTerminal, SelectList, Text, matchesKey } from "@earendil-works/pi-tui";
import type { Terminal } from "@earendil-works/pi-tui";
import type { EngramInitDecisions } from "../../contracts/engram-init.ts";
import { MaskedInput } from "./masked-input.ts";
import { startupFrame } from "./frame.ts";
import { accent } from "../basic/theme.ts";

export type EngramInitFlowResult =
  | { readonly confirmed: true; readonly decisions: EngramInitDecisions }
  | { readonly confirmed: false };

const plain = (text: string) => text;
const listTheme = { selectedPrefix: accent, selectedText: accent, description: plain, scrollInfo: plain, noMatch: plain };

async function showIntro(terminal: Terminal): Promise<boolean> {
  const body = new Text([
    "Forge614 Engram stores persistent memory locally on this device.",
    "",
    "Local SQLite + FTS5 storage is always used.",
    "This flow does not create or select a project.",
    "This flow does not detect or configure AI clients.",
  ].join("\n"));
  const list = new SelectList([{ value: "continue", label: "Continue" }], 1, listTheme);
  const tui = startupFrame(terminal, "Forge614 Engram — memory initialization", list, undefined, body);
  let finish!: (value: boolean) => void;
  const selection = new Promise<boolean>(resolve => { finish = resolve; });
  list.onSelect = () => finish(true);
  list.onCancel = () => finish(false);
  tui.addInputListener(data => {
    if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) { finish(false); return { consume: true }; }
    return undefined;
  });
  try { tui.start(); return await selection; }
  finally { tui.stop({ preserveScreen: true }); }
}

async function askPostgresConnectionString(terminal: Terminal): Promise<string | undefined> {
  const input = new MaskedInput({ placeholder: "postgres://user:password@host:5432/database" });
  const body = new Text("Enter the PostgreSQL connection string. It is never shown or logged.");
  const tui = startupFrame(terminal, "PostgreSQL connection string", input, undefined, body);
  let finish!: (value: string | undefined) => void;
  const submission = new Promise<string | undefined>(resolve => { finish = resolve; });
  input.onSubmit = value => finish(value.trim() ? value : undefined);
  input.onEscape = () => finish(undefined);
  tui.addInputListener(data => {
    if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) { finish(undefined); return { consume: true }; }
    return undefined;
  });
  try { tui.start(); return await submission; }
  finally { tui.stop({ preserveScreen: true }); }
}

async function askPostgres(terminal: Terminal): Promise<{ enabled: boolean; connectionString: string | null } | undefined> {
  const list = new SelectList([
    { value: "no", label: "No" },
    { value: "yes", label: "Yes, configure PostgreSQL synchronization" },
  ], 2, listTheme);
  const tui = startupFrame(terminal, "PostgreSQL synchronization", list);
  let finish!: (value: "no" | "yes" | undefined) => void;
  const selection = new Promise<"no" | "yes" | undefined>(resolve => { finish = resolve; });
  list.onSelect = item => finish(item.value as "no" | "yes");
  list.onCancel = () => finish(undefined);
  tui.addInputListener(data => {
    if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) { finish(undefined); return { consume: true }; }
    return undefined;
  });
  let choice: "no" | "yes" | undefined;
  try { tui.start(); choice = await selection; }
  finally { tui.stop({ preserveScreen: true }); }
  if (!choice) return undefined;
  if (choice === "no") return { enabled: false, connectionString: null };
  const connectionString = await askPostgresConnectionString(terminal);
  return connectionString === undefined ? undefined : { enabled: true, connectionString };
}

async function askReinforcement(terminal: Terminal): Promise<boolean | undefined> {
  const list = new SelectList([
    { value: "yes", label: "Yes" },
    { value: "no", label: "No" },
  ], 2, listTheme);
  const body = new Text("Reinforcement makes repeated memories rank higher in search results. It does not verify whether a memory is true.");
  const tui = startupFrame(terminal, "Memory reinforcement", list, undefined, body);
  let finish!: (value: "yes" | "no" | undefined) => void;
  const selection = new Promise<"yes" | "no" | undefined>(resolve => { finish = resolve; });
  list.onSelect = item => finish(item.value as "yes" | "no");
  list.onCancel = () => finish(undefined);
  tui.addInputListener(data => {
    if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) { finish(undefined); return { consume: true }; }
    return undefined;
  });
  try {
    tui.start();
    const choice = await selection;
    return choice === undefined ? undefined : choice === "yes";
  } finally { tui.stop({ preserveScreen: true }); }
}

function summaryText(decisions: EngramInitDecisions): string {
  const postgresLine = decisions.postgresUrl !== null ? "PostgreSQL: enabled" : "PostgreSQL: disabled";
  const reinforcementLine = decisions.reinforcement ? "reinforcement: enabled" : "reinforcement: disabled";
  const initCommand = decisions.postgresUrl !== null
    ? "forge614-engram init --json --postgres-url ********"
    : "forge614-engram init --json";
  const commands = decisions.reinforcement ? [initCommand, "forge614-engram reinforcement-enable"] : [initCommand];
  return [
    "local storage: SQLite + FTS5",
    postgresLine,
    reinforcementLine,
    "",
    "Forge614 Engram commands that will run:",
    ...commands,
    "",
    "No AI client, MCP, hook, or project will be configured by this flow.",
  ].join("\n");
}

async function showSummary(terminal: Terminal, decisions: EngramInitDecisions): Promise<boolean> {
  const body = new Text(summaryText(decisions));
  const list = new SelectList([
    { value: "confirm", label: "Confirm" },
    { value: "cancel", label: "Cancel" },
  ], 2, listTheme);
  const tui = startupFrame(terminal, "Summary", list, undefined, body);
  let finish!: (value: boolean) => void;
  const selection = new Promise<boolean>(resolve => { finish = resolve; });
  list.onSelect = item => finish(item.value === "confirm");
  list.onCancel = () => finish(false);
  tui.addInputListener(data => {
    if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) { finish(false); return { consume: true }; }
    return undefined;
  });
  try { tui.start(); return await selection; }
  finally { tui.stop({ preserveScreen: true }); }
}

/** Drives the Engram memory-initialization screens end to end. Makes no Engram command calls. */
export async function runEngramInitFlow(terminal: Terminal = new ProcessTerminal()): Promise<EngramInitFlowResult> {
  if (!await showIntro(terminal)) return { confirmed: false };
  const postgres = await askPostgres(terminal);
  if (!postgres) return { confirmed: false };
  const reinforcement = await askReinforcement(terminal);
  if (reinforcement === undefined) return { confirmed: false };
  const decisions: EngramInitDecisions = { postgresUrl: postgres.enabled ? postgres.connectionString : null, reinforcement };
  return (await showSummary(terminal, decisions)) ? { confirmed: true, decisions } : { confirmed: false };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test src/ui/startup/engram-init.test.ts`
Expected: PASS — all 6 tests.

- [ ] **Step 7: Commit**

```bash
git add src/ui/startup/frame.ts src/ui/startup/engram-init.ts src/ui/startup/engram-init.test.ts
git commit -m "feat: add the Engram memory-initialization visual flow"
```

---

### Task 5: `requireEngramProduct` argument validation

**Files:**
- Create: `src/app/init-engram.ts`
- Test: `src/app/init-engram.test.ts`

**Interfaces:**
- Produces: `requireEngramProduct(args: string[]): void` (throws on invalid input) — consumed by Task 6.

- [ ] **Step 1: Write the failing tests**

```typescript
import { expect, test } from "bun:test";
import { requireEngramProduct } from "./init-engram.ts";

test("requires --product with a value", () => {
  expect(() => requireEngramProduct([])).toThrow("--product <name>");
  expect(() => requireEngramProduct(["--product"])).toThrow("--product <name>");
});

test("rejects an unsupported product", () => {
  expect(() => requireEngramProduct(["--product", "atlas"])).toThrow('"engram" is supported today');
});

test("rejects extra arguments", () => {
  expect(() => requireEngramProduct(["--product", "engram", "extra"])).toThrow("does not accept");
});

test("accepts exactly --product engram", () => {
  expect(() => requireEngramProduct(["--product", "engram"])).not.toThrow();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/app/init-engram.test.ts`
Expected: FAIL — `Cannot find module './init-engram.ts'`.

- [ ] **Step 3: Write the implementation**

```typescript
const SUPPORTED_PRODUCTS = ["engram"] as const;

/** Validates `forge614-shell init --product <name>` arguments; throws a clear error otherwise. */
export function requireEngramProduct(args: string[]): void {
  const index = args.indexOf("--product");
  if (index === -1 || !args[index + 1]) {
    throw new Error("forge614-shell init requires --product <name>.");
  }
  const product = args[index + 1]!;
  const remaining = [...args];
  remaining.splice(index, 2);
  if (remaining.length) {
    throw new Error(`forge614-shell init does not accept: ${remaining.join(" ")}`);
  }
  if (!SUPPORTED_PRODUCTS.includes(product as (typeof SUPPORTED_PRODUCTS)[number])) {
    throw new Error(`forge614-shell init --product ${product} is not supported. Only "engram" is supported today.`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/app/init-engram.test.ts`
Expected: PASS — all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/init-engram.ts src/app/init-engram.test.ts
git commit -m "feat: validate forge614-shell init --product arguments"
```

---

### Task 6: `runInitCommand` orchestrator

**Files:**
- Modify: `src/app/init-engram.ts`
- Modify: `src/app/init-engram.test.ts`

**Interfaces:**
- Consumes: `requireEngramProduct` from Task 5, `runEngramInitFlow` from Task 4, `applyEngramInit`/`RunEngram` from Task 2.
- Produces: `interface RunInitOptions { readonly terminal?: Terminal; readonly run?: RunEngram; readonly home?: string; readonly env?: NodeJS.ProcessEnv }` and `runInitCommand(args: string[], options?: RunInitOptions): Promise<void>` — consumed by Task 7.

- [ ] **Step 1: Add the failing tests to `src/app/init-engram.test.ts`**

Append to the existing file (keep the imports and tests from Task 5):

```typescript
import type { Terminal } from "@earendil-works/pi-tui";
import { readFile } from "node:fs/promises";
import { runInitCommand } from "./init-engram.ts";

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
// Screen transitions attach a new input handler only after a microtask
// resumes, so consecutive terminal.input() calls need a tick between them
// (same helper src/ui/startup/engram-init.test.ts already uses).
const tick = () => new Promise(resolve => setTimeout(resolve, 25));

test("rejects a missing product before ever starting the terminal UI", async () => {
  const terminal = new TestTerminal();
  await expect(runInitCommand([], { terminal })).rejects.toThrow("--product <name>");
  expect(terminal.output).toBe("");
});

test("rejects a non-interactive terminal", async () => {
  await expect(runInitCommand(["--product", "engram"])).rejects.toThrow("interactive terminal");
});

test("cancelling makes zero Engram calls and sets exit code 130", async () => {
  const terminal = new TestTerminal();
  const calls: string[][] = [];
  process.exitCode = 0; // Bun's process.exitCode setter ignores `undefined`, so `0` is the actual reset value.
  const run = runInitCommand(["--product", "engram"], {
    terminal,
    run: async (command, args) => { calls.push([command, ...args]); return { status: 0, stdout: "{}", stderr: "" }; },
  });
  await tick();
  terminal.input("\x1b"); // Escape on the intro screen
  await run;
  expect(calls).toEqual([]);
  expect(process.exitCode).toBe(130);
  process.exitCode = 0; // reset so this test's exit code doesn't leak into the overall `bun test` process exit status
});

test("confirming with local storage only runs exactly init --json", async () => {
  const terminal = new TestTerminal();
  const calls: string[][] = [];
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async (command, args) => { calls.push([command, ...args]); return { status: 0, stdout: "{}", stderr: "" }; },
  });
  await tick();
  terminal.input("\r"); await tick(); // Continue
  terminal.input("\r"); await tick(); // PostgreSQL: No (default)
  terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // Reinforcement: No
  terminal.input("\r"); // Summary: Confirm (default)
  await run;
  expect(calls).toEqual([["/Users/tester/.forge614/engram/bin/forge614-engram", "init", "--json"]]);
});

test("confirming with PostgreSQL sends the connection string only to Engram, never to the screen", async () => {
  const terminal = new TestTerminal();
  const calls: string[][] = [];
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async (command, args) => { calls.push([command, ...args]); return { status: 0, stdout: "{}", stderr: "" }; },
  });
  await tick();
  terminal.input("\r"); await tick(); // Continue
  terminal.input("\x1b[B"); terminal.input("\r"); await tick(); // PostgreSQL: Yes
  terminal.input("postgres://user:pw@host/db");
  terminal.input("\r"); await tick(); // submit connection string
  terminal.input("\r"); await tick(); // Reinforcement: Yes (default)
  terminal.input("\r"); // Summary: Confirm
  await run;
  expect(calls).toEqual([
    ["/Users/tester/.forge614/engram/bin/forge614-engram", "init", "--json", "--postgres-url", "postgres://user:pw@host/db"],
    ["/Users/tester/.forge614/engram/bin/forge614-engram", "reinforcement-enable"],
  ]);
  expect(terminal.output).not.toContain("postgres://user:pw@host/db");
});

test("an Engram failure is reported, not swallowed as success", async () => {
  const terminal = new TestTerminal();
  const run = runInitCommand(["--product", "engram"], {
    terminal, home: "/Users/tester",
    run: async () => ({ status: 1, stdout: "", stderr: JSON.stringify({ code: "STORAGE_ERROR", error: "No se pudo completar la operación." }) }),
  });
  await tick();
  terminal.input("\r"); await tick();
  terminal.input("\r"); await tick();
  terminal.input("\x1b[B"); terminal.input("\r"); await tick();
  terminal.input("\r");
  await expect(run).rejects.toThrow("No se pudo completar la operación.");
});

test("the init command never imports Shell's normal chat startup modules", async () => {
  const source = await readFile(new URL("./init-engram.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/native-chat|visual-picker|engine-picker/);
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `bun test src/app/init-engram.test.ts`
Expected: FAIL — `runInitCommand` is not exported yet.

- [ ] **Step 3: Extend the implementation**

Append to `src/app/init-engram.ts` (keep `requireEngramProduct` from Task 5):

```typescript
import type { Terminal } from "@earendil-works/pi-tui";
import { runEngramInitFlow } from "../ui/startup/engram-init.ts";
import { applyEngramInit, type RunEngram } from "../infrastructure/forge614-engram.ts";

export interface RunInitOptions {
  readonly terminal?: Terminal;
  readonly run?: RunEngram;
  readonly home?: string;
  readonly env?: NodeJS.ProcessEnv;
}

/** Entry point for `forge614-shell init --product engram`. Makes no Engram call before confirmation. */
export async function runInitCommand(args: string[], options: RunInitOptions = {}): Promise<void> {
  requireEngramProduct(args);
  if (!options.terminal && (!process.stdin.isTTY || !process.stdout.isTTY)) {
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
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/app/init-engram.test.ts`
Expected: PASS — all 11 tests (4 from Task 5 + 7 new).

- [ ] **Step 5: Commit**

```bash
git add src/app/init-engram.ts src/app/init-engram.test.ts
git commit -m "feat: orchestrate the confirmed Engram init flow with correct exit codes"
```

---

### Task 7: Wire `init` into `src/cli.ts`

**Files:**
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `runInitCommand` from Task 6.

- [ ] **Step 1: Add the new branch**

In `src/cli.ts`, the current `uninstall` branch (around line 22) reads:

```javascript
} else if (args.length === 1 && args[0] === "uninstall") {
  try {
    const { uninstallInstalledShell } = await import("./infrastructure/updater.ts");
    await uninstallInstalledShell();
  } catch (error) {
    console.error(`Forge614-Shell uninstall failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
} else if (args.includes("--help") || args.includes("-h")) {
```

Insert a new `init` branch between them:

```javascript
} else if (args.length === 1 && args[0] === "uninstall") {
  try {
    const { uninstallInstalledShell } = await import("./infrastructure/updater.ts");
    await uninstallInstalledShell();
  } catch (error) {
    console.error(`Forge614-Shell uninstall failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
} else if (args[0] === "init") {
  try {
    const { runInitCommand } = await import("./app/init-engram.ts");
    await runInitCommand(args.slice(1));
  } catch (error) {
    console.error(`Forge614-Shell init failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
} else if (args.includes("--help") || args.includes("-h")) {
```

This branch never reaches the existing `parseEngine`/`discoverSelectableEngines`/`chooseStartup` code below it, since it is a separate `else if` arm.

- [ ] **Step 2: Build and smoke-test manually**

Run: `bun run build`
Expected: builds `dist/cli.js` without errors.

Run: `node dist/cli.js init`
Expected: prints `Forge614-Shell init failed: forge614-shell init requires --product <name>.` to stderr and exits non-zero (`echo $?` shows `1`).

Run: `node dist/cli.js init --product atlas`
Expected: prints `Forge614-Shell init failed: forge614-shell init --product atlas is not supported. Only "engram" is supported today.` and exits non-zero.

- [ ] **Step 3: Run the full existing test suite once more**

Run: `bun test`
Expected: PASS — no existing test (including `tests/architecture/layers.test.ts`, `src/app/options.test.ts`, `src/ui/startup/*.test.ts`) regresses.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat: wire forge614-shell init --product engram into the CLI"
```

---

### Task 8: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full check script**

Run: `bun run check`
Expected: typecheck, full test suite, and build all succeed (this is `tsc --noEmit && bun test && bun build ...`). Confirm the reported test count grew from the 133 tests documented in `docs/en/06-release-1.0.0-bundle-installer.md` §10 by the number of new tests added in Tasks 2–6 (6 + 6 + 6 + 4 + 7 = 29 new tests).

- [ ] **Step 2: Check the working tree is clean**

Run: `git status --short`
Expected: no output — every change from Tasks 1–7 was already committed. If anything is unstaged (e.g. the spec/plan docs written during brainstorming), stage and commit it now:

```bash
git add docs/superpowers/specs/2026-09-20-shell-engram-init-flow-design.md docs/superpowers/plans/2026-09-20-shell-engram-init-flow.md
git commit -m "docs: add the Engram init flow spec and implementation plan"
```

- [ ] **Step 3: Check the full diff against the previous release tag for whitespace errors**

Run: `git diff 1.0.6 --check`
Expected: no output (no whitespace errors) — this checks the same lines the release below will ship.

---

### Task 9: Bump the version and push to `origin main`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Bump the version**

In `package.json`, change:

```json
  "version": "1.0.6",
```

to:

```json
  "version": "1.1.0",
```

- [ ] **Step 2: Rebuild and re-run the full check with the new version**

Run: `bun run check`
Expected: passes; `forge614-shell --version` (after `bun run build`) prints `forge614-shell 1.1.0`.

Run: `node dist/cli.js --version`
Expected: `forge614-shell 1.1.0`

- [ ] **Step 3: Commit the version bump**

```bash
git add package.json
git commit -m "release: prepare 1.1.0"
```

- [ ] **Step 4: Push to origin main**

Run: `git push origin main`
Expected: pushes cleanly (no rejected non-fast-forward — if `origin/main` moved, stop and report it instead of force-pushing).

---

### Task 10: Publish the GitHub Release as Latest

Follows the exact maintainer procedure in `docs/en/06-release-1.0.0-bundle-installer.md` §8, steps 4–7 (steps 1–3 — Engines already published, version bump, `bun run check` — are done in Task 9).

**Files:** none (packaging and publishing only).

- [ ] **Step 1: Generate the standalone bundle and checksum**

Run: `bun run bundle:release`
Expected: creates `dist/release/forge614-shell-1.1.0.tar.gz` and `dist/release/forge614-shell-1.1.0.tar.gz.sha256`.

Run: `ls dist/release/`
Expected: both files listed.

- [ ] **Step 2: Tag and push the numeric tag**

```bash
git tag 1.1.0
git push origin 1.1.0
```

Expected: `Forge614 Shell 1.1.0` becomes resolvable as a tag at `https://github.com/jotredev/forge614-shell/releases/tag/1.1.0` once the release below is created.

- [ ] **Step 3: Create the GitHub Release with all 3 required assets, marked Latest**

```bash
gh release create 1.1.0 \
  dist/release/forge614-shell-1.1.0.tar.gz \
  dist/release/forge614-shell-1.1.0.tar.gz.sha256 \
  scripts/install.sh \
  --repo jotredev/forge614-shell \
  --title "Forge614 Shell v1.1.0" \
  --notes "Adds forge614-shell init --product engram: a visual flow for Forge614 Engram's memory initialization (local SQLite + FTS5, optional PostgreSQL synchronization, optional reinforcement), applied only after confirmation through Engram's public non-interactive CLI." \
  --latest
```

`gh release create` marks the release as the repository's Latest release by default unless `--prerelease` or `--draft` is passed (neither is passed here), matching the confirmed decision to publish this as Latest immediately.

- [ ] **Step 4: Verify the public installer resolves the new release**

Run: `curl -fsSL https://api.github.com/repos/jotredev/forge614-shell/releases/latest | grep '"tag_name"'`
Expected: `"tag_name": "1.1.0"`

Run: `gh release view 1.1.0 --repo jotredev/forge614-shell --json isLatest -q .isLatest`
Expected: `true`

- [ ] **Step 5: Report results**

Summarize: the final commit hash pushed to `origin main`, the pushed tag (`1.1.0`), the GitHub Release URL, confirmation that it is marked Latest, and the full `bun run check` output from Task 9. This is the end of the plan — no further steps.
