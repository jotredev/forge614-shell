import { expect, test } from "bun:test";
import { RECAP_PROMPT_PREFIX as CODEX_RECAP_PROMPT_PREFIX } from "../../../tests/support/codex-texts.ts";
import { FixtureRpc } from "../../../tests/support/rpc-fixture.ts";
import { connectedCodex, converse, settle, texts } from "../../../tests/support/codex-fixture.ts";
import type { ConnectedCodex } from "../../../tests/support/codex-fixture.ts";
import { RECAP_PROMPT_PREFIX } from "./prompts.ts";
import {
  RECAP_HISTORY_MAX_BYTES, RECAP_HISTORY_MAX_TURNS, RECAP_MAX_BYTES, parseRecap, recapHistory, recapOutputSchema, recapPrompt, temporaryThreadConfig,
} from "./recap.ts";
import type { RecapCell } from "./recap.ts";

const bytes = (text: string) => Buffer.byteLength(text);
const user = (text: string): RecapCell => ({ role: "user", text });
const assistant = (text: string): RecapCell => ({ role: "assistant", text });

/**
 * The prompt is for the model, so it must be Codex's own words to the character: `PROMPT_PREFIX` of `context-fragments/src/recap_prompt.rs`
 * (rust-v0.159.0), compared with a copy a script extracted from that file. Exists because a paraphrase would change what the model is asked to write.
 */
test("the recap prompt is Codex's PROMPT_PREFIX, character for character, and the conversation follows «Conversation:»", () => {
  expect(RECAP_PROMPT_PREFIX).toBe(CODEX_RECAP_PROMPT_PREFIX);
  expect(bytes(RECAP_PROMPT_PREFIX)).toBe(1790);
  expect(RECAP_PROMPT_PREFIX.startsWith("Write a brief catch-up for a user returning to this task.")).toBe(true);
  expect(RECAP_PROMPT_PREFIX.endsWith("\n\nConversation:\n")).toBe(true);
  expect(recapPrompt("User: hi\n\nAssistant: hello")).toBe(`${CODEX_RECAP_PROMPT_PREFIX}User: hi\n\nAssistant: hello`);
});

/**
 * `RecapPrompt::MAX_ESTIMATED_TOKENS` is 8 192 tokens at 4 bytes each (`approx_bytes_for_tokens`); the history gets what the fixed instructions leave
 * (`HISTORY_MAX_BYTES`) and is cut at a character boundary (`floor_char_boundary`). Exists so a long conversation can never make the prompt bigger than Codex's.
 */
test("the whole prompt never exceeds 8192 estimated tokens (32768 bytes) and a cut never splits a character", () => {
  expect(RECAP_MAX_BYTES).toBe(32768);
  expect(RECAP_HISTORY_MAX_BYTES).toBe(32768 - 1790);
  const prompt = recapPrompt("é".repeat(RECAP_HISTORY_MAX_BYTES));
  expect(bytes(prompt)).toBeLessThanOrEqual(RECAP_MAX_BYTES);
  expect(prompt).not.toContain("�");
  expect(bytes(prompt)).toBe(RECAP_MAX_BYTES);
});

/** `recap_output_schema()` in `app/recap.rs`: the schema `turn/start` carries as `outputSchema` (`v2/TurnStartParams.ts`). */
test("the output schema is Codex's: summary up to 700 characters, next_action up to 200 or null, nothing else", () => {
  expect(recapOutputSchema()).toEqual({
    type: "object",
    properties: {
      summary: { type: "string", minLength: 1, maxLength: 700 },
      next_action: { type: ["string", "null"], maxLength: 200 },
    },
    required: ["summary", "next_action"],
    additionalProperties: false,
  });
});

/** `parse_recap` in `app/recap.rs`: what the model answered is trusted only if it has exactly the two fields and stays within the limits. */
test("the model's answer is accepted only in Codex's exact shape and limits", () => {
  expect(parseRecap('{"summary":"  Fixed the login.  ","next_action":"  Deploy it.  "}')).toEqual({ summary: "Fixed the login.", nextAction: "Deploy it." });
  expect(parseRecap('{"summary":"Fixed the login.","next_action":null}')).toEqual({ summary: "Fixed the login." });
  expect(parseRecap('{"summary":"Fixed the login.","next_action":"   "}')).toEqual({ summary: "Fixed the login." });
  for (const invalid of [
    "not json", '{"summary":"","next_action":null}', '{"summary":"   ","next_action":null}', '{"summary":"x"}',
    '{"summary":"x","next_action":null,"extra":1}', `{"summary":"${"a".repeat(701)}","next_action":null}`, `{"summary":"x","next_action":"${"b".repeat(201)}"}`,
    '{"summary":7,"next_action":null}', "[]", "null",
  ]) expect(parseRecap(invalid), invalid.slice(0, 50)).toBeUndefined();
  expect(parseRecap(`{"summary":"${"a".repeat(700)}","next_action":"${"b".repeat(200)}"}`)?.summary).toHaveLength(700);
});

/** `recent_exchanges` in `app/recap_history.rs`: at most eight answered exchanges, the oldest dropped. */
test("the history keeps the last 8 answered exchanges, labelled User and Assistant, separated by a blank line", () => {
  expect(RECAP_HISTORY_MAX_TURNS).toBe(8);
  const cells: RecapCell[] = [];
  for (let index = 1; index <= 10; index++) cells.push(user(`question ${index}`), assistant(`answer ${index}`));
  const history = recapHistory(cells);
  expect(history.startsWith("User: question 3\n\nAssistant: answer 3\n\nUser: question 4")).toBe(true);
  expect(history.endsWith("User: question 10\n\nAssistant: answer 10")).toBe(true);
  expect(history).not.toContain("question 2\n");
  expect(history.split("\n\nUser: ")).toHaveLength(8);
});

/** A request the assistant has not answered yet is kept and labelled «Pending user request» (`Exchange::fields`), so the summary knows what is open. */
test("a newer unanswered request is kept and labelled «Pending user request»", () => {
  expect(recapHistory([user("first"), assistant("done"), user("and now this")])).toBe("User: first\n\nAssistant: done\n\nPending user request: and now this");
});

/** Consecutive messages of the person count as one request (steering), joined with a blank line; empty or blank messages and a history with no request say nothing. */
test("adjacent user messages are one request, blank cells are skipped and no request gives no history", () => {
  expect(recapHistory([user("look at the login"), user("especially the tests"), assistant("ok"), assistant("   ")])).toBe("User: look at the login\n\nespecially the tests\n\nAssistant: ok");
  expect(recapHistory([])).toBe("");
  expect(recapHistory([assistant("hello, how can I help?")])).toBe("");
  expect(recapHistory([user("   ")])).toBe("");
});

/**
 * Over the byte budget the oldest exchanges go first and «[Earlier exchanges omitted]» says so (`OMITTED_HISTORY`): eight exchanges of about 10 000 bytes each
 * leave the last three, and the newest answer is never cut.
 */
test("a history over the budget drops the oldest exchanges and says so", () => {
  const cells: RecapCell[] = [];
  for (let index = 0; index < 8; index++) cells.push(user(`q${index} ${"x".repeat(4995)}`), assistant(`a${index} ${"y".repeat(4995)}`));
  const block = (index: number) => `User: q${index} ${"x".repeat(4995)}\n\nAssistant: a${index} ${"y".repeat(4995)}`;
  const history = recapHistory(cells);
  expect(history).toBe(`[Earlier exchanges omitted]\n\n${[5, 6, 7].map(block).join("\n\n")}`);
  expect(bytes(history)).toBeLessThanOrEqual(RECAP_HISTORY_MAX_BYTES);
});

/**
 * When even the newest exchange is too big, each message keeps its beginning and its end around «[... excerpted ...]» (`excerpt`) and the result fills the
 * budget exactly (`HISTORY_MAX_BYTES`): a short request stays whole and the long answer gives up its middle.
 */
test("a single exchange over the budget keeps both ends of the long message and fills the budget exactly", () => {
  const answer = `START${"y".repeat(RECAP_HISTORY_MAX_BYTES)}END`;
  const history = recapHistory([user("x".repeat(10)), assistant(answer)]);
  expect(bytes(history)).toBe(RECAP_HISTORY_MAX_BYTES);
  expect(history.startsWith(`User: ${"x".repeat(10)}\n\nAssistant: START`)).toBe(true);
  expect(history).toContain("\n[... excerpted ...]\n");
  expect(history.endsWith("END")).toBe(true);
});

/**
 * The 26 switches, the web search setting and the read-only profile of `start_temporary_thread` (`temporary_structured_request.rs`), plus one `{ enabled: false }` per MCP server
 * (the ones the app-server reports, listed once and sorted): the recap thread must not reach any tool, memory or outside service.
 */
test("the temporary thread turns off Codex's listed features and every MCP server, and asks for the read-only profile", () => {
  const config = temporaryThreadConfig(["github", "forge614-engram", "github"]);
  expect(config).toEqual({
    "features.apps": false, "features.code_mode": false, "features.code_mode_only": false, "features.context_management": false,
    "features.current_time_reminder": false, "features.deferred_executor": false, "features.enable_fanout": false, "features.goals": false,
    "features.hooks": false, "features.image_generation": false, "features.memories": false, "features.multi_agent": false,
    "features.multi_agent_v2": false, "features.plugins": false, "features.request_permissions_tool": false, "features.shell_snapshot": false,
    "features.shell_tool": false, "features.standalone_web_search": false, "features.token_budget": false, "features.tool_suggest": false,
    "features.unified_exec": false, "features.view_image": false, "cloud.skills.enabled": false, "skills.include_instructions": false,
    "tools.experimental_request_user_input.enabled": false, "tools.update_plan.enabled": false, web_search: "disabled",
    default_permissions: ":read-only",
    mcp_servers: { "forge614-engram": { enabled: false }, github: { enabled: false } },
  });
  expect(Object.keys(config as Record<string, unknown>)).toHaveLength(29);
});

// ── The session ────────────────────────────────────────────────────────────────────────────────────────────────────

/** `thread/start`'s answer for the temporary thread `r` (`v2/ThreadStartResponse.ts`): read-only, as Codex requires (`SandboxPolicy::ReadOnly`). */
const recapThread = { thread: { id: "r" }, model: "test-model", modelProvider: "openai", sandbox: { type: "readOnly", networkAccess: false } };

/**
 * Makes the fixture answer the calls `/recap` makes, telling the recap thread `r` apart from the conversation `t` (both use `turn/start`): `config/read`
 * (`v2/ConfigReadResponse.ts`, MCP servers in the flattened part of `config`), `thread/start` and `thread/unsubscribe` (`v2/ThreadUnsubscribeResponse.ts`).
 * `overrides` replace one method's answer.
 */
function answerRecap(rpc: FixtureRpc, overrides: Record<string, (params: any) => any> = {}) {
  rpc.replies.set("config/read", { config: { model: "test-model", mcp_servers: { "forge614-engram": { command: "engram" }, github: { url: "https://example.com" } } }, origins: {}, layers: null });
  rpc.replies.set("thread/unsubscribe", { status: "unsubscribed" });
  const replies = new Map(rpc.replies);
  rpc.handler = async (method, params) => {
    if (overrides[method]) return overrides[method]!(params);
    if (method === "thread/start" && params.ephemeral === true) return recapThread;
    if (method === "turn/start" && params.threadId === "r") return { turn: { id: "ru", status: "inProgress" } };
    if (!replies.has(method)) throw new Error(`Unexpected ${method}`);
    return replies.get(method);
  };
}

/** What the model writes when it obeys the schema, delivered like Codex does: an `agentMessage` item of the recap turn (`v2/ItemCompletedNotification.ts`) and the turn's end. */
function recapAnswers(env: ConnectedCodex, text: string, status = "completed", threadId = "r") {
  env.rpc.onNotification("item/completed", { threadId, turnId: "ru", item: { type: "agentMessage", id: "ri", text, phase: null, memoryCitation: null }, completedAtMs: 2 });
  env.rpc.onNotification("turn/completed", { threadId, turn: { id: "ru", status } });
}
const answer = JSON.stringify({ summary: "You greeted Codex and it said hello back.", next_action: "Ask for the next task." });
const methods = (env: ConnectedCodex, from: number) => env.rpc.calls.slice(from).map(call => call.method);

/**
 * Codex's `request_recap`: `config/read` (to learn every MCP server), `thread/start` for an ephemeral, read-only thread with no tools or environment
 * (`temporary_structured_request.rs`), `turn/start` with the prompt and `outputSchema`, and `thread/unsubscribe` — always in that order. The conversation's own
 * thread is untouched and the recap thread is never shown in the chat.
 */
test("recap() sends config/read, an ephemeral read-only thread/start, turn/start with the prompt and schema, then thread/unsubscribe", async () => {
  const env = await connectedCodex(); await converse(env);
  answerRecap(env.rpc);
  const before = env.rpc.calls.length; const shown = texts(env.events);
  const pending = env.session.recap();
  await settle();
  recapAnswers(env, answer);
  expect(await pending).toEqual({ status: "ok", summary: "You greeted Codex and it said hello back.", nextAction: "Ask for the next task." });
  expect(methods(env, before)).toEqual(["config/read", "thread/start", "turn/start", "thread/unsubscribe"]);
  const [read, start, turn, unsubscribe] = env.rpc.calls.slice(before);
  expect(read!.params).toEqual({ includeLayers: false, cwd: "/project" });
  expect(start!.params).toEqual({
    model: "test-model", modelProvider: "openai", cwd: "/project", approvalPolicy: "never", sandbox: "read-only", runtimeWorkspaceRoots: [], ephemeral: true, threadSource: "system",
    environments: [], dynamicTools: [], selectedCapabilityRoots: [],
    config: temporaryThreadConfig(["forge614-engram", "github"]),
  });
  expect(turn!.params).toEqual({
    threadId: "r", input: [{ type: "text", text: `${CODEX_RECAP_PROMPT_PREFIX}User: hello\n\nAssistant: Hi there`, text_elements: [] }], outputSchema: recapOutputSchema(),
  });
  expect(unsubscribe!.params).toEqual({ threadId: "r" });
  expect(env.session.sessionId).toBe("t");
  expect(texts(env.events)).toEqual(shown);
  expect(env.session.busy).toBe(false);
});

/** The prompt carries only what the person saw: the messages of the exchange, never the memory block Shell puts in front of the first message. */
test("recap() builds the history from the visible exchanges of this conversation, more than one", async () => {
  const env = await connectedCodex(); await converse(env, "hello", "Hi there"); await converse(env, "fix the login", "Done, the login works");
  answerRecap(env.rpc);
  const pending = env.session.recap(); await settle(); recapAnswers(env, answer); await pending;
  const turn = env.rpc.calls.find(call => call.method === "turn/start" && call.params.threadId === "r")!;
  expect(turn.params.input[0].text).toBe(`${CODEX_RECAP_PROMPT_PREFIX}User: hello\n\nAssistant: Hi there\n\nUser: fix the login\n\nAssistant: Done, the login works`);
});

/** A conversation that was reopened (`/resume`) has its old messages in the recap, as they are on the screen. */
test("recap() after /resume summarizes the resumed conversation", async () => {
  const env = await connectedCodex();
  env.rpc.replies.set("thread/read", { thread: { id: "old", cwd: "/project", status: { type: "idle" }, path: null, turns: [
    { id: "x", startedAt: 1, completedAt: 2, items: [{ type: "userMessage", id: "m1", content: [{ type: "text", text: "add a footer", text_elements: [] }] }, { type: "agentMessage", id: "m2", text: "Footer added." }] },
  ] } });
  await env.session.resume("old");
  answerRecap(env.rpc);
  const pending = env.session.recap(); await settle(); recapAnswers(env, answer); await pending;
  expect(env.rpc.calls.find(call => call.method === "turn/start")!.params.input[0].text).toBe(`${CODEX_RECAP_PROMPT_PREFIX}User: add a footer\n\nAssistant: Footer added.`);
});

/** «There is no conversation history to recap.» (`MANUAL_RECAP_EMPTY_HISTORY_MESSAGE`): nothing is asked of Codex, and no thread is created. */
test("recap() with no conversation yet says so and calls nothing", async () => {
  const env = await connectedCodex(); answerRecap(env.rpc);
  const before = env.rpc.calls.length;
  expect(await env.session.recap()).toEqual({ status: "empty" });
  expect(env.rpc.calls.length).toBe(before);
});

/** `MANUAL_RECAP_IN_PROGRESS_MESSAGE`: a second `/recap` while one is being generated is refused and starts no second thread. */
test("recap() while another recap is being generated answers «busy» and starts nothing", async () => {
  const env = await connectedCodex(); await converse(env); answerRecap(env.rpc);
  const first = env.session.recap(); await settle();
  const before = env.rpc.calls.length;
  expect(await env.session.recap()).toEqual({ status: "busy" });
  expect(env.rpc.calls.length).toBe(before);
  recapAnswers(env, answer);
  expect((await first).status).toBe("ok");
  (env.session as any).recapTimeoutMs = 50;
  expect((await env.session.recap()).status).not.toBe("busy");
});

/**
 * The recap thread is hidden work: whatever it streams (deltas, tool lines, an error) never reaches the chat, and what the conversation streams at the same moment
 * still does. Events are told apart by `threadId`.
 */
test("events of the recap thread never reach the chat and the conversation's own events still do", async () => {
  const env = await connectedCodex(); await converse(env); answerRecap(env.rpc);
  const pending = env.session.recap(); await settle();
  env.rpc.onNotification("item/agentMessage/delta", { threadId: "r", turnId: "ru", itemId: "ri", delta: "SECRET-RECAP-DELTA" });
  env.rpc.onNotification("item/started", { threadId: "r", turnId: "ru", item: { type: "commandExecution", id: "c", command: "ls" } });
  env.rpc.onNotification("error", { threadId: "r", turnId: "ru", error: { message: "recap-only failure" }, willRetry: false });
  env.rpc.onNotification("item/agentMessage/delta", { threadId: "t", turnId: "u", itemId: "main-item", delta: "conversation text" });
  recapAnswers(env, answer);
  await pending;
  const all = JSON.stringify(env.events);
  expect(all).not.toContain("SECRET-RECAP-DELTA");
  expect(all).not.toContain("recap-only failure");
  expect(all).not.toContain("commandExecution");
  expect(env.events.some(event => event.type === "delta" && event.text === "conversation text")).toBe(true);
});

/**
 * Whatever goes wrong, the temporary thread is detached (`unsubscribe_temporary_thread` at the end of `run_temporary_structured_turn`) and the person gets one
 * «could not generate» answer. Each case is a real way Codex's own code fails: the turn ends failed or interrupted, the model breaks the schema, answers with more
 * than 8 KiB (`STRUCTURED_RESPONSE_MAX_BYTES`), or `turn/start` itself fails.
 */
for (const [name, arrange] of [
  ["the turn fails", (env: ConnectedCodex) => recapAnswers(env, answer, "failed")],
  ["the turn is interrupted", (env: ConnectedCodex) => recapAnswers(env, answer, "interrupted")],
  ["the model breaks the schema", (env: ConnectedCodex) => recapAnswers(env, '{"summary":"only a summary"}')],
  ["the model does not answer in JSON", (env: ConnectedCodex) => recapAnswers(env, "Here is your recap!")],
  ["the answer is over 8 KiB", (env: ConnectedCodex) => recapAnswers(env, JSON.stringify({ summary: "a".repeat(9000), next_action: null }))],
] as const) {
  test(`recap() detaches the temporary thread and reports failure when ${name}`, async () => {
    const env = await connectedCodex(); await converse(env); answerRecap(env.rpc);
    const before = env.rpc.calls.length;
    const pending = env.session.recap(); await settle();
    arrange(env);
    expect(await pending).toEqual({ status: "failed" });
    expect(methods(env, before)).toEqual(["config/read", "thread/start", "turn/start", "thread/unsubscribe"]);
    expect(env.rpc.calls.at(-1)!.params).toEqual({ threadId: "r" });
    (env.session as any).recapTimeoutMs = 50;
    expect((await env.session.recap()).status, "a new recap can start after a failure").not.toBe("busy");
  });
}

/** The error path of `run_temporary_structured_turn`: `turn/start` rejected still ends in `thread/unsubscribe`. */
test("recap() detaches the temporary thread when turn/start is rejected", async () => {
  const env = await connectedCodex(); await converse(env);
  answerRecap(env.rpc, { "turn/start": params => { if (params.threadId === "r") throw new Error("turn/start failed"); return { turn: { id: "u", status: "inProgress" } }; } });
  const before = env.rpc.calls.length;
  expect(await env.session.recap()).toEqual({ status: "failed" });
  expect(methods(env, before)).toEqual(["config/read", "thread/start", "turn/start", "thread/unsubscribe"]);
  expect(env.rpc.calls.at(-1)!.params).toEqual({ threadId: "r" });
});

/** `start_temporary_thread` refuses a thread that did not start read-only; the thread already exists on the server, so it is detached too. */
test("recap() refuses a thread that did not start read-only, sends no prompt and detaches it", async () => {
  const env = await connectedCodex(); await converse(env);
  answerRecap(env.rpc, { "thread/start": params => params.ephemeral === true ? { ...recapThread, sandbox: { type: "workspaceWrite", writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } } : { thread: { id: "t" }, model: "test-model", modelProvider: "openai" } });
  const before = env.rpc.calls.length;
  expect(await env.session.recap()).toEqual({ status: "failed" });
  expect(methods(env, before)).toEqual(["config/read", "thread/start", "thread/unsubscribe"]);
});

/** `config/read` fails: Codex fails closed («Fail closed if the remote-effective MCP configuration cannot be read»), so no thread is started at all. */
test("recap() starts no thread when config/read fails", async () => {
  const env = await connectedCodex(); await converse(env);
  answerRecap(env.rpc, { "config/read": () => { throw new Error("config unavailable"); } });
  const before = env.rpc.calls.length;
  expect(await env.session.recap()).toEqual({ status: "failed" });
  expect(methods(env, before)).toEqual(["config/read"]);
});

/**
 * `STRUCTURED_TURN_TIMEOUT` is 30 seconds in Codex; the tests shorten it (a field, like `stopWaitMs`). Past it the wait ends, the thread is detached (never left
 * subscribed) and the session is free for another recap.
 */
test("recap() past the time limit gives up, detaches the temporary thread and allows another recap", async () => {
  const env = await connectedCodex(); await converse(env);
  answerRecap(env.rpc);
  (env.session as any).recapTimeoutMs = 25;
  const before = env.rpc.calls.length;
  expect(await env.session.recap()).toEqual({ status: "failed" });
  expect(methods(env, before)).toEqual(["config/read", "thread/start", "turn/start", "thread/unsubscribe"]);
  expect(env.rpc.calls.at(-1)!.params).toEqual({ threadId: "r" });
  expect((await env.session.recap()).status).not.toBe("busy");
});

/** A thread that hangs before answering `turn/start` is bounded by the same limit (Codex wraps `turn/start` and the wait in one timeout). */
test("recap() gives up when turn/start never answers and still detaches the thread", async () => {
  const env = await connectedCodex(); await converse(env);
  answerRecap(env.rpc, { "turn/start": params => params.threadId === "r" ? new Promise(() => {}) : { turn: { id: "u", status: "inProgress" } } });
  (env.session as any).recapTimeoutMs = 25;
  const before = env.rpc.calls.length;
  expect(await env.session.recap()).toEqual({ status: "failed" });
  expect(methods(env, before)).toEqual(["config/read", "thread/start", "turn/start", "thread/unsubscribe"]);
});

/** The recap thread is ephemeral, so `/resume` (`thread/list`) never sees it: Shell asks for nothing about it beyond the calls above. */
test("recap() leaves the list of saved conversations alone", async () => {
  const env = await connectedCodex(); await converse(env); answerRecap(env.rpc);
  const pending = env.session.recap(); await settle(); recapAnswers(env, answer); await pending;
  expect(env.rpc.calls.some(call => call.method === "thread/list" || call.method === "thread/resume" || call.method === "thread/fork")).toBe(false);
  expect(env.rpc.calls.find(call => call.method === "thread/start" && call.params.ephemeral)!.params.ephemeral).toBe(true);
});
