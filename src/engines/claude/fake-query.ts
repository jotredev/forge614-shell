import { randomUUID } from "node:crypto";
import type { Options, Query, SDKMessage, SDKUserMessage, query } from "@anthropic-ai/claude-agent-sdk";

/**
 * A stand-in for the SDK's `Query`, for the tests of Claude Code's open conversation. It behaves like the real one measured with SDK 0.3.274 (2026-10-02): it really consumes the input
 * generator it is given, answers each message with `command_lifecycle` + `init` + `assistant` + `result` (the result carries `user_message_uuids`), can emit events out of turn (background
 * tasks, notifications, an automatic turn), answers `interrupt()` the way Claude Code does (the turn ends with an error result and its tasks are killed), counts the control requests it
 * receives and can die. No process, account or network is involved.
 */

/** An async queue with one reader: values in the order they came, then the end (or a failure). */
class Pipe<T> {
  private items: T[] = [];
  private waiting?: { resolve: (result: IteratorResult<T>) => void; reject: (error: unknown) => void };
  private ending?: { error?: unknown };

  push(value: T): void { if (!this.ending) { this.items.push(value); this.flush(); } }
  end(): void { this.finish({}); }
  fail(error: unknown): void { this.finish({ error }); }
  private finish(ending: { error?: unknown }): void { if (!this.ending) { this.ending = ending; this.flush(); } }
  private flush(): void {
    const waiting = this.waiting;
    if (!waiting) return;
    if (this.items.length) { this.waiting = undefined; waiting.resolve({ value: this.items.shift() as T, done: false }); }
    else if (this.ending) {
      this.waiting = undefined;
      if (this.ending.error !== undefined) waiting.reject(this.ending.error);
      else waiting.resolve({ value: undefined, done: true });
    }
  }
  next(): Promise<IteratorResult<T>> {
    return new Promise((resolve, reject) => { this.waiting = { resolve, reject }; this.flush(); });
  }
}

/** The SDK's `McpServerStatus` as far as Shell reads it. */
export interface FakeMcpServer { name: string; status: string }

export interface FakeQueryConfig {
  /** How the fake answers one message of the person; by default `answerNormally`. It may emit as the turn goes on (`fake.emit`). */
  turn?: (message: SDKUserMessage, fake: FakeQuery) => Promise<void> | void;
  /** With `hold`, the default turn says queued/started/init/assistant but keeps the result until `fake.answer(uuids)` (or an `interrupt`), so a test can act mid-turn. */
  hold?: boolean;
  /** What `mcpServerStatus()` answers on its call `n` (counted from 1). Without it the request is refused, like a Claude Code that cannot report. */
  mcp?: (call: number) => FakeMcpServer[] | Promise<FakeMcpServer[]>;
  /** The `mcp_servers` the default `init` carries. */
  initMcp?: FakeMcpServer[];
  /** The handshake the catalog reads. */
  models?: unknown[]; commands?: unknown[]; account?: unknown;
  /** What `getContextUsage` answers. */
  context?: { totalTokens: number; rawMaxTokens: number };
  /** A stop Claude Code never answers: `interrupt()` returns, but nothing ends the turn. */
  silentInterrupt?: boolean;
  /** Makes `setPermissionMode` refuse. */
  refuseMode?: boolean;
  /** The cumulative `total_cost_usd` and `modelUsage` the default result carries on each turn (they accumulate across the turns of one query, as in the SDK). */
  turnCost?: number; turnTokens?: number;
}

export const lifecycle = (uuid: string, state: "queued" | "started" | "completed" | "cancelled") =>
  ({ type: "command_lifecycle", command_uuid: uuid, state, uuid: randomUUID(), session_id: "fake-session" }) as unknown as SDKMessage;
export const fakeInit = (sessionId = "fake-session", mcp?: FakeMcpServer[], extra: object = {}) =>
  ({ type: "system", subtype: "init", session_id: sessionId, model: "claude-test", ...(mcp ? { mcp_servers: mcp } : {}), uuid: randomUUID(), ...extra }) as unknown as SDKMessage;
export const fakeAssistant = (text: string, extra: object = {}) =>
  ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] }, parent_tool_use_id: null, uuid: randomUUID(), session_id: "fake-session", ...extra }) as unknown as SDKMessage;
export const fakeResult = (uuids: string[] | undefined, extra: object = {}) =>
  ({
    type: "result", subtype: "success", is_error: false, duration_ms: 1, duration_api_ms: 1, num_turns: 1, result: "ok", session_id: "fake-session",
    total_cost_usd: 0, usage: {}, modelUsage: {}, permission_denials: [], ...(uuids ? { user_message_uuids: uuids } : {}), uuid: randomUUID(), ...extra,
  }) as unknown as SDKMessage;
export const taskStarted = (id: string, description: string, extra: object = {}) =>
  ({ type: "system", subtype: "task_started", task_id: id, description, task_type: "local_agent", is_backgrounded: true, uuid: randomUUID(), session_id: "fake-session", ...extra }) as unknown as SDKMessage;
export const taskNotification = (id: string, status: "completed" | "failed" | "stopped", summary: string, extra: object = {}) =>
  ({ type: "system", subtype: "task_notification", task_id: id, status, summary, output_file: "/tmp/out", uuid: randomUUID(), session_id: "fake-session", ...extra }) as unknown as SDKMessage;

/** The text of a person's message. */
export const textOf = (message: SDKUserMessage): string => typeof message.message.content === "string" ? message.message.content : JSON.stringify(message.message.content);

export class FakeQuery {
  /** What `connect` received: the options the query was opened with and its input generator. */
  readonly params: { prompt: AsyncIterable<SDKUserMessage>; options: Options };
  /** The messages the fake read from the input generator, in order. */
  readonly sent: SDKUserMessage[] = [];
  /** Uuids of messages sent and not yet answered (the turn is held). */
  readonly held: string[] = [];
  /** The control requests received, counted. */
  readonly calls = { interrupt: 0, setModel: [] as (string | undefined)[], setPermissionMode: [] as string[], mcpServerStatus: 0, initializationResult: 0, supportedModels: 0, getContextUsage: 0, close: 0 };
  closed = false;
  sessionId = "fake-session";
  private readonly pipe = new Pipe<SDKMessage>();
  private readonly running = new Set<string>();
  private cost = 0;
  private tokens = 0;

  constructor(params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }, readonly config: FakeQueryConfig = {}) {
    this.params = params;
    void this.consume();
  }

  /** Emits events as the process would, out of turn or inside one. */
  emit(...events: SDKMessage[]): void {
    for (const event of events) {
      const raw = event as Record<string, any>;
      if (raw.type === "system" && raw.subtype === "task_started") this.running.add(raw.task_id);
      if (raw.type === "system" && raw.subtype === "task_notification") this.running.delete(raw.task_id);
      this.pipe.push(event);
    }
  }
  lifecycle(uuid: string, state: "queued" | "started" | "completed" | "cancelled"): void { this.emit(lifecycle(uuid, state)); }

  /** Answers held messages: the assistant speaks and ONE result carries all their uuids (several messages sent mid-turn end together, as measured). */
  answer(uuids: string[], extra: object = {}): void {
    for (const uuid of uuids) { const index = this.held.indexOf(uuid); if (index !== -1) this.held.splice(index, 1); }
    this.emit(fakeAssistant(`answer to ${uuids.length} message(s)`), fakeResult(uuids, { ...this.cumulative(), ...extra }));
    for (const uuid of uuids) this.lifecycle(uuid, "completed");
  }

  /** The process dies: with an error the event stream throws it, without one it just ends (neither is a `close()`). */
  die(error?: unknown): void { if (error === undefined) this.pipe.end(); else this.pipe.fail(error); }

  /** The cumulative counters, growing on each call like the SDK's across the turns of one query. */
  private cumulative(): object {
    this.cost += this.config.turnCost ?? 0; this.tokens += this.config.turnTokens ?? 0;
    return this.config.turnTokens === undefined && this.config.turnCost === undefined ? {} : {
      total_cost_usd: this.cost,
      modelUsage: { "claude-test": { inputTokens: this.tokens, outputTokens: this.tokens, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: this.cost, contextWindow: 200000, maxOutputTokens: 32000 } },
    };
  }

  private async consume(): Promise<void> {
    const iterator = this.params.prompt[Symbol.asyncIterator]();
    try {
      for (;;) {
        const step = await iterator.next();
        if (step.done || this.closed) return;
        this.sent.push(step.value);
        void Promise.resolve((this.config.turn ?? answerNormally)(step.value, this)).catch(error => this.die(error));
      }
    } catch (error) { this.die(error); }
  }

  /** The `Query` this stands in for: only the members Shell uses. */
  asQuery(): Query {
    const fake = this;
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => fake.pipe.next(),
        return: async () => { fake.closed = true; return { value: undefined, done: true }; },
      }),
      interrupt: async () => {
        fake.calls.interrupt++;
        if (!fake.config.silentInterrupt) {
          const uuids = [...fake.held];
          fake.held.length = 0;
          for (const uuid of uuids) fake.lifecycle(uuid, "cancelled");
          // Claude Code kills the background tasks together with the turn (measured), then reports each one.
          for (const id of [...fake.running]) {
            fake.emit({ type: "system", subtype: "task_updated", task_id: id, patch: { status: "killed" }, uuid: randomUUID(), session_id: "fake-session" } as unknown as SDKMessage, taskNotification(id, "stopped", "Stopped"));
          }
          if (uuids.length) fake.emit(fakeResult(uuids, { subtype: "error_during_execution", is_error: true, errors: [] }));
        }
        return { still_queued: [] };
      },
      setModel: async (model?: string) => { fake.calls.setModel.push(model); },
      setPermissionMode: async (mode: string) => { if (fake.config.refuseMode) throw new Error("refused"); fake.calls.setPermissionMode.push(mode); },
      mcpServerStatus: async () => {
        fake.calls.mcpServerStatus++;
        if (!fake.config.mcp) throw new Error("this stand-in cannot report MCP servers");
        return fake.config.mcp(fake.calls.mcpServerStatus);
      },
      initializationResult: async () => { fake.calls.initializationResult++; return { models: fake.config.models ?? [], commands: fake.config.commands ?? [], account: fake.config.account ?? { email: "fake@example.com" } }; },
      supportedModels: async () => { fake.calls.supportedModels++; return fake.config.models ?? []; },
      getContextUsage: async () => { fake.calls.getContextUsage++; return fake.config.context ?? { totalTokens: 1, rawMaxTokens: 0 }; },
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({ rate_limits_available: false }),
      close: () => { fake.calls.close++; fake.closed = true; fake.pipe.end(); },
    } as unknown as Query;
  }
}

/** The default turn: queued, started, `init`, the assistant's words and the result of exactly this message — or, with `hold`, everything but the result. */
export function answerNormally(message: SDKUserMessage, fake: FakeQuery): void {
  const uuid = message.uuid!;
  fake.lifecycle(uuid, "queued");
  if (fake.held.length) { fake.held.push(uuid); return; }
  fake.lifecycle(uuid, "started");
  fake.emit(fakeInit(fake.sessionId, fake.config.initMcp), fakeAssistant(`answer to ${textOf(message)}`));
  if (fake.config.hold) { fake.held.push(uuid); return; }
  fake.answer([uuid]);
}

/** A fake SDK: `connect` stands in for `query()` and every query it opened is kept in `opened`. */
export function fakeSdk(config: FakeQueryConfig = {}) {
  const opened: FakeQuery[] = [];
  const connect = ((params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => {
    const fake = new FakeQuery(params, config);
    opened.push(fake);
    return fake.asQuery();
  }) as unknown as typeof query;
  return { connect, opened, get last(): FakeQuery { return opened[opened.length - 1]!; } };
}

/**
 * Lets a session whose tests only watch the events of ONE message at a time keep working: `run` is called once per message of the person with the message text and the options the query was
 * opened with, and the events it yields are the answer. Results without `user_message_uuids` get the message's own uuid; a run that ends without a result (or throws) kills the query, as a process
 * that dies mid-turn would. MCP servers cannot be asked of it.
 */
export function queryFromRun(run: (input: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>): typeof query {
  return ((params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => {
    let chain: Promise<void> = Promise.resolve();
    const fake = new FakeQuery(params, {
      turn: (message, self) => {
        chain = chain.then(async () => {
          const uuid = message.uuid!;
          self.lifecycle(uuid, "queued"); self.lifecycle(uuid, "started");
          let resultSeen = false;
          try {
            // Each message used to get options of its own; a test that looks at them (and may even alter them while matching) must not see what an earlier message left, so each call gets its own copy.
            const systemPrompt = params.options.systemPrompt;
            const options = { ...params.options, ...(systemPrompt && typeof systemPrompt === "object" && !Array.isArray(systemPrompt) ? { systemPrompt: { ...systemPrompt } } : {}) };
            for await (const event of run({ prompt: textOf(message), options })) {
              if (event.type === "result") resultSeen = true;
              self.emit(event.type === "result" && !(event as Record<string, unknown>).user_message_uuids ? { ...event, user_message_uuids: [uuid] } as SDKMessage : event);
            }
          } catch (error) { self.die(error); return; }
          if (!resultSeen) self.die(); else self.lifecycle(uuid, "completed");
        });
        return chain;
      },
    });
    return fake.asQuery();
  }) as unknown as typeof query;
}

/** A clock that only moves when a test says so: `sleep` waits for `advance`, which wakes the sleepers whose time has come. */
export function manualClock() {
  let time = 0;
  const sleepers: { wake: number; resolve: () => void }[] = [];
  return {
    now: () => time,
    sleep: (ms: number) => new Promise<void>(resolve => { sleepers.push({ wake: time + ms, resolve }); }),
    /** Moves the time forward and lets every sleeper due run, one by one, with the time set to its own wake-up moment. */
    async advance(ms: number): Promise<void> {
      const target = time + ms;
      for (;;) {
        const due = sleepers.filter(sleeper => sleeper.wake <= target).sort((a, b) => a.wake - b.wake)[0];
        if (!due) break;
        sleepers.splice(sleepers.indexOf(due), 1);
        time = Math.max(time, due.wake);
        due.resolve();
        await settle();
      }
      time = target;
      await settle();
    },
  };
}

/** Lets pending promise callbacks and zero-delay timers run, so what an event started has been handled. */
export const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));
