import { expect, test } from "bun:test";
import { applyMcpPlan, discoverMcpCapableAgents, discoverSelectableEngines, planMcpInstall, planMcpRemove, removeEngramMcpFromAgent } from "./forge614-engines.ts";

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
  await expect(discoverMcpCapableAgents({ home: "/Users/tester", run: async () => ({ status: 127, stdout: "", stderr: "not found" }) }))
    .rejects.toThrow("Forge614 Engines is unavailable");
});

test("planMcpInstall sends the exact Engines contract and reads the plan", async () => {
  const calls: string[][] = [];
  const plan = await planMcpInstall({
    agentId: "claude-code", name: "forge614-engram", command: "/Users/tester/.forge614/engram/bin/forge614-engram", args: ["mcp"],
    home: "/Users/tester",
    run: async (command, args) => {
      calls.push([command, ...args]);
      return {
        status: 0,
        stdout: JSON.stringify({
          schemaVersion: 1,
          plan: {
            planId: "plan-1", agentId: "claude-code", action: "mcp-install", noop: false,
            writes: [{ path: "/Users/tester/.claude.json", beforeHash: "x", afterContent: "{ secret: true }" }],
          },
        }),
        stderr: "",
      };
    },
  });
  expect(calls).toEqual([[
    "/Users/tester/.forge614/engines/bin/forge614-engines", "plan", "mcp-install",
    "--agent", "claude-code", "--name", "forge614-engram",
    "--command", "/Users/tester/.forge614/engram/bin/forge614-engram", "--args", "mcp",
  ]]);
  expect(plan).toEqual({ planId: "plan-1", noop: false, filePath: "/Users/tester/.claude.json" });
});

test("planMcpInstall never exposes afterContent or beforeHash", async () => {
  const plan = await planMcpInstall({
    agentId: "claude-code", name: "forge614-engram", command: "/bin/x", args: ["mcp"], home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: JSON.stringify({ schemaVersion: 1, plan: { planId: "plan-1", agentId: "claude-code", action: "mcp-install", noop: false, writes: [{ path: "/p", beforeHash: "h", afterContent: "SECRET" }] } }),
      stderr: "",
    }),
  });
  expect(JSON.stringify(plan)).not.toContain("SECRET");
  expect(JSON.stringify(plan)).not.toContain("beforeHash");
});

test("planMcpInstall reports noop when nothing would change", async () => {
  const plan = await planMcpInstall({
    agentId: "claude-code", name: "forge614-engram", command: "/bin/x", args: ["mcp"], home: "/Users/tester",
    run: async () => ({ status: 0, stdout: JSON.stringify({ schemaVersion: 1, plan: { planId: "plan-1", agentId: "claude-code", action: "mcp-install", noop: true, writes: [] } }), stderr: "" }),
  });
  expect(plan).toEqual({ planId: "plan-1", noop: true, filePath: null });
});

test("planMcpInstall throws Engines' own message for a conflict", async () => {
  await expect(planMcpInstall({
    agentId: "claude-code", name: "forge614-engram", command: "/bin/x", args: ["mcp"], home: "/Users/tester",
    run: async () => ({ status: 1, stdout: JSON.stringify({ schemaVersion: 1, error: { code: "CONFLICT", message: "A different MCP already uses this name." } }), stderr: "" }),
  })).rejects.toThrow("A different MCP already uses this name.");
});

test("applyMcpPlan sends the plan id and reports the changed files", async () => {
  const calls: string[][] = [];
  const result = await applyMcpPlan({
    planId: "plan-1", home: "/Users/tester",
    run: async (command, args) => {
      calls.push([command, ...args]);
      return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, result: { planId: "plan-1", applied: true, changedFiles: ["/Users/tester/.claude.json"] } }), stderr: "" };
    },
  });
  expect(calls).toEqual([["/Users/tester/.forge614/engines/bin/forge614-engines", "apply", "--plan-id", "plan-1"]]);
  expect(result).toEqual({ applied: true, changedFiles: ["/Users/tester/.claude.json"] });
});

test("applyMcpPlan throws Engines' own message when the plan id is unknown", async () => {
  await expect(applyMcpPlan({
    planId: "missing", home: "/Users/tester",
    run: async () => ({ status: 1, stdout: JSON.stringify({ schemaVersion: 1, error: { code: "PLAN_NOT_FOUND", message: 'No plan found with id "missing"' } }), stderr: "" }),
  })).rejects.toThrow('No plan found with id "missing"');
});

test("planMcpRemove sends the same four flags as install and throws when the entry does not match what this system would have installed", async () => {
  const calls: string[][] = [];
  await expect(planMcpRemove({
    agentId: "claude-code", name: "forge614-engram", command: "/Users/tester/.forge614/engram/bin/forge614-engram", args: ["mcp"], home: "/Users/tester",
    run: async (command, args) => {
      calls.push([command, ...args]);
      return {
        status: 1,
        stdout: JSON.stringify({ schemaVersion: 1, error: { code: "UNRECOGNIZED_ENTRY", message: 'Refusing to remove "forge614-engram": it does not match what this system would have installed' } }),
        stderr: "",
      };
    },
  })).rejects.toThrow("does not match what this system would have installed");
  expect(calls).toEqual([[
    "/Users/tester/.forge614/engines/bin/forge614-engines", "plan", "mcp-remove",
    "--agent", "claude-code", "--name", "forge614-engram",
    "--command", "/Users/tester/.forge614/engram/bin/forge614-engram", "--args", "mcp",
  ]]);
});

test("removeEngramMcpFromAgent plans and applies removal in one call", async () => {
  const calls: string[][] = [];
  const result = await removeEngramMcpFromAgent("claude-code", { command: "/Users/tester/.forge614/engram/bin/forge614-engram", args: ["mcp"] }, {
    home: "/Users/tester",
    run: async (command, args) => {
      calls.push([command, ...args]);
      if (args.includes("plan")) {
        return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, plan: { planId: "plan-remove-1", agentId: "claude-code", action: "mcp-remove", noop: false, writes: [{ path: "/Users/tester/.claude.json" }] } }), stderr: "" };
      }
      return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, result: { planId: "plan-remove-1", applied: true, changedFiles: ["/Users/tester/.claude.json"] } }), stderr: "" };
    },
  });
  expect(calls).toEqual([
    [
      "/Users/tester/.forge614/engines/bin/forge614-engines", "plan", "mcp-remove",
      "--agent", "claude-code", "--name", "forge614-engram",
      "--command", "/Users/tester/.forge614/engram/bin/forge614-engram", "--args", "mcp",
    ],
    ["/Users/tester/.forge614/engines/bin/forge614-engines", "apply", "--plan-id", "plan-remove-1"],
  ]);
  expect(result).toEqual({ applied: true, changedFiles: ["/Users/tester/.claude.json"] });
});

test("removeEngramMcpFromAgent skips apply when there is nothing to remove", async () => {
  const calls: string[][] = [];
  const result = await removeEngramMcpFromAgent("claude-code", { command: "/bin/x", args: ["mcp"] }, {
    home: "/Users/tester",
    run: async (command, args) => {
      calls.push([command, ...args]);
      return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, plan: { planId: "plan-remove-1", agentId: "claude-code", action: "mcp-remove", noop: true, writes: [] } }), stderr: "" };
    },
  });
  expect(calls.length).toBe(1);
  expect(result).toEqual({ applied: false, changedFiles: [] });
});

import { planMemoryInstall, verifyMemoryIntegration } from "./forge614-engines.ts";

test("planMemoryInstall sends only --agent and reads the full plan", async () => {
  const calls: string[][] = [];
  const plan = await planMemoryInstall({
    agentId: "claude-code",
    home: "/Users/tester",
    run: async (command, args) => {
      calls.push([command, ...args]);
      return {
        status: 0,
        stdout: JSON.stringify({
          schemaVersion: 1,
          plan: {
            planId: "plan-1",
            agentId: "claude-code",
            action: "memory-install",
            noop: false,
            writes: [{ path: "/Users/tester/.claude.json", beforeHash: "x", afterContent: "SECRET" }],
            metadata: {
              mcp: { path: "/Users/tester/.claude.json", status: { kind: "write" } },
              instructions: { paths: ["/Users/tester/.claude/CLAUDE.md"], status: { kind: "write" } },
              overallStatus: "complete",
            },
          },
        }),
        stderr: "",
      };
    },
  });
  expect(calls).toEqual([[
    "/Users/tester/.forge614/engines/bin/forge614-engines", "plan", "memory-install", "--agent", "claude-code",
  ]]);
  expect(plan).toEqual({
    planId: "plan-1",
    agentId: "claude-code",
    noop: false,
    mcp: { path: "/Users/tester/.claude.json", status: { kind: "write" } },
    instructions: { paths: ["/Users/tester/.claude/CLAUDE.md"], status: { kind: "write" } },
    overallStatus: "complete",
  });
});

test("planMemoryInstall never exposes afterContent or beforeHash", async () => {
  const plan = await planMemoryInstall({
    agentId: "claude-code", home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        plan: {
          planId: "plan-1", agentId: "claude-code", action: "memory-install", noop: false,
          writes: [{ path: "/p", beforeHash: "h", afterContent: "SECRET" }],
          metadata: {
            mcp: { path: "/p", status: { kind: "write" } },
            instructions: { paths: ["/q"], status: { kind: "write" } },
            overallStatus: "complete",
          },
        },
      }),
      stderr: "",
    }),
  });
  expect(JSON.stringify(plan)).not.toContain("SECRET");
  expect(JSON.stringify(plan)).not.toContain("beforeHash");
});

test("planMemoryInstall reports partial for an assistant whose instructions are unsupported (e.g. Cursor)", async () => {
  const plan = await planMemoryInstall({
    agentId: "cursor", home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        plan: {
          planId: "plan-cursor", agentId: "cursor", action: "memory-install", noop: false,
          writes: [{ path: "/Users/tester/.cursor/mcp.json", beforeHash: "", afterContent: "{}" }],
          metadata: {
            mcp: { path: "/Users/tester/.cursor/mcp.json", status: { kind: "write" } },
            instructions: {
              paths: [],
              status: { kind: "unsupported", reason: "Cursor has no officially supported, stable, file-based mechanism to auto-load global instructions." },
            },
            overallStatus: "partial",
          },
        },
      }),
      stderr: "",
    }),
  });
  expect(plan.overallStatus).toBe("partial");
  expect(plan.instructions.status).toEqual({
    kind: "unsupported",
    reason: "Cursor has no officially supported, stable, file-based mechanism to auto-load global instructions.",
  });
});

test("planMemoryInstall surfaces a blocked component's conflict details", async () => {
  const plan = await planMemoryInstall({
    agentId: "claude-code", home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        plan: {
          planId: "plan-1", agentId: "claude-code", action: "memory-install", noop: true, writes: [],
          metadata: {
            mcp: {
              path: "/Users/tester/.claude.json",
              status: { kind: "blocked", reason: "mcp-conflict", details: 'An existing "forge614-engram" MCP entry with different content is already present at /Users/tester/.claude.json' },
            },
            instructions: { paths: ["/Users/tester/.claude/CLAUDE.md"], status: { kind: "noop" } },
            overallStatus: "partial",
          },
        },
      }),
      stderr: "",
    }),
  });
  expect(plan.mcp.status.kind).toBe("blocked");
  expect(plan.mcp.status).toEqual({
    kind: "blocked", reason: "mcp-conflict",
    details: 'An existing "forge614-engram" MCP entry with different content is already present at /Users/tester/.claude.json',
  });
});

test("planMemoryInstall throws Engines' own message for a hard failure", async () => {
  await expect(planMemoryInstall({
    agentId: "unknown-agent", home: "/Users/tester",
    run: async () => ({ status: 1, stdout: JSON.stringify({ schemaVersion: 1, error: { code: "UNKNOWN_AGENT", message: "Unknown agent: unknown-agent" } }), stderr: "" }),
  })).rejects.toThrow("Unknown agent: unknown-agent");
});

test("planMemoryInstall rejects a malformed plan instead of guessing its shape", async () => {
  await expect(planMemoryInstall({
    agentId: "claude-code", home: "/Users/tester",
    run: async () => ({ status: 0, stdout: JSON.stringify({ schemaVersion: 1, plan: { planId: "plan-1", agentId: "claude-code", action: "memory-install", noop: true, writes: [] } }), stderr: "" }),
  })).rejects.toThrow("forge614-engines returned an invalid plan.");
});

test("verifyMemoryIntegration sends only --agent and reads the verification", async () => {
  const calls: string[][] = [];
  const verification = await verifyMemoryIntegration({
    agentId: "claude-code", home: "/Users/tester",
    run: async (command, args) => {
      calls.push([command, ...args]);
      return {
        status: 0,
        stdout: JSON.stringify({
          schemaVersion: 1,
          verification: {
            agentId: "claude-code",
            mcp: { path: "/Users/tester/.claude.json", present: true },
            instructions: { supported: true, paths: ["/Users/tester/.claude/CLAUDE.md"], present: true },
            overallStatus: "complete",
          },
        }),
        stderr: "",
      };
    },
  });
  expect(calls).toEqual([[
    "/Users/tester/.forge614/engines/bin/forge614-engines", "verify", "memory-integration", "--agent", "claude-code",
  ]]);
  expect(verification).toEqual({
    agentId: "claude-code",
    mcp: { path: "/Users/tester/.claude.json", present: true },
    instructions: { supported: true, paths: ["/Users/tester/.claude/CLAUDE.md"], present: true },
    overallStatus: "complete",
  });
});

test("verifyMemoryIntegration reports complete for Cursor once its MCP is present, per Engines' own achievable-state semantics", async () => {
  const verification = await verifyMemoryIntegration({
    agentId: "cursor", home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        verification: {
          agentId: "cursor",
          mcp: { path: "/Users/tester/.cursor/mcp.json", present: true },
          instructions: { supported: false, paths: [], present: false },
          overallStatus: "complete",
        },
      }),
      stderr: "",
    }),
  });
  // Shell's own downgrade of this case to a non-"configured" outcome is app-layer logic (Task 3),
  // not this wrapper's job — this wrapper only reports Engines' contract faithfully.
  expect(verification.overallStatus).toBe("complete");
  expect(verification.instructions.supported).toBe(false);
});

test("verifyMemoryIntegration reports absent when nothing was ever installed", async () => {
  const verification = await verifyMemoryIntegration({
    agentId: "claude-code", home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        verification: {
          agentId: "claude-code",
          mcp: { path: "/Users/tester/.claude.json", present: false },
          instructions: { supported: true, paths: ["/Users/tester/.claude/CLAUDE.md"], present: false },
          overallStatus: "absent",
        },
      }),
      stderr: "",
    }),
  });
  expect(verification.overallStatus).toBe("absent");
});

test("verifyMemoryIntegration rejects a malformed result instead of guessing its shape", async () => {
  await expect(verifyMemoryIntegration({
    agentId: "claude-code", home: "/Users/tester",
    run: async () => ({ status: 0, stdout: JSON.stringify({ schemaVersion: 1, verification: { agentId: "claude-code" } }), stderr: "" }),
  })).rejects.toThrow("forge614-engines returned an invalid verification result.");
});
