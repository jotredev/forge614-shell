import { expect, test } from "bun:test";
import { parseEngine } from "./options.ts";

test("normal startup requires a selection; explicit engines remain available", () => {
  expect(parseEngine([])).toEqual({ engine: undefined, args: [] });
  expect(parseEngine(["--engine", "claude"])).toEqual({ engine: "claude", args: [] });
  expect(parseEngine(["--engine", "codex"])).toEqual({ engine: "codex", args: [] });
  expect(parseEngine(["--engine", "antigravity"])).toEqual({ engine: "antigravity", args: [] });
  expect(() => parseEngine(["--engine", "gemini"])).toThrow("Antigravity");
  expect(parseEngine(["--engine", "pi", "--mode", "rpc"])).toEqual({ engine: "pi", args: ["--mode", "rpc"] });
  expect(() => parseEngine(["--engine", "other"])).toThrow();
  expect(() => parseEngine(["--engine"])).toThrow();
  expect(() => parseEngine(["--engine", "pi", "--engine", "claude"])).toThrow();
});
