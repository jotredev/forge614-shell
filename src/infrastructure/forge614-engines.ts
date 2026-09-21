import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AvailableEngine } from "../contracts/available-engine.ts";
import type { McpCapableAgent } from "../contracts/mcp-agent.ts";

type DetectRun = (command: string, args: string[]) => Promise<{ status: number | null; stdout: string; stderr: string }>;

interface EnginesAgent {
  id?: unknown;
  label?: unknown;
  installed?: unknown;
  executable?: unknown;
}

interface EnginesReport {
  schemaVersion?: unknown;
  agents?: unknown;
}

interface EnginesErrorPayload {
  error?: { code?: unknown; message?: unknown };
}

interface McpPlanPayload {
  plan?: { planId?: unknown; noop?: unknown; writes?: unknown };
}

interface McpApplyPayload {
  result?: { applied?: unknown; changedFiles?: unknown };
}

const supportedShellAdapters: Record<string, AvailableEngine["id"]> = {
  "claude-code": "claude",
  codex: "codex",
};

const defaultRun: DetectRun = async (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
};

function validateReport(value: unknown): EnginesReport {
  if (!value || typeof value !== "object") throw new Error("Forge614 Engines returned an invalid detection result.");
  const report = value as EnginesReport;
  if (report.schemaVersion !== 1) throw new Error("Forge614 Engines is incompatible with this Shell version. Reinstall Forge614 Shell to repair its required dependency.");
  if (!Array.isArray(report.agents)) throw new Error("Forge614 Engines returned an invalid detection result.");
  return report;
}

function enginesBinary(home: string, env?: NodeJS.ProcessEnv): string {
  const forgeHome = env?.FORGE614_HOME ?? join(home, ".forge614");
  return join(forgeHome, "engines", "bin", "forge614-engines");
}

function toSelectableAgent(agent: EnginesAgent): AvailableEngine | undefined {
  if (agent.installed !== true || typeof agent.id !== "string" || typeof agent.executable !== "string" || !agent.executable) return undefined;
  const id = supportedShellAdapters[agent.id];
  if (!id) return undefined;
  return { id, label: typeof agent.label === "string" && agent.label ? agent.label : agent.id, executable: agent.executable };
}

/**
 * Reads the versioned public detection contract from the Engines dependency.
 * Shell deliberately does not search PATH or maintain a second detector here.
 */
export async function discoverSelectableEngines(options: {
  home?: string;
  env?: NodeJS.ProcessEnv;
  run?: DetectRun;
} = {}): Promise<AvailableEngine[]> {
  const home = options.home ?? homedir();
  const binary = enginesBinary(home, options.env);
  const result = await (options.run ?? defaultRun)(binary, ["detect"]);
  if (result.status !== 0) {
    throw new Error("Forge614 Engines is unavailable. Reinstall Forge614 Shell to repair its required dependency.");
  }
  let report: EnginesReport;
  try {
    report = validateReport(JSON.parse(result.stdout));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Forge614 Engines")) throw error;
    throw new Error("Forge614 Engines returned an invalid detection result.");
  }
  return (report.agents as EnginesAgent[]).map(toSelectableAgent).filter((agent): agent is AvailableEngine => Boolean(agent));
}

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

function parseEnginesError(stdout: string, stderr: string): string | undefined {
  for (const text of [stdout, stderr]) {
    try {
      const payload = JSON.parse(text) as EnginesErrorPayload;
      if (payload.error && typeof payload.error.message === "string" && payload.error.message) return payload.error.message;
    } catch { /* try the next stream */ }
  }
  return undefined;
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
    throw new Error(parseEnginesError(result.stdout, result.stderr) ?? `forge614-engines ${label} failed.`);
  }
  if (parsed && typeof parsed === "object" && "error" in (parsed as Record<string, unknown>)) {
    throw new Error(parseEnginesError(result.stdout, result.stderr) ?? `forge614-engines ${label} failed.`);
  }
  if (result.status !== 0) {
    throw new Error(parseEnginesError(result.stdout, result.stderr) ?? `forge614-engines ${label} failed.`);
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
