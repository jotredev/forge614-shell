import { expect, test } from "bun:test";
import { CodexSession } from "./session.ts";
import { FixtureRpc } from "../../../tests/support/rpc-fixture.ts";

function codexFixture() {
  const rpc = new FixtureRpc();
  rpc.replies.set("initialize", {});
  rpc.replies.set("account/read", { account: { type: "chatgpt", planType: "plus" }, requiresOpenaiAuth: true });
  rpc.replies.set("model/list", { data: [{ model: "test-model", displayName: "Test model", isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "medium" }, { reasoningEffort: "high" }] }], nextCursor: null });
  rpc.replies.set("account/rateLimits/read", { rateLimits: { primary: { usedPercent: 24, resetsAt: 1900000000, windowDurationMins: 10080 } } });
  return rpc;
}

test("manual quota refresh reads account limits without starting a model turn", async () => {
  const rpc = codexFixture();
  const session = new CodexSession(rpc, "/project", () => {}, async () => false);
  await session.initialize();
  rpc.replies.set("account/rateLimits/read", { rateLimits: { primary: { usedPercent: 0, resetsAt: 1900000000, windowDurationMins: 10080 } } });
  const before = rpc.calls.length;
  await session.refreshUsage();
  expect(rpc.calls.slice(before).map(call => call.method)).toEqual(["account/rateLimits/read"]);
  expect(session.visual().usage?.[0]?.usedPercent).toBe(0);
  expect(session.visual().usage?.[0]?.reset).toBe(new Date(1900000000000).toISOString());
});

test("Codex logout is local and reconnect reuses the untouched native account", async () => {
  for (const allow of [false, true]) {
    const rpc = codexFixture(); const events: any[] = [];
    const session = new CodexSession(rpc, "/project", e => events.push(e), async () => allow);
    await session.initialize();
    const before = rpc.calls.length;
    await session.logout();
    expect(rpc.calls.length).toBe(before);
    expect(rpc.calls.some(c => c.method === "account/login/start")).toBe(false);
    expect(session.status().join(" ").includes("24%")).toBe(!allow);
    expect(session.busy).toBe(false);
    if (allow) {
      expect(session.status()[0]).toContain("/login");
      session.reset();
      await expect(session.send("hello")).rejects.toThrow("/login");
      expect(rpc.calls.length).toBe(before);
      await session.login();
      expect(session.status()[0]).toContain("ChatGPT");
      expect(rpc.calls.some(c => c.method === "account/logout" || c.method === "account/login/start")).toBe(false);
    }
  }
});

test("Codex visual state clears reported model and context after local logout", async () => {
  const rpc = new FixtureRpc();
  rpc.replies.set("initialize", {});
  rpc.replies.set("account/read", { account: { type: "chatgpt", planType: "plus" }, requiresOpenaiAuth: true });
  rpc.replies.set("model/list", { data: [{ model: "gpt-5.6", displayName: "GPT-5.6", isDefault: true, defaultReasoningEffort: "medium" }], nextCursor: null });
  rpc.replies.set("account/rateLimits/read", { rateLimits: { primary: { usedPercent: 74, resetsAt: 1_789_000_000 } } });
  const session = new CodexSession(rpc, "/project", () => {}, async () => true);

  await session.initialize();
  rpc.onNotification("thread/tokenUsage/updated", { tokenUsage: { total: { inputTokens: 10_000, cachedInputTokens: 2_000, outputTokens: 1_000 }, last: { totalTokens: 18_000 }, modelContextWindow: 128_000 } });
  expect(session.visual()).toMatchObject({ account: "connected", provider: "Codex", model: "gpt-5.6", reasoning: "medium", context: { used: 18_000, window: 128_000 } });

  await session.logout();
  expect(session.visual()).toEqual({ account: "disconnected", provider: "Codex" });
});

test("Codex logout can be cancelled before consent and is blocked during a turn", async () => {
  const rpc = codexFixture();
  const session = new CodexSession(rpc, "/project", () => {}, async (_text, signal) => new Promise(resolve => signal.addEventListener("abort", () => resolve(false), { once: true })));
  const pending = session.logout();
  await expect(session.logout()).rejects.toThrow("active");
  await session.cancel(); await pending;
  expect(rpc.calls.some(c => c.method === "account/logout")).toBe(false);
  expect(session.busy).toBe(false);
});

test("Codex startup loads native model metadata but never starts a turn", async () => {
  const rpc = codexFixture(); const session = new CodexSession(rpc, "/project", () => {}, async () => false);
  await session.initialize();
  expect(session.models[0]?.id).toBe("test-model");
  expect(session.status().join("\n")).toContain("24%");
  expect(rpc.calls.some(call => call.method === "turn/start")).toBe(false);
  await expect(session.setEffort("impossible")).rejects.toThrow();
});

test("Codex login preserves an existing ChatGPT account without starting OAuth", async () => {
  const rpc = codexFixture();
  const session = new CodexSession(rpc, "/project", () => {}, async () => false);
  await session.login();
  expect(rpc.calls.some(call => call.method === "account/login/start")).toBe(false);
  expect(session.busy).toBe(false);
});

test("Codex rejects API authentication before sending a prompt", async () => {
  const rpc = codexFixture(); rpc.replies.set("account/read", { account: { type: "apiKey" } });
  const session = new CodexSession(rpc, "/project", () => {}, async () => false);
  await session.initialize();
  await expect(session.send("hello")).rejects.toThrow("ChatGPT");
  expect(rpc.calls.some(call => call.method === "thread/start" || call.method === "turn/start")).toBe(false);
});

test("Codex streams a turn, scopes events and never grants denied permissions", async () => {
  const rpc = codexFixture(); const events: any[] = [];
  const session = new CodexSession(rpc, "/project", event => events.push(event), async () => false);
  await session.initialize();
  await session.setEffort("high");
  rpc.replies.set("thread/start", { thread: { id: "t" }, model: "test-model", modelProvider: "openai", reasoningEffort: "medium" });
  rpc.replies.set("turn/start", { turn: { id: "u", status: "inProgress" } });
  const pending = session.send("hello");
  await new Promise(resolve => setImmediate(resolve));
  expect(session.busy).toBe(true);
  expect(rpc.calls.find(call => call.method === "turn/start")?.params.effort).toBe("high");
  expect(rpc.calls.find(call => call.method === "thread/start")?.params).toMatchObject({ cwd: "/project", approvalPolicy: "untrusted", sandbox: "workspace-write", modelProvider: "openai" });
  rpc.onNotification("item/agentMessage/delta", { threadId: "other", delta: "IGNORE" });
  rpc.onNotification("item/agentMessage/delta", { threadId: "t", turnId: "u", itemId: "i", delta: "hello" });
  const decision = await rpc.onRequest("item/commandExecution/requestApproval", { threadId: "t", turnId: "u", command: "touch example" });
  expect(decision).toEqual({ decision: "decline" });
  rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } });
  await pending;
  expect(events.some(event => event.text === "hello")).toBe(true);
  expect(events.some(event => event.text === "IGNORE")).toBe(false);
  expect(session.busy).toBe(false);
});

test("Codex applies only a mode allowed by its native app-server requirements", async () => {
  const rpc = codexFixture();
  rpc.replies.set("configRequirements/read", { requirements: { allowedApprovalPolicies: ["onRequest"], allowedSandboxModes: ["readOnly", "workspaceWrite"] } });
  rpc.replies.set("thread/start", { thread: { id: "t" }, model: "test-model", modelProvider: "openai" });
  rpc.replies.set("turn/start", { turn: { id: "u", status: "inProgress" } });
  const session = new CodexSession(rpc, "/project", () => {}, async () => false);
  await session.initialize();
  expect(session.workModes?.()).toEqual(expect.arrayContaining([{ id: "onRequest:readOnly", label: "onRequest · readOnly" }]));
  await session.setWorkMode?.("onRequest:readOnly");
  const pending = session.send("inspect");
  await new Promise(resolve => setImmediate(resolve));
  expect(rpc.calls.find(call => call.method === "thread/start")?.params).toMatchObject({ approvalPolicy: "onRequest", sandboxPolicy: { type: "readOnly" } });
  rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } });
  await pending;
});

test("Codex resume only restores history and waits for a message", async () => {
  const rpc = codexFixture(); const events: any[] = [];
  const session = new CodexSession(rpc, "/project", event => events.push(event), async () => false);
  await session.initialize();
  rpc.replies.set("thread/read", { thread: { id: "old", cwd: "/project", status: { type: "idle" }, turns: [{ items: [{ type: "agentMessage", text: "old reply" }] }] } });
  await session.resume("old");
  expect(events.some(event => event.text === "old reply")).toBe(true);
  expect(rpc.calls.some(call => call.method === "thread/resume" || call.method === "turn/start")).toBe(false);
});

test("Codex process failure releases an active turn instead of waiting forever", async () => {
  const rpc = codexFixture();
  rpc.replies.set("thread/start", { thread: { id: "t" }, model: "test-model", modelProvider: "openai" });
  rpc.replies.set("turn/start", { turn: { id: "u", status: "inProgress" } });
  const session = new CodexSession(rpc, "/project", () => {}, async () => false);
  await session.initialize();
  const pending = session.send("hello");
  await new Promise(resolve => setImmediate(resolve));
  rpc.onClose(new Error("Engine connection closed"));
  await expect(pending).rejects.toThrow("closed");
  expect(session.busy).toBe(false);
});

test("Codex tracks pending browser login, prevents overlaps and cancels through its native API", async () => {
  const rpc = codexFixture();
  rpc.replies.set("account/read", { account: null, requiresOpenaiAuth: true });
  rpc.replies.set("account/login/start", { type: "chatgpt", loginId: "login-1", authUrl: "https://example.invalid/login" });
  rpc.replies.set("account/login/cancel", { status: "canceled" });
  const session = new CodexSession(rpc, "/project", () => {}, async () => false);
  await session.initialize(); await session.login();
  expect(session.busy).toBe(true);
  await expect(session.login()).rejects.toThrow("active");
  await expect(session.send("hello")).rejects.toThrow("active");
  rpc.onNotification("account/login/completed", { loginId: "unrelated", success: true });
  expect(session.busy).toBe(true);
  await session.cancel();
  expect(rpc.calls.at(-1)).toEqual({ method: "account/login/cancel", params: { loginId: "login-1" } });
  expect(session.busy).toBe(false);
  await session.login();
  rpc.onNotification("account/login/completed", { loginId: "login-1", success: false, error: "cancelled" });
  expect(session.busy).toBe(false);
});

test("Codex opens the returned login URL and keeps a manual fallback if browser launch fails", async () => {
  for (const opened of [true, false]) {
    const rpc = codexFixture(); const events: any[] = []; const urls: string[] = [];
    rpc.replies.set("account/read", { account: null, requiresOpenaiAuth: true });
    const url = "https://auth.openai.com/oauth/authorize?state=test&code_challenge=test";
    rpc.replies.set("account/login/start", { type: "chatgpt", loginId: "login-browser", authUrl: url });
    const session = new CodexSession(rpc, "/project", event => events.push(event), async () => false, async value => { urls.push(value); return opened; });
    await session.initialize(); await session.login();
    expect(urls).toEqual([url]);
    expect(session.busy).toBe(true);
    expect(events.some(event => event.text.includes(url))).toBe(true);
    expect(events.some(event => event.text.includes(opened ? "Browser launch requested" : "Could not open"))).toBe(true);
    expect(rpc.calls.some(call => call.method === "turn/start")).toBe(false);
  }
});

test("an Engram MCP tool call is shown with a brain-labeled activity line", async () => {
  const rpc = codexFixture();
  const events: any[] = [];
  const session = new CodexSession(rpc, "/project", event => events.push(event), async () => false);
  await session.initialize();
  rpc.replies.set("thread/start", { thread: { id: "thread-1" }, model: "test-model", reasoningEffort: "medium", modelProvider: "openai" });
  rpc.handler = async (method, params) => {
    if (method === "turn/start") {
      queueMicrotask(() => {
        rpc.onNotification("item/started", {
          threadId: "thread-1",
          item: { type: "mcpToolCall", id: "call-1", server: "forge614-engram", tool: "memory_search", arguments: { query: "test" } },
        });
        rpc.onNotification("turn/completed", { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } });
      });
      return { turn: { id: "turn-1" } };
    }
    if (!rpc.replies.has(method)) throw new Error(`Unexpected ${method}`);
    return rpc.replies.get(method);
  };
  await session.send("please search memory");
  expect(events.some(event => event.type === "text" && event.text.startsWith("Tool: 🧠 memory search"))).toBe(true);
});

test("an MCP tool call from a server other than forge614-engram falls back to a plain server/tool label", async () => {
  const rpc = codexFixture();
  const events: any[] = [];
  const session = new CodexSession(rpc, "/project", event => events.push(event), async () => false);
  await session.initialize();
  rpc.replies.set("thread/start", { thread: { id: "thread-1" }, model: "test-model", reasoningEffort: "medium", modelProvider: "openai" });
  rpc.handler = async (method) => {
    if (method === "turn/start") {
      queueMicrotask(() => {
        rpc.onNotification("item/started", {
          threadId: "thread-1",
          item: { type: "mcpToolCall", id: "call-1", server: "github", tool: "create_issue", arguments: {} },
        });
        rpc.onNotification("turn/completed", { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } });
      });
      return { turn: { id: "turn-1" } };
    }
    if (!rpc.replies.has(method)) throw new Error(`Unexpected ${method}`);
    return rpc.replies.get(method);
  };
  await session.send("please open an issue");
  expect(events.some(event => event.type === "text" && event.text.startsWith("Tool: github: create_issue"))).toBe(true);
  expect(events.some(event => event.type === "text" && event.text.includes("🧠"))).toBe(false);
});
