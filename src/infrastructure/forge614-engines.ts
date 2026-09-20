import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AvailableEngine } from "../contracts/available-engine.ts";

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
  const forgeHome = options.env?.FORGE614_HOME ?? join(home, ".forge614");
  const binary = join(forgeHome, "engines", "bin", "forge614-engines");
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
