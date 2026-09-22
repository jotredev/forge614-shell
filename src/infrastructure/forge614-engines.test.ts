import { expect, test } from "bun:test";
import { applyEnginesPlan, defaultRun, discoverMcpCapableAgents, discoverSelectableEngines, planMcpInstall, planMcpRemove, planMemoryInstall, removeEngramMcpFromAgent, verifyMemoryIntegration } from "./forge614-engines.ts";

test("the real runner execs asynchronously — it does not block the event loop, so a caller can show live progress while it runs", async () => {
  let tickedWhileRunning = false;
  const timer = setInterval(() => { tickedWhileRunning = true; }, 0);
  const result = await defaultRun(process.execPath, ["-e", "console.log('ready')"]);
  clearInterval(timer);
  expect(tickedWhileRunning).toBe(true);
  expect(result).toEqual({ status: 0, stdout: "ready\n", stderr: "" });
});

test("the real runner reports a non-zero exit with its stdout/stderr intact, not a thrown rejection", async () => {
  const result = await defaultRun(process.execPath, ["-e", "console.error('boom'); process.exit(3)"]);
  expect(result.status).toBe(3);
  expect(result.stderr).toContain("boom");
});

test("the real runner reports a missing binary as no exit status, not a crash", async () => {
  const result = await defaultRun("/definitely/not/a/real/forge614-engines-binary", []);
  expect(result.status).toBeNull();
});

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

test("applyEnginesPlan sends the plan id and reports the changed files", async () => {
  const calls: string[][] = [];
  const result = await applyEnginesPlan({
    planId: "plan-1", home: "/Users/tester",
    run: async (command, args) => {
      calls.push([command, ...args]);
      return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, result: { planId: "plan-1", applied: true, changedFiles: ["/Users/tester/.claude.json"] } }), stderr: "" };
    },
  });
  expect(calls).toEqual([["/Users/tester/.forge614/engines/bin/forge614-engines", "apply", "--plan-id", "plan-1"]]);
  expect(result).toEqual({ applied: true, changedFiles: ["/Users/tester/.claude.json"] });
});

test("applyEnginesPlan throws Engines' own message when the plan id is unknown", async () => {
  await expect(applyEnginesPlan({
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
              hook: { path: "/Users/tester/.claude/settings.json", status: { kind: "write" }, runtimeStatus: { kind: "pending-runtime-verification", reason: "no-evidence" } },
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
    hook: { path: "/Users/tester/.claude/settings.json", status: { kind: "write" }, runtimeStatus: { kind: "pending-runtime-verification", reason: "no-evidence" } },
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
            hook: { path: "/r", status: { kind: "write" }, runtimeStatus: { kind: "pending-runtime-verification", reason: "no-evidence" } },
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
            hook: { path: "", status: { kind: "unsupported", reason: "Cursor has no officially supported, stable session-start hook mechanism this installer configures" }, runtimeStatus: { kind: "unsupported" } },
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
            hook: { path: "/Users/tester/.claude/settings.json", status: { kind: "noop" }, runtimeStatus: { kind: "pending-runtime-verification", reason: "no-evidence" } },
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

test("planMemoryInstall parses the hook component and its runtime status", async () => {
  const plan = await planMemoryInstall({
    agentId: "codex", home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        plan: {
          planId: "plan-1", agentId: "codex", action: "memory-install", noop: false,
          writes: [{ path: "/Users/tester/.codex/config.toml", beforeHash: "x", afterContent: "SECRET" }],
          metadata: {
            mcp: { path: "/Users/tester/.codex/config.toml", status: { kind: "noop" } },
            instructions: { paths: ["/Users/tester/.codex/AGENTS.md"], status: { kind: "noop" } },
            hook: { path: "/Users/tester/.codex/config.toml", status: { kind: "write" }, runtimeStatus: { kind: "needs-user-trust" } },
            overallStatus: "partial",
          },
        },
      }),
      stderr: "",
    }),
  });
  expect(plan.hook).toEqual({
    path: "/Users/tester/.codex/config.toml",
    status: { kind: "write" },
    runtimeStatus: { kind: "needs-user-trust" },
  });
});

test("planMemoryInstall parses a pending-runtime-verification reason", async () => {
  const plan = await planMemoryInstall({
    agentId: "claude-code", home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        plan: {
          planId: "plan-1", agentId: "claude-code", action: "memory-install", noop: false, writes: [],
          metadata: {
            mcp: { path: "/Users/tester/.claude.json", status: { kind: "noop" } },
            instructions: { paths: ["/Users/tester/.claude/CLAUDE.md"], status: { kind: "noop" } },
            hook: { path: "/Users/tester/.claude/settings.json", status: { kind: "write" }, runtimeStatus: { kind: "pending-runtime-verification", reason: "no-evidence" } },
            overallStatus: "partial",
          },
        },
      }),
      stderr: "",
    }),
  });
  expect(plan.hook.runtimeStatus).toEqual({ kind: "pending-runtime-verification", reason: "no-evidence" });
});

test("planMemoryInstall parses the evidence-expired reason distinctly from no-evidence", async () => {
  const plan = await planMemoryInstall({
    agentId: "claude-code", home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        plan: {
          planId: "plan-1", agentId: "claude-code", action: "memory-install", noop: true, writes: [],
          metadata: {
            mcp: { path: "/Users/tester/.claude.json", status: { kind: "noop" } },
            instructions: { paths: ["/Users/tester/.claude/CLAUDE.md"], status: { kind: "noop" } },
            hook: { path: "/Users/tester/.claude/settings.json", status: { kind: "noop" }, runtimeStatus: { kind: "pending-runtime-verification", reason: "evidence-expired" } },
            overallStatus: "partial",
          },
        },
      }),
      stderr: "",
    }),
  });
  expect(plan.hook.runtimeStatus).toEqual({ kind: "pending-runtime-verification", reason: "evidence-expired" });
});

test("planMemoryInstall rejects a pending-runtime-verification status with an unrecognized reason", async () => {
  await expect(planMemoryInstall({
    agentId: "claude-code", home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        plan: {
          planId: "plan-1", agentId: "claude-code", action: "memory-install", noop: false, writes: [],
          metadata: {
            mcp: { path: "/x", status: { kind: "noop" } },
            instructions: { paths: [], status: { kind: "noop" } },
            hook: { path: "/y", status: { kind: "write" }, runtimeStatus: { kind: "pending-runtime-verification", reason: "made-up-reason" } },
            overallStatus: "partial",
          },
        },
      }),
      stderr: "",
    }),
  })).rejects.toThrow("forge614-engines returned an invalid plan.");
});

test("planMemoryInstall never hardcodes an Engines version check — it detects the contract purely by the hook field's presence", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("./forge614-engines.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/1\.9\.0|1\.10\.0/);
});

test("planMemoryInstall tells the user to update Engines when the hook component is entirely missing (Engines predates the memory-hook contract)", async () => {
  await expect(planMemoryInstall({
    agentId: "claude-code", home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        plan: {
          planId: "plan-1", agentId: "claude-code", action: "memory-install", noop: false, writes: [],
          metadata: {
            mcp: { path: "/Users/tester/.claude.json", status: { kind: "noop" } },
            instructions: { paths: ["/Users/tester/.claude/CLAUDE.md"], status: { kind: "noop" } },
            overallStatus: "complete",
          },
        },
      }),
      stderr: "",
    }),
  })).rejects.toThrow('Forge614 Engines needs to be updated. Run "forge614-shell update", then try again.');
});

test("verifyMemoryIntegration parses the hook component including dryRunOk and runtime-observed", async () => {
  const verification = await verifyMemoryIntegration({
    agentId: "claude-code", home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        verification: {
          agentId: "claude-code",
          mcp: { path: "/Users/tester/.claude.json", present: true },
          instructions: { supported: true, paths: ["/Users/tester/.claude/CLAUDE.md"], present: true },
          hook: { supported: true, path: "/Users/tester/.claude/settings.json", present: true, dryRunOk: true, runtimeStatus: { kind: "runtime-observed" } },
          overallStatus: "complete",
        },
      }),
      stderr: "",
    }),
  });
  expect(verification.hook).toEqual({
    supported: true, path: "/Users/tester/.claude/settings.json", present: true, dryRunOk: true,
    runtimeStatus: { kind: "runtime-observed" },
  });
});

test("verifyMemoryIntegration parses evidence-expired the same way it parses no-evidence (both are pending-runtime-verification with different reasons)", async () => {
  const verification = await verifyMemoryIntegration({
    agentId: "claude-code", home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        verification: {
          agentId: "claude-code",
          mcp: { path: "/Users/tester/.claude.json", present: true },
          instructions: { supported: true, paths: ["/Users/tester/.claude/CLAUDE.md"], present: true },
          hook: { supported: true, path: "/Users/tester/.claude/settings.json", present: true, dryRunOk: true, runtimeStatus: { kind: "pending-runtime-verification", reason: "evidence-expired" } },
          overallStatus: "partial",
        },
      }),
      stderr: "",
    }),
  });
  expect(verification.hook.runtimeStatus).toEqual({ kind: "pending-runtime-verification", reason: "evidence-expired" });
});

test("verifyMemoryIntegration tells the user to update Engines when the hook component is entirely missing", async () => {
  await expect(verifyMemoryIntegration({
    agentId: "claude-code", home: "/Users/tester",
    run: async () => ({
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
    }),
  })).rejects.toThrow('Forge614 Engines needs to be updated. Run "forge614-shell update", then try again.');
});

test("verifyMemoryIntegration still rejects a genuinely malformed result as invalid, not as an outdated-Engines hint", async () => {
  await expect(verifyMemoryIntegration({
    agentId: "claude-code", home: "/Users/tester",
    run: async () => ({ status: 0, stdout: JSON.stringify({ schemaVersion: 1, verification: { agentId: "claude-code" } }), stderr: "" }),
  })).rejects.toThrow("forge614-engines returned an invalid verification result.");
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
            hook: { supported: true, path: "/Users/tester/.claude/settings.json", present: true, dryRunOk: true, runtimeStatus: { kind: "runtime-observed" } },
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
    hook: { supported: true, path: "/Users/tester/.claude/settings.json", present: true, dryRunOk: true, runtimeStatus: { kind: "runtime-observed" } },
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
          hook: { supported: false, path: "", present: false, dryRunOk: false, runtimeStatus: { kind: "unsupported" } },
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
          hook: { supported: true, path: "/Users/tester/.claude/settings.json", present: false, dryRunOk: false, runtimeStatus: { kind: "absent" } },
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

import { updateEngines } from "./forge614-engines.ts";

test("updateEngines sends the bare update command and reads the result", async () => {
  const calls: string[][] = [];
  const result = await updateEngines({
    home: "/Users/tester",
    run: async (command, args) => {
      calls.push([command, ...args]);
      return {
        status: 0,
        stdout: JSON.stringify({ schemaVersion: 1, result: { updated: true, currentVersion: "1.3.0", latestVersion: "1.4.0" } }),
        stderr: "",
      };
    },
  });
  expect(calls).toEqual([["/Users/tester/.forge614/engines/bin/forge614-engines", "update"]]);
  expect(result).toEqual({ updated: true, currentVersion: "1.3.0", latestVersion: "1.4.0" });
});

test("updateEngines reports already up to date, with no note field when Engines sends none", async () => {
  const result = await updateEngines({
    home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: JSON.stringify({ schemaVersion: 1, result: { updated: false, currentVersion: "1.4.0", latestVersion: "1.4.0" } }),
      stderr: "",
    }),
  });
  expect(result).toEqual({ updated: false, currentVersion: "1.4.0", latestVersion: "1.4.0" });
  expect("note" in result).toBe(false);
});

test("updateEngines keeps Engines' own note when present", async () => {
  const result = await updateEngines({
    home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        result: { updated: true, currentVersion: "1.3.0", latestVersion: "1.4.0", note: "Restart your terminal to pick up the new PATH entry." },
      }),
      stderr: "",
    }),
  });
  expect(result.note).toBe("Restart your terminal to pick up the new PATH entry.");
});

test("updateEngines throws Engines' own message for a hard failure", async () => {
  await expect(updateEngines({
    home: "/Users/tester",
    run: async () => ({
      status: 1,
      stdout: JSON.stringify({ schemaVersion: 1, error: { code: "UPDATE_ASSET_MISSING", message: "The latest release has no Forge614 Engines asset for darwin-arm64" } }),
      stderr: "",
    }),
  })).rejects.toThrow("The latest release has no Forge614 Engines asset for darwin-arm64");
});

test("updateEngines rejects a malformed result instead of guessing its shape", async () => {
  await expect(updateEngines({
    home: "/Users/tester",
    run: async () => ({ status: 0, stdout: JSON.stringify({ schemaVersion: 1, result: { updated: true } }), stderr: "" }),
  })).rejects.toThrow("forge614-engines returned an invalid update result.");
});

test("updateEngines never echoes raw stdout when it can't be parsed as JSON", async () => {
  const error = await updateEngines({
    home: "/Users/tester",
    run: async () => ({ status: 1, stdout: "Downloading forge614-engines 1.4.0...\ngarbage", stderr: "" }),
  }).catch((thrown: Error) => thrown);
  expect((error as Error).message).toBe("forge614-engines update failed.");
  expect((error as Error).message).not.toContain("Downloading");
});
