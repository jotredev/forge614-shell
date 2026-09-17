import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkGeminiConfiguration } from "./config.ts";

test("Gemini refuses an API-auth project override without changing settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-gemini-config-"));
  try {
    await mkdir(join(root, ".gemini"));
    const env = { GEMINI_CLI_HOME: root, GEMINI_CLI_SYSTEM_SETTINGS_PATH: join(root, "system.json"), GEMINI_CLI_SYSTEM_DEFAULTS_PATH: join(root, "defaults.json") };
    await writeFile(join(root, ".gemini", "settings.json"), '{// comment\n"security":{"auth":{"selectedType":"gemini-api-key"}}}');
    await expect(checkGeminiConfiguration(root, env)).rejects.toThrow("Google");
    await writeFile(join(root, ".gemini", "settings.json"), '{"security":{"auth":{"selectedType":"oauth-personal"}}}');
    await expect(checkGeminiConfiguration(root, env)).resolves.toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});
