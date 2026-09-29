import { expect, test } from "bun:test";
import { parseEngine } from "./options.ts";

/**
 * `--engine` errors name only claude and codex, yet `pi` is still parsed silently for the legacy route.
 * Exists because Pi was removed from every visible text (owner's rule: only Engines-supported assistants are listed), not from the parser.
 */
test("normal startup requires a selection; explicit engines remain available", () => {
  expect(parseEngine([])).toEqual({ engine: undefined, args: [] });
  expect(parseEngine(["--engine", "claude"])).toEqual({ engine: "claude", args: [] });
  expect(parseEngine(["--engine", "codex"])).toEqual({ engine: "codex", args: [] });
  expect(() => parseEngine(["--engine", "gemini"])).toThrow("--engine must be claude or codex.");
  expect(() => parseEngine(["--engine", "antigravity"])).toThrow("--engine must be claude or codex.");
  expect(() => parseEngine(["--engine", "gemini"], "es")).toThrow("--engine debe ser claude o codex.");
  expect(parseEngine(["--engine", "pi", "--mode", "rpc"])).toEqual({ engine: "pi", args: ["--mode", "rpc"] });
  expect(() => parseEngine(["--engine", "other"])).toThrow();
  expect(() => parseEngine(["--engine"])).toThrow();
  expect(() => parseEngine(["--engine", "pi", "--engine", "claude"])).toThrow();
  try { parseEngine(["--engine", "other"]); } catch (error) { expect((error as Error).message).not.toMatch(/\bpi\b/i); }
  try { parseEngine(["--engine", "other"], "es"); } catch (error) { expect((error as Error).message).not.toMatch(/\bpi\b/i); }
});
