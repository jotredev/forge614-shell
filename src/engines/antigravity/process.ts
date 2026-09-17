import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { runAccountCommand } from "./account-command.ts";

export function antigravityEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const conflicts = Object.keys(env).filter(key => env[key] && /^(GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_GEMINI_BASE_URL|GOOGLE_GENAI_USE_VERTEXAI|GOOGLE_APPLICATION_CREDENTIALS)$/i.test(key));
  if (conflicts.length) throw new Error(`Account mode refuses overrides: ${conflicts.join(", ")}. No account settings were changed.`);
  return { ...env };
}

export async function checkAntigravityAccountMode(env: NodeJS.ProcessEnv): Promise<void> {
  antigravityEnvironment(env);
  // Read only routing configuration, never credential stores.
  try {
    const settings = JSON.parse(await readFile(join(env.HOME || env.USERPROFILE || homedir(), ".gemini", "antigravity-cli", "settings.json"), "utf8"));
    if (settings.modelProvider === "gemini") throw new Error("Antigravity is configured for API billing. Switch to account login in native agy before using Shell.");
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

export async function antigravityModels(executable: string, cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  await checkAntigravityAccountMode(env);
  try {
    return (await promisify(execFile)(executable, ["models"], { cwd, env: antigravityEnvironment(env), timeout: 30000, maxBuffer: 1024 * 1024 })).stdout;
  } catch { throw new Error("Could not load Antigravity models. Use /login to authenticate, then retry."); }
}

export async function antigravityLoginState(executable: string, cwd: string, env: NodeJS.ProcessEnv, signal?: AbortSignal, run: typeof runAccountCommand = runAccountCommand): Promise<"connected" | "required" | "unknown"> {
  await checkAntigravityAccountMode(env);
  try {
    // /usage is a documented CLI-local command, not a model prompt.
    const { stdout } = await run(executable, ["-p", "/usage"], {
      cwd, env: antigravityEnvironment(env), signal, timeout: 15000, maxBuffer: 65536,
    });
    return /Limit Remaining\t\d+(?:\.\d+)?%\t/.test(stdout) ? "connected" : "unknown";
  } catch (error) {
    if (signal?.aborted) throw new Error("Login check cancelled.");
    const stderr = String((error as { stderr?: string }).stderr ?? "");
    return /authentication required|not (?:logged|signed) in|please (?:log|sign) in/i.test(stderr) ? "required" : "unknown";
  }
}

export async function antigravityLogin(executable: string, cwd: string, env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<void> {
  await checkAntigravityAccountMode(env);
  if (signal.aborted) throw new Error("Antigravity login cancelled.");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [], { cwd, env: antigravityEnvironment(env), stdio: "inherit" });
    let failure: Error | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => {
      failure = new Error("Antigravity login cancelled.");
      child.kill("SIGTERM");
      timer ??= setTimeout(() => child.kill("SIGKILL"), 2000); timer.unref();
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.once("error", () => { failure ??= new Error("Antigravity login could not start."); });
    child.once("close", code => {
      signal.removeEventListener("abort", abort); if (timer) clearTimeout(timer);
      if (failure) reject(failure);
      else if (code === 0) resolve();
      else reject(new Error("Antigravity closed before login was verified. Reopen /login if needed."));
    });
  });
}


export async function runAntigravity(executable: string, args: string[], prompt: string, cwd: string, env: NodeJS.ProcessEnv, emit: (event: any) => void, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error("Antigravity cancelled.");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env: antigravityEnvironment(env), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let buffer = ""; let failure: Error | undefined; let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      child.kill("SIGTERM");
      killTimer ??= setTimeout(() => child.kill("SIGKILL"), 2000);
      killTimer.unref();
    };
    const abort = () => { failure = new Error("Antigravity cancelled."); stop(); };
    const fail = () => { failure ??= new Error("Invalid Antigravity stream protocol."); stop(); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const line = (value: string) => {
      if (!value.trim() || failure) return;
      try { const event = JSON.parse(value); if (!event || typeof event.event !== "string") throw new Error(); emit(event); }
      catch { fail(); }
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 16 * 1024 * 1024) { fail(); return; }
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) { line(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
    });
    // Raw diagnostics can contain private configuration. Report only a known notice.
    let diagnostics = ""; let permissionNotice = false;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      diagnostics = (diagnostics + chunk).slice(-4096);
      if (!permissionNotice && /permission|soft.denied|approval/i.test(diagnostics)) {
        permissionNotice = true; emit({ event: "permission_notice" });
      }
    });
    child.stdin.on("error", () => { failure ??= new Error("Antigravity input closed unexpectedly."); stop(); });
    child.once("error", () => { failure ??= new Error("Could not launch Antigravity CLI."); });
    child.once("close", code => {
      signal.removeEventListener("abort", abort);
      if (!failure && buffer.trim()) line(buffer);
      if (killTimer) clearTimeout(killTimer);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`Antigravity exited with code ${code}. Check /login and native permissions.`));
      else resolve();
    });
    child.stdin.end(JSON.stringify({ event: "user", message: { content: prompt } }) + "\n");
  });
}
