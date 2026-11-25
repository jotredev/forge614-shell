import { expect, test } from "bun:test";
import { parseEngine } from "./options.ts";
import { ShellError, describeError } from "../shell-error.ts";

/**
 * `--engine` accepts only the three Shell chat adapters (`claude`, `codex`, `antigravity`); every
 * unknown id gets the stable support error. Exists because unsupported ids must fail closed before
 * the CLI opens a terminal or saves preferences.
 */
test("normal startup requires a selection; explicit engines remain available", () => {
  expect(parseEngine([])).toEqual({ engine: undefined, args: [] });
  expect(parseEngine(["--engine", "claude"])).toEqual({ engine: "claude", args: [] });
  expect(parseEngine(["--engine", "codex"])).toEqual({ engine: "codex", args: [] });
  expect(parseEngine(["--engine", "antigravity"])).toEqual({ engine: "antigravity", args: [] });
  for (const engine of ["pi", "foo", "gemini", "other"]) {
    let caught: unknown;
    try { parseEngine(["--engine", engine]); } catch (error) { caught = error; }
    expect(caught, engine).toBeInstanceOf(ShellError);
    expect((caught as ShellError).code, engine).toBe("engine-not-fully-supported");
    expect(describeError(caught, "en"), engine).toContain(engine);
  }
  let esError: unknown;
  try { parseEngine(["--engine", "foo"], "es"); } catch (error) { esError = error; }
  expect(describeError(esError, "es")).toContain("totalmente compatible");
  expect(() => parseEngine(["--engine"])).toThrow();
  expect(() => parseEngine(["--engine", "pi", "--engine", "claude"])).toThrow();
});
