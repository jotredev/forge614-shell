import { Editor, TuiAltScreen, ProcessTerminal, visibleWidth, matchesKey } from "@earendil-works/pi-tui";
import type { TUI, TuiMouseEvent } from "@earendil-works/pi-tui";
import { accent as cyan, danger, muted, fit, paint, success, warning } from "./theme.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";

function defaultForgeCommands(locale: Locale): ComposerChoice[] {
  const t = getCatalog(locale).chat;
  return [
    ["/model", t.commandSelectModel], ["/effort", t.commandReasoningLevel], ["/resume", t.commandChatHistory],
    ["/refresh", t.commandRefreshPlanUsageEngines], ["/new", t.commandNewConversation], ["/login", t.commandConnectAccount], ["/logout", t.commandDisconnectLocally],
    ["/status", t.commandSessionDetails], ["/stop", t.commandCancelKeepOpen], ["/help", t.commandBrowseAllCommands], ["/commands", t.commandBrowseAllCommands], ["/quit", t.commandExitShell],
  ].map(([value, label]) => ({ value: value!, label: label! }));
}
/** `search`, when set, is the text a searchable picker matches typed words against; without it the row's display and label are searched. */
export interface ComposerChoice { value: string; label: string; display?: string; group?: string; search?: string; }
export interface ComposerCommandGroup { title: string; items: ComposerChoice[]; }

/** Lowercase and without accents, so «CAFÉ», «Café» and «cafe» all read the same when searching. */
export function normalizeSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}

/** The rows that match every typed word (in any order, anywhere in the row's searchable text); an empty search keeps all of them. */
export function filterChoices(items: ComposerChoice[], query: string): ComposerChoice[] {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter(item => {
    const haystack = normalizeSearch(item.search ?? `${item.display ?? item.value} ${item.label}`);
    return words.every(word => haystack.includes(word));
  });
}

const purple = paint("176;132;255");
const planning = paint("52;170;166");
export type WorkModePresentation = { text: string; help: string };

/** Copy only translates native mode identifiers; it never changes their behavior. */
export function workModePresentation(mode?: string, locale: Locale = "en"): WorkModePresentation {
  const t = getCatalog(locale).workMode;
  const withCycle = (text: string) => `${text} · ${t.shiftTabToCycle}`;
  switch (mode) {
    case "bypassPermissions": return { text: danger(t.bypassPermissionsOn), help: muted(withCycle(t.bypassPermissionsHelp)) };
    case "auto": return { text: warning(t.autoModeOn), help: muted(withCycle(t.autoModeHelp)) };
    case "default": return { text: muted(t.manualModeOn), help: muted(withCycle(t.manualModeHelp)) };
    case "acceptEdits": return { text: purple(t.acceptEditsOn), help: muted(withCycle(t.acceptEditsHelp)) };
    case "plan": return { text: planning(t.planModeOn), help: muted(withCycle(t.planModeHelp)) };
    case "dontAsk": return { text: warning(t.dontAskModeOn), help: muted(withCycle(t.dontAskModeHelp)) };
    default: {
      const [approval, sandbox] = mode?.split(":") ?? [];
      if (approval === "onRequest" || approval === "unlessTrusted") {
        const sandboxText = sandbox === "readOnly" ? t.readOnly : sandbox === "workspaceWrite" ? t.workspaceWrite : sandbox;
        if (approval === "onRequest") return { text: muted(t.manualModeOnWithSandbox({ sandbox: sandboxText ?? "" })), help: muted(withCycle(t.manualModeApprovalHelp)) };
        return { text: warning(t.autoModeOnWithSandbox({ sandbox: sandboxText ?? "" })), help: muted(withCycle(t.trustedWorkspaceHelp)) };
      }
      return { text: muted(t.engineMode), help: muted(t.shiftTabToCycle) };
    }
  }
}


function rule(width: number): string {
  return "─".repeat(Math.max(0, width));
}

/**
 * Gives the status dot its own color per state, so a busy status reads as busy at a glance instead
 * of blending into "ready". Matches against both locales' status text (never just the active
 * locale's) so a stale status string set right before a language switch still colors correctly.
 */
function statusColor(status: string): (text: string) => string {
  if (isWorkingStatus(status)) return warning;
  const en = getCatalog("en").chat; const es = getCatalog("es").chat;
  const enTc = getCatalog("en").claudeChat; const esTc = getCatalog("es").claudeChat;
  if (status === en.statusReady || status === es.statusReady) return success;
  if (status === en.awaitingPermission || status === es.awaitingPermission) return danger;
  if (status === enTc.statusCheckingAccount || status === esTc.statusCheckingAccount) return muted;
  return warning; // e.g. "Connect with /login" — needs the person's attention
}

function isWorkingStatus(status: string): boolean {
  return status.startsWith(getCatalog("en").chat.statusWorking) || status.startsWith(getCatalog("es").chat.statusWorking);
}

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
/** A live-moving dot while active — a static label reads as frozen once the person stares at it. */
export function spinnerFrame(active: boolean): string {
  return active ? SPINNER_FRAMES[Math.floor(Date.now() / 120) % SPINNER_FRAMES.length]! : "●";
}
/** A live-moving dot while busy — a static label reads as frozen once the person stares at it. */
function statusDot(status: string): string {
  return spinnerFrame(isWorkingStatus(status));
}

/** A focused editor rendered as Forge614's primary writing surface. */
export class ForgeComposer extends Editor {
  private status: string;
  private workModeHint?: string;
  private selectedChoice = 0;
  private currentValue?: string;
  private dismissed = "";
  private commandGroups: ComposerCommandGroup[];
  private skillChoices: ComposerChoice[] = [];
  private picker?: { title: string; items: ComposerChoice[]; searchable: boolean; resolve: (value?: string) => void };
  private pickerQuery = "";
  private repaint: () => void;
  constructor(tui: TUI, private readonly locale: Locale = "en") {
    super(tui, { borderColor: cyan, selectList: { selectedPrefix: cyan, selectedText: cyan, description: muted, scrollInfo: muted, noMatch: muted } }, { paddingX: 1 });
    this.repaint = () => tui.requestRender();
    this.status = getCatalog(locale).chat.statusReady;
    this.commandGroups = [{ title: "FORGE614", items: defaultForgeCommands(locale) }];
  }
  /**
   * Opens a selector: arrows move, Enter resolves the highlighted value, Esc resolves nothing. With
   * `searchable`, typing also filters the rows (see `filterChoices`) and Backspace widens the search
   * again; without it typed letters are ignored, as they always were.
   */
  choose(title: string, items: ComposerChoice[], current?: string, options: { searchable?: boolean } = {}): Promise<string | undefined> {
    this.cancelChoice();
    if (!items.length) return Promise.resolve(undefined);
    this.selectedChoice = Math.max(0, items.findIndex(item => item.value === current));
    this.currentValue = current;
    this.pickerQuery = "";
    return new Promise(resolve => { this.picker = { title, items, searchable: Boolean(options.searchable), resolve }; this.repaint(); });
  }
  cancelChoice(): void { const picker = this.picker; this.picker = undefined; this.currentValue = undefined; this.pickerQuery = ""; picker?.resolve(); this.repaint(); }
  /** What the menu lists right now: the open picker's rows narrowed by what was typed, or the "/" and "$" suggestions. */
  private activeItems(): ComposerChoice[] {
    return this.picker ? (this.picker.searchable ? filterChoices(this.picker.items, this.pickerQuery) : this.picker.items) : this.suggestions();
  }
  /** Keys for a searchable picker: arrows, Enter, Esc, Backspace and printable text; everything else is swallowed so no stray key reaches the editor. */
  private handleSearchInput(data: string): void {
    const items = this.activeItems();
    if (matchesKey(data, "escape")) { this.dismissed = this.getText(); this.cancelChoice(); return; }
    if (items.length && (matchesKey(data, "up") || matchesKey(data, "down"))) {
      this.selectedChoice = (this.selectedChoice + (matchesKey(data, "up") ? -1 : 1) + items.length) % items.length;
    } else if (items.length && (matchesKey(data, "enter") || matchesKey(data, "tab"))) {
      const picker = this.picker!; this.picker = undefined; this.pickerQuery = ""; picker.resolve(items[this.selectedChoice % items.length]!.value);
    } else if (matchesKey(data, "backspace")) {
      this.pickerQuery = Array.from(this.pickerQuery).slice(0, -1).join(""); this.selectedChoice = 0;
    } else if (data && !/[\u0000-\u001f\u007f-\u009f]/.test(data)) {
      this.pickerQuery += data; this.selectedChoice = 0;
    }
    this.repaint();
  }
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
    return this.choose(getCatalog(this.locale).chat.commandsFallbackTitle, this.commandItems().filter(item => item.value !== "/help" && item.value !== "/commands"));
  }
  private suggestions(): ComposerChoice[] {
    const text = this.getText();
    if (text === this.dismissed) return [];
    if (/^\/[a-z]*$/.test(text)) return this.commandItems().filter(item => item.value.startsWith(text));
    if (/^\$[a-z0-9_-]*$/i.test(text)) return this.skillChoices.filter(item => item.value.startsWith(text));
    return [];
  }
  handleInput(data: string): void {
    if (this.picker?.searchable) { this.handleSearchInput(data); return; }
    if (this.picker && (data.startsWith("/") || this.getText().startsWith("/")) && !matchesKey(data, "escape")) {
      super.handleInput(data);
      this.repaint();
      return;
    }
    const items = this.activeItems();
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
    const items = this.activeItems();
    const searchRows = this.picker?.searchable ? 1 : 0;
    const menuRows = items.length ? Math.min(5, items.length - Math.max(0, this.selectedChoice - 4)) + 2 + searchRows : searchRows ? 2 : 0;
    return super.handleMouse({ ...event, x: event.x - 4, y: event.y - 2 - menuRows, width: Math.max(1, event.width - 8) });
  }

  render(width: number): string[] {
    const margin = width >= 14 ? 2 : 0;
    return this.renderContent(width - margin * 2).map(line => " ".repeat(margin) + line);
  }
  private renderContent(width: number): string[] {
    const t = getCatalog(this.locale).chat;
    const innerWidth = Math.max(1, width - 4);
    if (width < 10) return super.render(Math.max(1, width));
    const editor = super.render(innerWidth).slice(1, -1);
    const title = `  ${statusDot(this.status)} ${this.status}  `;
    const topFill = rule(Math.max(0, width - visibleWidth(title) - 5));
    const mode = this.workModeHint ? workModePresentation(this.workModeHint, this.locale) : undefined;
    const hint = mode ? mode.text : muted(t.helpOrCommandsHint);
    const shortcuts = mode ? mode.help : muted(t.shiftEnterNewline);
    const hintWidth = visibleWidth(hint) + visibleWidth(shortcuts);
    const hintLine = innerWidth >= hintWidth + 2 ? `${hint}${" ".repeat(innerWidth - hintWidth)}${shortcuts}` : hint;

    const items = this.activeItems();
    const start = Math.max(0, this.selectedChoice - 4);
    const visibleItems = items.slice(start, start + 5);
    // Numbering and the ✓ for the active value only make sense for a deliberate choose() menu
    // (/model, /effort, /resume…) — not for the live "/" or "$" autocomplete-as-you-type list.
    const numbered = Boolean(this.picker);
    const leftText = (item: ComposerChoice, index: number) =>
      `${numbered ? `${start + index + 1}. ` : ""}${item.display ?? item.value}${item.value === this.currentValue ? " ✓" : ""}`;
    const leftWidth = Math.max(0, ...visibleItems.map((item, offset) => visibleWidth(leftText(item, offset))));
    const searchRow = this.picker?.searchable
      ? [fit(`${cyan(`${t.searchLabel}:`)} ${this.pickerQuery ? this.pickerQuery : muted(t.searchPlaceholder)}`, width)]
      : [];
    const menu = items.length ? [
      ...searchRow,
      ...visibleItems.flatMap((item, offset) => [
        ...(offset === 0 || item.group !== visibleItems[offset - 1]?.group ? [fit(cyan(item.group ?? this.picker?.title ?? t.commandsFallbackTitle), width)] : []),
        fit((() => {
          const isCursor = start + offset === this.selectedChoice;
          const isCurrent = item.value === this.currentValue;
          const color = isCursor ? cyan : isCurrent ? success : muted;
          const left = color(`${isCursor ? "›" : " "} ${fit(leftText(item, offset), leftWidth)}`);
          return item.label ? `${left}  ${muted(item.label)}` : left;
        })(), width),
      ]),
      fit(muted(t.menuFooter({ title: this.picker?.title ?? t.commandsFallbackTitle, from: start + 1, to: Math.min(start + 5, items.length), total: items.length })), width),
    ] : searchRow.length ? [...searchRow, fit(muted(t.searchNoMatches), width)] : [];
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

export function createComposer(tui: TUI = new TuiAltScreen(new ProcessTerminal()), locale: Locale = "en"): { component: ForgeComposer; input: ForgeComposer } {
  const input = new ForgeComposer(tui, locale);
  return { component: input, input };
}
