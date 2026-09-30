import { expect, test } from "bun:test";
import { FixtureRpc } from "../../../tests/support/rpc-fixture.ts";
import { connectedCodex, converse, settle, texts } from "../../../tests/support/codex-fixture.ts";
import type { ConnectedCodex } from "../../../tests/support/codex-fixture.ts";
import { ShellError } from "../../shell-error.ts";
import { descendantsOf, subagentName, toSubagentThread } from "./subagents.ts";

/**
 * A `Thread` as the app-server sends it (`v2/Thread.ts`), reduced to what the picker reads. A subagent's `source` is `{ subAgent: { thread_spawn: … } }`
 * (`v2/SessionSource.ts`, `SubAgentSource.ts`); `status` is `v2/ThreadStatus.ts`.
 */
function protocolThread(id: string, over: Record<string, unknown> = {}, spawn?: { parent: string; path?: string | null; nickname?: string | null; role?: string | null }) {
  return {
    id, preview: "", ephemeral: false, createdAt: 1, updatedAt: 1, status: { type: "idle" }, cwd: "/project", path: null, canAcceptDirectInput: null,
    agentNickname: spawn?.nickname ?? null, agentRole: spawn?.role ?? null, name: null, turns: [],
    source: spawn ? { subAgent: { thread_spawn: { parent_thread_id: spawn.parent, depth: 1, agent_path: spawn.path ?? null, agent_nickname: spawn.nickname ?? null, agent_role: spawn.role ?? null } } } : "cli",
    ...over,
  };
}

/** How Codex names a row of its picker (`format_agent_picker_item_name` and the agent path), leaving the empty case to the screen. */
test("a subagent is named by its agent path, then «nickname [role]», the nickname, «[role]» — or nothing", () => {
  const named = (path: string | null, nickname: string | null, role: string | null) => subagentName({ agentPath: path ?? undefined, nickname: nickname ?? undefined, role: role ?? undefined });
  expect(named("  /root/reviewer ", "Kepler", "reviewer")).toBe("/root/reviewer");
  expect(named(null, "Kepler", "reviewer")).toBe("Kepler [reviewer]");
  expect(named(null, "Kepler", null)).toBe("Kepler");
  expect(named(null, null, "reviewer")).toBe("[reviewer]");
  expect(named(null, "  ", " ")).toBe("");
  expect(named("   ", null, null)).toBe("");
});

/** `ThreadStatus`: an active thread is running, one the server does not hold in memory is closed (`is_closed = NotLoaded`), anything else waits. */
test("a thread's state is running, idle or closed from its status", () => {
  for (const [status, state] of [[{ type: "active", activeFlags: [] }, "running"], [{ type: "idle" }, "idle"], [{ type: "notLoaded" }, "closed"], [{ type: "systemError" }, "idle"]] as const) {
    expect(toSubagentThread(protocolThread("c", { status }, { parent: "t" }), "").state).toBe(state);
  }
});

/**
 * `find_loaded_subagent_threads_for_primary` (`app/loaded_threads.rs`): from the flat list of loaded threads, the descendants of the conversation by following the
 * `thread_spawn` parent edges at any depth; unrelated threads, threads that are not spawned subagents and the conversation itself are left out.
 */
test("the descendants of a conversation are found by following the spawn edges, at any depth", () => {
  const threads = [
    protocolThread("t"), protocolThread("c1", {}, { parent: "t" }), protocolThread("g1", {}, { parent: "c1" }), protocolThread("gg1", {}, { parent: "g1" }),
    protocolThread("other-child", {}, { parent: "other" }), protocolThread("x1"), protocolThread("review", { source: { subAgent: "review" } }),
  ].map(thread => toSubagentThread(thread, ""));
  expect(descendantsOf("t", threads).map(thread => thread.id).sort()).toEqual(["c1", "g1", "gg1"]);
  expect(descendantsOf("nobody", threads)).toEqual([]);
});

// ── The session ────────────────────────────────────────────────────────────────────────────────────────────────────

const features = (enabled: boolean) => ({ data: [{ name: "multi_agent", stage: "stable", displayName: null, description: null, announcement: null, enabled, defaultEnabled: true }], nextCursor: null });
const child = protocolThread("c1", { status: { type: "active", activeFlags: [] }, createdAt: 10, preview: "Review the login tests" }, { parent: "t", path: "/root/reviewer", nickname: "Kepler", role: "reviewer" });
const grandchild = protocolThread("g1", { createdAt: 20 }, { parent: "c1", nickname: "Ada" });
const unrelated = protocolThread("x1", { createdAt: 15 });
const closed = protocolThread("p1", { status: { type: "notLoaded" }, createdAt: 5, preview: "An older helper" }, { parent: "t", nickname: "Old" });

/**
 * Makes the fixture answer what `/subagents` asks: `experimentalFeature/list` (the subagents feature is `multi_agent`), `thread/loaded/list` (`v2/ThreadLoadedListResponse.ts`),
 * `thread/read` (`v2/ThreadReadResponse.ts`) for each thread and `thread/list` (`v2/ThreadListResponse.ts`) for the saved descendants. `overrides` replace one method's answer.
 */
function answerSubagents(rpc: FixtureRpc, overrides: Record<string, (params: any) => any> = {}, byId: Record<string, any> = { c1: child, g1: grandchild, x1: unrelated }) {
  rpc.replies.set("experimentalFeature/list", features(true));
  rpc.replies.set("thread/loaded/list", { data: ["t", "c1", "g1", "x1"], nextCursor: null });
  rpc.replies.set("thread/list", { data: [closed, child], nextCursor: null, backwardsCursor: null });
  rpc.replies.set("thread/unsubscribe", { status: "unsubscribed" });
  const replies = new Map(rpc.replies);
  rpc.handler = async (method, params) => {
    if (overrides[method]) return overrides[method]!(params);
    if (method === "thread/read" && byId[params.threadId]) return { thread: byId[params.threadId] };
    if (!replies.has(method)) throw new Error(`Unexpected ${method} ${JSON.stringify(params)}`);
    return replies.get(method);
  };
}
const methods = (env: ConnectedCodex, from: number) => env.rpc.calls.slice(from).map(call => call.method);
const detourEvents = (env: ConnectedCodex) => env.events.filter(event => event.type === "detourStart" || event.type === "detourEnd").map(event => event.type);

/**
 * Codex's picker looks for the subagents of the conversation with `thread/loaded/list` and `thread/read` (the ones in memory) and `thread/list` with
 * `sourceKinds: ["subAgentThreadSpawn"]` and the conversation as `ancestorThreadId` (the saved ones, paged), as in `app/session_lifecycle.rs` and `app/agent_picker.rs`.
 * The main conversation comes first; the rest in the order they were spawned.
 */
test("subagents() reads the loaded threads and lists the saved descendants of the current thread, main first", async () => {
  const env = await connectedCodex(); await converse(env); answerSubagents(env.rpc);
  const before = env.rpc.calls.length;
  const list = await env.session.subagents!();
  expect(methods(env, before)).toEqual(["experimentalFeature/list", "thread/loaded/list", "thread/read", "thread/read", "thread/read", "thread/list"]);
  const [features_, loaded, ...rest] = env.rpc.calls.slice(before);
  expect(features_!.params).toEqual({ limit: 100, threadId: "t" });
  expect(loaded!.params).toEqual({});
  expect(rest.slice(0, 3).map(call => call.params)).toEqual([{ threadId: "c1", includeTurns: false }, { threadId: "g1", includeTurns: false }, { threadId: "x1", includeTurns: false }]);
  expect(rest[3]!.params).toEqual({ limit: 100, sortDirection: "desc", modelProviders: [], sourceKinds: ["subAgentThreadSpawn"], useStateDbOnly: true, ancestorThreadId: "t" });
  expect(list).toEqual({ enabled: true, agents: [
    { id: "t", name: "", main: true, state: "idle", current: true },
    { id: "p1", name: "Old", preview: "An older helper", main: false, state: "closed", current: false },
    { id: "c1", name: "/root/reviewer", preview: "Review the login tests", main: false, state: "running", current: false },
    { id: "g1", name: "Ada", main: false, state: "idle", current: false },
  ] });
});

/** Saved descendants come in pages (`AGENT_PICKER_PAGE_SIZE` 100, at most 1 000): the cursor of each page is asked for the next, once. */
test("subagents() follows the pages of thread/list with their cursor and stops on a repeated one", async () => {
  const env = await connectedCodex(); await converse(env);
  const pages = [{ data: [closed], nextCursor: "page-2", backwardsCursor: null }, { data: [child], nextCursor: "page-2", backwardsCursor: null }];
  answerSubagents(env.rpc, { "thread/list": () => pages.shift() ?? { data: [], nextCursor: null, backwardsCursor: null }, "thread/loaded/list": () => ({ data: ["t"], nextCursor: null }) }, {});
  const list = await env.session.subagents!();
  const asked = env.rpc.calls.filter(call => call.method === "thread/list").map(call => call.params.cursor);
  expect(asked).toEqual([undefined, "page-2"]);
  expect(list.agents.map(agent => agent.id)).toEqual(["t", "p1", "c1"]);
});

/** A conversation is the main row alone when it has no subagent; with none open there is nothing to look for and Codex is not asked about threads. */
test("subagents() with no subagents lists only the main conversation, and with no conversation nothing", async () => {
  const env = await connectedCodex(); await converse(env);
  answerSubagents(env.rpc, { "thread/loaded/list": () => ({ data: ["t"], nextCursor: null }), "thread/list": () => ({ data: [], nextCursor: null, backwardsCursor: null }) });
  expect((await env.session.subagents!()).agents.map(agent => agent.id)).toEqual(["t"]);
  const fresh = await connectedCodex(); answerSubagents(fresh.rpc);
  const before = fresh.rpc.calls.length;
  expect(await fresh.session.subagents!()).toEqual({ enabled: true, agents: [] });
  expect(methods(fresh, before)).toEqual(["experimentalFeature/list"]);
});

/**
 * `Feature::Collab` (`multi_agent`) is on by default. It counts as off only when Codex says so; a feature list that lacks it or cannot be read is not a reason to ask the
 * person to change their configuration.
 */
test("subagents() reports the feature off only when Codex says so", async () => {
  const off = await connectedCodex(); await converse(off); answerSubagents(off.rpc, { "experimentalFeature/list": () => features(false) });
  expect((await off.session.subagents!()).enabled).toBe(false);
  const missing = await connectedCodex(); await converse(missing); answerSubagents(missing.rpc, { "experimentalFeature/list": () => ({ data: [], nextCursor: null }) });
  expect((await missing.session.subagents!()).enabled).toBe(true);
  const broken = await connectedCodex(); await converse(broken); answerSubagents(broken.rpc, { "experimentalFeature/list": () => { throw new Error("nope"); } });
  expect((await broken.session.subagents!()).enabled).toBe(true);
});

/** Like Codex (`backfill_loaded_subagent_threads` logs and goes on), a failing call only leaves out what it would have added. */
test("subagents() lists what it could read when a call fails", async () => {
  const noLoaded = await connectedCodex(); await converse(noLoaded); answerSubagents(noLoaded.rpc, { "thread/loaded/list": () => { throw new Error("loaded list failed"); } });
  expect((await noLoaded.session.subagents!()).agents.map(agent => agent.id)).toEqual(["t", "p1", "c1"]);
  const noSaved = await connectedCodex(); await converse(noSaved); answerSubagents(noSaved.rpc, { "thread/list": () => { throw new Error("list failed"); } });
  expect((await noSaved.session.subagents!()).agents.map(agent => agent.id)).toEqual(["t", "c1", "g1"]);
  const noRead = await connectedCodex(); await converse(noRead); answerSubagents(noRead.rpc, { "thread/read": params => { if (params.threadId === "g1") throw new Error("read failed"); return { thread: params.threadId === "c1" ? child : unrelated }; } });
  expect((await noRead.session.subagents!()).agents.map(agent => agent.id)).toEqual(["t", "p1", "c1"]);
});

/** The question Codex asks turns the feature on with the same request as its own screen (`build_feature_enabled_edit` + `write_config_batch`): it is saved in the person's Codex configuration. */
test("enableSubagents() writes features.multi_agent with config/batchWrite and reloads the configuration", async () => {
  const env = await connectedCodex(); env.rpc.replies.set("config/batchWrite", { status: "ok", version: "v1", filePath: "/home/u/.codex/config.toml", overriddenMetadata: null });
  expect(await env.session.enableSubagents!()).toEqual({ status: "ok" });
  expect(env.rpc.calls.filter(call => call.method === "config/batchWrite").map(call => call.params)).toEqual([
    { edits: [{ keyPath: "features.multi_agent", value: true, mergeStrategy: "replace" }], reloadUserConfig: true },
  ]);
  env.rpc.replies.set("config/batchWrite", { status: "okOverridden", version: "v2", filePath: "/home/u/.codex/config.toml", overriddenMetadata: { message: "Managed by your organization", overridingLayer: {}, effectiveValue: false } });
  expect(await env.session.enableSubagents!()).toEqual({ status: "okOverridden", message: "Managed by your organization" });
});

/** The reply of `thread/read` for the watched subagent, with the turn Codex saved (`v2/Turn.ts`, `ThreadItem.ts`). */
const watched = { ...child, turns: [{ id: "ct1", startedAt: 100, completedAt: 200, items: [
  { type: "userMessage", id: "cm1", content: [{ type: "text", text: "Review the login tests", text_elements: [] }] }, { type: "agentMessage", id: "cm2", text: "Found 2 issues." },
] }] };

/**
 * Choosing a subagent shows its conversation: `thread/read` with its turns, then its words as they come. The screen is told to switch first (`detourStart`, named after the
 * subagent) so what follows lands in the subagent's view; the main conversation stays where it was.
 */
test("watchSubagent() reads the subagent with its turns, switches the view to it and leaves the main conversation alone", async () => {
  const env = await connectedCodex(); await converse(env); answerSubagents(env.rpc, {}, { c1: watched });
  const before = env.rpc.calls.length; const shown = env.events.length;
  await env.session.watchSubagent!("c1");
  expect(env.rpc.calls.slice(before).map(call => [call.method, call.params])).toEqual([["thread/read", { threadId: "c1", includeTurns: true }]]);
  const added = env.events.slice(shown);
  expect(added.map(event => event.type)).toEqual(["detourStart", "text", "text"]);
  expect(added[0]!.text).toBe("/root/reviewer");
  expect(added.slice(1).map(event => event.text)).toEqual(["You: Review the login tests", "Found 2 issues."]);
  expect(env.session.detour!()).toEqual({ kind: "agent", name: "/root/reviewer", readOnly: true });
  expect(env.session.sessionId).toBe("t");
  expect(env.session.busy).toBe(false);
});

/** A subagent that is still working keeps writing: its events are shown at once, and the main conversation's wait until the person returns, in order. */
test("a watched subagent's live words show at once and the main conversation's wait until the person returns", async () => {
  const env = await connectedCodex(); answerSubagents(env.rpc, {}, { c1: watched });
  const main = env.session.send("long task"); await settle();
  await env.session.watchSubagent!("c1");
  env.rpc.onNotification("item/agentMessage/delta", { threadId: "t", turnId: "u", itemId: "m1", delta: "main words" });
  env.rpc.onNotification("item/agentMessage/delta", { threadId: "c1", turnId: "ct2", itemId: "cx", delta: "subagent words" });
  env.rpc.onNotification("item/started", { threadId: "c1", turnId: "ct2", item: { type: "commandExecution", id: "cmd", command: "npm test" } });
  const shown = env.events.filter(event => event.type === "delta" || event.type === "text").map(event => event.text);
  expect(shown.slice(-2)).toEqual(["subagent words", "Tool: commandExecution\nnpm test"]);
  expect(shown).not.toContain("main words");
  const before = env.rpc.calls.length;
  await env.session.leaveDetour!();
  expect(methods(env, before), "leaving a subagent that is still running does not stop it").toEqual([]);
  expect(detourEvents(env)).toEqual(["detourStart", "detourEnd"]);
  expect(env.events.at(-1)).toMatchObject({ type: "delta", text: "main words" });
  env.rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } });
  await main;
});

/** A watched subagent takes no messages (the person is only watching), and nothing is sent to Codex for them. */
test("writing while a subagent is watched is refused and sends nothing", async () => {
  const env = await connectedCodex(); await converse(env); answerSubagents(env.rpc, {}, { c1: watched });
  await env.session.watchSubagent!("c1");
  const before = env.rpc.calls.length;
  await expect(env.session.send("hello subagent")).rejects.toBeInstanceOf(ShellError);
  await expect(env.session.send("hello subagent")).rejects.toMatchObject({ code: "codex-agent-read-only" });
  expect(env.rpc.calls.length).toBe(before);
});

/** Codex retries `thread/read` without turns when the subagent's thread has none to give (`can_fallback_from_include_turns_error`); any other error is the person's to see. */
test("watchSubagent() reads again without turns when the server has none to give, and fails on any other error", async () => {
  let attempts = 0;
  const env = await connectedCodex(); await converse(env);
  answerSubagents(env.rpc, { "thread/read": params => { attempts++; if (params.includeTurns) throw new Error("ephemeral threads do not support includeTurns"); return { thread: child }; } });
  await env.session.watchSubagent!("c1");
  expect(attempts).toBe(2);
  expect(env.rpc.calls.filter(call => call.method === "thread/read").map(call => call.params)).toEqual([{ threadId: "c1", includeTurns: true }, { threadId: "c1", includeTurns: false }]);
  expect(env.session.detour!()).toMatchObject({ kind: "agent" });

  const failing = await connectedCodex(); await converse(failing);
  answerSubagents(failing.rpc, { "thread/read": () => { throw new Error("thread not loaded: c1"); } });
  await expect(failing.session.watchSubagent!("c1")).rejects.toThrow("thread not loaded: c1");
  expect(failing.session.detour!()).toBeUndefined();
  expect(detourEvents(failing)).toEqual([]);
});

/** Choosing another subagent while one is watched goes straight to it: the view returns to the main one and switches again, and nothing is stopped. */
test("watching another subagent leaves the first one and follows the second", async () => {
  const env = await connectedCodex(); await converse(env); answerSubagents(env.rpc, {}, { c1: watched, g1: { ...grandchild, turns: [] } });
  await env.session.watchSubagent!("c1");
  const before = env.rpc.calls.length;
  await env.session.watchSubagent!("g1");
  expect(detourEvents(env)).toEqual(["detourStart", "detourEnd", "detourStart"]);
  expect(env.session.detour!()).toMatchObject({ kind: "agent", name: "Ada" });
  expect(methods(env, before)).toEqual(["thread/read"]);
  env.rpc.onNotification("item/agentMessage/delta", { threadId: "c1", turnId: "ct2", itemId: "late", delta: "from the first one" });
  expect(JSON.stringify(env.events)).not.toContain("from the first one");
});

/** The picker marks the conversation on screen: the main one, or the watched subagent. */
test("subagents() marks the watched subagent as the current one", async () => {
  const env = await connectedCodex(); await converse(env); answerSubagents(env.rpc, {}, { c1: watched, g1: grandchild, x1: unrelated });
  await env.session.watchSubagent!("c1");
  expect((await env.session.subagents!()).agents.filter(agent => agent.current).map(agent => agent.id)).toEqual(["c1"]);
  await env.session.leaveDetour!();
  expect((await env.session.subagents!()).agents.filter(agent => agent.current).map(agent => agent.id)).toEqual(["t"]);
});

/** A subagent's own permission questions are not the person's to answer from here (they are only watching): declined, and the person is not asked. */
test("a watched subagent's permission questions are declined without asking", async () => {
  let asked = 0;
  const env = await connectedCodex("en", () => {}, async () => { asked++; return true; }); await converse(env); answerSubagents(env.rpc, {}, { c1: watched });
  await env.session.watchSubagent!("c1");
  const answer = await env.rpc.onRequest("item/commandExecution/requestApproval", { threadId: "c1", turnId: "ct2", itemId: "cmd", command: "rm -rf build" });
  expect(answer).toEqual({ decision: "decline" });
  expect(asked).toBe(0);
  expect(texts(env.events).some(text => text.includes("rm -rf"))).toBe(false);
});

/** Only one conversation can be on screen apart from the main one: `/side` refuses while a subagent is watched. */
test("startSide() refuses while a subagent is watched", async () => {
  const env = await connectedCodex(); await converse(env); answerSubagents(env.rpc, {}, { c1: watched });
  await env.session.watchSubagent!("c1");
  expect(await env.session.startSide!()).toEqual({ status: "already-open" });
});
