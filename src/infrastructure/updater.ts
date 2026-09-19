import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

type Spawn = (command: string, args: string[], options?: { stdio?: "inherit" }) => { status: number | null; stderr?: string | Buffer; error?: Error };

export async function updateInstalledShell(options: { installer?: string; spawn?: Spawn } = {}): Promise<void> {
  const installer = options.installer ?? fileURLToPath(new URL("../install.sh", import.meta.url));
  const spawn = options.spawn ?? ((command, args) => spawnSync(command, args, { stdio: "inherit" }));
  const result = spawn("bash", [installer, "--latest"], options.spawn ? undefined : { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(typeof result.stderr === "string" ? result.stderr.trim() : "Forge614 Shell update failed.");
}
