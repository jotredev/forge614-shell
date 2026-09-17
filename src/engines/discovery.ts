import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

export interface InstalledEngine {
  id: "claude" | "codex" | "antigravity";
  label: string;
  executable: string;
}

// Only working connectors belong here. Bundled legacy Pi is not a native-agent connector.
const supported = [
  { id: "claude", label: "Claude Code", command: "claude" },
  { id: "codex", label: "Codex", command: "codex" },
  { id: "antigravity", label: "Antigravity CLI", command: "agy" },
] as const;

export async function discoverEngines(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): Promise<InstalledEngine[]> {
  const path = Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "";
  const directories = [...new Set(path.split(platform === "win32" ? ";" : ":").filter(directory => isAbsolute(directory)))];
  const installed: InstalledEngine[] = [];
  for (const engine of supported) {
    const name = platform === "win32" ? `${engine.command}.exe` : engine.command;
    for (const directory of directories) {
      const executable = join(directory, name);
      try {
        if (!(await stat(executable)).isFile()) continue;
        await access(executable, constants.X_OK);
        installed.push({ id: engine.id, label: engine.label, executable });
        break;
      } catch { /* Try the npm entry on Windows, without running its cmd shim. */ }
      if (platform === "win32" && engine.id === "codex") {
        try {
          if (!(await stat(join(directory, `${engine.command}.cmd`))).isFile()) continue;
          const packageRoot = join(directory, "node_modules", "@openai/codex");
          const metadata = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
          const bin = typeof metadata.bin === "string" ? metadata.bin : metadata.bin?.[engine.command];
          if (typeof bin !== "string") continue;
          const entry = resolve(packageRoot, bin);
          const within = relative(packageRoot, entry);
          if (within.startsWith("..") || isAbsolute(within) || !/\.m?js$/i.test(entry) || !(await stat(entry)).isFile()) continue;
          installed.push({ id: engine.id, label: engine.label, executable: entry });
          break;
        } catch { /* Missing or inaccessible package: not an available choice. */ }
      }
    }
  }
  return installed;
}
