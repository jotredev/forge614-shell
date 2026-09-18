import { expect, test } from "bun:test";
import { AntigravitySession } from "./session.ts";

test("local logout blocks model calls until an explicit login verifies the account", async () => {
  let calls = 0; let connected = true;
  const session = new AntigravitySession(() => {}, {
    checkLogin: async () => connected ? "connected" : "unknown",
    confirmLogout: async () => true,
    models: async () => "", login: async () => {},
    run: async (_args, _text, emit) => { calls++; emit({ event: "result", result: { status: "SUCCESS", response: "ok" } }); },
  });
  await session.initialize();
  await session.logout();
  expect(session.status()[0]).not.toContain("Connected");
  await expect(session.send("hello")).rejects.toThrow("/login");
  connected = false; await session.login();
  await expect(session.send("hello")).rejects.toThrow("/login");
  expect(calls).toBe(0);
  connected = true; await session.login(); await session.send("hello");
  expect(calls).toBe(1);
});

test("Antigravity logout confirms, stays in Shell and requires login before another message", async () => {
  let calls = 0; let allow = false;
  const session = new AntigravitySession(() => {}, {
    models: async () => { calls++; return ""; }, login: async () => { calls++; },
    checkLogin: async () => { calls++; return "connected"; },
    confirmLogout: async () => allow,
    run: async () => { calls++; },
  });
  await session.logout(); expect(calls).toBe(0);
  allow = true; await session.logout(); expect(calls).toBe(0);
  expect(session.status()[0]).toContain("/login");
  await expect(session.send("hello")).rejects.toThrow("/login");
  expect(session.busy).toBe(false);
});

test("login reuses a verified account without opening native agy or sending a prompt", async () => {
  let opened = false; const events: any[] = [];
  const session = new AntigravitySession(event => events.push(event), {
    checkLogin: async () => "connected", models: async () => "test-model Test\n",
    login: async () => { opened = true; }, run: async () => { throw new Error("No inference allowed"); },
  });
  await session.login();
  expect(session.visual()).toEqual({ account: "connected", provider: "Antigravity" });
  expect(opened).toBe(false);
  expect(session.status().join(" ")).toContain("Connected");
});

test("unknown authentication never opens another UI; required login needs explicit confirmation", async () => {
  for (const state of ["unknown", "required"] as const) {
    let opened = false; let asked = false;
    const session = new AntigravitySession(() => {}, {
      checkLogin: async () => state, confirmLogin: async () => { asked = true; return false; },
      models: async () => "", login: async () => { opened = true; }, run: async () => {},
    });
    await session.login();
    expect(opened).toBe(false);
    expect(asked).toBe(state === "required");
  }
});

test("confirmed native login rechecks the account before reporting connected", async () => {
  let checks = 0; let opened = 0;
  const session = new AntigravitySession(() => {}, {
    checkLogin: async () => ++checks === 1 ? "required" : "connected",
    confirmLogin: async () => true, models: async () => "test-model Test\n",
    login: async () => { opened++; }, run: async () => { throw new Error("No inference allowed"); },
  });
  await session.login();
  expect(opened).toBe(1);
  expect(checks).toBe(2);
  expect(session.status().join(" ")).toContain("Connected");
});

test("Antigravity starts idle, sends documented stream input and resumes only on the next message", async () => {
  const calls: any[] = []; const events: any[] = [];
  const session = new AntigravitySession(event => events.push(event), {
    models: async () => "test-model   Test model\n",
    login: async () => {},
    run: async (args, prompt, emit) => {
      calls.push({ args, prompt });
      emit({ event: "init", conversation_id: "session-1", init: {} });
      emit({ event: "step_update", step_update: { step_type: "agent_response", step_index: 1, text_delta: "Hello" } });
      emit({ event: "result", result: { conversation_id: "session-1", status: "SUCCESS", response: "Hello", usage: { input_tokens: 10, output_tokens: 2 } } });
    },
  });
  await session.initialize();
  expect(calls).toEqual([]);
  await session.setModel("test-model"); await session.setEffort("high");
  await session.send("hi");
  expect(calls[0].args).toEqual(["--input-format", "stream-json", "--output-format", "stream-json", "--disable-slash-commands", "--model", "test-model", "--effort", "high"]);
  expect(calls[0].prompt).toBe("hi");
  expect(events.filter(event => event.type === "delta").map(event => event.text)).toEqual(["Hello"]);
  expect(session.status().join(" ")).toContain("10");
  await session.resume("session-1");
  expect(calls).toHaveLength(1);
  await session.send("continue");
  expect(calls[1].args).toContain("--conversation");
  expect(calls[1].args).not.toContain("--dangerously-skip-permissions");
  await expect(session.listSessions()).rejects.toThrow("history");
});

test("Antigravity rejects incomplete or failed streams and releases busy state", async () => {
  for (const status of [undefined, "ERROR", "WAITING"]) {
    const session = new AntigravitySession(() => {}, {
      models: async () => "", login: async () => {},
      run: async (_args, _prompt, emit) => { if (status) emit({ event: "result", result: { status, error: "Not authenticated" } }); },
    });
    await expect(session.send("hi")).rejects.toThrow();
    expect(session.busy).toBe(false);
  }
});

test("Antigravity cancellation aborts the active transport and disallows concurrent operations", async () => {
  const session = new AntigravitySession(() => {}, {
    models: async () => "", login: async () => {},
    run: async (_args, _prompt, _emit, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })),
  });
  const pending = session.send("hi");
  await expect(session.send("again")).rejects.toThrow("active");
  await expect(session.login()).rejects.toThrow("active");
  await session.cancel();
  await expect(pending).rejects.toThrow("cancelled");
  expect(session.busy).toBe(false);
});
