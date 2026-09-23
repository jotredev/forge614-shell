import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Bun 1.4.2 is the single version of the whole ecosystem (acta 0026); Bun 1.3.8 hangs on Linux, so
// the floor is 1.3.9. Shell has no CI workflows, so `package.json` is the only place this is pinned.
const metadata = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  engines: Record<string, string>;
  packageManager: string;
};

test("package.json requires Bun >=1.3.9 (1.3.8 hangs on Linux) and keeps its Node floor", () => {
  expect(metadata.engines.bun).toBe(">=1.3.9");
  expect(metadata.engines.node).toBe(">=22.19.0");
});

test("package.json pins the ecosystem's single Bun version as its package manager", () => {
  expect(metadata.packageManager).toBe("bun@1.4.2");
});
