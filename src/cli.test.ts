import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

test("the init dispatch forwards the real process env to runInitCommand, so a custom FORGE614_HOME reaches Engines/Engram resolution", async () => {
  const source = await readFile(new URL("./cli.ts", import.meta.url), "utf8");
  const initCall = source.match(/runInitCommand\(args\.slice\(1\),\s*\{[^}]*\}\)/)?.[0];
  expect(initCall).toBeDefined();
  expect(initCall).toContain("env: process.env");
});
