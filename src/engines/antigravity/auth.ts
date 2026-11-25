import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ShellError } from "../../shell-error.ts";

/**
 * Environment variables that route Antigravity/Gemini through API keys, Vertex AI, or custom
 * endpoints instead of the user's native Google subscription. Shell refuses to start Antigravity
 * whenever any of these is non-empty, and never prints their values.
 */
const BLOCKED_ENV_PATTERN = /^(GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_GENAI_API_KEY|GOOGLE_GENAI_USE_VERTEXAI|GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_CLOUD_PROJECT|GOOGLE_CLOUD_LOCATION|GEMINI_BASE_URL|GOOGLE_GEMINI_BASE_URL|ANTIGRAVITY_API_KEY|ANTIGRAVITY_BASE_URL|ANTIGRAVITY_AUTH_TOKEN)$/i;

/**
 * Validates that the environment passed to `agy` carries no API-key or provider-override variable.
 * Throws a typed `ShellError` naming only the conflicting variable names (never their values).
 */
export function antigravityEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const conflicts = Object.keys(env).filter(key => env[key] && BLOCKED_ENV_PATTERN.test(key));
  if (conflicts.length) throw new ShellError("antigravity-env-conflict", { keys: conflicts.join(", ") });
  return { ...env };
}

/** Where Antigravity CLI keeps its user settings file (`~/.gemini/antigravity-cli/settings.json`). */
export function antigravitySettingsPath(home: string): string {
  return join(home, ".gemini", "antigravity-cli", "settings.json");
}

/**
 * Ensures Antigravity CLI is not configured to route through a non-subscription provider such as
 * `modelProvider: "gemini"` (Gemini Developer API key mode). Reads only the `modelProvider` field
 * and never touches, copies, or logs credentials or tokens. A missing or unreadable file is left
 * alone because Antigravity defaults to its native Google subscription account.
 */
export function checkAntigravitySettings(options: { home?: string; env?: NodeJS.ProcessEnv } = {}): void {
  const home = options.home ?? options.env?.HOME ?? options.env?.USERPROFILE ?? homedir();
  const path = antigravitySettingsPath(home);
  if (!existsSync(path)) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== "object") return;
  const provider = (parsed as { modelProvider?: unknown }).modelProvider;
  if (typeof provider === "string" && provider.trim() && provider.trim().toLowerCase() !== "antigravity") {
    throw new ShellError("antigravity-subscription-required");
  }
}

/**
 * Delegates interactive Google subscription sign-in to Antigravity CLI's official terminal login
 * flow (`agy acp --login`). Shell never implements its own OAuth flow and never reads, copies,
 * persists, or prints any authentication tokens.
 */
export async function officialAntigravityLogin(
  executable: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
  options: { home?: string; signal?: AbortSignal } = {},
): Promise<void> {
  const cleanEnv = antigravityEnvironment(env);
  checkAntigravitySettings({ home: options.home, env: cleanEnv });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ["acp", "--login"], {
      env: cleanEnv,
      cwd,
      stdio: "inherit",
      signal: options.signal,
    });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new ShellError("antigravity-login-exit-code", { code: String(code) })));
  });
}
