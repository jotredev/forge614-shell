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
