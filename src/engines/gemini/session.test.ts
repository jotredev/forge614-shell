import { expect, test } from "bun:test";
import { GeminiSession } from "./session.ts";
import { FixtureRpc } from "../../../tests/support/rpc-fixture.ts";

test("Gemini authenticates only through Google and uses native ACP permissions", async () => {
  const rpc = new FixtureRpc(); const events: any[] = [];
  rpc.replies.set("initialize", { protocolVersion: 1, authMethods: [{ id: "oauth-personal" }], agentCapabilities: { loadSession: true } });
  rpc.replies.set("authenticate", {});
  rpc.replies.set("session/new", { sessionId: "g", models: { currentModelId: "auto", availableModels: [{ modelId: "auto", name: "Auto" }] } });
  rpc.replies.set("session/set_mode", {});
  const session = new GeminiSession(rpc, "/project", event => events.push(event), async () => false);
  await session.initialize();
  expect(rpc.calls.map(call => call.method)).toEqual(["initialize"]);
  await session.login();
  expect(rpc.calls.find(call => call.method === "authenticate")?.params).toEqual({ methodId: "oauth-personal" });
  const decision = await rpc.onRequest("session/request_permission", { sessionId: "g", toolCall: { title: "edit" }, options: [{ optionId: "proceed_once", kind: "allow_once" }] });
  expect(decision).toEqual({ outcome: { outcome: "cancelled" } });
  rpc.onNotification("session/update", { sessionId: "g", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "response" } } });
  expect(events.some(event => event.text === "response")).toBe(true);
  expect(rpc.calls.some(call => call.method === "session/prompt")).toBe(false);
});

test("Gemini history loads without a prompt and unsupported effort is explicit", async () => {
  const rpc = new FixtureRpc();
  rpc.replies.set("initialize", { protocolVersion: 1, authMethods: [{ id: "oauth-personal" }], agentCapabilities: { loadSession: true } });
  rpc.replies.set("authenticate", {}); rpc.replies.set("session/new", { sessionId: "g" });
  rpc.replies.set("session/set_mode", {}); rpc.replies.set("session/load", {});
  const session = new GeminiSession(rpc, "/project", () => {}, async () => false);
  await session.initialize(); await session.login(); await session.resume("old");
  expect(rpc.calls.some(call => call.method === "session/prompt")).toBe(false);
  await expect(session.setEffort("high")).rejects.toThrow("not exposed");
});

test("Gemini sends ACP prompts, rejects concurrent writers and allows only one permission call", async () => {
  const rpc = new FixtureRpc();
  rpc.replies.set("initialize", { protocolVersion: 1, authMethods: [{ id: "oauth-personal" }], agentCapabilities: {} });
  rpc.replies.set("authenticate", {}); rpc.replies.set("session/new", { sessionId: "g" }); rpc.replies.set("session/set_mode", {});
  const session = new GeminiSession(rpc, "/project", () => {}, async () => true);
  await session.initialize(); await session.login();
  let finish!: (value: any) => void;
  rpc.handler = async (method, params) => {
    if (method !== "session/prompt") throw new Error(`Unexpected ${method}`);
    expect(params).toEqual({ sessionId: "g", prompt: [{ type: "text", text: "hello" }] });
    return new Promise(resolve => { finish = resolve; });
  };
  const pending = session.send("hello");
  await new Promise(resolve => setImmediate(resolve));
  await expect(session.send("second")).rejects.toThrow("active turn");
  const permission = { sessionId: "g", toolCall: { title: "edit" }, options: [{ kind: "allow_always", optionId: "always" }, { kind: "allow_once", optionId: "once" }] };
  expect(await rpc.onRequest("session/request_permission", permission)).toEqual({ outcome: { outcome: "selected", optionId: "once" } });
  await session.cancel();
  expect(rpc.calls.at(-1)).toEqual({ method: "session/cancel", params: { sessionId: "g" } });
  expect(await rpc.onRequest("session/request_permission", permission)).toEqual({ outcome: { outcome: "cancelled" } });
  finish({ stopReason: "cancelled", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });
  await pending;
  expect(session.status().join("\n")).toContain("input 10");
  expect(session.busy).toBe(false);
});
