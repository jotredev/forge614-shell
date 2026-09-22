import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

test("the init dispatch forwards the real process env to runInitCommand, so a custom FORGE614_HOME reaches Engines/Engram resolution", async () => {
  const source = await readFile(new URL("./cli.ts", import.meta.url), "utf8");
  const initCall = source.match(/runInitCommand\(args\.slice\(1\),\s*\{[^}]*\}\)/)?.[0];
  expect(initCall).toBeDefined();
  expect(initCall).toContain("env: process.env");
});

test("the init branch's own error catch reports in the locale the person just selected, not the pre-selection static one", async () => {
  const source = await readFile(new URL("./cli.ts", import.meta.url), "utf8");
  const initBranch = source.slice(source.indexOf('args[0] === "init"'), source.indexOf('args[0] === "language"'));
  // `effectiveLocale` must be declared before `ensureLocale` runs, updated once it resolves, and
  // used (never `staticLocale`) in this branch's own catch — otherwise a person who just chose
  // Español would see `runInitCommand`'s own error printed in English.
  expect(initBranch).toMatch(/let effectiveLocale = staticLocale;/);
  expect(initBranch).toMatch(/effectiveLocale = locale;/);
  const catchBlock = initBranch.slice(initBranch.indexOf("} catch (error) {"));
  expect(catchBlock).toContain("getCatalog(effectiveLocale)");
  expect(catchBlock).not.toContain("getCatalog(staticLocale)");
});
