import { expect, test } from "bun:test";
import { parseEngine } from "./options.ts";
import { ShellError, describeError } from "../shell-error.ts";

/**
 * `--engine` accepts only the two Shell chat adapters; every unknown id gets the stable support error.
 * Exists because unsupported ids must fail closed before the CLI opens a terminal or saves preferences.
 */
test("normal startup requires a selection; explicit engines remain available", () => {
  expect(parseEngine([])).toEqual({ engine: undefined, args: [] });
  expect(parseEngine(["--engine", "claude"])).toEqual({ engine: "claude", args: [] });
  expect(parseEngine(["--engine", "codex"])).toEqual({ engine: "codex", args: [] });
  for (const engine of ["pi", "foo", "gemini", "antigravity", "other"]) {
    try { parseEngine(["--engine", engine]); } catch (error) {
      expect(error).toBeInstanceOf(ShellError);
      expect((error as ShellError).code).toBe("engine-not-fully-supported");
      expect(describeError(error, "en")).toContain(engine);
    }
  }
  try { parseEngine(["--engine", "foo"], "es"); } catch (error) {
    expect(describeError(error, "es")).toContain("totalmente compatible");
  }
  expect(() => parseEngine(["--engine"])).toThrow();
  expect(() => parseEngine(["--engine", "pi", "--engine", "claude"])).toThrow();
});
