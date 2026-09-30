import { CodexSession } from "../../src/engines/codex/session.ts";
import type { Approve } from "../../src/engines/types.ts";
import type { Locale } from "../../src/i18n/index.ts";
import { FixtureRpc } from "./rpc-fixture.ts";

/** Lets the pending promises of a fixture answer (every reply of `FixtureRpc` is immediate), so a test can look at what was asked before it answers the next call. */
export const settle = () => new Promise<void>(resolve => setImmediate(resolve));

/**
 * A connected Codex session on `/project` against `FixtureRpc`, with the replies `initialize` needs plus a `thread/start` for the conversation `t`
 * and a `turn/start` for its turn `u` (`v2/ThreadStartResponse.ts`, `v2/TurnStartResponse.ts`). `configure` adds or replaces replies; `approve` answers permission questions.
 */
export async function connectedCodex(locale: Locale = "en", configure: (rpc: FixtureRpc) => void = () => {}, approve: Approve = async () => false) {
  const rpc = new FixtureRpc(); const events: any[] = [];
  rpc.replies.set("initialize", {});
  rpc.replies.set("account/read", { account: { type: "chatgpt", planType: "plus" }, requiresOpenaiAuth: true });
  rpc.replies.set("model/list", { data: [{ model: "test-model", displayName: "Test model", isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: [] }], nextCursor: null });
  rpc.replies.set("account/rateLimits/read", { rateLimits: { primary: { usedPercent: 24, resetsAt: 1900000000, windowDurationMins: 10080 } } });
  rpc.replies.set("thread/start", { thread: { id: "t" }, model: "test-model", modelProvider: "openai" });
  rpc.replies.set("turn/start", { turn: { id: "u", status: "inProgress" } });
  configure(rpc);
  const session = new CodexSession(rpc, "/project", event => events.push(event), approve, undefined, undefined, locale);
  await session.initialize();
  return { rpc, session, events };
}

export type ConnectedCodex = Awaited<ReturnType<typeof connectedCodex>>;

/** The text events the person would read, in order (what `emit` sent as `text`). */
export const texts = (events: any[]) => events.filter(event => event.type === "text").map(event => event.text as string);

/**
 * Opens conversation `t` with one whole exchange, as after a real message: the person wrote `user`, Codex answered `assistant`
 * (`item/completed` of an `agentMessage`, `v2/ThreadItem.ts`) and the turn `u` completed.
 */
export async function converse(env: ConnectedCodex, user = "hello", assistant = "Hi there"): Promise<void> {
  const pending = env.session.send(user);
  await settle();
  env.rpc.onNotification("item/completed", { threadId: "t", turnId: "u", item: { type: "agentMessage", id: `a-${user}`, text: assistant, phase: null, memoryCitation: null }, completedAtMs: 1 });
  env.rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } });
  await pending;
}
