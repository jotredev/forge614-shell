import { expect, test } from "bun:test";
import { cycleWorkMode, restoreWorkMode } from "./work-mode.ts";
import type { WorkModeControl } from "./work-mode.ts";
import type { WorkModeChange } from "./types.ts";

/** A fake assistant with three modes; `change` is what it answers to a mode change (applied now, or next turn). */
function control(current: string | undefined, change: WorkModeChange = "applied", failWith?: Error) {
  const asked: string[] = [];
  const fake: WorkModeControl = {
    workModes: () => [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "full", label: "Full access", tone: "danger" }],
    workMode: () => current,
    setWorkMode: async id => { if (failWith) throw failWith; asked.push(id); current = id; return change; },
  };
  return { fake, asked };
}

/** Shift+Tab moves to the next mode the assistant lists, wraps around, and starts from the first when no mode is set yet; it never invents one. */
test("cycleWorkMode moves to the next mode the assistant lists and wraps around", async () => {
  const one = control("a");
  expect((await cycleWorkMode(one.fake))?.mode.id).toBe("b");
  const wrap = control("full");
  expect((await cycleWorkMode(wrap.fake))?.mode.id).toBe("a");
  const unset = control(undefined);
  expect((await cycleWorkMode(unset.fake))?.mode.id).toBe("a");
});

/** The UI needs to know whether the change took effect at once or only from the next turn, to say so in one line. */
test("cycleWorkMode passes on whether the change applies now or from the next turn", async () => {
  expect((await cycleWorkMode(control("a", "next-turn").fake))?.change).toBe("next-turn");
  expect((await cycleWorkMode(control("a", "applied").fake))?.change).toBe("applied");
});

/** An assistant that lists no modes (or cannot change them) leaves Shift+Tab doing nothing rather than failing. */
test("cycleWorkMode does nothing when the assistant lists no modes", async () => {
  const empty: WorkModeControl = { workModes: () => [], workMode: () => undefined, setWorkMode: async () => "applied" };
  expect(await cycleWorkMode(empty)).toBeUndefined();
});

/** Idea 7: the mode saved last time is put back on opening without asking — including the full-access one. */
test("restoreWorkMode puts back any saved mode the assistant still lists, including full access", async () => {
  for (const saved of ["a", "b", "full"]) {
    const { fake, asked } = control("a");
    expect(await restoreWorkMode(fake, saved)).toBe(true);
    expect(asked).toEqual([saved]);
  }
});

/** A saved mode the assistant no longer has (it changed version) falls back to its default silently: no error, no call. */
test("restoreWorkMode ignores an unknown or missing saved mode without error", async () => {
  const unknown = control("a");
  expect(await restoreWorkMode(unknown.fake, "gone-in-new-version")).toBe(false);
  expect(unknown.asked).toEqual([]);
  const missing = control("a");
  expect(await restoreWorkMode(missing.fake, undefined)).toBe(false);
  expect(missing.asked).toEqual([]);
});

/** Restoring is a convenience: if the assistant refuses it, opening Shell must still work. */
test("restoreWorkMode never throws when the assistant refuses the saved mode", async () => {
  const { fake } = control("a", "applied", new Error("refused"));
  expect(await restoreWorkMode(fake, "b")).toBe(false);
});
