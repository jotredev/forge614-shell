import { Editor, TuiAltScreen, ProcessTerminal, visibleWidth, matchesKey } from "@earendil-works/pi-tui";
import type { TUI, TuiMouseEvent } from "@earendil-works/pi-tui";
import { accent as cyan, danger, muted, fit, paint, success, warning } from "./theme.ts";

const forgeCommands = [
  ["/model", "Select model"], ["/effort", "Reasoning level"], ["/resume", "Chat history"],
  ["/refresh", "Refresh plan usage (supported engines)"], ["/new", "New conversation"], ["/login", "Connect account"], ["/logout", "Disconnect locally"],
  ["/status", "Session details"], ["/stop", "Cancel current operation; keep Shell open"], ["/help", "Browse all commands"], ["/commands", "Browse all commands"], ["/quit", "Exit Shell"],
].map(([value, label]) => ({ value: value!, label: label! }));
export interface ComposerChoice { value: string; label: string; display?: string; group?: string; }
export interface ComposerCommandGroup { title: string; items: ComposerChoice[]; }

const purple = paint("176;132;255");
const planning = paint("52;170;166");
export type WorkModePresentation = { text: string; help: string };

/** Copy only translates native mode identifiers; it never changes their behavior. */
export function workModePresentation(mode?: string): WorkModePresentation {
  switch (mode) {
    case "bypassPermissions": return { text: danger("▶▶ bypass permissions on"), help: muted("no confirmations · Shift+Tab to cycle") };
    case "auto": return { text: warning("▶▶ auto mode on"), help: muted("the engine decides approvals · Shift+Tab to cycle") };
    case "default": return { text: muted("Ⅱ manual mode on"), help: muted("asks before risky actions · Shift+Tab to cycle") };
    case "acceptEdits": return { text: purple("▶▶ accept edits on"), help: muted("auto-approves file edits · Shift+Tab to cycle") };
    case "plan": return { text: planning("Ⅱ plan mode on"), help: muted("plans only; tools cannot run · Shift+Tab to cycle") };
    case "dontAsk": return { text: warning("Ⅱ don't ask mode on"), help: muted("denies actions without prior approval · Shift+Tab to cycle") };
    default: {
      const [approval, sandbox] = mode?.split(":") ?? [];
      if (approval === "onRequest" || approval === "unlessTrusted") {
        const sandboxText = sandbox === "readOnly" ? "read only" : sandbox === "workspaceWrite" ? "workspace write" : sandbox;
        if (approval === "onRequest") return { text: muted(`Ⅱ manual mode on · ${sandboxText}`), help: muted("asks for approval · Shift+Tab to cycle") };
        return { text: warning(`▶▶ auto mode on · ${sandboxText}`), help: muted("trusted workspace · Shift+Tab to cycle") };
      }
      return { text: muted("Ⅱ engine mode"), help: muted("Shift+Tab to cycle") };
    }
  }
}


function rule(width: number): string {
  return "─".repeat(Math.max(0, width));
}

/** Gives the status dot its own color per state, so "Working" reads as busy at a glance instead of blending into "Ready". */
function statusColor(status: string): (text: string) => string {
  if (status.startsWith("Working")) return warning;
  switch (status) {
    case "Ready": return success;
    case "Awaiting permission": return danger;
    case "Checking account": return muted;
    default: return warning; // e.g. "Connect with /login" — needs the person's attention
  }
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
/** A live-moving dot while busy — a static "Working" label reads as frozen once the person stares at it. */
function statusDot(status: string): string {
  return status.startsWith("Working") ? SPINNER_FRAMES[Math.floor(Date.now() / 120) % SPINNER_FRAMES.length]! : "●";
}

/** A focused editor rendered as Forge614's primary writing surface. */
export class ForgeComposer extends Editor {
  private status = "Ready";
  private workModeHint?: string;
  private selectedChoice = 0;
  private currentValue?: string;
  private dismissed = "";
  private commandGroups: ComposerCommandGroup[] = [{ title: "FORGE614", items: forgeCommands }];
  private skillChoices: ComposerChoice[] = [];
  private picker?: { title: string; items: ComposerChoice[]; resolve: (value?: string) => void };
  private repaint: () => void;
  constructor(tui: TUI) {
    super(tui, { borderColor: cyan, selectList: { selectedPrefix: cyan, selectedText: cyan, description: muted, scrollInfo: muted, noMatch: muted } }, { paddingX: 1 });
    this.repaint = () => tui.requestRender();
  }
  choose(title: string, items: ComposerChoice[], current?: string): Promise<string | undefined> {
    this.cancelChoice();
    if (!items.length) return Promise.resolve(undefined);
    this.selectedChoice = Math.max(0, items.findIndex(item => item.value === current));
    this.currentValue = current;
    return new Promise(resolve => { this.picker = { title, items, resolve }; this.repaint(); });
  }
  cancelChoice(): void { const picker = this.picker; this.picker = undefined; this.currentValue = undefined; picker?.resolve(); this.repaint(); }
  setCommandGroups(groups: ComposerCommandGroup[]): void {
    this.commandGroups = groups.filter(group => group.items.length).map(group => ({ ...group, items: group.items.map(item => ({ ...item, group: group.title })) }));
    this.selectedChoice = 0; this.dismissed = ""; this.repaint();
  }
  setSkillChoices(skills: ComposerChoice[]): void {
    this.skillChoices = skills.map(skill => ({ ...skill, group: "CODEX SKILLS" }));
    this.repaint();
  }
  private commandItems(): ComposerChoice[] { return this.commandGroups.flatMap(group => group.items.map(item => ({ ...item, group: group.title }))); }
  chooseCommand(): Promise<string | undefined> {
    return this.choose("Commands", this.commandItems().filter(item => item.value !== "/help" && item.value !== "/commands"));
  }
  private suggestions(): ComposerChoice[] {
    const text = this.getText();
    if (text === this.dismissed) return [];
    if (/^\/[a-z]*$/.test(text)) return this.commandItems().filter(item => item.value.startsWith(text));
    if (/^\$[a-z0-9_-]*$/i.test(text)) return this.skillChoices.filter(item => item.value.startsWith(text));
    return [];
  }
  handleInput(data: string): void {
    if (this.picker && (data.startsWith("/") || this.getText().startsWith("/")) && !matchesKey(data, "escape")) {
      super.handleInput(data);
      this.repaint();
      return;
    }
    const items = this.picker?.items ?? this.suggestions();
    if (items.length) {
      if (matchesKey(data, "up") || matchesKey(data, "down")) {
        this.selectedChoice = (this.selectedChoice + (matchesKey(data, "up") ? -1 : 1) + items.length) % items.length;
        this.repaint(); return;
      }
      if (matchesKey(data, "escape")) { this.dismissed = this.getText(); this.cancelChoice(); return; }
      if (matchesKey(data, "enter") || matchesKey(data, "tab")) {
        const item = items[this.selectedChoice % items.length]!;
        if (this.picker) { const picker = this.picker; this.picker = undefined; picker.resolve(item.value); }
        else { this.setText(item.value); this.dismissed = item.value; if (matchesKey(data, "enter")) this.onSubmit?.(item.value); }
        this.repaint(); return;
      }
      if (this.picker) return;
    }
    const before = this.getText();
    super.handleInput(data);
    if (this.getText() !== before) { this.selectedChoice = 0; this.dismissed = ""; }
  }
  setValue(value: string): void { this.setText(value); }
  setStatus(status: string): void { this.status = status; }
  setWorkModeHint(mode?: string): void { this.workModeHint = mode; this.repaint(); }
  handleMouse(event: TuiMouseEvent) {
    // Own editor gestures so screen-level selection cannot highlight the
    // zero-width cursor marker (or the entire padded input row).
    if (event.button === "left" && ["press", "drag", "release"].includes(event.type)) return { handled: true, focus: true };
    const items = this.picker?.items ?? this.suggestions();
    const menuRows = items.length ? Math.min(5, items.length - Math.max(0, this.selectedChoice - 4)) + 2 : 0;
    return super.handleMouse({ ...event, x: event.x - 4, y: event.y - 2 - menuRows, width: Math.max(1, event.width - 8) });
  }

  render(width: number): string[] {
    const margin = width >= 14 ? 2 : 0;
    return this.renderContent(width - margin * 2).map(line => " ".repeat(margin) + line);
  }
  private renderContent(width: number): string[] {
    const innerWidth = Math.max(1, width - 4);
    if (width < 10) return super.render(Math.max(1, width));
    const editor = super.render(innerWidth).slice(1, -1);
    const title = `  ${statusDot(this.status)} ${this.status}  `;
    const topFill = rule(Math.max(0, width - visibleWidth(title) - 5));
    const mode = this.workModeHint ? workModePresentation(this.workModeHint) : undefined;
    const hint = mode ? mode.text : muted("/help or /commands · Browse commands");
    const shortcuts = mode ? mode.help : muted("Shift+Enter newline");
    const hintWidth = visibleWidth(hint) + visibleWidth(shortcuts);
    const hintLine = innerWidth >= hintWidth + 2 ? `${hint}${" ".repeat(innerWidth - hintWidth)}${shortcuts}` : hint;

    const items = this.picker?.items ?? this.suggestions();
    const start = Math.max(0, this.selectedChoice - 4);
    const visibleItems = items.slice(start, start + 5);
    // Numbering and the ✓ for the active value only make sense for a deliberate choose() menu
    // (/model, /effort, /resume…) — not for the live "/" or "$" autocomplete-as-you-type list.
    const numbered = Boolean(this.picker);
    const leftText = (item: ComposerChoice, index: number) =>
      `${numbered ? `${start + index + 1}. ` : ""}${item.display ?? item.value}${item.value === this.currentValue ? " ✓" : ""}`;
    const leftWidth = Math.max(0, ...visibleItems.map((item, offset) => visibleWidth(leftText(item, offset))));
    const menu = items.length ? [
      ...visibleItems.flatMap((item, offset) => [
        ...(offset === 0 || item.group !== visibleItems[offset - 1]?.group ? [fit(cyan(item.group ?? this.picker?.title ?? "Commands"), width)] : []),
        fit((() => {
          const isCursor = start + offset === this.selectedChoice;
          const isCurrent = item.value === this.currentValue;
          const color = isCursor ? cyan : isCurrent ? success : muted;
          const left = color(`${isCursor ? "›" : " "} ${fit(leftText(item, offset), leftWidth)}`);
          return item.label ? `${left}  ${muted(item.label)}` : left;
        })(), width),
      ]),
      fit(muted(`${this.picker?.title ?? "Commands"} · ${start + 1}–${Math.min(start + 5, items.length)} of ${items.length} · ↑/↓ choose · Enter confirm · Esc cancel`), width),
    ] : [];
    return [
      ...menu,
      "",
      fit(`${cyan("╭─")} ${statusColor(this.status)(title)} ${cyan(`${topFill}╮`)}`, width),
      `${cyan("│")} ${" ".repeat(innerWidth)} ${cyan("│")}`,
      ...editor.map(line => `${cyan("│")} ${fit(line, innerWidth)} ${cyan("│")}`),
      `${cyan("│")} ${" ".repeat(innerWidth)} ${cyan("│")}`,
      `${cyan("│")} ${fit(hintLine, innerWidth)} ${cyan("│")}`,
      cyan(`╰${rule(width - 2)}╯`),
    ];
  }
}

export function createComposer(tui: TUI = new TuiAltScreen(new ProcessTerminal())): { component: ForgeComposer; input: ForgeComposer } {
  const input = new ForgeComposer(tui);
  return { component: input, input };
}
