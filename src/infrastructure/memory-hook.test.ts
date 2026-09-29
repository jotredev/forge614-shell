import { expect, test } from "bun:test";
import { createMemoryHookProbe } from "./memory-hook.ts";
import { enginesDouble, hookOf, verifyStdout } from "../../tests/support/memory-hook-fixtures.ts";

/**
 * Why this exists: measured with a real account (2026-09-29, build of 067e348), the memory reached Claude Code and Codex TWICE
 * (Shell's own block and the startup hook Engines installs). Shell only skips its block when the hook really delivers, and this is
 * the table of what counts as «the hook delivers»: `hook.present` and `hook.dryRunOk` and a `runtimeStatus.kind` that is none of
 * `unsupported`, `absent` and `needs-user-trust`.
 */
test("the hook counts as active only when it is present, its dry run passes and its runtime status is not unsupported, absent or needs-user-trust", async () => {
  const cases: [string, Record<string, unknown>, boolean][] = [
    ["runtime-observed", hookOf({ kind: "runtime-observed" }), true],
    ["pending-runtime-verification", hookOf({ kind: "pending-runtime-verification", reason: "no-evidence" }), true],
    ["needs-user-trust", hookOf({ kind: "needs-user-trust" }), false],
    ["unsupported", hookOf({ kind: "unsupported" }), false],
    ["absent", hookOf({ kind: "absent" }), false],
    ["not present", hookOf({ kind: "runtime-observed" }, { present: false }), false],
    ["dry run failed", hookOf({ kind: "runtime-observed" }, { dryRunOk: false }), false],
  ];
  for (const [name, hook, expected] of cases) {
    const probe = createMemoryHookProbe("claude-code", { home: "/Users/tester", run: enginesDouble(verifyStdout(hook)).run });
    expect([name, await probe()]).toEqual([name, expected]);
  }
});

/** Why: Shell never assumes the hook works. Whatever goes wrong while asking Engines, Shell pastes its own block: better twice than never. */
test("a failed, unreadable, outdated or slow verification means the hook is not active", async () => {
  const failing = createMemoryHookProbe("claude-code", { home: "/Users/tester", run: enginesDouble("", 1).run });
  expect(await failing()).toBe(false);
  const garbage = createMemoryHookProbe("claude-code", { home: "/Users/tester", run: enginesDouble("not json").run });
  expect(await garbage()).toBe(false);
  const outdated = createMemoryHookProbe("claude-code", { home: "/Users/tester", run: enginesDouble(verifyStdout(undefined)).run });
  expect(await outdated()).toBe(false);
  const throwing = createMemoryHookProbe("claude-code", { home: "/Users/tester", run: async () => { throw new Error("boom"); } });
  expect(await throwing()).toBe(false);
  const slow = createMemoryHookProbe("claude-code", {
    home: "/Users/tester", timeoutMs: 20,
    run: () => new Promise(() => {}),
  });
  expect(await slow()).toBe(false);
});

/** Why: the check is one per Shell run and per assistant; asking Engines on every turn would cost a process each time. Only `verify memory-integration` is ever run (never `memory-hook-run`, never `hook-evidence`). */
test("the detection asks Engines once, with only verify memory-integration for that agent", async () => {
  const double = enginesDouble(verifyStdout(hookOf({ kind: "runtime-observed" }), "codex"));
  const probe = createMemoryHookProbe("codex", { home: "/Users/tester", run: double.run });
  expect(await Promise.all([probe(), probe()])).toEqual([true, true]);
  expect(await probe()).toBe(true);
  expect(double.commands).toEqual([["verify", "memory-integration", "--agent", "codex"]]);
});
