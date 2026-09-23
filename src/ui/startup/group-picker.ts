import { Input, Text, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import type { EngramGroup, GroupChoice } from "../../contracts/engram-group.ts";
import { isValidGroupName } from "../../contracts/engram-group.ts";
import type { EngramFlowScreen } from "./frame.ts";
import { bindAbort } from "./engram-init.ts";
import { accent, border, muted } from "../basic/theme.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Catalog, Locale } from "../../i18n/index.ts";
import { describeError, ShellError } from "../../shell-error.ts";

/** How many existing groups are visible at once; more are windowed so the screen fits 80×24. */
const VISIBLE_GROUPS = 4;
const DIVIDER_WIDTH = 40;

type Row =
  | { readonly kind: "group"; readonly group: EngramGroup }
  | { readonly kind: "create" }
  | { readonly kind: "loose" };

export interface GroupListTheme {
  readonly cursor: (text: string) => string;
  readonly heading: (text: string) => string;
  readonly description: (text: string) => string;
  readonly divider: (text: string) => string;
}

const defaultTheme: GroupListTheme = { cursor: accent, heading: muted, description: muted, divider: border };

/**
 * The group-selection list (acta 0023 §5): "Existing groups" with each group's projects, a divider
 * line, then "Create a new group…" and "It is a standalone project". With no groups the first section
 * — and the divider — do not appear. Arrows move, Enter chooses, Esc cancels. The list only reports
 * the choice; applying it is the caller's job, and it never touches anything itself.
 */
export class GroupSelectList implements Component {
  private readonly rows: readonly Row[];
  private cursor = 0;
  private windowStart = 0;
  onSelect?: (choice: GroupChoice | { readonly kind: "create" }) => void;
  onCancel?: () => void;

  constructor(
    private readonly groups: readonly EngramGroup[],
    private readonly t: Catalog["groupPicker"],
    private readonly theme: GroupListTheme = defaultTheme,
  ) {
    this.rows = [...groups.map((group): Row => ({ kind: "group", group })), { kind: "create" }, { kind: "loose" }];
  }

  invalidate(): void {}

  private move(delta: number): void {
    this.cursor = Math.max(0, Math.min(this.rows.length - 1, this.cursor + delta));
    // Keep the highlighted group inside the visible window; on an action the window stays where it was.
    const groupIndex = Math.min(this.cursor, this.groups.length - 1);
    if (this.groups.length > 0) {
      if (groupIndex < this.windowStart) this.windowStart = groupIndex;
      if (groupIndex >= this.windowStart + VISIBLE_GROUPS) this.windowStart = groupIndex - VISIBLE_GROUPS + 1;
    }
  }

  render(width: number): string[] {
    const fitLine = (text: string) => truncateToWidth(text, Math.max(1, width), "…");
    const line = (index: number, label: string) => {
      const text = `${index === this.cursor ? "> " : "  "}${label}`;
      return index === this.cursor ? this.theme.cursor(fitLine(text)) : fitLine(text);
    };
    const lines: string[] = [];
    if (this.groups.length > 0) {
      const windowed = this.groups.length > VISIBLE_GROUPS;
      const position = Math.min(this.cursor, this.groups.length - 1) + 1;
      lines.push(this.theme.heading(windowed ? `${this.t.existingHeading} (${position}/${this.groups.length})` : this.t.existingHeading));
      const end = Math.min(this.groups.length, this.windowStart + VISIBLE_GROUPS);
      for (let index = this.windowStart; index < end; index++) {
        const group = this.groups[index]!;
        lines.push(line(index, group.name));
        const projects = group.projects.length > 0
          ? this.t.projectsLine({ projects: group.projects.map(project => project.name).join(", ") })
          : this.t.noProjects;
        lines.push(this.theme.description(fitLine(`    ${projects}`)));
      }
      lines.push(this.theme.divider("─".repeat(Math.max(1, Math.min(width, DIVIDER_WIDTH)))));
    }
    lines.push(line(this.groups.length, this.t.createLabel));
    lines.push(line(this.groups.length + 1, this.t.looseLabel));
    return lines;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "up")) { this.move(-1); return; }
    if (matchesKey(data, "down")) { this.move(1); return; }
    if (matchesKey(data, "enter") || matchesKey(data, "return")) {
      const row = this.rows[this.cursor]!;
      if (row.kind === "group") this.onSelect?.({ kind: "existing", group: row.group });
      else if (row.kind === "loose") this.onSelect?.({ kind: "loose" });
      else this.onSelect?.({ kind: "create" });
      return;
    }
    if (matchesKey(data, "escape")) { this.onCancel?.(); return; }
  }
}

type NameOutcome = { readonly kind: "name"; readonly name: string } | { readonly kind: "back" } | { readonly kind: "cancel" };

/** Why a typed group name cannot be used, as person-facing text, or `undefined` when it is fine. */
function nameProblem(name: string, taken: readonly EngramGroup[], locale: Locale): string | undefined {
  if (!isValidGroupName(name)) return describeError(new ShellError("GROUP_NAME_INVALID"), locale);
  if (taken.some(group => group.name.toLowerCase() === name.toLowerCase())) {
    return describeError(new ShellError("GROUP_NAME_TAKEN", { name }), locale);
  }
  return undefined;
}

async function askGroupName(
  groups: readonly EngramGroup[], screen: EngramFlowScreen, locale: Locale, signal?: AbortSignal,
): Promise<NameOutcome> {
  const t = getCatalog(locale).groupName;
  const input = new Input({ placeholder: "mi-tienda" });
  const body = new Text(t.prompt);
  screen.setScreen(t.title, input, { body, hint: new Text(t.hint) });
  let finish!: (value: NameOutcome) => void;
  const submission = new Promise<NameOutcome>(resolve => { finish = resolve; });
  input.onSubmit = value => {
    const name = value.trim();
    const problem = nameProblem(name, groups, locale);
    if (problem) {
      // Same screen, same input: the person fixes the name without losing what they typed.
      body.setText(`${t.prompt}\n\n${problem}`);
      screen.tui.requestRender();
      return;
    }
    finish({ kind: "name", name });
  };
  input.onEscape = () => finish({ kind: "back" });
  const unsubscribe = screen.tui.addInputListener(data => {
    if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) { finish({ kind: "cancel" }); return { consume: true }; }
    return undefined;
  });
  const terminate = () => finish({ kind: "cancel" });
  process.once("SIGTERM", terminate);
  const unbindAbort = bindAbort(signal, terminate);
  try { return await submission; }
  finally { process.removeListener("SIGTERM", terminate); unsubscribe(); unbindAbort(); }
}

async function pickFromList(
  groups: readonly EngramGroup[], screen: EngramFlowScreen, locale: Locale, signal?: AbortSignal,
): Promise<GroupChoice | { readonly kind: "create" } | undefined> {
  const t = getCatalog(locale).groupPicker;
  const list = new GroupSelectList(groups, t);
  screen.setScreen(t.title, list, { hint: new Text(t.hint) });
  let finish!: (value: GroupChoice | { readonly kind: "create" } | undefined) => void;
  const selection = new Promise<GroupChoice | { readonly kind: "create" } | undefined>(resolve => { finish = resolve; });
  list.onSelect = choice => finish(choice);
  list.onCancel = () => finish(undefined);
  const unsubscribe = screen.tui.addInputListener(data => {
    if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) { finish(undefined); return { consume: true }; }
    return undefined;
  });
  const terminate = () => finish(undefined);
  process.once("SIGTERM", terminate);
  const unbindAbort = bindAbort(signal, terminate);
  try { return await selection; }
  finally { process.removeListener("SIGTERM", terminate); unsubscribe(); unbindAbort(); }
}

/**
 * Asks, once, which group this project belongs to. Returns the choice — an existing group, a new
 * group name (already checked against Engram's naming rule and the existing names), or "standalone" —
 * or `undefined` when the person cancels (Esc / Ctrl+C / Ctrl+D) or `signal` aborts (stdin closed for
 * real). Makes no Engram call and writes nothing; the caller applies the choice through Engram's CLI.
 */
export async function chooseGroup(
  groups: readonly EngramGroup[], screen: EngramFlowScreen, locale: Locale = "en", signal?: AbortSignal,
): Promise<GroupChoice | undefined> {
  while (!signal?.aborted) {
    const choice = await pickFromList(groups, screen, locale, signal);
    if (choice === undefined || signal?.aborted) return undefined;
    if (choice.kind !== "create") return choice;
    const outcome = await askGroupName(groups, screen, locale, signal);
    if (outcome.kind === "cancel" || signal?.aborted) return undefined;
    if (outcome.kind === "name") return { kind: "new", name: outcome.name };
    // "back": show the list again.
  }
  return undefined;
}
