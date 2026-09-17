import { expect, test } from "bun:test";
import { nativeEnvironment } from "./process.ts";

test("native engines reject billing-routing overrides without printing their values", () => {
  for (const [id, key] of [["codex", "OPENAI_API_KEY"], ["codex", "OPENAI_BASE_URL"], ["gemini", "GEMINI_API_KEY"], ["gemini", "GOOGLE_GENAI_USE_VERTEXAI"]] as const) {
    try { nativeEnvironment(id, { [key]: "secret" }); throw new Error("accepted"); }
    catch (error) { expect(String(error)).toContain(key); expect(String(error)).not.toContain("secret"); }
  }
  expect(nativeEnvironment("gemini", {}).GEMINI_API_KEY).toBe("");
  expect(nativeEnvironment("gemini", {}).GOOGLE_GEMINI_BASE_URL).toBe("");
});
