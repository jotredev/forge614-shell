import { expect, test } from "bun:test";
import { discoverMcpCapableAgents, discoverSelectableEngines } from "./forge614-engines.ts";

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

test("discoverMcpCapableAgents checks capabilities per installed agent and keeps only supportsMcp:true", async () => {
  const calls: string[][] = [];
  const agents = await discoverMcpCapableAgents({
    home: "/Users/tester",
    run: async (command, args) => {
      calls.push([command, ...args]);
      if (args[0] === "detect") {
        return {
          status: 0,
          stdout: JSON.stringify({
            schemaVersion: 1,
            agents: [
              { id: "claude-code", label: "Claude Code", installed: true, executable: "/usr/local/bin/claude", configDir: "/x", configFound: true },
              { id: "codex", label: "Codex", installed: true, executable: "/usr/local/bin/codex", configDir: "/x", configFound: true },
              { id: "cursor", label: "Cursor", installed: false, executable: undefined, configDir: "/x", configFound: false },
            ],
          }),
          stderr: "",
        };
      }
      const agentId = args[args.indexOf("--agent") + 1];
      return {
        status: 0,
        stdout: JSON.stringify({ schemaVersion: 1, id: agentId, label: agentId, supportsMcp: agentId === "claude-code", supportsHooks: true, supportsHeadlessExec: true }),
        stderr: "",
      };
    },
  });
  expect(calls).toEqual([
    ["/Users/tester/.forge614/engines/bin/forge614-engines", "detect"],
    ["/Users/tester/.forge614/engines/bin/forge614-engines", "capabilities", "--agent", "claude-code"],
    ["/Users/tester/.forge614/engines/bin/forge614-engines", "capabilities", "--agent", "codex"],
  ]);
  expect(agents).toEqual([{ id: "claude-code", label: "Claude Code", executable: "/usr/local/bin/claude" }]);
});

test("discoverMcpCapableAgents excludes an agent whose capabilities lookup fails, instead of crashing", async () => {
  const agents = await discoverMcpCapableAgents({
    home: "/Users/tester",
    run: async (_command, args) => {
      if (args[0] === "detect") {
        return {
          status: 0,
          stdout: JSON.stringify({ schemaVersion: 1, agents: [{ id: "claude-code", label: "Claude Code", installed: true, executable: "/usr/local/bin/claude", configDir: "/x", configFound: true }] }),
          stderr: "",
        };
      }
      return { status: 1, stdout: JSON.stringify({ schemaVersion: 1, error: { code: "UNKNOWN_AGENT", message: "Unknown agent: claude-code" } }), stderr: "" };
    },
  });
  expect(agents).toEqual([]);
});

test("discoverMcpCapableAgents rejects an unavailable Engines installation", async () => {
  await expect(discoverMcpCapableAgents({ run: async () => ({ status: 127, stdout: "", stderr: "not found" }) }))
    .rejects.toThrow("Forge614 Engines is unavailable");
});
