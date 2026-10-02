import { expect, test } from "bun:test";
import { readEcosystemVersions } from "./ecosystem-versions.ts";
import type { VersionTimers } from "./ecosystem-versions.ts";

const ENGINES = "/forge/engines/bin/forge614-engines";
const ENGRAM = "/forge/engram/bin/forge614-engram";
const env = { FORGE614_HOME: "/forge" };

/** Stand-in for the clock: records the delay of every timer asked for and lets the test fire them all at once, so nothing waits for real seconds. */
function fakeTimers() {
  const delays: number[] = []; const callbacks = new Map<number, () => void>(); let next = 0;
  const timers: VersionTimers = {
    set: (callback, ms) => { delays.push(ms); callbacks.set(++next, callback); return next; },
    clear: handle => { callbacks.delete(handle as number); },
  };
  return { timers, delays, fire: () => { for (const callback of [...callbacks.values()]) callback(); }, pending: () => callbacks.size };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

/** The real outputs of the two binaries (`forge614-engines --version`, `forge614-engram --version`): the version is the last word. */
test("the versions are the last word of what each binary prints", async () => {
  const calls: [string, string[]][] = [];
  const result = await readEcosystemVersions({
    env, home: "/home", exists: () => true,
    run: async (binary, args) => { calls.push([binary, args]); return binary === ENGINES ? "forge614-engines 1.16.0\n" : "forge614-engram 1.8.6\n"; },
  });
  expect(result).toEqual({ engines: { state: "version", version: "1.16.0" }, engram: { state: "version", version: "1.8.6" } });
  // One call per binary, with only `--version`, on the binaries the rest of Shell already locates.
  expect(calls).toEqual([[ENGINES, ["--version"]], [ENGRAM, ["--version"]]]);
});

/** Without `FORGE614_HOME` the binaries are where the rest of Shell looks for them: under `~/.forge614`. */
test("without FORGE614_HOME the binaries are looked for under the home folder", async () => {
  const asked: string[] = [];
  await readEcosystemVersions({ env: {}, home: "/home/ana", exists: path => { asked.push(path); return false; }, run: async () => "" });
  expect(asked).toEqual(["/home/ana/.forge614/engines/bin/forge614-engines", "/home/ana/.forge614/engram/bin/forge614-engram"]);
});

/** A binary that is not there is «missing» and is never run; the other one is still read. */
test("a binary that does not exist is missing and is not run", async () => {
  const ran: string[] = [];
  const result = await readEcosystemVersions({
    env, home: "/home", exists: path => path === ENGRAM,
    run: async binary => { ran.push(binary); return "forge614-engram 1.8.6"; },
  });
  expect(result).toEqual({ engines: { state: "missing" }, engram: { state: "version", version: "1.8.6" } });
  expect(ran).toEqual([ENGRAM]);
});

/** A binary that exists but fails, or prints nothing, is «unreadable»: the panel shows the row without a version, never «not installed». */
test("a binary that exists but fails or prints nothing is unreadable", async () => {
  const result = await readEcosystemVersions({
    env, home: "/home", exists: () => true,
    run: async binary => { if (binary === ENGINES) throw new Error("exit 1"); return "  \n"; },
  });
  expect(result).toEqual({ engines: { state: "unreadable" }, engram: { state: "unreadable" } });
});

/**
 * A binary that never answers is given up after 3 seconds (the limit is each binary's own): the row goes without version and the other binary is not held back.
 * The clock is a stand-in, so the 3 seconds are not waited for.
 */
test("a binary that does not answer within 3 seconds is unreadable and does not hold the other one back", async () => {
  const clock = fakeTimers();
  const pending = readEcosystemVersions({
    env, home: "/home", exists: () => true, timers: clock.timers,
    run: async binary => binary === ENGINES ? "forge614-engines 1.16.0" : new Promise<string>(() => {}),
  });
  await flush();
  expect(clock.delays).toEqual([3000, 3000]);
  clock.fire();
  expect(await pending).toEqual({ engines: { state: "version", version: "1.16.0" }, engram: { state: "unreadable" } });
});

/** A binary that answers in time leaves no timer running behind it. */
test("the limit's timer is cleared once a binary has answered", async () => {
  const clock = fakeTimers();
  await readEcosystemVersions({ env, home: "/home", exists: () => true, timers: clock.timers, run: async () => "forge614-engines 1.16.0" });
  expect(clock.pending()).toBe(0);
});
