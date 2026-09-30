import { expect, test } from "bun:test";
import { CodexSession } from "./session.ts";
import { FixtureRpc } from "../../../tests/support/rpc-fixture.ts";
import { getStartupContext } from "../../infrastructure/forge614-engram.ts";
import { withStartupNotices } from "../../infrastructure/engram-notices.ts";
import { createMemoryHookProbe } from "../../infrastructure/memory-hook.ts";
import { enginesDouble, hookOf, hooksListWithEngramHook, verifyStdout } from "../../../tests/support/memory-hook-fixtures.ts";
import { getCatalog } from "../../i18n/index.ts";

/** A real-shaped `startup-context` (format 1) payload with a shared memory and one Engram notice, as `getStartupContext` reads it. */
const memoryPayload = JSON.stringify({
  format: 1,
  shared: { format: 1, pinned: [], recent: [{ title: "Pinned rule", preview: "keep it" }] },
  project: { status: "unbound", notices: [{ code: "PROJECT_REBOUND_FROM_FILE", message: "x" }] },
});
const fetchMemory = (calls: { count: number }) => (directory: string, options: Parameters<typeof getStartupContext>[1]) => {
  calls.count++;
  return getStartupContext(directory, { ...options, run: async () => ({ status: 0, stdout: memoryPayload, stderr: "" }) });
};

/** A Codex app-server double that is signed in, opens threads and takes turns; `hooks/list` answers with `hooks` (or fails when `hooks` is an Error). */
function codexRpc(hooks: unknown) {
  const rpc = new FixtureRpc();
  rpc.replies.set("initialize", {});
  rpc.replies.set("account/read", { account: { type: "chatgpt", planType: "plus" }, requiresOpenaiAuth: true });
  rpc.replies.set("model/list", { data: [{ model: "test-model", displayName: "Test model", isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: [] }], nextCursor: null });
  rpc.replies.set("account/rateLimits/read", { rateLimits: { primary: { usedPercent: 24, resetsAt: 1900000000, windowDurationMins: 10080 } } });
  rpc.replies.set("thread/start", { thread: { id: "t" }, model: "test-model", modelProvider: "openai" });
  rpc.replies.set("thread/resume", { thread: { id: "old" }, model: "test-model", modelProvider: "openai" });
  rpc.replies.set("thread/compact/start", {});
  rpc.replies.set("turn/start", { turn: { id: "u", status: "inProgress" } });
  rpc.handler = async (method, params) => {
    if (method === "hooks/list") { if (hooks instanceof Error) throw hooks; return hooks; }
    if (method === "thread/compact/start") { queueMicrotask(() => rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "c", status: "completed" } })); return {}; }
    return rpc.replies.get(method);
  };
  return rpc;
}

async function runTurn(rpc: FixtureRpc, session: CodexSession, text: string) {
  const pending = session.send(text);
  await new Promise(resolve => setImmediate(resolve));
  rpc.onNotification("turn/completed", { threadId: session.sessionId, turn: { id: "u", status: "completed" } });
  await pending;
}

const activeVerify = () => enginesDouble(verifyStdout(hookOf({ kind: "runtime-observed" }), "codex"));
const inputsOf = (rpc: FixtureRpc) => rpc.calls.filter(call => call.method === "turn/start").map(call => call.params.input);

/**
 * The reason for the whole change: measured with a real account (2026-09-29, build of 067e348, Codex 0.159.0), the assistant saw the memory TWICE,
 * because Shell sent its block in front of the first message and the SessionStart hook Engines installs in ~/.codex/config.toml delivered its own.
 * With `verify memory-integration` saying the hook is active AND `hooks/list` showing that hook (sessionStart, `memory-hook-run`, enabled, trusted),
 * the input of the first `turn/start` must carry only the person's words, in every kind of start (new thread, `/new`, `/resume`, `/compact`);
 * Shell still reads `startup-context` so Engram's notice reaches the person, once. Each check runs once per Shell run.
 */
test("with the startup hook active and confirmed by hooks/list the turn input has no memory block in any start, and Engram's notices are still shown", async () => {
  const calls = { count: 0 }; const shown: string[] = []; const engines = activeVerify();
  const rpc = codexRpc(hooksListWithEngramHook());
  const session = new CodexSession(rpc, "/project", () => {}, async () => false, undefined,
    withStartupNotices(fetchMemory(calls), text => shown.push(text), "en"), "en",
    createMemoryHookProbe("codex", { home: "/Users/tester", run: engines.run }));
  await session.initialize();
  await runTurn(rpc, session, "first message");
  session.reset(); await runTurn(rpc, session, "after /new");
  expect(inputsOf(rpc)).toEqual([[{ type: "text", text: "first message" }], [{ type: "text", text: "after /new" }]]);
  await session.compact();
  await runTurn(rpc, session, "after /compact");
  expect(inputsOf(rpc).at(-1)).toEqual([{ type: "text", text: "after /compact" }]);
  expect(JSON.stringify(rpc.calls)).not.toContain("forge614-engram-memory");
  expect(shown).toEqual([getCatalog("en").engramNotices.projectReboundFromFile]);
  expect(calls.count).toBe(3);
  expect(engines.commands).toEqual([["verify", "memory-integration", "--agent", "codex"]]);
  expect(rpc.calls.filter(call => call.method === "hooks/list")).toHaveLength(1);
  expect(rpc.calls.find(call => call.method === "hooks/list")?.params).toEqual({ cwds: ["/project"] });
});

/** `/resume` picks a saved thread: the memory rule is the same one (nothing pasted while the hook delivers; the block as always without it). */
test("/resume follows the same rule: no block with an active hook, the usual block without one", async () => {
  for (const active of [true, false]) {
    const rpc = codexRpc(hooksListWithEngramHook());
    rpc.handler = async (method, params) => {
      if (method === "hooks/list") return hooksListWithEngramHook();
      if (method === "thread/read") return { thread: { id: "old", cwd: "/project", status: { type: "idle" }, turns: [] } };
      return rpc.replies.get(method);
    };
    const verify = active ? activeVerify() : enginesDouble("", 1);
    const session = new CodexSession(rpc, "/project", () => {}, async () => false, undefined, fetchMemory({ count: 0 }), "en",
      createMemoryHookProbe("codex", { home: "/Users/tester", run: verify.run }));
    await session.initialize();
    await session.resume("old");
    await runTurn(rpc, session, "hello");
    const input = inputsOf(rpc)[0]!;
    expect([active, input.length, input.at(-1)]).toEqual([active, active ? 1 : 2, { type: "text", text: "hello" }]);
    if (!active) { expect(input[0].text.startsWith("<forge614-engram-memory>\n")).toBe(true); expect(input[0].text).toContain("Pinned rule"); }
    expect(rpc.calls.find(call => call.method === "thread/resume")).toBeDefined();
  }
});

/**
 * The fallback: whenever the hook is not certainly delivering — `verify` says it does not (needs the person's trust, absent) or fails, or the
 * session's own `hooks/list` does not show Engines' hook enabled and trusted (or cannot be read) — Shell sends its block as before, unchanged.
 */
test("without an active hook — needs-user-trust, failed verify, or hooks/list without a trusted, enabled memory-hook-run — Shell still sends its block first", async () => {
  const trusted = () => createMemoryHookProbe("codex", { home: "/Users/tester", run: activeVerify().run });
  const attempts: [string, unknown, () => Promise<boolean>][] = [
    ["needs-user-trust", hooksListWithEngramHook(), createMemoryHookProbe("codex", { home: "/Users/tester", run: enginesDouble(verifyStdout(hookOf({ kind: "needs-user-trust" }), "codex")).run })],
    ["verify failed", hooksListWithEngramHook(), createMemoryHookProbe("codex", { home: "/Users/tester", run: enginesDouble("", 1).run })],
    ["hooks/list without any hook", { data: [{ cwd: "/project", warnings: [], errors: [], hooks: [] }] }, trusted()],
    ["hooks/list hook untrusted", hooksListWithEngramHook({ trustStatus: "untrusted" }), trusted()],
    ["hooks/list hook modified", hooksListWithEngramHook({ trustStatus: "modified" }), trusted()],
    ["hooks/list hook disabled", hooksListWithEngramHook({ enabled: false }), trusted()],
    ["hooks/list hook of another event", hooksListWithEngramHook({ eventName: "stop" }), trusted()],
    ["hooks/list hook of another command", hooksListWithEngramHook({ command: "echo memory" }), trusted()],
    ["hooks/list fails", new Error("boom"), trusted()],
  ];
  for (const [name, hooks, probe] of attempts) {
    const calls = { count: 0 };
    const rpc = codexRpc(hooks);
    const session = new CodexSession(rpc, "/project", () => {}, async () => false, undefined, fetchMemory(calls), "en", probe);
    await session.initialize();
    await runTurn(rpc, session, "hello");
    const input = inputsOf(rpc)[0]!;
    expect([name, input.length, input[0].text.startsWith("<forge614-engram-memory>\n"), input[0].text.includes("Pinned rule"), input[0].text.endsWith("</forge614-engram-memory>"), input[1]])
      .toEqual([name, 2, true, true, true, { type: "text", text: "hello" }]);
    expect(calls.count).toBe(1);
  }
});

/** A hook that Engines' own check trusts but that the session's `hooks/list` accepts as `managed` (installed by the organization) still counts: `managed` is trusted by definition. */
test("a managed sessionStart memory-hook-run counts as trusted", async () => {
  const rpc = codexRpc(hooksListWithEngramHook({ trustStatus: "managed", isManaged: true }));
  const session = new CodexSession(rpc, "/project", () => {}, async () => false, undefined, fetchMemory({ count: 0 }), "en", createMemoryHookProbe("codex", { home: "/Users/tester", run: activeVerify().run }));
  await session.initialize();
  await runTurn(rpc, session, "hello");
  expect(inputsOf(rpc)).toEqual([[{ type: "text", text: "hello" }]]);
});

/** `/status` says where the memory comes from without asking the model; asking is the same single detection the turns use. */
test("memoryDeliveredByAssistant() is true only when verify and hooks/list agree, and is decided once for the whole run", async () => {
  const engines = activeVerify(); const rpc = codexRpc(hooksListWithEngramHook());
  const session = new CodexSession(rpc, "/project", () => {}, async () => false, undefined, fetchMemory({ count: 0 }), "en", createMemoryHookProbe("codex", { home: "/Users/tester", run: engines.run }));
  await session.initialize();
  expect(await session.memoryDeliveredByAssistant()).toBe(true);
  await runTurn(rpc, session, "hi");
  expect(await session.memoryDeliveredByAssistant()).toBe(true);
  expect(engines.commands).toHaveLength(1);
  expect(rpc.calls.filter(call => call.method === "hooks/list")).toHaveLength(1);
  const plainRpc = codexRpc(hooksListWithEngramHook());
  const plain = new CodexSession(plainRpc, "/project", () => {}, async () => false);
  await plain.initialize();
  expect(await plain.memoryDeliveredByAssistant()).toBe(false);
  expect(plainRpc.calls.some(call => call.method === "hooks/list")).toBe(false);
});

/**
 * Came out of the third real-account test: the check of whether the startup hook delivers the memory (`verify memory-integration` and this session's `hooks/list`) was
 * made when the first message was sent and delayed it by about a second. It is now asked when the session opens, in the background: before any message, once for the
 * whole run, and every later message only reads its answer.
 */
test("Codex asks whether the startup hook delivers the memory when the session opens, before any message, and only once", async () => {
  const engines = activeVerify(); const rpc = codexRpc(hooksListWithEngramHook());
  const session = new CodexSession(rpc, "/project", () => {}, async () => false, undefined, fetchMemory({ count: 0 }), "en", createMemoryHookProbe("codex", { home: "/Users/tester", run: engines.run }));
  await session.initialize();
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
  expect(rpc.calls.some(call => call.method === "turn/start")).toBe(false);
  expect(engines.commands).toEqual([["verify", "memory-integration", "--agent", "codex"]]);
  expect(rpc.calls.filter(call => call.method === "hooks/list")).toHaveLength(1);
  await runTurn(rpc, session, "first"); await runTurn(rpc, session, "second");
  expect(engines.commands).toHaveLength(1);
  expect(rpc.calls.filter(call => call.method === "hooks/list")).toHaveLength(1);
  expect(inputsOf(rpc)).toEqual([[{ type: "text", text: "first" }], [{ type: "text", text: "second" }]]);
});

/**
 * The check runs in the background: `initialize()` does not wait for it, so a slow check no longer holds the session opening. The first message waits for it only if it has
 * not finished, and a check that ends with «no» (or fails) means Shell pastes its own block, as always.
 */
test("a slow startup-hook check does not hold the session opening; the first message waits for it and, if it says no, sends the block", async () => {
  let release!: (delivers: boolean) => void; let asked = 0;
  const probe = () => { asked++; return new Promise<boolean>(resolve => { release = resolve; }); };
  const rpc = codexRpc(hooksListWithEngramHook());
  const session = new CodexSession(rpc, "/project", () => {}, async () => false, undefined, fetchMemory({ count: 0 }), "en", probe);
  await session.initialize();
  expect(asked).toBe(1);
  const pending = session.send("hello");
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
  expect(rpc.calls.some(call => call.method === "turn/start")).toBe(false);
  release(false);
  await new Promise(resolve => setImmediate(resolve));
  for (let i = 0; i < 5 && !rpc.calls.some(call => call.method === "turn/start"); i++) await new Promise(resolve => setImmediate(resolve));
  rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } });
  await pending;
  expect(asked).toBe(1);
  expect(JSON.stringify(inputsOf(rpc)[0])).toContain("forge614-engram-memory");
});
