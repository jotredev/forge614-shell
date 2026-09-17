import { expect, test } from "bun:test";
import { claudeEnvironment, requireSubscription, claudeLoginState } from "./auth.ts";

test("cancelled Claude account checks cannot reconnect using buffered successful output", async () => {
  const control = new AbortController();
  await expect(claudeLoginState("claude", {}, "/project", async () => {
    control.abort();
    throw { stdout: '{"loggedIn":true,"authMethod":"claude.ai"}' };
  }, control.signal)).rejects.toThrow();
});

test("Claude login distinguishes subscription, signed-out and unverified status without opening auth", async () => {
  const control = new AbortController();
  await claudeLoginState("claude", {}, "/project", async (_file, _args, options) => {
    expect((options as { signal: AbortSignal }).signal).toBe(control.signal);
    return { stdout: '{"loggedIn":false}' };
  }, control.signal);
  expect(await claudeLoginState("claude", {}, "/project", async () => ({ stdout: '{"loggedIn":true,"authMethod":"claude.ai"}' }))).toBe(true);
  expect(await claudeLoginState("claude", {}, "/project", async () => { throw { stdout: '{"loggedIn":false}' }; })).toBe(false);
  await expect(claudeLoginState("claude", {}, "/project", async () => ({ stdout: '{"loggedIn":true,"authMethod":"api_key"}' }))).rejects.toThrow("subscription");
  await expect(claudeLoginState("claude", {}, "/project", async () => { throw new Error("timeout"); })).rejects.toThrow("timeout");
});

test("subscription launch refuses ambient API routing without changing the user's environment", () => {
  const env = { PATH: "/bin", ANTHROPIC_API_KEY: "secret" };
  expect(() => claudeEnvironment(env)).toThrow("ANTHROPIC_API_KEY");
  expect(env.ANTHROPIC_API_KEY).toBe("secret");
  expect(() => claudeEnvironment({ anthropic_base_url: "https://proxy" })).toThrow();
  expect(() => claudeEnvironment({ CLAUDE_CODE_API_KEY_HELPER: "command" })).toThrow();
  expect(claudeEnvironment({ PATH: "/bin", TERM: "xterm" })).toEqual({ PATH: "/bin", TERM: "xterm" });
});

test("subscription preflight rejects signed-out and API accounts", () => {
  expect(() => requireSubscription({ loggedIn: false })).toThrow("login");
  expect(() => requireSubscription({ loggedIn: true, authMethod: "api_key" })).toThrow("subscription");
  expect(() => requireSubscription({ loggedIn: true, authMethod: "claude.ai" })).not.toThrow();
});
