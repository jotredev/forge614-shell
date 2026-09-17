import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
type Execute = (command: string, args: string[]) => Promise<unknown>;
const execute: Execute = (command, args) => execFileAsync(command, args, { timeout: 5000, windowsHide: true, maxBuffer: 65536 });

export async function openLoginBrowser(
  rawUrl: string, platform: NodeJS.Platform = process.platform, run: Execute = execute,
): Promise<boolean> {
  try {
    const url = new URL(rawUrl);
    const approved = (url.hostname === "auth.openai.com" && url.pathname === "/oauth/authorize")
      || (url.hostname === "accounts.google.com" && url.pathname === "/o/oauth2/v2/auth");
    if (url.protocol !== "https:" || !approved || url.port || url.username || url.password) return false;
    // Separate arguments, never a shell command: OAuth URLs contain & and other metacharacters.
    if (platform === "darwin") await run("/usr/bin/open", [rawUrl]);
    else if (platform === "win32") await run("rundll32.exe", ["url.dll,FileProtocolHandler", rawUrl]);
    else if (platform === "linux") await run("xdg-open", [rawUrl]);
    else return false;
    return true;
  } catch { return false; }
}
