import { ProcessTerminal } from "@earendil-works/pi-tui";
import type { Terminal } from "@earendil-works/pi-tui";
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

function outcomeLine(outcome: MemoryOutcome): string {
  if (outcome.status === "configured") return `${outcome.label}: configured — MCP server and memory instructions are installed and active`;
  if (outcome.status === "prepared") return `${outcome.label}: ready — ${outcome.detail}`;
  if (outcome.status === "unsupported") return `${outcome.label}: partially configured — ${outcome.detail}`;
  if (outcome.status === "blocked") return `${outcome.label}: blocked — ${outcome.detail}`;
  if (outcome.status === "skipped") return `${outcome.label}: skipped`;
  return `${outcome.label}: could not be configured — ${outcome.detail}`;
}

/**
 * Human phrasing for a structurally correct install whose hook runtime evidence has not been
 * observed yet. Never claims what already happened (Shell cannot know whether Codex has or has not
 * trusted the hook) and never asks the person to rerun anything — it only describes what may
 * happen the next time the assistant is used normally.
 */
function preparedDetail(label: string, runtimeStatus: MemoryVerification["hook"]["runtimeStatus"]): string {
  if (runtimeStatus.kind === "needs-user-trust") {
    return `${label} memory integration is ready. When you next start ${label} normally, ${label} may ask you once to approve the Forge614 memory hook.`;
  }
  return `${label} memory integration is ready. It finishes confirming itself the next time you use ${label} normally.`;
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
): MemoryOutcome {
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
    return { label, status: "failed", detail: `Forge614 Engines could not confirm any memory integration for ${label}.` };
  }
  if (!verification.instructions.supported) {
    return { label, status: "unsupported", detail: `${label} has no built-in way to automatically load memory instructions yet; the MCP server and memory search still work.` };
  }
  if (!verification.mcp.present || !verification.instructions.present) {
    return { label, status: "failed", detail: `Forge614 Engines could not confirm full memory integration for ${label}.` };
  }
  const hookPending = verification.hook.runtimeStatus.kind === "pending-runtime-verification" || verification.hook.runtimeStatus.kind === "needs-user-trust";
  if (hookPending) {
    return { label, status: "prepared", detail: preparedDetail(label, verification.hook.runtimeStatus) };
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
  options: { home?: string; env?: NodeJS.ProcessEnv; enginesRun?: RunEngram; chooseMemoryAgents?: ChooseMemoryAgents },
): Promise<MemorySetupResult> {
  let agents: McpCapableAgent[];
  try {
    agents = await showWorking(screen, "Forge614 Engram", "Detecting compatible AI assistants…", () =>
      discoverMcpCapableAgents({ home: options.home, env: options.env, run: options.enginesRun }));
  } catch (error) {
    return { outcomes: [], applied: false, notice: `Memory setup could not be offered: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (agents.length === 0) {
    return { outcomes: [], applied: false, notice: "No compatible AI assistants were found to configure with memory integration." };
  }
  const pickAgents = options.chooseMemoryAgents ?? chooseMemoryAgents;
  const selectedIds = await pickAgents(agents, screen);
  if (selectedIds === undefined) {
    return { outcomes: agents.map(agent => ({ label: agent.label, status: "skipped" as const })), applied: false, notice: "Memory setup was skipped." };
  }
  if (selectedIds.length === 0) {
    return { outcomes: agents.map(agent => ({ label: agent.label, status: "skipped" as const })), applied: false, notice: "No assistant was selected. No memory integration was configured." };
  }
  let applied = false;
  const selectedSet = new Set(selectedIds);
  const outcomeMap = new Map<string, MemoryOutcome>();
  const planned: { agent: McpCapableAgent; plan: MemoryInstallPlan }[] = [];
  for (const agent of agents) {
    if (!selectedSet.has(agent.id)) { outcomeMap.set(agent.id, { label: agent.label, status: "skipped" }); continue; }
    try {
      const plan = await showWorking(screen, "Forge614 Engram", `Planning memory integration for ${agent.label}…`, () =>
        planMemoryInstall({ agentId: agent.id, home: options.home, env: options.env, run: options.enginesRun }));
      planned.push({ agent, plan });
    } catch (error) {
      outcomeMap.set(agent.id, { label: agent.label, status: "failed", detail: error instanceof Error ? error.message : String(error) });
    }
  }
  const pending = planned.filter(p => !p.plan.noop);
  const resolved = planned.filter(p => p.plan.noop);
  for (const r of resolved) {
    try {
      const verification = await showWorking(screen, "Forge614 Engram", `Verifying ${r.agent.label}…`, () =>
        verifyMemoryIntegration({ agentId: r.agent.id, home: options.home, env: options.env, run: options.enginesRun }));
      outcomeMap.set(r.agent.id, classifyMemoryOutcome(r.agent.label, r.plan, verification));
    } catch (error) {
      outcomeMap.set(r.agent.id, { label: r.agent.label, status: "failed", detail: error instanceof Error ? error.message : String(error) });
    }
  }
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
    const confirmed = await showMemoryPreviewConfirm(previewItems, screen);
    if (!confirmed) {
      for (const p of pending) outcomeMap.set(p.agent.id, { label: p.agent.label, status: "skipped" });
    } else {
      for (const p of pending) {
        try {
          const applyResult = await showWorking(screen, "Forge614 Engram", `Applying memory integration for ${p.agent.label}…`, () =>
            applyEnginesPlan({ planId: p.plan.planId, home: options.home, env: options.env, run: options.enginesRun }));
          if (!applyResult.applied) {
            outcomeMap.set(p.agent.id, { label: p.agent.label, status: "failed", detail: "Forge614 Engines reported the change was not applied." });
            continue;
          }
          const verification = await showWorking(screen, "Forge614 Engram", `Verifying ${p.agent.label}…`, () =>
            verifyMemoryIntegration({ agentId: p.agent.id, home: options.home, env: options.env, run: options.enginesRun }));
          const outcome = classifyMemoryOutcome(p.agent.label, p.plan, verification);
          // Only a plan this run actually wrote justifies the "restart your assistant" hint.
          if (outcome.status === "configured" || outcome.status === "prepared" || outcome.status === "unsupported") applied = true;
          outcomeMap.set(p.agent.id, outcome);
        } catch (error) {
          outcomeMap.set(p.agent.id, { label: p.agent.label, status: "failed", detail: error instanceof Error ? error.message : String(error) });
        }
      }
    }
  }
  return { outcomes: agents.map(agent => outcomeMap.get(agent.id)!), applied };
}

/**
 * Entry point for `forge614-shell init --product engram`. Makes no Engram call before confirmation.
 * Owns one continuous alternate-screen session from the intro screen to the final result — no
 * step here ever prints to the plain terminal or opens a second alt-screen.
 */
export async function runInitCommand(args: string[], options: RunInitOptions = {}): Promise<void> {
  requireEngramProduct(args);
  // Explicit `interactive` wins; an injected terminal implies interactive; otherwise the real TTYs decide.
  const interactive = options.interactive ?? (options.terminal ? true : Boolean(process.stdin.isTTY && process.stdout.isTTY));
  if (!interactive) {
    throw new Error("forge614-shell init requires an interactive terminal.");
  }
  const screen = new EngramFlowScreen(options.terminal ?? new ProcessTerminal(), options.version);
  screen.start();
  try {
    const flow = await runEngramInitFlow(screen);
    if (!flow.confirmed) {
      process.exitCode = 130;
      showResult(screen, "Cancelled", ["Cancelled. No changes were made."]);
      return;
    }
    await showWorking(screen, "Forge614 Engram", "Initializing local memory…", () =>
      applyEngramInit(flow.decisions, { run: options.run, home: options.home, env: options.env }));
    const resultLines = ["Forge614 Engram memory initialization is complete."];
    try {
      const { outcomes, applied, notice } = await runMemorySetupStep(screen, { home: options.home, env: options.env, enginesRun: options.enginesRun, chooseMemoryAgents: options.chooseMemoryAgents });
      if (notice) resultLines.push("", notice);
      for (const outcome of outcomes) resultLines.push(outcomeLine(outcome));
      // Nothing was written this run (everything was already configured, or the preview was
      // cancelled) means there is nothing new for an assistant to reload.
      if (applied) {
        resultLines.push("", "Close and reopen each configured assistant's session so it loads the new MCP server and memory instructions.");
      }
    } catch (error) {
      resultLines.push("", `Memory setup could not be completed: ${error instanceof Error ? error.message : String(error)}`);
    }
    showResult(screen, "Result", resultLines);
  } finally {
    screen.stop({ preserveScreen: true });
  }
}
