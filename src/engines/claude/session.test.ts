import { expect, test } from "bun:test";
import { ClaudeSession } from "./session.ts";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

test("context summary is read before closing the single-message input stream", async () => {
  let closed = false;
  let inputEnded = false;
  let drained: Promise<unknown>;
  const session = new ClaudeSession({ cwd: "/tmp", executable: "claude", env: {}, authenticate: async () => {}, connect: (({ prompt }: any) => {
    const iterator = prompt[Symbol.asyncIterator]();
    return {
      supportedModels: async () => [],
      async *[Symbol.asyncIterator]() {
        expect((await iterator.next()).value.message.content).toBe("hello");
        drained = iterator.next().then(() => { inputEnded = true; });
        yield { type: "result", subtype: "success" };
      },
      getContextUsage: async (options: unknown) => {
        expect(options).toEqual({ detail: "summary" });
        expect(inputEnded).toBe(false);
        return { totalTokens: 18000, rawMaxTokens: 128000 };
      },
      close: () => { closed = true; },
    };
  }) as any });
  await session.send("hello", () => {}, async () => false);
  await drained!;
  expect(session.context).toEqual({ used: 18000, window: 128000 });
  expect(closed).toBe(true);
  expect(inputEnded).toBe(true);
});

test("resume only selects a session; no model work starts before send", async () => {
  let calls = 0;
  let received: unknown;
  const session = new ClaudeSession({ cwd: "/tmp/project", executable: "/bin/claude", env: {}, authenticate: async () => {}, run: options => {
    calls++;
    received = options;
    return (async function* () {
      yield { type: "system", subtype: "init", session_id: "saved", model: "claude-test" } as SDKMessage;
      yield { type: "result", subtype: "success", session_id: "saved", is_error: false } as SDKMessage;
    })();
  } });
  session.resume("saved");
  expect(calls).toBe(0);
  await session.send("hello", () => {}, async () => false);
  expect(calls).toBe(1);
  expect(received).toMatchObject({ prompt: "hello", options: { resume: "saved", pathToClaudeCodeExecutable: "/bin/claude", permissionMode: "default", cwd: "/tmp/project" } });
  expect(session.busy).toBe(false);
});

test("Claude applies its selected native permission mode to the next turn", async () => {
  let received: any;
  const session = new ClaudeSession({ cwd: "/tmp", executable: "claude", env: {}, authenticate: async () => {}, run: input => {
    received = input;
    return (async function* () { yield { type: "result", subtype: "success", session_id: "s", is_error: false } as SDKMessage; })();
  } });

  await session.setWorkMode("plan");
  await session.send("make a plan", () => {}, async () => false);

  expect(received.options.permissionMode).toBe("plan");
  expect(session.workMode?.()).toBe("plan");
});

test("failed authentication never reaches the model and releases busy state", async () => {
  let called = false;
  const session = new ClaudeSession({ cwd: "/tmp", executable: "claude", env: {}, authenticate: async () => { throw new Error("Please login"); }, run: () => {
    called = true;
    return (async function* () {})();
  } });
  await expect(session.send("hello", () => {}, async () => true)).rejects.toThrow("login");
  expect(called).toBe(false);
  expect(session.busy).toBe(false);
});

test("tool denial and cancellation cannot become permission approvals", async () => {
  const decisions: unknown[] = [];
  const session = new ClaudeSession({ cwd: "/tmp", executable: "claude", env: {}, authenticate: async () => {}, run: ({ options }) => {
    return (async function* () {
      const context = { signal: options.abortController!.signal, toolUseID: "tool-1", requestId: "request-1" };
      decisions.push(await options.canUseTool!("Bash", { command: "echo test" }, context));
      session.stop();
      decisions.push(await options.canUseTool!("Bash", { command: "echo test" }, context));
      yield { type: "result", subtype: "success", session_id: "s", is_error: false } as SDKMessage;
    })();
  } });
  let requests = 0;
  await session.send("test", () => {}, async () => ++requests > 1);
  expect(decisions).toMatchObject([{ behavior: "deny" }, { behavior: "deny" }]);
  expect(session.busy).toBe(false);
});

test("an interrupted transport is not reported as a successful turn", async () => {
  const session = new ClaudeSession({ cwd: "/tmp", executable: "claude", env: {}, authenticate: async () => {}, run: () => (async function* () {})() });
  await expect(session.send("hello", () => {}, async () => false)).rejects.toThrow("without a result");
});

test("concurrent messages cannot start a second writer", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const session = new ClaudeSession({ cwd: "/tmp", executable: "claude", env: {}, authenticate: async () => gate, run: () => (async function* () {
    yield { type: "result", subtype: "success", session_id: "s", is_error: false } as SDKMessage;
  })() });
  const first = session.send("first", () => {}, async () => false);
  await expect(session.send("second", () => {}, async () => false)).rejects.toThrow("already running");
  expect(() => session.resume("other")).toThrow();
  release(); await first;
});
