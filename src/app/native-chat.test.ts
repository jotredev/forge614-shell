import { expect, test } from "bun:test";
import { join } from "node:path";
import { antigravityStartupContext, codexStartupContext, createAntigravitySession, createCodexSession } from "./native-chat.ts";
import { FixtureRpc } from "../../tests/support/rpc-fixture.ts";
import { ShellError } from "../shell-error.ts";

function withEnvVar(name: string, value: string | undefined, run: () => Promise<void>): Promise<void> {
  const original = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  return run().finally(() => {
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  });
}

const unboundPayload = JSON.stringify({
  format: 1,
  shared: { format: 1, pinned: [], recent: [] },
  project: { status: "unbound" },
});

// En Windows el ejecutable resuelto por locateEngramBinary lleva extensión .exe y separadores nativos; en Unix va sin sufijo.
const expectedEngramBinaryName = process.platform === "win32" ? "forge614-engram.exe" : "forge614-engram";

test("codexStartupContext resolves the Engram binary under a custom FORGE614_HOME from the real process env", async () => {
  await withEnvVar("FORGE614_HOME", "/custom/forge-for-codex-test", async () => {
    const calls: string[] = [];
    const result = await codexStartupContext("/some/project", {
      run: async (command, args) => { calls.push(command); void args; return { status: 0, stdout: unboundPayload, stderr: "" }; },
    });
    const expectedBinary = join("/custom/forge-for-codex-test", "engram", "bin", expectedEngramBinaryName);
    expect(calls).toEqual([expectedBinary]);
    if (process.platform === "win32") {
      expect(calls[0]?.endsWith(".exe")).toBe(true);
    } else {
      expect(calls[0]?.endsWith(".exe")).toBe(false);
    }
    expect(result.available).toBe(true);
  });
});

test("codexStartupContext falls back to the standard ~/.forge614 path with no FORGE614_HOME set", async () => {
  await withEnvVar("FORGE614_HOME", undefined, async () => {
    const calls: string[] = [];
    const result = await codexStartupContext("/some/project", {
      home: "/Users/tester",
      run: async (command, args) => { calls.push(command); void args; return { status: 0, stdout: unboundPayload, stderr: "" }; },
    });
    const expectedBinary = join("/Users/tester", ".forge614", "engram", "bin", expectedEngramBinaryName);
    expect(calls).toEqual([expectedBinary]);
    if (process.platform === "win32") {
      expect(calls[0]?.endsWith(".exe")).toBe(true);
    } else {
      expect(calls[0]?.endsWith(".exe")).toBe(false);
    }
    expect(result.available).toBe(true);
  });
});

test("codexStartupContext always uses Shell's real process env, even overriding an unrelated env passed by the caller", async () => {
  await withEnvVar("FORGE614_HOME", "/real-shell-forge-home", async () => {
    const calls: string[] = [];
    await codexStartupContext("/some/project", {
      env: { FORGE614_HOME: "/should-be-ignored" } as NodeJS.ProcessEnv,
      run: async (command, args) => { calls.push(command); void args; return { status: 0, stdout: unboundPayload, stderr: "" }; },
    });
    const expectedBinary = join("/real-shell-forge-home", "engram", "bin", expectedEngramBinaryName);
    expect(calls).toEqual([expectedBinary]);
    if (process.platform === "win32") {
      expect(calls[0]?.endsWith(".exe")).toBe(true);
    } else {
      expect(calls[0]?.endsWith(".exe")).toBe(false);
    }
  });
});

test("codexStartupContext never leaks the resolved FORGE614_HOME path in its unavailable reason", async () => {
  await withEnvVar("FORGE614_HOME", "/private/secret-forge-home", async () => {
    const result = await codexStartupContext("/some/project", {
      run: async () => ({ status: null, stdout: "", stderr: "" }),
    });
    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.reason).not.toContain("/private/secret-forge-home");
      expect(result.reason).not.toContain("FORGE614_HOME");
    }
  });
});

/**
 * The composition root gives the Codex session a way to open the app-server again (`createCodexSession`), which is what lets a `/f614:stop` that Codex never
 * answers end in a reconnection instead of «restart Shell». Here the process starter is a stand-in: it is asked once when the session is created and once more, with
 * the same folder and executable, when the stop times out, and the second connection is the one that resumes the conversation. `FORGE614_HOME` points to a folder
 * that does not exist, so the memory check and Engram's digest find no Forge614 binary and nothing of the person's machine is touched.
 */
test("createCodexSession opens the app-server again after a stop Codex never answers, with the same executable and folder", () => withEnvVar("FORGE614_HOME", "/nonexistent/forge-for-native-chat-test", async () => {
  const started: { id: string; executable: string; cwd: string }[] = [];
  const first = new FixtureRpc(); const second = new FixtureRpc();
  first.replies.set("initialize", {});
  first.replies.set("account/read", { account: { type: "chatgpt", planType: "plus" }, requiresOpenaiAuth: true });
  first.replies.set("model/list", { data: [], nextCursor: null });
  first.replies.set("thread/start", { thread: { id: "t" }, model: "m", modelProvider: "openai" });
  first.replies.set("turn/start", { turn: { id: "u", status: "inProgress" } });
  second.replies.set("initialize", {});
  second.replies.set("thread/resume", { thread: { id: "t" }, model: "m", modelProvider: "openai" });
  const connections = [first, second];
  const events: { type: string; text?: string }[] = [];
  const session = createCodexSession("codex", "/bin/codex", "/project", event => events.push(event), async () => false, "en",
    (id, executable, cwd) => { started.push({ id, executable, cwd }); return connections[started.length - 1]!; });
  expect(started).toEqual([{ id: "codex", executable: "/bin/codex", cwd: "/project" }]);
  await session.initialize();
  const pending = session.send("hello");
  await new Promise(resolve => setImmediate(resolve));
  first.handler = async method => { const error = new ShellError("engine-request-timeout", { method }); first.onClose(error); throw error; };
  await session.cancel();
  await pending;
  expect(started).toEqual([{ id: "codex", executable: "/bin/codex", cwd: "/project" }, { id: "codex", executable: "/bin/codex", cwd: "/project" }]);
  expect(second.calls.find(call => call.method === "thread/resume")!.params).toMatchObject({ threadId: "t" });
  expect(events.filter(event => event.type === "text").map(event => event.text)).toEqual([expect.stringContaining("reconnected to Codex")]);
}));

/**
 * Verifies Antigravity's composition root forwards Shell's real `process.env` (respecting a custom
 * `FORGE614_HOME`) to `getStartupContext` and wires `createAntigravitySession` with the process
 * starter and TUI-suspending login runner.
 */
test("antigravityStartupContext respects custom FORGE614_HOME and createAntigravitySession wires start and login suspension", () => withEnvVar("FORGE614_HOME", "/custom/forge-for-agy-test", async () => {
  const calls: string[] = [];
  const result = await antigravityStartupContext("/some/project", {
    run: async command => { calls.push(command); return { status: 0, stdout: unboundPayload, stderr: "" }; },
  });
  expect(calls).toEqual([join("/custom/forge-for-agy-test", "engram", "bin", expectedEngramBinaryName)]);
  expect(result.available).toBe(true);

  const started: { id: string; executable: string; cwd: string }[] = [];
  const rpc = new FixtureRpc();
  let signedIn = false;
  rpc.replies.set("initialize", { protocolVersion: 1, agentCapabilities: {} });
  rpc.handler = async method => {
    if (method === "session/new") {
      if (!signedIn) throw new Error("Authentication required");
      return { sessionId: "agy-1", models: { availableModels: [] }, configOptions: [] };
    }
    return rpc.replies.get(method);
  };
  let suspended = 0;
  let loggedIn = 0;
  const session = createAntigravitySession(
    "/usr/local/bin/agy",
    "/project",
    () => {},
    async () => false,
    "en",
    (id, executable, cwd) => { started.push({ id, executable, cwd }); return rpc; },
    async work => { suspended++; return work(); },
    async () => { loggedIn++; signedIn = true; },
  );
  expect(started).toEqual([{ id: "antigravity", executable: "/usr/local/bin/agy", cwd: "/project" }]);
  await session.initialize();
  await session.login();
  expect(suspended).toBe(1);
  expect(loggedIn).toBe(1);
  expect(session.sessionId).toBe("agy-1");
}));
