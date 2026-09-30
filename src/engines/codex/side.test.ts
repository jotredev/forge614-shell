import { expect, test } from "bun:test";
import { SIDE_BOUNDARY_PROMPT as CODEX_SIDE_BOUNDARY_PROMPT, SIDE_DEVELOPER_INSTRUCTIONS as CODEX_SIDE_DEVELOPER_INSTRUCTIONS } from "../../../tests/support/codex-texts.ts";
import { FixtureRpc } from "../../../tests/support/rpc-fixture.ts";
import { connectedCodex, converse, settle, texts } from "../../../tests/support/codex-fixture.ts";
import type { ConnectedCodex } from "../../../tests/support/codex-fixture.ts";
import { SIDE_BOUNDARY_PROMPT, SIDE_DEVELOPER_INSTRUCTIONS } from "./prompts.ts";
import { isHistoryPaginationUnsupported, sideBoundaryItem, sideDeveloperInstructions, sideStartRefusal } from "./side.ts";

const bytes = (text: string) => Buffer.byteLength(text);

/**
 * The two texts `/side` gives the model are Codex's own, to the character: `SIDE_BOUNDARY_PROMPT` and `SIDE_DEVELOPER_INSTRUCTIONS` of `tui/src/app/side.rs`
 * (rust-v0.159.0), compared with copies a script extracted from that file. Exists because they are what keeps the side thread from carrying out the main thread's work.
 */
test("the side boundary and developer instructions are Codex's, character for character", () => {
  expect(SIDE_BOUNDARY_PROMPT).toBe(CODEX_SIDE_BOUNDARY_PROMPT);
  expect(SIDE_DEVELOPER_INSTRUCTIONS).toBe(CODEX_SIDE_DEVELOPER_INSTRUCTIONS);
  expect(bytes(SIDE_BOUNDARY_PROMPT)).toBe(1435);
  expect(bytes(SIDE_DEVELOPER_INSTRUCTIONS)).toBe(1613);
  expect(SIDE_BOUNDARY_PROMPT.startsWith("Side conversation boundary.\n\nEverything before this boundary is inherited history from the parent thread.")).toBe(true);
  expect(SIDE_DEVELOPER_INSTRUCTIONS.startsWith("You are in a side conversation, not the main thread.\n\nThis side conversation is for answering questions")).toBe(true);
});

/** `side_developer_instructions`: the side instructions go after the thread's own, separated by a blank line; with none (or only blanks) they are alone. */
test("the side instructions are appended after the existing ones, or stand alone", () => {
  expect(sideDeveloperInstructions("Existing developer policy.")).toBe(`Existing developer policy.\n\n${CODEX_SIDE_DEVELOPER_INSTRUCTIONS}`);
  expect(sideDeveloperInstructions(undefined)).toBe(CODEX_SIDE_DEVELOPER_INSTRUCTIONS);
  expect(sideDeveloperInstructions(null)).toBe(CODEX_SIDE_DEVELOPER_INSTRUCTIONS);
  expect(sideDeveloperInstructions("  \n ")).toBe(CODEX_SIDE_DEVELOPER_INSTRUCTIONS);
});

/** `side_boundary_prompt_item`: a `ResponseItem::Message` from the user with one `input_text` (`ResponseItem.ts`, `ContentItem.ts`), which `thread/inject_items` takes as it is. */
test("the boundary is injected as a user message with one input_text and nothing else", () => {
  expect(sideBoundaryItem()).toEqual({ type: "message", role: "user", content: [{ type: "input_text", text: CODEX_SIDE_BOUNDARY_PROMPT }] });
});

/** `is_history_pagination_unsupported`: the fork is retried without `excludeTurns` only when the server's complaint is about that history feature. */
test("only an error about paginated history sends the fork again without excludeTurns", () => {
  for (const message of ["unknown field `excludeTurns`", "Invalid params: historyMode is not supported", "exclude turns is unsupported", "thread/turns/list is unavailable", "thread/items/list not found", "Method not found: thread/fork", "unknown variant `paginated`"]) {
    expect(isHistoryPaginationUnsupported(message), message).toBe(true);
  }
  for (const message of ["transport disconnected", "no rollout found for thread id 1", "paginated", "permission denied"]) {
    expect(isHistoryPaginationUnsupported(message), message).toBe(false);
  }
});

/** `side_start_error_message`: a conversation without a first message has nothing to branch from, and the server says so in two ways. */
test("a fork refused because the conversation has no first message is recognized", () => {
  expect(sideStartRefusal("thread/fork failed: no rollout found for thread id 019da1a1-bed9-7a43-88a2-b49d43915021")).toBe("no-conversation");
  expect(sideStartRefusal("includeTurns is unavailable before first user message")).toBe("no-conversation");
  expect(sideStartRefusal("transport disconnected")).toBeUndefined();
});

// ── The session ────────────────────────────────────────────────────────────────────────────────────────────────────

/** `thread/fork`'s answer (`v2/ThreadForkResponse.ts`) for the side thread `s`. */
const sideThread = { thread: { id: "s" }, model: "test-model", modelProvider: "openai" };
const methods = (env: ConnectedCodex, from: number) => env.rpc.calls.slice(from).map(call => call.method);
const callsTo = (env: ConnectedCodex, method: string) => env.rpc.calls.filter(call => call.method === method);

/**
 * Makes the fixture answer what `/side` asks: `config/read` (the thread's own developer instructions, `v2/Config.ts`), `thread/fork`, `thread/inject_items`
 * (`v2/ThreadInjectItemsResponse.ts`), `thread/unsubscribe` and `turn/interrupt`; and tells the side thread's `turn/start` (turn `sideTurn`) from the conversation's.
 */
function answerSide(rpc: FixtureRpc, overrides: Record<string, (params: any) => any> = {}, sideTurn = "su") {
  rpc.replies.set("config/read", { config: { developer_instructions: "Existing developer policy." }, origins: {}, layers: null });
  rpc.replies.set("thread/inject_items", {});
  rpc.replies.set("thread/unsubscribe", { status: "unsubscribed" });
  rpc.replies.set("turn/interrupt", {});
  const replies = new Map(rpc.replies);
  rpc.handler = async (method, params) => {
    if (overrides[method]) return overrides[method]!(params);
    if (method === "thread/fork") return sideThread;
    if (method === "turn/start" && params.threadId === "s") return { turn: { id: sideTurn, status: "inProgress" } };
    if (!replies.has(method)) throw new Error(`Unexpected ${method}`);
    return replies.get(method);
  };
}
const detourEvents = (env: ConnectedCodex) => env.events.filter(event => event.type === "detourStart" || event.type === "detourEnd").map(event => event.type);
/** A conversation with one exchange and a side conversation opened on it. */
async function withSide(overrides: Record<string, (params: any) => any> = {}, sideTurn = "su") {
  const env = await connectedCodex(); await converse(env); answerSide(env.rpc, overrides, sideTurn);
  expect(await env.session.startSide()).toEqual({ status: "started" });
  return env;
}
/** The side thread's answer, delivered like Codex does: streamed deltas of one item, the item, and the turn's end. */
const sideDelta = (env: ConnectedCodex, delta: string, itemId = "si", turnId = "su") => env.rpc.onNotification("item/agentMessage/delta", { threadId: "s", turnId, itemId, delta });
const sideDone = (env: ConnectedCodex, turnId = "su", status = "completed") => env.rpc.onNotification("turn/completed", { threadId: "s", turn: { id: turnId, status } });

/**
 * Codex's `handle_start_side`: `config/read` (the developer instructions the thread already has), `thread/fork` of the conversation as an ephemeral, `user`-sourced thread that
 * skips the copied turns (`excludeTurns`) and carries the side instructions after the existing ones, and `thread/inject_items` with the boundary — in that order.
 * The main conversation stays as it was.
 */
test("startSide() reads the config, forks an ephemeral thread with the side instructions and injects the boundary, in Codex's order", async () => {
  const env = await connectedCodex(); await converse(env); answerSide(env.rpc);
  const before = env.rpc.calls.length;
  expect(await env.session.startSide()).toEqual({ status: "started" });
  expect(methods(env, before)).toEqual(["config/read", "thread/fork", "thread/inject_items"]);
  const [read, fork, inject] = env.rpc.calls.slice(before);
  expect(read!.params).toEqual({ includeLayers: false, cwd: "/project" });
  expect(fork!.params).toEqual({
    threadId: "t", cwd: "/project", model: "test-model", modelProvider: "openai", approvalPolicy: "untrusted", approvalsReviewer: "user", sandbox: "workspace-write",
    developerInstructions: `Existing developer policy.\n\n${CODEX_SIDE_DEVELOPER_INSTRUCTIONS}`, ephemeral: true, threadSource: "user", excludeTurns: true,
  });
  expect(inject!.params).toEqual({ threadId: "s", items: [{ type: "message", role: "user", content: [{ type: "input_text", text: CODEX_SIDE_BOUNDARY_PROMPT }] }] });
  expect(env.session.detour?.()).toEqual({ kind: "side", readOnly: false });
  expect(detourEvents(env)).toEqual(["detourStart"]);
  expect(env.session.sessionId).toBe("t");
});

/**
 * The fork takes the permission mode the person chose (`/permissions`), like `/fork` does, and the side turns are sent with it: the side conversation cannot do more
 * (nor is it asked less) than the main one.
 */
test("startSide() forks with the chosen permission mode and its turns carry that mode", async () => {
  const env = await connectedCodex("en", rpc => rpc.replies.set("configRequirements/read", { requirements: null }));
  await env.session.setWorkMode("never:danger-full-access");
  await converse(env); answerSide(env.rpc);
  await env.session.startSide();
  const fork = callsTo(env, "thread/fork")[0]!.params;
  expect(fork).toMatchObject({ approvalPolicy: "never", sandbox: "danger-full-access", approvalsReviewer: "user" });
  const pending = env.session.send("hi"); await settle();
  expect(callsTo(env, "turn/start").at(-1)!.params).toMatchObject({ threadId: "s", approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" }, approvalsReviewer: "user" });
  sideDone(env); await pending;
});

/** With no developer instructions in the config, or a config that cannot be read, the side instructions go alone (Codex reads its config best-effort). */
test("startSide() without existing developer instructions sends the side instructions alone", async () => {
  for (const config of [(): any => ({ config: { developer_instructions: null }, origins: {}, layers: null }), (): any => { throw new Error("config unavailable"); }]) {
    const env = await connectedCodex(); await converse(env); answerSide(env.rpc, { "config/read": config });
    expect(await env.session.startSide()).toEqual({ status: "started" });
    expect(callsTo(env, "thread/fork")[0]!.params.developerInstructions).toBe(CODEX_SIDE_DEVELOPER_INSTRUCTIONS);
  }
});

/** `fork_thread_at_with_presentation`: a server that does not know `excludeTurns` gets the fork again without it. */
test("startSide() sends the fork again without excludeTurns when the server does not know it", async () => {
  let attempts = 0;
  const env = await connectedCodex(); await converse(env);
  answerSide(env.rpc, { "thread/fork": params => { attempts++; if ("excludeTurns" in params) throw new Error("unknown field `excludeTurns`"); return sideThread; } });
  expect(await env.session.startSide()).toEqual({ status: "started" });
  expect(attempts).toBe(2);
  const forks = callsTo(env, "thread/fork");
  expect(forks[0]!.params.excludeTurns).toBe(true);
  expect("excludeTurns" in forks[1]!.params).toBe(false);
  expect(forks[1]!.params.developerInstructions).toBe(forks[0]!.params.developerInstructions);
});

/** Each way `/side` can be refused gets its own answer (Codex's messages, told by the screen) and calls nothing it should not. */
test("startSide() without a conversation, while one is open or during a review answers without forking", async () => {
  const fresh = await connectedCodex(); answerSide(fresh.rpc);
  const before = fresh.rpc.calls.length;
  expect(await fresh.session.startSide()).toEqual({ status: "no-conversation" });
  expect(fresh.rpc.calls.length).toBe(before);

  const open = await withSide();
  const calls = open.rpc.calls.length;
  expect(await open.session.startSide()).toEqual({ status: "already-open" });
  expect(open.rpc.calls.length).toBe(calls);

  const reviewing = await connectedCodex(); await converse(reviewing);
  reviewing.rpc.replies.set("review/start", { turn: { id: "r1", status: "inProgress" }, reviewThreadId: "t" });
  answerSide(reviewing.rpc);
  const review = reviewing.session.startReview({ type: "uncommittedChanges" }); await settle();
  expect(await reviewing.session.startSide()).toEqual({ status: "reviewing" });
  expect(callsTo(reviewing, "thread/fork")).toHaveLength(0);
  reviewing.rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "r1", status: "completed" } });
  await review;
});

/** `side_start_error_message`: the server refusing to fork a conversation with no rollout is «send a message first», anything else is a failure with the server's own text. */
test("startSide() tells a conversation without a first message from a real failure, and cleans up after a failed preparation", async () => {
  const noRollout = await connectedCodex(); await converse(noRollout);
  answerSide(noRollout.rpc, { "thread/fork": () => { throw new Error("thread/fork failed: no rollout found for thread id 019da1a1"); } });
  expect(await noRollout.session.startSide()).toEqual({ status: "no-conversation" });
  expect(noRollout.session.detour?.()).toBeUndefined();

  const broken = await connectedCodex(); await converse(broken);
  answerSide(broken.rpc, { "thread/fork": () => { throw new Error("transport disconnected"); } });
  expect(await broken.session.startSide()).toEqual({ status: "failed", stage: "start", error: "transport disconnected" });
  expect(detourEvents(broken)).toEqual([]);

  const unprepared = await connectedCodex(); await converse(unprepared);
  answerSide(unprepared.rpc, { "thread/inject_items": () => { throw new Error("inject refused"); } });
  expect(await unprepared.session.startSide()).toEqual({ status: "failed", stage: "prepare", error: "inject refused" });
  expect(callsTo(unprepared, "thread/unsubscribe").map(call => call.params)).toEqual([{ threadId: "s" }]);
  expect(unprepared.session.detour?.()).toBeUndefined();
  expect(detourEvents(unprepared)).toEqual([]);
});

/** While the side conversation is open what the person writes goes to its thread as a normal turn, with the mode and model of the main one, and never to the main thread. */
test("what is written during a side conversation is a turn of the side thread and the memory block is not sent again", async () => {
  const env = await withSide();
  const before = env.rpc.calls.length;
  const pending = env.session.send("what does this function do?"); await settle();
  const turn = env.rpc.calls.slice(before).find(call => call.method === "turn/start")!;
  expect(turn.params).toEqual({ threadId: "s", input: [{ type: "text", text: "what does this function do?" }], model: "test-model", effort: "medium", approvalsReviewer: "user", approvalPolicy: "untrusted" });
  expect(env.session.busy).toBe(true);
  sideDelta(env, "It reads the file.");
  sideDone(env);
  await pending;
  expect(env.session.busy).toBe(false);
  expect(env.events.some(event => event.type === "delta" && event.text === "It reads the file.")).toBe(true);
  expect(env.rpc.calls.slice(before).filter(call => call.method === "turn/start").every(call => call.params.threadId === "s")).toBe(true);
});

/**
 * The two threads are told apart by `threadId` only. Here both use the same turn id «u» (Codex never does, but a mix-up would show exactly like this): the main
 * turn's end must not end the side turn, and the side turn's end must not end the main one. What the main thread says during the side conversation waits and comes after
 * `detourEnd`, in order; what the side thread says shows at once.
 */
test("events of the two threads, interleaved, each go to their own thread", async () => {
  const env = await connectedCodex(); answerSide(env.rpc, {}, "u");
  const main = env.session.send("long task"); await settle();
  expect(await env.session.startSide()).toEqual({ status: "started" });
  expect(env.session.mainBusy?.()).toBe(true);
  expect(env.session.busy, "busy tells about the conversation on screen").toBe(false);

  const side = env.session.send("quick question"); await settle();
  expect(env.session.busy).toBe(true);
  env.rpc.onNotification("item/agentMessage/delta", { threadId: "t", turnId: "u", itemId: "m1", delta: "main part one" });
  sideDelta(env, "side part one", "si", "u");
  env.rpc.onNotification("item/agentMessage/delta", { threadId: "t", turnId: "u", itemId: "m1", delta: " main part two" });
  const shown = () => env.events.filter(event => event.type === "delta").map(event => event.text);
  expect(shown()).toEqual(["side part one"]);

  env.rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } });
  await main;
  expect(env.session.busy, "the main turn ending does not end the side turn").toBe(true);
  sideDone(env, "u");
  await side;
  expect(env.session.busy).toBe(false);

  await env.session.leaveDetour?.();
  const order = env.events.filter(event => event.type === "delta" || event.type === "detourEnd").map(event => event.type === "detourEnd" ? "detourEnd" : event.text);
  expect(order).toEqual(["side part one", "detourEnd", "main part one", " main part two"]);
});
/** A side answer is what `/copy` copies and `/export` exports while it is on screen; the main answer comes back when the person returns. */
test("during a side conversation /copy and /export use the side, and the main answer returns afterwards", async () => {
  const env = await withSide({ "thread/read": () => ({ thread: { turns: [{ items: [
    { type: "userMessage", id: "m1", content: [{ type: "text", text: "hello", text_elements: [] }] }, { type: "agentMessage", id: "m2", text: "Hi there" },
  ] }] } }) });
  const pending = env.session.send("what is X?"); await settle();
  env.rpc.onNotification("item/completed", { threadId: "s", turnId: "su", item: { type: "agentMessage", id: "sa", text: "X is a letter.", phase: null, memoryCitation: null }, completedAtMs: 3 });
  sideDone(env); await pending;
  expect(env.session.lastResponse?.()).toBe("X is a letter.");
  const markdown = await env.session.exportTranscript?.();
  expect(markdown).toContain("what is X?");
  expect(markdown).toContain("X is a letter.");
  expect(markdown).not.toContain("hello");
  expect(markdown).not.toContain("Hi there");
  await env.session.leaveDetour?.();
  expect(env.session.lastResponse?.()).toBe("Hi there");
  expect(await env.session.exportTranscript?.()).not.toContain("X is a letter.");
});

/**
 * Leaving with a turn running: `turn/interrupt` (with the side turn's id) and `thread/unsubscribe`, then the main conversation is back untouched. The `send` that was
 * waiting on the side turn is released, so the box is free.
 */
test("leaveDetour() interrupts a running side turn, unsubscribes and returns to the main conversation", async () => {
  const env = await withSide();
  const pending = env.session.send("a long question"); await settle();
  const before = env.rpc.calls.length;
  await env.session.leaveDetour?.();
  await pending;
  expect(methods(env, before)).toEqual(["turn/interrupt", "thread/unsubscribe"]);
  expect(env.rpc.calls[before]!.params).toEqual({ threadId: "s", turnId: "su" });
  expect(env.rpc.calls[before + 1]!.params).toEqual({ threadId: "s" });
  expect(env.session.detour?.()).toBeUndefined();
  expect(detourEvents(env)).toEqual(["detourStart", "detourEnd"]);
  expect(env.session.sessionId).toBe("t");
  expect(env.session.busy).toBe(false);
});

/** Nothing running in the side thread means no `turn/interrupt` (there is no turn to interrupt); the thread is still detached. */
test("leaveDetour() on an idle side conversation only unsubscribes", async () => {
  const env = await withSide();
  const before = env.rpc.calls.length;
  await env.session.leaveDetour?.();
  expect(methods(env, before)).toEqual(["thread/unsubscribe"]);
  expect(env.rpc.calls[before]!.params).toEqual({ threadId: "s" });
});

/** Codex returns to the parent at once and cleans up in the background (`discard_side_thread_in_background`): a failing cleanup never keeps the person in the side conversation. */
test("leaveDetour() returns to the main conversation even when the cleanup calls fail", async () => {
  const env = await withSide();
  const pending = env.session.send("a long question"); await settle();
  env.rpc.handler = async (method, params) => { if (method === "turn/interrupt" || method === "thread/unsubscribe") throw new Error(`${method} failed`); throw new Error(`Unexpected ${method} ${JSON.stringify(params)}`); };
  await env.session.leaveDetour?.();
  await pending;
  expect(env.session.detour?.()).toBeUndefined();
  expect(detourEvents(env)).toEqual(["detourStart", "detourEnd"]);
});

/** After the side thread is discarded (`abandoned_side_threads`), whatever it still sends is ignored, and a new side conversation can be opened. */
test("events of a discarded side thread are ignored and a new side conversation can start", async () => {
  const env = await withSide();
  await env.session.leaveDetour?.();
  const shown = env.events.length;
  sideDelta(env, "late words");
  env.rpc.onNotification("item/completed", { threadId: "s", turnId: "su", item: { type: "agentMessage", id: "late", text: "late answer", phase: null, memoryCitation: null }, completedAtMs: 4 });
  expect(env.events.length).toBe(shown);
  expect(texts(env.events)).not.toContain("late answer");
  expect(await env.session.startSide()).toEqual({ status: "started" });
});

/** `/f614:stop` while the side conversation is on screen stops the side turn (what the person is watching), not the main one. */
test("cancel() during a side turn interrupts the side thread's turn", async () => {
  const env = await withSide();
  const pending = env.session.send("a long question"); await settle();
  const before = env.rpc.calls.length;
  await env.session.cancel();
  expect(env.rpc.calls.slice(before).find(call => call.method === "turn/interrupt")!.params).toEqual({ threadId: "s", turnId: "su" });
  sideDone(env, "su", "interrupted");
  await pending;
  expect(env.session.detour?.()).toBeDefined();
  expect(env.session.busy).toBe(false);
});

/**
 * A permission question of the side thread is asked to the person (they are typing there), and only while its turn runs; one from the main thread is held until they
 * are back — it would otherwise be asked inside the side conversation, about something they cannot see — and the side header says the main thread needs approval.
 */
test("the side thread's permission questions are asked, the main thread's wait until the person returns", async () => {
  const asked: string[] = [];
  const env = await connectedCodex("en", () => {}, async description => { asked.push(description); return true; });
  const main = env.session.send("do the work"); await settle();
  answerSide(env.rpc);
  expect(await env.session.startSide()).toEqual({ status: "started" });

  const idle = await env.rpc.onRequest("item/commandExecution/requestApproval", { threadId: "s", turnId: "su", itemId: "c0", command: "ls" });
  expect(idle, "no side turn is running").toEqual({ decision: "decline" });

  const side = env.session.send("list the files"); await settle();
  const sideAnswer = await env.rpc.onRequest("item/commandExecution/requestApproval", { threadId: "s", turnId: "su", itemId: "c1", command: "ls" });
  expect(sideAnswer).toEqual({ decision: "accept" });
  expect(asked).toHaveLength(1);

  let mainAnswer: any;
  const mainRequest = env.rpc.onRequest("item/commandExecution/requestApproval", { threadId: "t", turnId: "u", itemId: "c2", command: "rm build" }).then(answer => { mainAnswer = answer; });
  await settle();
  expect(mainAnswer, "held while the person is in the side conversation").toBeUndefined();
  expect(asked).toHaveLength(1);
  expect(env.session.detour?.()).toEqual({ kind: "side", readOnly: false, mainNeedsApproval: true });

  await env.session.leaveDetour?.();
  await mainRequest;
  expect(mainAnswer).toEqual({ decision: "accept" });
  expect(asked).toHaveLength(2);
  await side.catch(() => {});
  env.rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } });
  await main;
});
