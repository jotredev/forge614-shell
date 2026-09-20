import { expect, test } from "bun:test";
import { nativeEnvironment } from "./process.ts";

test("native engines reject billing-routing overrides without printing their values", () => {
  for (const key of ["OPENAI_API_KEY", "OPENAI_BASE_URL"]) {
    try { nativeEnvironment({ [key]: "secret" }); throw new Error("accepted"); }
    catch (error) { expect(String(error)).toContain(key); expect(String(error)).not.toContain("secret"); }
  }
});
