import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
type Execute = (command: string, args: string[]) => Promise<unknown>;
const execute: Execute = (command, args) => execFileAsync(command, args, { timeout: 5000, windowsHide: true, maxBuffer: 65536 });

/** Opens `rawUrl` with the system's own launcher, as separate arguments and never through a shell. */
async function launch(rawUrl: string, platform: NodeJS.Platform, run: Execute): Promise<boolean> {
  if (platform === "darwin") await run("/usr/bin/open", [rawUrl]);
  else if (platform === "win32") await run("rundll32.exe", ["url.dll,FileProtocolHandler", rawUrl]);
  else if (platform === "linux") await run("xdg-open", [rawUrl]);
  else return false;
  return true;
}

/**
 * Opens a web page the person chose (an app's page from Codex's `/apps`), like Codex does. Unlike the login
 * helper it is not tied to one site, so it accepts only a plain `https:` page: no other scheme, no embedded
 * credentials, no explicit port. Any failure answers false so the caller can show the link instead.
 */
export async function openLink(rawUrl: string, platform: NodeJS.Platform = process.platform, run: Execute = execute): Promise<boolean> {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.port || url.username || url.password) return false;
    return await launch(rawUrl, platform, run);
  } catch { return false; }
}

/**
 * Whether the chat may open `rawUrl` when the person clicks it: a plain `http:` or `https:` address, with or without a port (a local server such as `http://localhost:3000`) and
 * with no user or password in it. Any other scheme (`javascript:`, `file:`, `ftp:`, `mailto:`…) and anything that is not an address is refused.
 */
export function isOpenableWebUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch { return false; }
}

/**
 * Opens a web page the person clicked in the chat, as one separate argument and never through a shell, like `launch()` does for the others. It is a function of its own because the chat's
 * rule is wider than `openLink`'s (which `/apps` keeps: https only, no port): `http:` and a port are allowed here, see `isOpenableWebUrl`. Any failure answers false.
 */
export async function openWebPage(rawUrl: string, platform: NodeJS.Platform = process.platform, run: Execute = execute): Promise<boolean> {
  try {
    if (!isOpenableWebUrl(rawUrl)) return false;
    return await launch(rawUrl, platform, run);
  } catch { return false; }
}

export async function openLoginBrowser(
  rawUrl: string, platform: NodeJS.Platform = process.platform, run: Execute = execute,
): Promise<boolean> {
  try {
    const url = new URL(rawUrl);
    const approved = (url.hostname === "auth.openai.com" && url.pathname === "/oauth/authorize")
      || (url.hostname === "accounts.google.com" && url.pathname === "/o/oauth2/v2/auth");
    if (url.protocol !== "https:" || !approved || url.port || url.username || url.password) return false;
    // Separate arguments, never a shell command: OAuth URLs contain & and other metacharacters.
    return await launch(rawUrl, platform, run);
  } catch { return false; }
}
