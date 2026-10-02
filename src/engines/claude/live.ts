import type { query, Options, Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

/**
 * An endless input stream for a live SDK query: `push` hands a message to the SDK (which writes it to Claude Code's stdin as soon as the generator delivers it) and the stream never ends
 * until `end()`, so stdin stays open and the `claude` process lives for the whole conversation. Messages pushed before the SDK asks for them wait in order.
 */
export class InputQueue implements AsyncIterable<SDKUserMessage> {
  private readonly items: SDKUserMessage[] = [];
  private waiting?: (result: IteratorResult<SDKUserMessage>) => void;
  private ended = false;

  /** Hands the message to the reader, or keeps it in order until the reader asks. Ignored once the stream has ended. */
  push(message: SDKUserMessage): void {
    if (this.ended) return;
    const waiting = this.waiting;
    if (waiting) { this.waiting = undefined; waiting({ value: message, done: false }); }
    else this.items.push(message);
  }

  /** Ends the stream: the reader's pending (or next) read finishes. */
  end(): void {
    this.ended = true;
    const waiting = this.waiting;
    this.waiting = undefined;
    waiting?.({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item) return Promise.resolve({ value: item, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise(resolve => { this.waiting = resolve; });
      },
      return: async () => { this.end(); return { value: undefined, done: true }; },
    };
  }
}

/** What the permanent reader of a live query hands to its owner. */
export interface LiveHandlers {
  /** One event of the query, in arrival order; the next one is not read until this returns. A failure here never ends the stream. */
  event(event: SDKMessage): Promise<void> | void;
  /** The event stream finished or threw although nobody closed the query: the process died. `error` is what the SDK threw, when it threw. */
  ended(error?: unknown): void;
}

/**
 * One SDK query kept open: its input is an endless `InputQueue` and its events are read by ONE permanent reader that never stops on a `result` — breaking out of the SDK's `for await` would
 * call `return()` on the query and kill the process, and with it every background task running inside. `close()` is the only way a live query ends on purpose (the SDK then ends the
 * iterator without throwing, and the process and anything it started die within seconds); a stream that ends or throws without it is a death, reported through `handlers.ended`.
 */
export class LiveQuery {
  readonly query: Query;
  /** Resolves with `undefined` when this query is closed (on purpose or by death): lets a wait race against it. */
  readonly halted: Promise<undefined>;
  private readonly queue = new InputQueue();
  private closedFlag = false;
  private halt!: () => void;

  constructor(connect: typeof query, options: Options, private readonly handlers: LiveHandlers) {
    this.halted = new Promise<undefined>(resolve => { this.halt = () => resolve(undefined); });
    this.query = connect({ prompt: this.queue, options });
    void this.pump();
  }

  /** Whether `close()` was called (or the process died): nothing is read, sent or asked any more. */
  get closed(): boolean { return this.closedFlag; }

  /** Hands one message of the person to Claude Code. */
  push(message: SDKUserMessage): void { this.queue.push(message); }

  /** Closes the query and ends its input. Safe to call twice. */
  close(): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    this.halt();
    this.queue.end();
    try { this.query.close(); } catch { /* Already gone. */ }
  }

  private async pump(): Promise<void> {
    try {
      for await (const event of this.query) {
        if (this.closedFlag) return;
        try { await this.handlers.event(event); } catch { /* A bug while handling one event must not end the stream of all the next ones. */ }
      }
      if (!this.closedFlag) this.handlers.ended();
    } catch (error) {
      if (!this.closedFlag) this.handlers.ended(error);
    }
  }
}
