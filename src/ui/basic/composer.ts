import { Editor, TuiAltScreen, ProcessTerminal, visibleWidth, matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { TUI, TuiMouseEvent } from "@earendil-works/pi-tui";
import { accent as cyan, danger, muted, fit, paint, success, warning } from "./theme.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";
import type { NativeCollaborationMode, NativeWorkMode } from "../../engines/types.ts";

/**
 * Shell's own commands, all with the `/f614:` prefix: what the menu offers until an assistant's screen hands over its own list.
 * The assistants' commands (`/model`, `/login`, `/status`…) never belong here: the screen lists them under the assistant's name.
 */
function defaultForgeCommands(locale: Locale): ComposerChoice[] {
  const t = getCatalog(locale).chat;
  return [
    ["/f614:refresh", t.commandRefreshPlanUsageEngines], ["/f614:stop", t.commandCancelKeepOpen],
    ["/f614:help", t.commandBrowseAllCommands], ["/f614:commands", t.commandBrowseAllCommands], ["/f614:quit", t.commandExitShell],
  ].map(([value, label]) => ({ value: value!, label: label! }));
}
/**
 * `search`, when set, is the text a searchable picker matches typed words against; without it the row's display and label are searched.
 * `key`, when set, is a single letter that picks the row straight away in a picker that is not searchable (uppercase or lowercase).
 */
export interface ComposerChoice { value: string; label: string; display?: string; group?: string; search?: string; key?: string; }
/**
 * How a picker opens: `searchable` filters as the person types; `numbered: false` drops the «1.» before each row; `footer` replaces the
 * default «title · 1–2 of 2 · …» line; `body` is an explanation of the question, drawn wrapped under its title and gone with the picker.
 */
export interface ComposerChooseOptions { searchable?: boolean; numbered?: boolean; footer?: string; body?: string; }
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
/** Codex's footer draws «Plan mode» in magenta (`CollaborationModeIndicator::styled_line`). */
const magenta = paint("217;112;214");
export type WorkModePresentation = { text: string; help: string };
/** The assistant's collaboration modes, when Shift+Tab switches them instead of the permissions (Codex: Plan ↔ Default), and the active one. */
export type CollaborationHint = { modes: NativeCollaborationMode[]; active?: string };

/**
 * Draws the work mode an adapter hands over: the assistant's own name for it (`label`), colored and
 * explained by the adapter's `tone`. It knows no mode ids or names of any assistant, so a mode an
 * assistant adds tomorrow needs no change here; without a mode it shows the engine's own default.
 * With `collaboration` (an assistant whose Shift+Tab switches collaboration modes) the permission stays,
 * the active mode's own indicator is added after it, and the help names that switch instead of «cycle».
 */
export function workModePresentation(mode?: NativeWorkMode, locale: Locale = "en", collaboration?: CollaborationHint): WorkModePresentation {
  const t = getCatalog(locale).workMode;
  if (collaboration?.modes.length) {
    const base = mode ? workModePresentation(mode, locale).text : muted(t.engineMode);
    const indicator = collaboration.modes.find(item => item.id === collaboration.active)?.indicator;
    return {
      text: indicator ? `${base}${muted(" · ")}${magenta(indicator)}` : base,
      help: muted(t.shiftTabCollaboration({ modes: collaboration.modes.map(item => item.label).join(" ↔ ") })),
    };
  }
  if (!mode) return { text: muted(t.engineMode), help: muted(t.shiftTabToCycle) };
  const withCycle = (text: string) => `${text} · ${t.shiftTabToCycle}`;
  const drawn = (glyph: string, color: (text: string) => string, help?: string): WorkModePresentation =>
    ({ text: color(`${glyph} ${mode.label}`), help: muted(help ? withCycle(help) : t.shiftTabToCycle) });
  switch (mode.tone) {
    case "danger": return drawn("▶▶", danger, t.bypassPermissionsHelp);
    case "auto": return drawn("▶▶", warning, t.autoModeHelp);
    case "acceptEdits": return drawn("▶▶", purple, t.acceptEditsHelp);
    case "manual": return drawn("Ⅱ", muted, t.manualModeHelp);
    case "readOnly": return drawn("Ⅱ", muted, t.readOnlyModeHelp);
    case "plan": return drawn("Ⅱ", planning, t.planModeHelp);
    case "strict": return drawn("Ⅱ", warning, t.dontAskModeHelp);
    default: return drawn("Ⅱ", muted);
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

/** «Working …» or, while `/compact` runs, «Compacting context …» — both in either language, both drawn as busy. */
function isWorkingStatus(status: string): boolean {
  return (["en", "es"] as const).some(locale => status.startsWith(getCatalog(locale).chat.statusWorking) || status.startsWith(getCatalog(locale).codexChat.compactingTitle));
}

/**
 * A busy status that fits `max` columns: «label · what it is doing · time» loses the middle part (the command, or «Making room to
 * continue») before it is allowed to cut off the time at the end, which is the part that shows it has not frozen.
 */
function fitStatus(status: string, max: number): string {
  const parts = status.split(" · ");
  while (parts.length > 2 && visibleWidth(parts.join(" · ")) > max) parts.splice(1, 1);
  return parts.join(" · ");
}

export const SPINNER_FRAMES =["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
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
  private workModeHint?: NativeWorkMode;
  private collaborationHint?: CollaborationHint;
  private selectedChoice = 0;
  private currentValue?: string;
  private dismissed = "";
  private commandGroups: ComposerCommandGroup[];
  private skillChoices: ComposerChoice[] = [];
  /** Where `@` looks for files (the assistant's own search); none means `@` is plain text. */
  private fileSearch?: (query: string) => Promise<string[]>;
  /** The `@` query last searched and the files it found. */
  private fileQuery = "";
  private fileChoices: ComposerChoice[] = [];
  private picker?: { title: string; items: ComposerChoice[]; searchable: boolean; numbered: boolean; footer?: string; body?: string; resolve: (value?: string) => void };
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
   * again; without it typed letters are ignored, as they always were, except a row's own `key`, which picks it.
   * The first row starts marked unless `current` names another. See `ComposerChooseOptions` for the look.
   */
  choose(title: string, items: ComposerChoice[], current?: string, options: ComposerChooseOptions = {}): Promise<string | undefined> {
    this.cancelChoice();
    if (!items.length) return Promise.resolve(undefined);
    this.selectedChoice = Math.max(0, items.findIndex(item => item.value === current));
    this.currentValue = current;
    this.pickerQuery = "";
    return new Promise(resolve => {
      this.picker = { title, items, searchable: Boolean(options.searchable), numbered: options.numbered !== false, ...(options.footer ? { footer: options.footer } : {}), ...(options.body ? { body: options.body } : {}), resolve };
      this.repaint();
    });
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
    this.skillChoices = skills.map(skill => ({ ...skill, group: getCatalog(this.locale).chat.skillsGroup }));
    this.repaint();
  }
  /** Lets `@` search files with the assistant's own search (Codex: `fuzzyFileSearch`); undefined turns it off. */
  setFileSearch(search?: (query: string) => Promise<string[]>): void {
    this.fileSearch = search; this.fileQuery = ""; this.fileChoices = [];
  }
  /**
   * The files for the `@token` at the end of the text. Like Codex's file search, an empty token searches
   * nothing; a new token starts a search whose answer is kept only if the token is still the same.
   */
  private fileSuggestions(query: string): ComposerChoice[] {
    if (!this.fileSearch || !query) return [];
    if (query !== this.fileQuery) {
      this.fileQuery = query; this.fileChoices = [];
      void this.fileSearch(query).then(paths => {
        if (this.fileQuery !== query) return;
        const group = getCatalog(this.locale).chat.filesGroup;
        this.fileChoices = paths.map(path => ({ value: path, label: "", group }));
        this.repaint();
      }).catch(() => {});
    }
    return this.fileChoices;
  }
  /**
   * Puts the chosen file where the `@token` was, like Codex's `insert_selected_path`: the path as plain text,
   * in double quotes when it has spaces (and no quote of its own), followed by one space.
   */
  private insertFile(path: string): void {
    const text = this.getText();
    const token = /@[^\s@]*$/.exec(text);
    const inserted = /\s/.test(path) && !path.includes("\"") ? `"${path}"` : path;
    const next = `${token ? text.slice(0, token.index) : text}${inserted} `;
    this.setText(next); this.dismissed = next; this.fileQuery = ""; this.fileChoices = [];
  }
  private commandItems(): ComposerChoice[] { return this.commandGroups.flatMap(group => group.items.map(item => ({ ...item, group: group.title }))); }
  chooseCommand(): Promise<string | undefined> {
    return this.choose(getCatalog(this.locale).chat.commandsFallbackTitle, this.commandItems().filter(item => item.value !== "/f614:help" && item.value !== "/f614:commands"));
  }
  private suggestions(): ComposerChoice[] {
    const text = this.getText();
    if (text === this.dismissed) return [];
    // A command name may hold digits, «-» and «:» (`/f614:stop`, `/debug-config`); a skill name may also hold «.» and «:» (plugin skills).
    if (/^\/[a-z0-9:_-]*$/.test(text)) return this.commandItems().filter(item => item.value.startsWith(text));
    if (/^\$[a-z0-9_:.-]*$/i.test(text)) return this.skillChoices.filter(item => item.value.startsWith(text));
    const mention = /(?:^|\s)@([^\s@]*)$/.exec(text);
    if (mention) return this.fileSuggestions(mention[1]!);
    return [];
  }
  handleInput(data: string): void {
    if (this.picker?.searchable) { this.handleSearchInput(data); return; }
    if (this.picker && (data.startsWith("/") || this.getText().startsWith("/")) && !matchesKey(data, "escape")) {
      super.handleInput(data);
      this.repaint();
      return;
    }
    const keyed = this.picker && data.length === 1 ? this.picker.items.find(item => item.key !== undefined && item.key.toLowerCase() === data.toLowerCase()) : undefined;
    if (keyed) { const picker = this.picker!; this.picker = undefined; picker.resolve(keyed.value); this.repaint(); return; }
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
        else if (item.group === getCatalog(this.locale).chat.filesGroup) this.insertFile(item.value);
        // Like Codex, a skill only goes into the box as «$name » so the person goes on writing; the next Enter sends the message.
        else if (item.group === getCatalog(this.locale).chat.skillsGroup) { const text = `${item.value} `; this.setText(text); this.dismissed = text; }
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
  /** The work mode to show under the input, as its adapter lists it (none shows the engine's own default), and the collaboration modes when Shift+Tab switches those. */
  setWorkModeHint(mode?: NativeWorkMode, collaboration?: CollaborationHint): void { this.workModeHint = mode; this.collaborationHint = collaboration; this.repaint(); }
  handleMouse(event: TuiMouseEvent) {
    // Own editor gestures so screen-level selection cannot highlight the
    // zero-width cursor marker (or the entire padded input row).
    if (event.button === "left" && ["press", "drag", "release"].includes(event.type)) return { handled: true, focus: true };
    const items = this.activeItems();
    const searchRows = this.picker?.searchable ? 1 : 0;
    const menuRows = items.length ? Math.min(5, items.length - Math.max(0, this.selectedChoice - 4)) + 2 + searchRows + this.bodyLines(event.width).length : searchRows ? 2 : 0;
    return super.handleMouse({ ...event, x: event.x - 4, y: event.y - 2 - menuRows, width: Math.max(1, event.width - 8) });
  }

  /** The open picker's explanation wrapped for a component of `width` columns (the same margin `render` leaves), or no rows when it has none. */
  private bodyLines(width: number): string[] {
    if (!this.picker?.body) return [];
    const inner = Math.max(1, width >= 14 ? width - 4 : width);
    return wrapTextWithAnsi(muted(this.picker.body), inner).map(line => fit(line, inner));
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
    const title = `  ${statusDot(this.status)} ${isWorkingStatus(this.status) ? fitStatus(this.status, width - 11) : this.status}  `;
    const topFill = rule(Math.max(0, width - visibleWidth(title) - 5));
    const mode = this.workModeHint || this.collaborationHint?.modes.length ? workModePresentation(this.workModeHint, this.locale, this.collaborationHint) : undefined;
    const hint = mode ? mode.text : muted(t.helpOrCommandsHint);
    const shortcuts = mode ? mode.help : muted(t.shiftEnterNewline);
    const hintWidth = visibleWidth(hint) + visibleWidth(shortcuts);
    const hintLine = innerWidth >= hintWidth + 2 ? `${hint}${" ".repeat(innerWidth - hintWidth)}${shortcuts}` : hint;

    const items = this.activeItems();
    const start = Math.max(0, this.selectedChoice - 4);
    const visibleItems = items.slice(start, start + 5);
    // Numbering and the ✓ for the active value only make sense for a deliberate choose() menu
    // (/model, /effort, /resume…) — not for the live "/" or "$" autocomplete-as-you-type list.
    const numbered = Boolean(this.picker?.numbered);
    const leftText = (item: ComposerChoice, index: number) =>
      `${numbered ? `${start + index + 1}. ` : ""}${item.display ?? item.value}${item.value === this.currentValue ? " ✓" : ""}`;
    const leftWidth = Math.max(0, ...visibleItems.map((item, offset) => visibleWidth(leftText(item, offset))));
    const bodyRows = this.bodyLines(width + 4);
    const skillList = !this.picker && items[0]?.group === t.skillsGroup;
    const searchRow = this.picker?.searchable
      ? [fit(`${cyan(`${t.searchLabel}:`)} ${this.pickerQuery ? this.pickerQuery : muted(t.searchPlaceholder)}`, width)]
      : [];
    const menu = items.length ? [
      ...searchRow,
      ...visibleItems.flatMap((item, offset) => [
        ...(offset === 0 || item.group !== visibleItems[offset - 1]?.group ? [fit(cyan(item.group ?? this.picker?.title ?? t.commandsFallbackTitle), width)] : []),
        ...(offset === 0 ? bodyRows : []),
        fit((() => {
          const isCursor = start + offset === this.selectedChoice;
          const isCurrent = item.value === this.currentValue;
          const color = isCursor ? cyan : isCurrent ? success : muted;
          const left = color(`${isCursor ? "›" : " "} ${fit(leftText(item, offset), leftWidth)}`);
          return item.label ? `${left}  ${muted(item.label)}` : left;
        })(), width),
      ]),
      fit(muted(this.picker?.footer ?? t.menuFooter({ title: this.picker?.title ?? (skillList ? t.skillsFooterTitle : t.commandsFallbackTitle), from: start + 1, to: Math.min(start + 5, items.length), total: items.length })), width),
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
