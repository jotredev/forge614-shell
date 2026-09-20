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
