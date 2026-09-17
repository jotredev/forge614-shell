import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Read authentication settings only, never oauth_creds.json or token stores.
// Fail closed for conflicting auth policies rather than silently using a paid API.
export async function checkGeminiConfiguration(cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  const system = env.GEMINI_CLI_SYSTEM_SETTINGS_PATH ?? (process.platform === "darwin"
    ? "/Library/Application Support/GeminiCli/settings.json"
    : process.platform === "win32" ? "C:\\ProgramData\\gemini-cli\\settings.json" : "/etc/gemini-cli/settings.json");
  const files = new Set([
    system, env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH ?? join(dirname(system), "system-defaults.json"),
    join(env.GEMINI_CLI_HOME ?? homedir(), ".gemini", "settings.json"), join(cwd, ".gemini", "settings.json"),
  ]);
  for (const file of files) {
    let content: string;
    try { content = await readFile(file, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw new Error(`Cannot verify Gemini authentication settings: ${file}`); }
    let settings: any;
    try {
      const json = content.replace(/("(?:\\.|[^"\\])*")|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g, (match, quoted) => quoted ?? match.replace(/[^\r\n]/g, " "));
      settings = JSON.parse(json);
    } catch { throw new Error(`Cannot parse Gemini settings safely: ${file}`); }
    for (const kind of [settings?.security?.auth?.selectedType, settings?.security?.auth?.enforcedType]) {
      if (kind && kind !== "oauth-personal") throw new Error(`Gemini has a non-Google authentication setting in ${file}. Select "Log in with Google" in the official Gemini CLI, then reopen Shell. No account settings were changed.`);
    }
  }
}
