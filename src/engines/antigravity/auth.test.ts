import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { antigravityEnvironment, antigravitySettingsPath, checkAntigravitySettings } from "./auth.ts";
import { ShellError, describeError } from "../../shell-error.ts";

/**
 * Antigravity subscription mode must reject every Gemini/Google/Antigravity API-key or routing
 * override environment variable without ever printing its secret value. Exists to guarantee Shell
 * never silently bills or authenticates via API keys instead of the native Google subscription.
 */
test("antigravityEnvironment rejects Gemini/Google/Antigravity API key overrides without printing values", () => {
  const blockedKeys = [
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_GENAI_API_KEY",
    "GOOGLE_GENAI_USE_VERTEXAI",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_CLOUD_PROJECT",
    "GEMINI_BASE_URL",
    "ANTIGRAVITY_API_KEY",
    "ANTIGRAVITY_BASE_URL",
    "ANTIGRAVITY_AUTH_TOKEN",
  ];
  for (const key of blockedKeys) {
    let caught: unknown;
    try {
      antigravityEnvironment({ PATH: "/usr/bin", [key]: "super-secret-value-123" });
    } catch (error) {
      caught = error;
    }
    expect(caught, key).toBeInstanceOf(ShellError);
    expect((caught as ShellError).code, key).toBe("antigravity-env-conflict");
    expect(describeError(caught, "en"), key).toContain(key);
    expect(describeError(caught, "en"), key).not.toContain("super-secret-value-123");
    expect(describeError(caught, "es"), key).toContain(key);
    expect(describeError(caught, "es"), key).not.toContain("super-secret-value-123");
  }
});

/**
 * A clean environment (including unset or empty API-key variables) must pass through as a shallow
 * copy without mutation. Exists so normal subscription sessions start cleanly.
 */
test("antigravityEnvironment allows a clean environment and empty blocked keys", () => {
  const input = { HOME: "/Users/tester", PATH: "/usr/bin", GEMINI_API_KEY: "" };
  const result = antigravityEnvironment(input);
  expect(result).toEqual(input);
  expect(result).not.toBe(input);
});

/**
 * Antigravity settings configured with `modelProvider: "gemini"` (Gemini Developer API mode) must
 * be rejected in favor of native subscription mode; absent, default, or `"antigravity"` provider
 * settings must be accepted. Exists so Shell never chats through an API-key provider configuration.
 */
test("checkAntigravitySettings refuses modelProvider: gemini and allows subscription/default settings", () => {
  const home = mkdtempSync(join(tmpdir(), "forge614-agy-auth-"));
  try {
    // Missing settings file defaults to native subscription — allowed.
    expect(() => checkAntigravitySettings({ home })).not.toThrow();

    const file = antigravitySettingsPath(home);
    mkdirSync(join(home, ".gemini", "antigravity-cli"), { recursive: true });

    writeFileSync(file, JSON.stringify({ model: "Gemini 4 Neon (High)" }));
    expect(() => checkAntigravitySettings({ home })).not.toThrow();

    writeFileSync(file, JSON.stringify({ modelProvider: "antigravity" }));
    expect(() => checkAntigravitySettings({ home })).not.toThrow();

    writeFileSync(file, JSON.stringify({ modelProvider: "gemini" }));
    let caught: unknown;
    try { checkAntigravitySettings({ home }); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(ShellError);
    expect((caught as ShellError).code).toBe("antigravity-subscription-required");
    expect(describeError(caught, "en")).toContain("/f614:login");
    expect(describeError(caught, "es")).toContain("/f614:login");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
