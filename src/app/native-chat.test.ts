import { expect, test } from "bun:test";
import { codexStartupContext } from "./native-chat.ts";

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

test("codexStartupContext resolves the Engram binary under a custom FORGE614_HOME from the real process env", async () => {
  await withEnvVar("FORGE614_HOME", "/custom/forge-for-codex-test", async () => {
    const calls: string[] = [];
    const result = await codexStartupContext("/some/project", {
      run: async (command, args) => { calls.push(command); void args; return { status: 0, stdout: unboundPayload, stderr: "" }; },
    });
    expect(calls).toEqual(["/custom/forge-for-codex-test/engram/bin/forge614-engram"]);
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
    expect(calls).toEqual(["/Users/tester/.forge614/engram/bin/forge614-engram"]);
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
    expect(calls).toEqual(["/real-shell-forge-home/engram/bin/forge614-engram"]);
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
