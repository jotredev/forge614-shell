import { expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeSession, TurnStoppedByPerson } from "./session.ts";
import { ShellError, describeError } from "../../shell-error.ts";
import { fakeAssistant, fakeInit, fakeResult, fakeSdk, manualClock, settle } from "./fake-query.ts";
import type { FakeQueryConfig } from "./fake-query.ts";

/**
 * Claude Code stays open for the whole conversation: ONE query per chat, opened in the background, fed through an endless input queue and read by one permanent reader. These tests drive
 * a session over `fakeSdk` (a stand-in with the behavior measured with SDK 0.3.274 on 2026-10-02): no process, account or network is involved.
 */

type Dependencies = ConstructorParameters<typeof ClaudeSession>[0];

/** A session over a fake SDK, with the account check counted and every event it delivers kept. */
function liveSession(config: FakeQueryConfig = {}, extra: Partial<Dependencies> = {}) {
  const sdk = fakeSdk(config);
  const checks = { auth: 0 };
  const events: SDKMessage[] = [];
  const session = new ClaudeSession({ cwd: "/tmp/project", executable: "/bin/claude", env: {}, connect: sdk.connect, authenticate: async () => { checks.auth++; }, ...extra });
  session.attach({ onEvent: event => { events.push(event); }, approve: async () => true });
  return { sdk, session, checks, events };
}

/** Whether a promise has settled, without waiting for it. */
function watch(promise: Promise<unknown>) {
  const state = { settled: false, error: undefined as unknown };
  promise.then(() => { state.settled = true; }, error => { state.settled = true; state.error = error; });
  return state;
}

test("two messages in a row open ONE query, check the account once and never ask the model list per message", async () => {
  const h = liveSession();
  await h.session.send("one");
  await h.session.send("two");
  expect(h.sdk.opened).toHaveLength(1);
  expect(h.checks.auth).toBe(1);
  expect(h.sdk.opened[0]!.calls.supportedModels).toBe(0);
  expect(h.sdk.opened[0]!.sent.map(message => message.message.content)).toEqual(["one", "two"]);
  expect(h.sdk.opened[0]!.sent.every(message => typeof message.uuid === "string" && message.uuid.length > 0)).toBe(true);
  expect(h.sdk.opened[0]!.calls.close).toBe(0);
});

test("the catalog and the MCP list come from the same query the messages use: one connect when the chat opens", async () => {
  const h = liveSession({ models: [{ value: "default", displayName: "Default", description: "d" }], mcp: () => [{ name: "forge614-engram", status: "connected" }] });
  await h.session.initialize(undefined, { accountVerified: true });
  await h.session.send("hello");
  expect(h.sdk.opened).toHaveLength(1);
  expect(h.sdk.opened[0]!.calls.initializationResult).toBe(1);
  expect(h.sdk.opened[0]!.calls.mcpServerStatus).toBe(1);
  expect(h.checks.auth).toBe(0);
  expect(h.session.models.map(model => model.value)).toEqual(["default"]);
  expect(h.session.mcpStatus()).toEqual([{ name: "forge614-engram", state: "connected" }]);
});

test("the opening query carries the real options: memory in the system prompt, mode, model, effort, partial messages and bypass reachable", async () => {
  const h = liveSession({}, { getStartupContext: async () => ({ available: true, text: "Favorite color: black." }) });
  h.session.model = "claude-test"; h.session.effort = "high";
  await h.session.setWorkMode("plan");
  await h.session.open();
  const options = h.sdk.opened[0]!.params.options;
  expect(options.permissionMode).toBe("plan");
  expect(options.model).toBe("claude-test");
  expect(options.effort).toBe("high");
  expect(options.persistSession).toBe(true);
  expect(options.includePartialMessages).toBe(true);
  expect(options.allowDangerouslySkipPermissions).toBe(true);
  expect(options.settingSources).toEqual(["user", "project", "local"]);
  expect(options.resume).toBeUndefined();
  expect((options.systemPrompt as { append: string }).append).toContain("Favorite color: black.");
});

/** The failure the owner saw: on resume Claude Code injected «N background agents didn't finish…», that turn's own `result` arrived first and Shell cut the real turn. */
test("the person's turn does not end with a result that lacks its uuid, and does end with its own", async () => {
  const h = liveSession({ hold: true });
  const turn = watch(h.session.send("the real message"));
  await settle();
  const fake = h.sdk.opened[0]!;
  const uuid = fake.sent[0]!.uuid!;
  // The notification's automatic turn finishes first, with no uuid of the person's.
  fake.emit(fakeResult([]));
  await settle();
  expect(turn.settled).toBe(false);
  expect(h.session.busy).toBe(true);
  expect(h.events.filter(event => event.type === "result")).toHaveLength(1);
  fake.answer([uuid]);
  await settle();
  expect(turn.settled).toBe(true);
  expect(turn.error).toBeUndefined();
  expect(h.session.busy).toBe(false);
  expect(h.events.filter(event => event.type === "result")).toHaveLength(2);
});

test("a message sent while the assistant answers is accepted, queued, and one result with both uuids ends the turn", async () => {
  const h = liveSession({ hold: true });
  const first = watch(h.session.send("first"));
  await settle();
  const second = watch(h.session.send("second"));
  await settle();
  const fake = h.sdk.opened[0]!;
  expect(fake.sent.map(message => message.message.content)).toEqual(["first", "second"]);
  expect(h.sdk.opened).toHaveLength(1);
  expect(second.error).toBeUndefined();
  expect(first.settled || second.settled).toBe(false);
  fake.answer(fake.sent.map(message => message.uuid!));
  await settle();
  expect(first.settled).toBe(true); expect(first.error).toBeUndefined();
  expect(second.settled).toBe(true); expect(second.error).toBeUndefined();
  expect(h.session.busy).toBe(false);
});

test("/f614:stop interrupts the query without closing it, and the turn ends with the result Claude Code gives", async () => {
  const h = liveSession({ hold: true });
  const turn = watch(h.session.send("long job"));
  await settle();
  h.session.stop();
  await settle();
  const fake = h.sdk.opened[0]!;
  expect(fake.calls.interrupt).toBe(1);
  expect(fake.calls.close).toBe(0);
  expect(turn.settled).toBe(true);
  // The error result Claude Code gives to the person's own stop is the stop itself: it ends the turn as «stopped by the person», not with the technical word of the result.
  expect(turn.error).toBeInstanceOf(TurnStoppedByPerson);
  expect((turn.error as Error).message).not.toContain("error_during_execution");
  expect(h.session.busy).toBe(false);
  // The conversation goes on over the same query.
  const next = h.session.send("after the stop");
  await settle();
  expect(h.sdk.opened).toHaveLength(1);
  fake.answer([fake.sent[1]!.uuid!]);
  await next;
});

test("another error result of a turn the person stopped keeps its own message, and one that was not stopped is not «stopped by the person»", async () => {
  // A stop Claude Code does not answer by itself: the test hands over the result it wants.
  const stopped = liveSession({ hold: true, silentInterrupt: true });
  const turn = watch(stopped.session.send("long job"));
  await settle();
  stopped.session.stop();
  const fake = stopped.sdk.opened[0]!;
  fake.emit(fakeResult([fake.sent[0]!.uuid!], { subtype: "error_max_turns", is_error: true, errors: ["Reached the turn limit"] }));
  await settle();
  expect(turn.settled).toBe(true);
  expect(turn.error).not.toBeInstanceOf(TurnStoppedByPerson);
  expect((turn.error as Error).message).toBe("Reached the turn limit");

  // The same technical result with no stop asked is not a stop of the person's: no error reaches the message at all (the screen draws it as Claude's error).
  const plain = liveSession({ hold: true, silentInterrupt: true });
  const other = watch(plain.session.send("another job"));
  await settle();
  const second = plain.sdk.opened[0]!;
  second.emit(fakeResult([second.sent[0]!.uuid!], { subtype: "error_during_execution", is_error: true, errors: [] }));
  await settle();
  expect(other.settled).toBe(true);
  expect(other.error).toBeUndefined();
});

test("a stop Claude Code never answers: after 5 s the query is closed and opened again with the same conversation, and the person is told", async () => {
  const clock = manualClock();
  const h = liveSession({ hold: true, silentInterrupt: true }, { clock });
  const turn = watch(h.session.send("stuck job"));
  await settle();
  h.session.stop();
  await clock.advance(4999);
  expect(turn.settled).toBe(false);
  expect(h.sdk.opened[0]!.calls.close).toBe(0);
  await clock.advance(1);
  await settle();
  expect(h.sdk.opened[0]!.calls.interrupt).toBe(1);
  expect(h.sdk.opened[0]!.calls.close).toBe(1);
  expect(h.sdk.opened).toHaveLength(2);
  expect(h.sdk.opened[1]!.params.options.resume).toBe("fake-session");
  expect(turn.settled).toBe(true);
  expect((turn.error as ShellError).code).toBe("claude-stop-timeout");
  expect(describeError(turn.error, "en")).toBe("Claude Code did not answer the stop in 5 seconds. Shell closed it and opened it again with the same conversation.");
  expect(describeError(turn.error, "es")).toBe("Claude Code no respondió a la detención en 5 segundos. Shell lo cerró y lo abrió de nuevo con la misma conversación.");
  expect(h.session.busy).toBe(false);
});

test("/new closes the query and opens another in the background with no resume and fresh memory", async () => {
  let memoryCalls = 0;
  const h = liveSession({}, { getStartupContext: async () => { memoryCalls++; return { available: true, text: "x" }; } });
  await h.session.send("one");
  expect(memoryCalls).toBe(1);
  h.session.reset();
  await settle();
  expect(h.sdk.opened).toHaveLength(2);
  expect(h.sdk.opened[0]!.calls.close).toBe(1);
  expect(h.sdk.opened[1]!.params.options.resume).toBeUndefined();
  expect(memoryCalls).toBe(2);
  // The next message finds the new query ready: nothing else is opened.
  await h.session.send("two");
  expect(h.sdk.opened).toHaveLength(2);
  expect(h.sdk.opened[1]!.sent.map(message => message.message.content)).toEqual(["two"]);
});

test("/resume closes the query and opens another with resume: id and fresh memory", async () => {
  let memoryCalls = 0;
  const h = liveSession({}, { getStartupContext: async () => { memoryCalls++; return { available: true, text: "x" }; } });
  await h.session.send("one");
  h.session.resume("other-session");
  await settle();
  expect(h.sdk.opened).toHaveLength(2);
  expect(h.sdk.opened[0]!.calls.close).toBe(1);
  expect(h.sdk.opened[1]!.params.options.resume).toBe("other-session");
  expect(memoryCalls).toBe(2);
});

test("a new effort closes the query and opens another with resume and the new effort; a new model is told live without reopening", async () => {
  const h = liveSession();
  await h.session.send("one");
  await h.session.setModel("claude-other");
  expect(h.sdk.opened).toHaveLength(1);
  expect(h.sdk.opened[0]!.calls.setModel).toEqual(["claude-other"]);
  expect(h.session.model).toBe("claude-other");
  await h.session.setEffort("high");
  await settle();
  expect(h.sdk.opened).toHaveLength(2);
  expect(h.sdk.opened[0]!.calls.close).toBe(1);
  expect(h.sdk.opened[1]!.params.options.effort).toBe("high");
  expect(h.sdk.opened[1]!.params.options.model).toBe("claude-other");
  expect(h.sdk.opened[1]!.params.options.resume).toBe("fake-session");
});

test("the permission mode is told to the open query at once, idle or not, and the person is never told «next turn»", async () => {
  const h = liveSession({ hold: true });
  await h.session.open();
  expect(await h.session.setWorkMode("acceptEdits")).toBe("applied");
  const turn = watch(h.session.send("job"));
  await settle();
  expect(await h.session.setWorkMode("plan")).toBe("applied");
  expect(h.sdk.opened[0]!.calls.setPermissionMode).toEqual(["acceptEdits", "plan"]);
  expect(h.session.workMode()).toBe("plan");
  h.sdk.opened[0]!.answer([h.sdk.opened[0]!.sent[0]!.uuid!]);
  await settle();
  expect(turn.settled).toBe(true);
});

test("a mode Claude Code refuses live is reported plainly and the previous mode stays", async () => {
  const h = liveSession({ refuseMode: true });
  await h.session.open();
  let caught: unknown;
  try { await h.session.setWorkMode("plan"); } catch (error) { caught = error; }
  expect((caught as ShellError).code).toBe("claude-mode-rejected");
  expect(h.session.workMode()).toBe("default");
});

test("when the process dies the turn ends with the error and the next message opens again with resume (that one waits for the start)", async () => {
  const h = liveSession({ hold: true });
  const turn = watch(h.session.send("job"));
  await settle();
  h.sdk.opened[0]!.die(new Error("Claude Code process exited with code 1"));
  await settle();
  expect(turn.settled).toBe(true);
  expect((turn.error as Error).message).toBe("Claude Code process exited with code 1");
  expect(h.session.busy).toBe(false);
  expect(h.sdk.opened).toHaveLength(1);
  const again = h.session.send("again");
  await settle();
  expect(h.sdk.opened).toHaveLength(2);
  expect(h.sdk.opened[1]!.params.options.resume).toBe("fake-session");
  h.sdk.opened[1]!.answer([h.sdk.opened[1]!.sent[0]!.uuid!]);
  await again;
});

test("a process that ends without a result and without being closed is «ended without a result»", async () => {
  const h = liveSession({ hold: true });
  const turn = watch(h.session.send("job"));
  await settle();
  h.sdk.opened[0]!.die();
  await settle();
  expect((turn.error as ShellError).code).toBe("claude-no-result");
});

test("an account error in a turn (authentication_failed, or a 401 result) is «please /login», not a generic stop", async () => {
  for (const variant of ["assistant", "status"] as const) {
    const h = liveSession({ turn: (message, fake) => {
      const uuid = message.uuid!;
      fake.emit(fakeInit());
      if (variant === "assistant") fake.emit(fakeAssistant("Please run /login", { error: "authentication_failed" }), fakeResult([uuid], { is_error: true }));
      else fake.emit(fakeResult([uuid], { is_error: true, api_error_status: 401 }));
    } });
    const turn = watch(h.session.send("hello"));
    await settle();
    expect((turn.error as ShellError).code, variant).toBe("claude-login-required");
    expect(h.session.busy).toBe(false);
  }
});

test("the MCP servers are asked of the open query right after it opens: pending turns to connected in rounds of 2 s", async () => {
  const clock = manualClock();
  const answers = [
    [{ name: "a", status: "connected" }, { name: "b", status: "pending" }],
    [{ name: "a", status: "connected" }, { name: "b", status: "pending" }],
    [{ name: "a", status: "connected" }, { name: "b", status: "connected" }],
  ];
  let redraws = 0;
  const h = liveSession({ mcp: call => answers[call - 1]! }, { clock, onMcpStatus: () => { redraws++; } });
  await h.session.open();
  await settle();
  const fake = h.sdk.opened[0]!;
  expect(fake.calls.mcpServerStatus).toBe(1);
  expect(h.session.mcpStatus()).toEqual([{ name: "a", state: "connected" }, { name: "b", state: "starting" }]);
  await clock.advance(1999);
  expect(fake.calls.mcpServerStatus).toBe(1);
  await clock.advance(1);
  expect(fake.calls.mcpServerStatus).toBe(2);
  await clock.advance(2000);
  expect(fake.calls.mcpServerStatus).toBe(3);
  expect(h.session.mcpStatus()).toEqual([{ name: "a", state: "connected" }, { name: "b", state: "connected" }]);
  expect(redraws).toBe(3);
  // None pending any more: nothing is asked again, with no clock running.
  await clock.advance(120000);
  expect(fake.calls.mcpServerStatus).toBe(3);
});

test("a server stuck on pending does not keep the questions going: the last one is at 30 s", async () => {
  const clock = manualClock();
  const asked: number[] = [];
  const h = liveSession({ mcp: () => { asked.push(clock.now()); return [{ name: "slow", status: "pending" }]; } }, { clock });
  await h.session.open();
  await clock.advance(60000);
  expect(asked).toHaveLength(16);
  expect(asked[0]).toBe(0);
  expect(asked.at(-1)).toBe(30000);
  expect(h.session.mcpStatus()).toEqual([{ name: "slow", state: "starting" }]);
});

test("an init that brings a server as pending never lowers a state already known, and asks one more round", async () => {
  const clock = manualClock();
  const h = liveSession({
    mcp: call => call === 1 ? [{ name: "forge614-engram", status: "connected" }, { name: "github", status: "failed" }] : [{ name: "forge614-engram", status: "connected" }, { name: "github", status: "failed" }, { name: "context7", status: "connected" }],
    initMcp: [{ name: "forge614-engram", status: "pending" }, { name: "github", status: "pending" }, { name: "context7", status: "pending" }],
  }, { clock });
  // What the list says at the very moment the init is delivered, before the extra round it asks for has answered.
  let atInit: unknown;
  h.session.attach({ onEvent: event => { if (event.type === "system" && event.subtype === "init") atInit = h.session.mcpStatus(); } });
  await h.session.open();
  await settle();
  expect(h.session.mcpStatus()).toEqual([{ name: "forge614-engram", state: "connected" }, { name: "github", state: "failed" }]);
  await h.session.send("hello");
  // The init listed all three as pending: the two known keep their state, the new one starts as «starting».
  expect(atInit).toEqual([{ name: "forge614-engram", state: "connected" }, { name: "github", state: "failed" }, { name: "context7", state: "starting" }]);
  await settle();
  // The pending server in that init asked one more round, and its answer settles the list.
  expect(h.sdk.opened[0]!.calls.mcpServerStatus).toBe(2);
  expect(h.session.mcpStatus()).toEqual([{ name: "forge614-engram", state: "connected" }, { name: "github", state: "failed" }, { name: "context7", state: "connected" }]);
});

test("with no server pending nothing is asked again, not even after a message", async () => {
  const clock = manualClock();
  const h = liveSession({ mcp: () => [{ name: "a", status: "connected" }], initMcp: [{ name: "a", status: "connected" }] }, { clock });
  await h.session.open();
  await h.session.send("one");
  await h.session.send("two");
  await clock.advance(120000);
  expect(h.sdk.opened[0]!.calls.mcpServerStatus).toBe(1);
});

/** `total_cost_usd` and `modelUsage` of a result are running totals of the query: each turn shows its own part, and the count starts again when the query is opened again. */
test("each turn shows its own cost and tokens: the accumulated totals of the query minus the previous ones", async () => {
  const h = liveSession({ turnCost: 0.25, turnTokens: 100 });
  await h.session.send("one");
  await h.session.send("two");
  const results = h.events.filter(event => event.type === "result") as unknown as { total_cost_usd: number; modelUsage: Record<string, Record<string, number>> }[];
  expect(results.map(result => result.total_cost_usd)).toEqual([0.25, 0.25]);
  expect(results.map(result => result.modelUsage["claude-test"]!.inputTokens)).toEqual([100, 100]);
  expect(results.map(result => result.modelUsage["claude-test"]!.outputTokens)).toEqual([100, 100]);
  // The context window is a size, not a count: it is not subtracted.
  expect(results.map(result => result.modelUsage["claude-test"]!.contextWindow)).toEqual([200000, 200000]);
  h.session.reset();
  await settle();
  await h.session.send("three");
  const third = (h.events.filter(event => event.type === "result").at(-1) as unknown as { total_cost_usd: number });
  expect(third.total_cost_usd).toBe(0.25);
});

test("leaving closes the open query, and closing before it finished opening never connects", async () => {
  const h = liveSession();
  await h.session.send("one");
  h.session.close();
  expect(h.sdk.opened[0]!.calls.close).toBe(1);
  h.session.close();
  expect(h.sdk.opened[0]!.calls.close).toBe(1);

  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const early = liveSession({}, { authenticate: () => gate });
  const opening = early.session.open();
  early.session.close();
  release();
  await opening;
  await settle();
  expect(early.sdk.opened).toHaveLength(0);

  const afterConnect = liveSession();
  await afterConnect.session.open();
  afterConnect.session.close();
  expect(afterConnect.sdk.opened[0]!.calls.close).toBe(1);
  expect(afterConnect.session.busy).toBe(false);
});
