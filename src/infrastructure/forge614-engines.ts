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
