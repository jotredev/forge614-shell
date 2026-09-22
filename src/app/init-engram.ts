import { ProcessTerminal } from "@earendil-works/pi-tui";
import type { Terminal } from "@earendil-works/pi-tui";
import { classifyDebugKey, createInitDebugLog } from "./init-debug-log.ts";
import type { InitDebugLog } from "./init-debug-log.ts";
import { runEngramInitFlow } from "../ui/startup/engram-init.ts";
import { chooseMemoryAgents, showMemoryPreviewConfirm } from "../ui/startup/memory-setup.ts";
import type { MemoryPreviewItem } from "../ui/startup/memory-setup.ts";
import { EngramFlowScreen } from "../ui/startup/frame.ts";
import { showResult, showWorking } from "../ui/startup/engram-progress.ts";
import { applyEngramInit, type RunEngram } from "../infrastructure/forge614-engram.ts";
import {
  applyEnginesPlan, discoverMcpCapableAgents, planMemoryInstall, verifyMemoryIntegration,
  type MemoryComponentStatus, type MemoryInstallPlan, type MemoryVerification,
} from "../infrastructure/forge614-engines.ts";
import type { McpCapableAgent } from "../contracts/mcp-agent.ts";
import { getCatalog } from "../i18n/index.ts";
import type { Catalog, Locale } from "../i18n/index.ts";
import { describeError, ShellError } from "../shell-error.ts";

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
    throw new ShellError("init-requires-product");
  }
  if (remaining.length) {
    throw new ShellError("init-unexpected-args", { args: remaining.join(" ") });
  }
  if (!SUPPORTED_PRODUCTS.includes(product as (typeof SUPPORTED_PRODUCTS)[number])) {
    throw new ShellError("init-unsupported-product", { product });
  }
}

/** Matches the real `chooseMemoryAgents`'s signature exactly, so a test double is interchangeable. */
type ChooseMemoryAgents = typeof chooseMemoryAgents;

export interface RunInitOptions {
  readonly terminal?: Terminal;
  /** Overrides the real TTY check; the sole source of truth for the interactivity gate when given. */
  readonly interactive?: boolean;
  readonly run?: RunEngram;
  readonly enginesRun?: RunEngram;
  readonly home?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly version?: string;
  /**
   * Injects the interactive assistant picker for tests, so a genuine picker-layer exception can be
   * exercised without a global module mock; defaults to the real `chooseMemoryAgents`. Never set in
   * production.
   */
  readonly chooseMemoryAgents?: ChooseMemoryAgents;
  /**
   * Real `process.stdin` by default; injectable so tests can simulate stdin actually closing
   * (EOF/pipe close) without touching the global `process.stdin`. Distinct from a Ctrl-D
   * keypress, which each screen already treats as an in-band cancel key.
   */
  readonly stdin?: StdinLifecycle;
  /**
   * The already-resolved locale for this run; defaults to "en". `runInitCommand` never resolves a
   * locale itself (no preferences read, no interactive language selector) — that resolution lives
   * in `src/app/language-gate.ts` and is the caller's (`cli.ts`'s) job, so this function stays
   * deterministic and side-effect-free for a given set of options.
   */
  readonly locale?: Locale;
}

/** The minimal slice of `process.stdin`'s lifecycle this module needs to detect a real close. */
interface StdinLifecycle {
  on(event: "end" | "close", listener: () => void): void;
  off(event: "end" | "close", listener: () => void): void;
}

export type MemoryOutcomeStatus = "configured" | "prepared" | "blocked" | "unsupported" | "failed" | "skipped";

interface MemoryOutcome {
  readonly label: string;
  readonly status: MemoryOutcomeStatus;
  readonly detail?: string;
}

interface MemorySetupResult {
  readonly outcomes: MemoryOutcome[];
  /** True only when this run's own `apply` wrote something that then verified as configured, prepared, or unsupported. */
  readonly applied: boolean;
  /** A short human notice for when the step ended before producing any per-agent outcome (no assistants found, setup skipped, or a detection failure). Folded into the final result screen instead of printed immediately. */
  readonly notice?: string;
}

function outcomeLine(outcome: MemoryOutcome, t: Catalog["memorySetup"]): string {
  if (outcome.status === "configured") return t.outcomeConfigured({ agent: outcome.label });
  if (outcome.status === "prepared") return t.outcomePrepared({ agent: outcome.label, detail: outcome.detail ?? "" });
  if (outcome.status === "unsupported") return t.outcomeUnsupported({ agent: outcome.label, detail: outcome.detail ?? "" });
  if (outcome.status === "blocked") return t.outcomeBlocked({ agent: outcome.label, detail: outcome.detail ?? "" });
  if (outcome.status === "skipped") return t.outcomeSkipped({ agent: outcome.label });
  return t.outcomeFailed({ agent: outcome.label, detail: outcome.detail ?? "" });
}

/**
 * Human phrasing for a structurally correct install whose hook runtime evidence has not been
 * observed yet. Never claims what already happened (Shell cannot know whether Codex has or has not
 * trusted the hook) and never asks the person to rerun anything — it only describes what may
 * happen the next time the assistant is used normally.
 */
function preparedDetail(label: string, runtimeStatus: MemoryVerification["hook"]["runtimeStatus"], t: Catalog["memorySetup"]): string {
  if (runtimeStatus.kind === "needs-user-trust") {
    return t.preparedNeedsTrust({ agent: label });
  }
  return t.preparedPending({ agent: label });
}

/**
 * Turns one agent's plan (if any — a fully pre-existing, noop install has none) and verification
 * into the outcome Shell reports. Never calls anything, never waits for a native session, never
 * asks the person to rerun a command. Runtime hook evidence is informational: its absence never
 * turns a structurally correct install into a failure — see Global Constraints.
 */
export function classifyMemoryOutcome(
  label: string,
  plan: MemoryInstallPlan | undefined,
  verification: MemoryVerification,
  locale: Locale = "en",
): MemoryOutcome {
  const t = getCatalog(locale).memorySetup;
  // A real conflict on ANY component — MCP, instructions, or the hook — always wins. Never let an
  // already-present MCP server or instructions set mask a genuinely blocked hook (or vice versa):
  // Shell must never report "configured" or "ready" while Engines' own plan says something was
  // refused due to a conflict it could not resolve.
  const blockedComponent = plan
    ? ([plan.mcp.status, plan.instructions.status, plan.hook.status].find(status => status.kind === "blocked") as
        Extract<MemoryComponentStatus, { kind: "blocked" }> | undefined)
    : undefined;
  if (blockedComponent) {
    return { label, status: "blocked", detail: blockedComponent.details };
  }
  if (verification.overallStatus === "absent") {
    return { label, status: "failed", detail: t.verificationAbsent({ agent: label }) };
  }
  if (!verification.instructions.supported) {
    return { label, status: "unsupported", detail: t.instructionsUnsupported({ agent: label }) };
  }
  if (!verification.mcp.present || !verification.instructions.present) {
    return { label, status: "failed", detail: t.verificationIncomplete({ agent: label }) };
  }
  const hookPending = verification.hook.runtimeStatus.kind === "pending-runtime-verification" || verification.hook.runtimeStatus.kind === "needs-user-trust";
  if (hookPending) {
    return { label, status: "prepared", detail: preparedDetail(label, verification.hook.runtimeStatus, t) };
  }
  return { label, status: "configured" };
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
  screen: EngramFlowScreen,
  options: { home?: string; env?: NodeJS.ProcessEnv; enginesRun?: RunEngram; chooseMemoryAgents?: ChooseMemoryAgents; locale: Locale; signal?: AbortSignal },
): Promise<MemorySetupResult> {
  const t = getCatalog(options.locale).memorySetup;
  const aborted = () => Boolean(options.signal?.aborted);
  let agents: McpCapableAgent[];
  try {
    agents = await showWorking(screen, "Forge614 Engram", t.detecting, () =>
      discoverMcpCapableAgents({ home: options.home, env: options.env, run: options.enginesRun }));
  } catch (error) {
    return { outcomes: [], applied: false, notice: t.detectionFailed({ message: describeError(error, options.locale) }) };
  }
  // Stdin closed for real while detection was in flight: never start the interactive picker or
  // any further Engines call — the caller (runInitCommand) already owns reporting this.
  if (aborted()) return { outcomes: [], applied: false };
  if (agents.length === 0) {
    return { outcomes: [], applied: false, notice: t.noAssistantsFound };
  }
  const pickAgents = options.chooseMemoryAgents ?? chooseMemoryAgents;
  const selectedIds = await pickAgents(agents, screen, options.locale, options.signal);
  if (aborted()) return { outcomes: [], applied: false };
  if (selectedIds === undefined) {
    return { outcomes: agents.map(agent => ({ label: agent.label, status: "skipped" as const })), applied: false, notice: t.setupSkipped };
  }
  if (selectedIds.length === 0) {
    return { outcomes: agents.map(agent => ({ label: agent.label, status: "skipped" as const })), applied: false, notice: t.noAssistantSelected };
  }
  let applied = false;
  const selectedSet = new Set(selectedIds);
  const outcomeMap = new Map<string, MemoryOutcome>();
  const planned: { agent: McpCapableAgent; plan: MemoryInstallPlan }[] = [];
  for (const agent of agents) {
    if (aborted()) return { outcomes: [], applied: false };
    if (!selectedSet.has(agent.id)) { outcomeMap.set(agent.id, { label: agent.label, status: "skipped" }); continue; }
    try {
      const plan = await showWorking(screen, "Forge614 Engram", t.planning({ agent: agent.label }), () =>
        planMemoryInstall({ agentId: agent.id, home: options.home, env: options.env, run: options.enginesRun }));
      planned.push({ agent, plan });
    } catch (error) {
      outcomeMap.set(agent.id, { label: agent.label, status: "failed", detail: describeError(error, options.locale) });
    }
  }
  if (aborted()) return { outcomes: [], applied: false };
  const pending = planned.filter(p => !p.plan.noop);
  const resolved = planned.filter(p => p.plan.noop);
  for (const r of resolved) {
    if (aborted()) return { outcomes: [], applied: false };
    try {
      const verification = await showWorking(screen, "Forge614 Engram", t.verifying({ agent: r.agent.label }), () =>
        verifyMemoryIntegration({ agentId: r.agent.id, home: options.home, env: options.env, run: options.enginesRun }));
      outcomeMap.set(r.agent.id, classifyMemoryOutcome(r.agent.label, r.plan, verification, options.locale));
    } catch (error) {
      outcomeMap.set(r.agent.id, { label: r.agent.label, status: "failed", detail: describeError(error, options.locale) });
    }
  }
  if (aborted()) return { outcomes: [], applied: false };
  if (pending.length > 0) {
    const blockedAgents = agents.filter(agent => selectedSet.has(agent.id) && outcomeMap.get(agent.id)?.status === "failed");
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
    const confirmed = await showMemoryPreviewConfirm(previewItems, screen, options.locale, options.signal);
    if (aborted()) return { outcomes: [], applied: false };
    if (!confirmed) {
      for (const p of pending) outcomeMap.set(p.agent.id, { label: p.agent.label, status: "skipped" });
    } else {
      for (const p of pending) {
        if (aborted()) return { outcomes: [], applied: false };
        try {
          const applyResult = await showWorking(screen, "Forge614 Engram", t.applying({ agent: p.agent.label }), () =>
            applyEnginesPlan({ planId: p.plan.planId, home: options.home, env: options.env, run: options.enginesRun }));
          if (!applyResult.applied) {
            outcomeMap.set(p.agent.id, { label: p.agent.label, status: "failed", detail: t.applyNotApplied });
            continue;
          }
          if (aborted()) return { outcomes: [], applied: false };
          const verification = await showWorking(screen, "Forge614 Engram", t.verifying({ agent: p.agent.label }), () =>
            verifyMemoryIntegration({ agentId: p.agent.id, home: options.home, env: options.env, run: options.enginesRun }));
          const outcome = classifyMemoryOutcome(p.agent.label, p.plan, verification, options.locale);
          // Only a plan this run actually wrote justifies the "restart your assistant" hint.
          if (outcome.status === "configured" || outcome.status === "prepared" || outcome.status === "unsupported") applied = true;
          outcomeMap.set(p.agent.id, outcome);
        } catch (error) {
          outcomeMap.set(p.agent.id, { label: p.agent.label, status: "failed", detail: describeError(error, options.locale) });
        }
      }
    }
  }
  return { outcomes: agents.map(agent => outcomeMap.get(agent.id)!), applied };
}

/**
 * Entry point for `forge614-shell init --product engram`. Makes no Engram call before confirmation.
 * Owns one continuous alternate-screen session from the intro screen to the final result — no
 * step here ever prints to the plain terminal or opens a second alt-screen. Never returns silently:
 * a failure to enter the alternate screen, or stdin closing for real while a screen is waiting on
 * input, always ends in a clear message on the plain terminal and a non-zero exit code.
 */
/**
 * Prints exactly one line to the plain terminal naming the debug log's path, and only when
 * debugging actually produced a file. Callers must only call this once the alternate screen has
 * already exited — never while it is still active, for the same reason the log itself never
 * writes to stdout/stderr: that buffer is shared with the TUI's differential renderer.
 */
function announceDebugLogPath(debugLog: InitDebugLog): void {
  if (!debugLog.path) return;
  try { process.stderr.write(`[forge614-shell] init debug log: ${debugLog.path}\n`); } catch { /* best effort */ }
}

export async function runInitCommand(args: string[], options: RunInitOptions = {}): Promise<void> {
  requireEngramProduct(args);
  const locale = options.locale ?? "en";
  const t = getCatalog(locale);
  const debugLog = createInitDebugLog(options.env ?? process.env, options.home);
  debugLog.event("stdin-state", { isTTY: Boolean(process.stdin.isTTY), isRaw: Boolean(process.stdin.isRaw) });
  debugLog.event("stdout-state", { isTTY: Boolean(process.stdout.isTTY) });
  // Explicit `interactive` wins; an injected terminal implies interactive; otherwise the real TTYs decide.
  const interactive = options.interactive ?? (options.terminal ? true : Boolean(process.stdin.isTTY && process.stdout.isTTY));
  if (!interactive) {
    debugLog.event("terminate", { reason: "not-interactive" });
    throw new Error(t.startup.requiresInteractiveTerminal);
  }

  const terminal = options.terminal ?? new ProcessTerminal();
  const screen = new EngramFlowScreen(terminal, options.version, locale);

  try {
    screen.start();
    debugLog.event("alt-screen-enter");
  } catch (error) {
    // `beforeTerminalStart()` writes the alt-screen escape sequence before the terminal's own
    // `start()` (raw-mode setup) can throw, so a partially-entered alt screen can already be
    // active here. Never let that state persist: some terminal emulators auto-restore the main
    // buffer once this process exits, which would silently swallow both the alt-screen content
    // and any error printed afterward while still "inside" it. Force a clean exit first.
    const message = describeError(error, locale);
    debugLog.event("terminate", { reason: "start-failed" });
    try {
      screen.stop();
    } catch {
      try { terminal.write("\x1b[?1049l\x1b[?25h"); } catch { /* best effort: nothing more to try */ }
    }
    process.exitCode = 1;
    announceDebugLogPath(debugLog);
    throw new Error(t.result.startFailed({ message }));
  }

  const stdin = options.stdin ?? process.stdin;
  // Drives cancellation explicitly: every screen and every Engram/Engines-calling step below
  // checks `abortController.signal`, so a real stdin close propagates as an actual cancellation
  // (stop asking, stop calling out, remove listeners) rather than just losing a race while the
  // flow keeps running unobserved in the background.
  const abortController = new AbortController();
  let resolveStdinClosed!: () => void;
  const stdinClosed = new Promise<"stdin-closed">(resolve => { resolveStdinClosed = () => resolve("stdin-closed"); });
  const onStdinEnd = () => { debugLog.event("stdin-closed"); abortController.abort(); resolveStdinClosed(); };
  stdin.on("end", onStdinEnd);
  stdin.on("close", onStdinEnd);
  const removeKeyDebugListener = screen.tui.addInputListener(data => {
    debugLog.event("input", { key: classifyDebugKey(data) });
    return undefined; // Observes only; never intercepts real key handling.
  });
  const onSignal = (name: "SIGINT" | "SIGTERM") => () => debugLog.event("signal", { name });
  const sigintHandler = onSignal("SIGINT");
  const sigtermHandler = onSignal("SIGTERM");
  process.once("SIGINT", sigintHandler);
  process.once("SIGTERM", sigtermHandler);

  const runFlow = async (): Promise<"completed" | "aborted"> => {
    const signal = abortController.signal;
    const flow = await runEngramInitFlow(screen, locale, signal);
    if (signal.aborted) return "aborted";
    if (!flow.confirmed) {
      process.exitCode = 130;
      showResult(screen, t.result.cancelledTitle, [t.result.cancelledBody]);
      return "completed";
    }
    await showWorking(screen, "Forge614 Engram", t.memorySetup.initializing, () =>
      applyEngramInit(flow.decisions, { run: options.run, home: options.home, env: options.env }));
    if (signal.aborted) return "aborted";
    const resultLines = [t.result.initComplete];
    try {
      const { outcomes, applied, notice } = await runMemorySetupStep(screen, { home: options.home, env: options.env, enginesRun: options.enginesRun, chooseMemoryAgents: options.chooseMemoryAgents, locale, signal });
      if (signal.aborted) return "aborted";
      if (notice) resultLines.push("", notice);
      for (const outcome of outcomes) resultLines.push(outcomeLine(outcome, t.memorySetup));
      // Nothing was written this run (everything was already configured, or the preview was
      // cancelled) means there is nothing new for an assistant to reload.
      if (applied) {
        resultLines.push("", t.result.restartHint);
      }
    } catch (error) {
      if (signal.aborted) return "aborted";
      resultLines.push("", t.result.memorySetupFailed({ message: describeError(error, locale) }));
    }
    showResult(screen, t.result.resultTitle, resultLines);
    return "completed";
  };

  try {
    const runFlowPromise = runFlow();
    const outcome = await Promise.race([runFlowPromise, stdinClosed]);
    if (outcome === "stdin-closed") {
      process.exitCode = 1;
      showResult(screen, t.result.stdinClosedTitle, t.result.stdinClosedBody.split("\n"));
      debugLog.event("terminate", { reason: "stdin-closed", exitCode: 1 });
      // Wait for the losing flow to actually observe the abort and settle — it must never touch
      // the screen (or call Engram/Engines) after this point, including after cleanup below.
      await runFlowPromise;
    } else {
      debugLog.event("terminate", { reason: "completed", exitCode: Number(process.exitCode ?? 0) });
    }
  } finally {
    stdin.off("end", onStdinEnd);
    stdin.off("close", onStdinEnd);
    removeKeyDebugListener();
    process.removeListener("SIGINT", sigintHandler);
    process.removeListener("SIGTERM", sigtermHandler);
    // No `preserveScreen`: this prints the last rendered screen into the normal terminal buffer
    // before exiting alt-screen mode, so the result actually stays visible — `preserveScreen: true`
    // only switches buffers, which discards the alt-screen content the moment the terminal restores
    // whatever was on the main buffer before this run started.
    screen.stop();
    debugLog.event("alt-screen-exit");
    // Only now — the alternate screen has already exited, so this is the plain terminal, not the
    // shared buffer the TUI was just rendering into.
    announceDebugLogPath(debugLog);
  }
}
