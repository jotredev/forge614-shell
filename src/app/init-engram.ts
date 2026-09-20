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
