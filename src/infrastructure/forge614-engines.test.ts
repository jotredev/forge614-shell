import { expect, test } from "bun:test";
import { discoverSelectableEngines } from "./forge614-engines.ts";

const report = {
  schemaVersion: 1,
  agents: [
    { id: "claude-code", label: "Claude Code", installed: true, executable: "/usr/local/bin/claude" },
    { id: "codex", label: "Codex", installed: true, executable: "/usr/local/bin/codex" },
    { id: "cursor", label: "Cursor", installed: true, executable: "/Applications/Cursor.app/Contents/MacOS/Cursor" },
  ],
};

test("uses the published Engines detect contract and maps only Shell chat adapters", async () => {
  const calls: string[][] = [];
  const engines = await discoverSelectableEngines({
    home: "/Users/tester",
    run: async (command, args) => {
      calls.push([command, ...args]);
      return { status: 0, stdout: JSON.stringify(report), stderr: "" };
    },
  });

  expect(calls).toEqual([["/Users/tester/.forge614/engines/bin/forge614-engines", "detect"]]);
  expect(engines).toEqual([
    { id: "claude", label: "Claude Code", executable: "/usr/local/bin/claude" },
    { id: "codex", label: "Codex", executable: "/usr/local/bin/codex" },
  ]);
});

test("rejects an unavailable or incompatible Engines installation instead of falling back to local discovery", async () => {
  await expect(discoverSelectableEngines({
    run: async () => ({ status: 127, stdout: "", stderr: "not found" }),
  })).rejects.toThrow("Forge614 Engines is unavailable");

  await expect(discoverSelectableEngines({
    run: async () => ({ status: 0, stdout: JSON.stringify({ schemaVersion: 2, agents: [] }), stderr: "" }),
  })).rejects.toThrow("incompatible");
});

test("rejects malformed detect output", async () => {
  await expect(discoverSelectableEngines({
    run: async () => ({ status: 0, stdout: "not json", stderr: "" }),
  })).rejects.toThrow("invalid detection result");
});
