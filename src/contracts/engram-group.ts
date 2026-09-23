/** A project listed inside a group by Engram's `group-list`. */
export interface EngramGroupProject {
  readonly projectId: string;
  readonly name: string;
}

/** A group as Engram's `group-list` reports it. `id` is its identity; `name` is for people. */
export interface EngramGroup {
  readonly id: string;
  readonly name: string;
  readonly projects: readonly EngramGroupProject[];
}

/** What the person chose on the group screen (never applied by the screen itself). */
export type GroupChoice =
  | { readonly kind: "existing"; readonly group: EngramGroup }
  | { readonly kind: "new"; readonly name: string }
  | { readonly kind: "loose" };

/** Engram's own rule for a group name (docs/11): lowercase letters, digits and single hyphens, 1 to 64 characters. */
export const GROUP_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const GROUP_NAME_MAX_LENGTH = 64;

export function isValidGroupName(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= GROUP_NAME_MAX_LENGTH && GROUP_NAME_PATTERN.test(value);
}
