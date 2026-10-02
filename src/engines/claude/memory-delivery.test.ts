import { expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeSession } from "./session.ts";
import { getStartupContext } from "../../infrastructure/forge614-engram.ts";
import { withStartupNotices } from "../../infrastructure/engram-notices.ts";
import { createMemoryHookProbe } from "../../infrastructure/memory-hook.ts";
import { enginesDouble, hookOf, verifyStdout } from "../../../tests/support/memory-hook-fixtures.ts";
import { getCatalog } from "../../i18n/index.ts";
import { fakeSdk, queryFromRun, settle } from "./fake-query.ts";

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
const okRun = () => (async function* () { yield { type: "result", subtype: "success", session_id: "s", is_error: false } as SDKMessage; })();
const baseDependencies = { cwd: "/repo", executable: "/bin/claude", env: {}, authenticate: async () => {} };

/**
 * The reason for the whole change: measured with a real account (2026-09-29, build of 067e348), the assistant saw the memory TWICE, because
 * Shell put its block in the system prompt and Engines' SessionStart hook (loaded by the SDK from ~/.claude/settings.json) delivered its own.
 * With the hook active (`verify memory-integration` says present, dry run ok, runtime-observed) Shell must NOT put its block in, in any kind of
 * start (first message, `/new` = reset, `/resume`, `/compact`, `/clear`); it still reads `startup-context` so Engram's notice reaches the person, once.
 */
test("with the startup hook active the system prompt carries no memory block in any start, and Engram's notices are still shown", async () => {
  const calls = { count: 0 }; const shown: [string, boolean][] = []; const prompts: unknown[] = [];
  const engines = enginesDouble(verifyStdout(hookOf({ kind: "runtime-observed" })));
  const session = new ClaudeSession({
    ...baseDependencies,
    getStartupContext: withStartupNotices(fetchMemory(calls), (text, isProblem) => shown.push([text, isProblem]), "en"),
    memoryHookActive: createMemoryHookProbe("claude-code", { home: "/Users/tester", run: engines.run }),
    connect: queryFromRun(input => { prompts.push(input.options.systemPrompt); return okRun(); }),
  });
  await session.send("first message", () => {}, async () => true);
  session.reset(); await session.send("after /new", () => {}, async () => true);
  session.resume("saved"); await session.send("after /resume", () => {}, async () => true);
  await session.send("/compact", () => {}, async () => true);
  session.reset(); await session.send("after /clear", () => {}, async () => true);
  expect(prompts).toEqual(Array(5).fill({ type: "preset", preset: "claude_code" }));
  expect(JSON.stringify(prompts)).not.toContain("forge614-engram-memory");
  expect(calls.count).toBe(4);
  expect(shown).toEqual([[getCatalog("en").engramNotices.projectReboundFromFile, false]]);
  expect(engines.commands).toEqual([["verify", "memory-integration", "--agent", "claude-code"]]);
});

/**
 * The fallback: whenever Shell cannot be sure the hook delivers, its own block goes in exactly as before (same wrapper, same text): the
 * hook is not present, needs the person's trust, `verify` failed, or the injected check itself blew up. Two copies is better than none.
 */
test("without an active hook — absent, needs-user-trust, failed verify or a failing check — Shell still puts its block in, unchanged", async () => {
  const attempts: [string, () => Promise<boolean>][] = [
    ["absent", createMemoryHookProbe("claude-code", { home: "/Users/tester", run: enginesDouble(verifyStdout(hookOf({ kind: "absent" }, { present: false }))).run })],
    ["needs-user-trust", createMemoryHookProbe("claude-code", { home: "/Users/tester", run: enginesDouble(verifyStdout(hookOf({ kind: "needs-user-trust" }))).run })],
    ["verify failed", createMemoryHookProbe("claude-code", { home: "/Users/tester", run: enginesDouble("", 1).run })],
    ["check throws", async () => { throw new Error("boom"); }],
  ];
  for (const [name, probe] of attempts) {
    const calls = { count: 0 }; let append = "";
    const session = new ClaudeSession({
      ...baseDependencies, getStartupContext: fetchMemory(calls), memoryHookActive: probe,
      connect: queryFromRun(input => { append = (input.options.systemPrompt as { append?: string }).append ?? ""; return okRun(); }),
    });
    await session.send("hi", () => {}, async () => true);
    expect([name, append.startsWith("<forge614-engram-memory>\n"), append.includes("Pinned rule"), append.endsWith("</forge614-engram-memory>")]).toEqual([name, true, true, true]);
    expect(append.match(/<forge614-engram-memory>/g)).toHaveLength(1);
    expect(calls.count).toBe(1);
  }
});

/** `/f614:status` says where the memory comes from without asking the model: the answer is the same one the turns use, so it comes from the one detection of the run. */
test("memoryDeliveredByAssistant() is true only with an active hook and is decided once for the whole run", async () => {
  const engines = enginesDouble(verifyStdout(hookOf({ kind: "runtime-observed" })));
  const active = new ClaudeSession({
    ...baseDependencies, getStartupContext: fetchMemory({ count: 0 }),
    memoryHookActive: createMemoryHookProbe("claude-code", { home: "/Users/tester", run: engines.run }), connect: queryFromRun(() => okRun()),
  });
  expect(await active.memoryDeliveredByAssistant()).toBe(true);
  await active.send("hi", () => {}, async () => true);
  expect(await active.memoryDeliveredByAssistant()).toBe(true);
  expect(engines.commands).toHaveLength(1);
  const plain = new ClaudeSession({ ...baseDependencies, connect: queryFromRun(() => okRun()) });
  expect(await plain.memoryDeliveredByAssistant()).toBe(false);
  const failing = new ClaudeSession({ ...baseDependencies, memoryHookActive: async () => { throw new Error("boom"); }, connect: queryFromRun(() => okRun()) });
  expect(await failing.memoryDeliveredByAssistant()).toBe(false);
});

/**
 * Came out of the third real-account test: the check of whether the startup hook delivers the memory was made when the first message was sent and delayed it by about
 * a second. It is now asked when the session opens (its catalog loads), in the background: before any message, once for the whole run, and every message only reads its answer.
 */
test("Claude asks whether the startup hook delivers the memory when the session opens, before any message, and only once", async () => {
  const engines = enginesDouble(verifyStdout(hookOf({ kind: "runtime-observed" })));
  const session = new ClaudeSession({
    ...baseDependencies, getStartupContext: fetchMemory({ count: 0 }), connect: fakeSdk().connect,
    memoryHookActive: createMemoryHookProbe("claude-code", { home: "/Users/tester", run: engines.run }),
  });
  let turns = 0;
  const counting = new ClaudeSession({ ...baseDependencies, connect: fakeSdk().connect, memoryHookActive: async () => { turns++; return true; } });
  await counting.initialize();
  await new Promise(resolve => setImmediate(resolve));
  expect(turns).toBe(1);
  await counting.send("first", () => {}, async () => true); await counting.send("second", () => {}, async () => true);
  expect(turns).toBe(1);
  await session.initialize();
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
  expect(engines.commands).toEqual([["verify", "memory-integration", "--agent", "claude-code"]]);
  await session.send("first", () => {}, async () => true);
  expect(engines.commands).toHaveLength(1);
});

/**
 * The check is in the background, but the query is opened with its final system prompt, which depends on the answer: the catalog (read over that same query) waits for the check, and
 * the first message finds the query already open. A «no» means Shell puts its block in; the check is asked once.
 */
test("a slow startup-hook check holds the opening of the query, which then carries the block when the check says no, and the check is asked once", async () => {
  let release!: (delivers: boolean) => void; let asked = 0;
  const sdk = fakeSdk();
  const session = new ClaudeSession({
    ...baseDependencies, getStartupContext: fetchMemory({ count: 0 }), connect: sdk.connect,
    memoryHookActive: () => { asked++; return new Promise<boolean>(resolve => { release = resolve; }); },
  });
  let loaded = false;
  const loading = session.initialize().then(() => { loaded = true; });
  await settle();
  expect(asked).toBe(1);
  expect(loaded).toBe(false);
  expect(sdk.opened).toHaveLength(0);
  release(false);
  await loading;
  expect(sdk.opened).toHaveLength(1);
  await session.send("hello", () => {}, async () => true);
  expect(asked).toBe(1);
  expect(sdk.opened).toHaveLength(1);
  expect((sdk.opened[0]!.params.options.systemPrompt as { append: string }).append).toContain("forge614-engram-memory");
});
