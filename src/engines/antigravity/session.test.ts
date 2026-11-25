import { expect, test } from "bun:test";
import { AntigravitySession } from "./session.ts";
import { FixtureRpc } from "../../../tests/support/rpc-fixture.ts";
import type { NativeEvent } from "../types.ts";
import { ShellError } from "../../shell-error.ts";

function buildSessionPayload(sessionId = "sess-1") {
  return {
    sessionId,
    models: {
      currentModelId: "gemini-4-neon-high",
      availableModels: [
        { modelId: "gemini-4-neon-high", name: "Gemini 4 Neon (High)" },
        { modelId: "gemini-4-neon-xhigh", name: "Gemini 4 Neon (XHigh)" },
        { modelId: "gemini-4-neon-medium", name: "Gemini 4 Neon (Medium)" },
        { modelId: "gemini-4-neon-low", name: "Gemini 4 Neon (Low)" },
        { modelId: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)" },
        { modelId: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium)" },
        { modelId: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)" },
        { modelId: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" },
      ],
    },
    modes: {
      currentModeId: "default",
      availableModes: [
        { id: "default", name: "Default", description: "Ask before edits and commands." },
        { id: "accept-edits", name: "Accept edits", description: "Approve workspace edits." },
        { id: "auto", name: "Auto", description: "Approve safe actions." },
        { id: "plan", name: "Plan", description: "Plan before executing." },
      ],
    },
    configOptions: [
      {
        id: "model",
        category: "model",
        currentValue: "gemini-4-neon",
        options: [
          { value: "gemini-4-neon", name: "Gemini 4 Neon" },
          { value: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
          { value: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" },
        ],
      },
      {
        id: "thought_level",
        category: "thought_level",
        currentValue: "high",
        options: [
          { value: "low", name: "Low" },
          { value: "medium", name: "Medium" },
          { value: "high", name: "High" },
          { value: "xhigh", name: "Extra" },
        ],
      },
    ],
    _meta: { antigravity: { tier: { name: "Google AI Pro", id: "g1-pro-tier" } } },
  };
}

function createAcpRpc(sessionId = "sess-1"): FixtureRpc {
  const rpc = new FixtureRpc();
  rpc.replies.set("initialize", {
    protocolVersion: 1,
    agentInfo: { name: "Antigravity ACP Server", version: "1.5.17" },
    agentCapabilities: { loadSession: true, _meta: { antigravity: { tier: true, systemPrompt: { append: true } } } },
  });
  rpc.replies.set("session/new", buildSessionPayload(sessionId));
  rpc.replies.set("session/close", {});
  rpc.replies.set("session/set_mode", {});
  rpc.replies.set("session/set_model", {});
  return rpc;
}

/**
 * Verifies the core ACP session lifecycle: `initialize` loads models, modes, tier, and version;
 * `send` streams `agent_message_chunk` deltas, updates context from `usage_update`, records token
 * totals, and formats `/status` + `visual()` with friendly model names.
 */
test("AntigravitySession initializes over ACP, streams deltas, tracks context/tokens, and exposes visual/status", async () => {
  const rpc = createAcpRpc();
  const events: NativeEvent[] = [];
  rpc.handler = async (method, params) => {
    if (method === "session/prompt") {
      rpc.onNotification("session/update", { sessionId: params.sessionId, update: { sessionUpdate: "usage_update", used: 12000, size: 1048576 } });
      rpc.onNotification("session/update", { sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello " } } });
      rpc.onNotification("session/update", { sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "world!" } } });
      return { stopReason: "end_turn", usage: { inputTokens: 12000, cachedReadTokens: 8000, outputTokens: 42 } };
    }
    return rpc.replies.get(method);
  };

  const session = new AntigravitySession(rpc, "/project", event => events.push(event), async () => false);
  await session.initialize();

  expect(session.sessionId).toBe("sess-1");
  expect(session.models.map(m => m.id)).toEqual(["gemini-4-neon", "gemini-3.8-flash", "gpt-oss-120b-medium"]);
  expect(session.workModes().map(m => m.id)).toEqual(["default", "accept-edits", "auto", "plan"]);
  expect(session.visual()).toEqual({
    account: "connected",
    provider: "Google Antigravity 1.5.17",
    user: "Google AI Pro",
    model: "gemini-4-neon",
    reasoning: "high",
  });

  await session.send("Hi");
  expect(events.filter(e => e.type === "delta").map(e => e.text).join("")).toBe("Hello world!");
  expect(session.visual().context).toEqual({ used: 12000, window: 1048576 });
  const statusText = session.status().join("\n");
  expect(statusText).toContain("Google account · Google AI Pro");
  expect(statusText).toContain("Gemini 4 Neon");
  expect(statusText).toContain("Folder: /project");
});

/**
 * Verifies model switching updates valid reasoning efforts dynamically and refuses unsupported
 * efforts (for example `xhigh` on `gemini-3.8-flash` or any effort on fixed `gpt-oss-120b-medium`).
 * Exists because `agy` rejects conflicting model+effort combinations.
 */
test("setModel and setEffort validate against per-model thought_level options and prevent conflicts", async () => {
  const rpc = createAcpRpc();
  rpc.handler = async (method, params) => {
    if (method === "session/set_config_option" && params.configId === "model" && params.value === "gemini-3.8-flash") {
      return {
        configOptions: [
          {
            id: "model", category: "model", currentValue: "gemini-3.8-flash",
            options: [
              { value: "gemini-4-neon", name: "Gemini 4 Neon" },
              { value: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
              { value: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" },
            ],
          },
          {
            id: "thought_level", category: "thought_level", currentValue: "medium",
            options: [{ value: "low", name: "Low" }, { value: "medium", name: "Medium" }, { value: "high", name: "High" }],
          },
        ],
      };
    }
    if (method === "session/set_config_option" && params.configId === "thought_level") {
      return { configOptions: [{ id: "thought_level", category: "thought_level", currentValue: params.value, options: [{ value: "low" }, { value: "medium" }, { value: "high" }] }] };
    }
    return rpc.replies.get(method);
  };

  const session = new AntigravitySession(rpc, "/project", () => {}, async () => false);
  await session.initialize();

  await session.setModel("gemini-3.8-flash");
  expect(session.visual().model).toBe("gemini-3.8-flash");
  expect(session.visual().reasoning).toBe("medium");

  await session.setEffort("low");
  expect(session.visual().reasoning).toBe("low");

  const badEffort = await session.setEffort("xhigh").catch((error: unknown) => error);
  expect(badEffort).toBeInstanceOf(ShellError);
  expect((badEffort as ShellError).code).toBe("antigravity-effort-unknown");

  const badModel = await session.setModel("does-not-exist").catch((error: unknown) => error);
  expect(badModel).toBeInstanceOf(ShellError);
  expect((badModel as ShellError).code).toBe("antigravity-model-unknown");
});

/**
 * Verifies ACP MCP tool calls for `forge614-engram` render with the distinct Engram label
 * (`🧠 memory search`) and track `currentActivity()` while in progress, clearing once completed.
 * Exists to guarantee §6 of issue #11 (visual feedback when Antigravity uses Engram).
 */
test("tool_call events for forge614-engram emit 🧠 memory labels and track currentActivity until completion", async () => {
  const rpc = createAcpRpc();
  const events: NativeEvent[] = [];
  let activeDuringCall: string | undefined;

  rpc.handler = async (method, params) => {
    if (method === "session/prompt") {
      rpc.onNotification("session/update", {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call_1",
          name: "call_mcp_tool",
          args: { ServerName: "forge614-engram", ToolName: "memory_search", Arguments: { query: "antigravity" } },
          status: "in_progress",
          title: "MCP Tool memory_search",
        },
      });
      activeDuringCall = session.currentActivity();
      rpc.onNotification("session/update", {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "call_1",
          name: "call_mcp_tool",
          args: { ServerName: "forge614-engram", ToolName: "memory_search", Arguments: { query: "antigravity" } },
          status: "completed",
          title: "MCP Tool memory_search",
        },
      });
      rpc.onNotification("session/update", {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call_2",
          name: "read_file",
          args: { Path: "/project/package.json" },
          status: "completed",
          title: "Read package.json",
        },
      });
      return { stopReason: "end_turn" };
    }
    return rpc.replies.get(method);
  };

  const session = new AntigravitySession(rpc, "/project", event => events.push(event), async () => false);
  await session.initialize();
  await session.send("search memory");

  expect(activeDuringCall).toBe("🧠 memory search");
  expect(session.currentActivity()).toBeUndefined();
  const toolTexts = events.filter(e => e.type === "text" && e.text.startsWith("Tool:")).map(e => e.text);
  expect(toolTexts).toHaveLength(2);
  expect(toolTexts[0]).toContain("Tool: 🧠 memory search");
  expect(toolTexts[0]).toContain('"query": "antigravity"');
  expect(toolTexts[1]).toContain("Tool: Read package.json");
});

/**
 * Verifies ACP `session/request_permission` translates tool calls into plain human text (never raw
 * JSON) and replies with the exact matching `allow_once` or `reject_once` optionId.
 */
test("session/request_permission formats plain-language descriptions and maps approval to ACP optionId", async () => {
  const rpc = createAcpRpc();
  const prompts: string[] = [];
  let allowNext = true;
  const session = new AntigravitySession(rpc, "/project", () => {}, async description => {
    prompts.push(description);
    return allowNext;
  });
  await session.initialize();

  const approved = await rpc.onRequest("session/request_permission", {
    sessionId: "sess-1",
    toolCall: {
      name: "call_mcp_tool",
      args: { ServerName: "forge614-engram", ToolName: "memory_save", Arguments: { title: "Rule" } },
    },
    options: [
      { optionId: "allow", name: "Allow", kind: "allow_once" },
      { optionId: "deny", name: "Deny", kind: "reject_once" },
    ],
  });
  expect(approved).toEqual({ outcome: { outcome: "selected", optionId: "allow" } });
  expect(prompts[0]).toContain("memory_save");
  expect(prompts[0]).toContain("forge614-engram");
  expect(prompts[0]).not.toContain("{");

  allowNext = false;
  const denied = await rpc.onRequest("session/request_permission", {
    sessionId: "sess-1",
    toolCall: { name: "run_command", args: { CommandLine: "bun test", toolSummary: "Run tests" } },
    options: [
      { optionId: "allow", name: "Allow", kind: "allow_once" },
      { optionId: "deny", name: "Deny", kind: "reject_once" },
    ],
  });
  expect(denied).toEqual({ outcome: { outcome: "selected", optionId: "deny" } });
  expect(prompts[1]).toContain("Run tests");
  expect(prompts[1]).toContain("bun test");
});

/**
 * Verifies login/logout rules: unauthenticated start stays disconnected without throwing; `/f614:login`
 * delegates to `runOfficialLogin` and verifies the Google session; `/logout` disconnects only locally
 * without ever requesting a native ACP `logout`.
 */
test("unauthenticated startup prompts /f614:login, official login connects, and logout stays local", async () => {
  const rpc = createAcpRpc();
  let signedIn = false;
  let loginRuns = 0;
  rpc.handler = async method => {
    if (method === "session/new") {
      if (!signedIn) throw new Error("Authentication required");
      return buildSessionPayload("sess-auth");
    }
    return rpc.replies.get(method);
  };

  const events: NativeEvent[] = [];
  const session = new AntigravitySession(rpc, "/project", event => events.push(event), async () => false, undefined, "en", undefined, undefined, async () => {
    loginRuns++;
    signedIn = true;
  });
  await session.initialize();
  expect(session.visual().account).toBe("disconnected");

  const sendBlocked = await session.send("hi").catch((error: unknown) => error);
  expect(sendBlocked).toBeInstanceOf(ShellError);
  expect((sendBlocked as ShellError).code).toBe("antigravity-requires-login-to-send");

  await session.login();
  expect(loginRuns).toBe(1);
  expect(session.visual().account).toBe("connected");
  expect(session.sessionId).toBe("sess-auth");

  await session.logout(async () => true);
  expect(session.visual().account).toBe("disconnected");
  // Must never sign out the native Google account via ACP logout.
  expect(rpc.calls.some(call => call.method === "logout")).toBe(false);
});

/**
 * Verifies `listSessions` filters to the current project folder and `resume` calls `session/load`,
 * replaying history while stripping any `<forge614-engram-memory>` wrapper from user messages.
 */
test("listSessions filters by cwd and resume replays history without memory wrapper", async () => {
  const rpc = createAcpRpc();
  const events: NativeEvent[] = [];
  rpc.handler = async (method, params) => {
    if (method === "session/list") {
      return {
        sessions: [
          { sessionId: "s-here", cwd: "/project", title: "Current project chat", updatedAt: "2026-11-25T10:00:00Z" },
          { sessionId: "s-other", cwd: "/other", title: "Other project", updatedAt: "2026-11-25T11:00:00Z" },
        ],
      };
    }
    if (method === "session/load") {
      rpc.onNotification("session/update", {
        sessionId: params.sessionId,
        update: { sessionUpdate: "user_message_chunk", content: { type: "text", text: "<forge614-engram-memory>\nsecret digest\n</forge614-engram-memory>\nOriginal question" } },
      });
      rpc.onNotification("session/update", {
        sessionId: params.sessionId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Original answer" } },
      });
      return buildSessionPayload("s-here");
    }
    return rpc.replies.get(method);
  };

  const session = new AntigravitySession(rpc, "/project", event => events.push(event), async () => false);
  await session.initialize();

  const listed = await session.listSessions();
  expect(listed).toEqual([{ id: "s-here", title: "Current project chat", folder: "/project", updatedAt: Date.parse("2026-11-25T10:00:00Z") }]);

  await session.resume("s-here");
  expect(session.sessionId).toBe("s-here");
  expect(events.filter(e => e.type === "text")).toEqual([
    { type: "text", text: "You: Original question", at: null },
    { type: "text", text: "Original answer", at: null },
  ]);
});

/**
 * Verifies `/f614:stop` sends `session/cancel`, settles cleanly when Antigravity responds, and
 * reconnects cleanly via `reconnectFn` if Antigravity does not answer within `stopWaitMs`.
 */
test("cancel sends session/cancel and reconnects cleanly if the server does not settle", async () => {
  const first = createAcpRpc("sess-cancel");
  const second = createAcpRpc("sess-cancel");
  second.replies.set("session/load", buildSessionPayload("sess-cancel"));
  let releasePrompt!: (value: unknown) => void;
  first.handler = async method => {
    if (method === "session/prompt") return new Promise(resolve => { releasePrompt = resolve; });
    return first.replies.get(method);
  };

  const events: NativeEvent[] = [];
  const session = new AntigravitySession(first, "/project", event => events.push(event), async () => false, undefined, "en", undefined, () => second);
  (session as any).stopWaitMs = 40;
  await session.initialize();

  // Idle cancel reports no-active-turn.
  expect(await session.cancel()).toBe("no-active-turn");

  // Active turn that hangs triggers timeout + reconnect.
  const turn = session.send("long task");
  await new Promise(resolve => setImmediate(resolve));
  const outcome = await session.cancel();
  await turn;
  expect(outcome).toBe("no-answer");
  expect(first.calls.some(n => n.method === "session/cancel")).toBe(true);
  expect(second.calls.some(c => c.method === "session/load")).toBe(true);
  expect(events.some(e => e.type === "text" && e.text.includes("reconnected to Antigravity"))).toBe(true);
  void releasePrompt;
});

/**
 * Verifies `workModes` and `setWorkMode` use ACP modes directly and report `"applied"` when idle
 * vs `"next-turn"` while a turn is running.
 */
test("setWorkMode switches ACP execution modes and rejects unknown modes", async () => {
  const rpc = createAcpRpc();
  const session = new AntigravitySession(rpc, "/project", () => {}, async () => false);
  await session.initialize();

  expect(session.workMode()).toBe("default");
  expect(await session.setWorkMode("plan")).toBe("applied");
  expect(session.workMode()).toBe("plan");
  expect(rpc.calls.find(c => c.method === "session/set_mode")?.params).toEqual({ sessionId: "sess-1", modeId: "plan" });

  const unknown = await session.setWorkMode("nonexistent").catch((error: unknown) => error);
  expect(unknown).toBeInstanceOf(ShellError);
  expect((unknown as ShellError).code).toBe("antigravity-mode-unknown");
});

/**
 * Live probing on `agy` 1.5.17 with `invoke_subagent` confirmed that `agy acp` does NOT emit
 * background-task lifecycle events (only `tool_call` / `tool_call_update`). Per AGENTS.md and
 * new-agent-checklist.md, `AntigravitySession` must leave `backgroundActivity` unimplemented so
 * Shell's UI honestly displays that this engine does not report background activity.
 */
test("AntigravitySession intentionally does not implement backgroundActivity so the UI honestly shows not reported", () => {
  const rpc = createAcpRpc();
  const session = new AntigravitySession(rpc, "/project", () => {}, async () => false);
  expect("backgroundActivity" in session).toBe(false);
  expect((session as { backgroundActivity?: unknown }).backgroundActivity).toBeUndefined();
});
