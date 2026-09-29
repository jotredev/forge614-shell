import type { NativeWorkMode, WorkModeChange } from "./types.ts";

/** What Shift+Tab and the «restore on opening» step need from an assistant's adapter — nothing about which assistant it is. */
export interface WorkModeControl {
  workModes(): NativeWorkMode[];
  workMode(): string | undefined;
  setWorkMode(id: string): Promise<WorkModeChange>;
}

/**
 * Moves to the next work mode the assistant lists (wrapping around; from no mode set, to the first) and
 * reports it with whether it applied at once or only from the next turn. Does nothing (returns
 * undefined) when the assistant lists no modes. A refusal by the assistant propagates as the error the
 * adapter raised, with the previous mode already back in place.
 */
export async function cycleWorkMode(control: WorkModeControl): Promise<{ mode: NativeWorkMode; change: WorkModeChange } | undefined> {
  const modes = control.workModes();
  if (!modes.length) return undefined;
  const index = modes.findIndex(mode => mode.id === control.workMode());
  const mode = modes[(index + 1) % modes.length]!;
  return { mode, change: await control.setWorkMode(mode.id) };
}

/**
 * Puts back the work mode saved last time, whatever it was (full access included), without asking. A saved
 * mode the assistant no longer lists (it changed version), a missing one, or one the assistant refuses
 * all leave the assistant on its own default and never raise an error: this is a convenience on opening.
 * Returns whether a saved mode was restored.
 */
export async function restoreWorkMode(control: WorkModeControl, saved: string | undefined): Promise<boolean> {
  if (!saved || !control.workModes().some(mode => mode.id === saved)) return false;
  try {
    await control.setWorkMode(saved);
    return true;
  } catch {
    return false;
  }
}
