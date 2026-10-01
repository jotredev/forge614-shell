import { Editor, TuiAltScreen, ProcessTerminal, visibleWidth, matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { TUI, TuiMouseEvent } from "@earendil-works/pi-tui";
import { accent as cyan, background, danger, elevated, faint, fit, magenta, mix, muted, palette, paint, planning, purple, success, surface, warning } from "./theme.ts";
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
 * `action: true` marks a row that does something (Marketplaces, Import selected, Cancel) instead of being one of the listed elements: the footer's count leaves it out.
 */
export interface ComposerChoice { value: string; label: string; display?: string; group?: string; search?: string; key?: string; action?: boolean; }
/**
 * How a picker opens: `searchable` filters as the person types; `numbered: false` drops the «1.» before each row; `footer` replaces the
 * default «title · 1–2 of 2 · …» line; `body` is an explanation of the question, drawn wrapped under its title and gone with the picker;
 * `startAt` puts the cursor on the row with that value without marking it as the current one (a list that reopens after a change keeps the cursor where it was).
 */
export interface ComposerChooseOptions { searchable?: boolean; numbered?: boolean; footer?: string; body?: string; startAt?: string; }
export interface ComposerCommandGroup { title: string; items: ComposerChoice[]; }

/**
 * The footer's «from–to of total» counted in elements only: rows marked `action` are not elements, so «Marketplaces» does not make 5015 plugins 5016.
 * `start` and `end` are the window of rows shown (`end` exclusive); a window of nothing but actions reads «total of total» instead of running past the end.
 */
export function elementRange(items: ComposerChoice[], start: number, end: number): { from: number; to: number; total: number } {
  const elements = (upTo: number) => items.slice(0, upTo).filter(item => !item.action).length;
  const total = elements(items.length);
  return { from: Math.min(elements(start) + 1, total), to: elements(end), total };
}

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
  if (status === en.awaitingAnswer || status === es.awaitingAnswer) return danger;
  if (status === enTc.statusCheckingAccount || status === esTc.statusCheckingAccount) return muted;
  return warning; // e.g. "Connect with /login" — needs the person's attention
}

/** «Working …» or, while `/compact` runs, «Compacting context …» — both in either language, both drawn as busy. */
function isWorkingStatus(status: string): boolean {
  return (["en", "es"] as const).some(locale => status.startsWith(getCatalog(locale).chat.statusWorking) || status.startsWith(getCatalog(locale).codexChat.compactingTitle)
    || status.startsWith(getCatalog(locale).codexChat.recapLoadingTitle));
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

/** «Ready», in either language: the status that gets the ✓ and the flash when a turn ends. */
function isReadyStatus(status: string): boolean {
  return status === getCatalog("en").chat.statusReady || status === getCatalog("es").chat.statusReady;
}

/** «Waiting for your answer», in either language: the status whose dot pulses. */
function isAwaitingStatus(status: string): boolean {
  return status === getCatalog("en").chat.awaitingAnswer || status === getCatalog("es").chat.awaitingAnswer;
}

export const SPINNER_FRAMES =["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
/** A live-moving dot while active — a static label reads as frozen once the person stares at it. `now` is the clock's time in milliseconds (the real one by default). */
export function spinnerFrame(active: boolean, now: number = Date.now()): string {
  return active ? SPINNER_FRAMES[Math.floor(now / 120) % SPINNER_FRAMES.length]! : "●";
}

/**
 * The time and the repaint timer the composer's animations run on, injectable so a test can set an exact instant and see that no timer is left behind.
 * `every` starts a timer that calls `tick` every `ms` milliseconds and returns the function that stops it.
 */
export interface ComposerClock { now(): number; every(ms: number, tick: () => void): () => void }
const realClock: ComposerClock = {
  now: () => Date.now(),
  every: (ms, tick) => { const timer = setInterval(tick, ms); timer.unref?.(); return () => clearInterval(timer); },
};

/** How often the screen repaints while something animates. */
const REPAINT_MS = 100;
/** How long the flash that turns Working into Ready lasts, and how far toward white it starts. */
const FLASH_MS = 600;
const FLASH_START = 0.6;
/** The light band: letters per second, and how many letters it reaches on each side of its position. */
const BAND_SPEED = 7.5;
const BAND_REACH = 3;
/** Seconds the «waiting» dot takes to dim and brighten once, and how far toward the surface it dims. */
const PULSE_SECONDS = 1.6;
const PULSE_DEPTH = 0.5;
const WHITE = [255, 255, 255] as const;
/** The dim end of the light band: the busy color pulled toward a dark gray; the bright end pulls it toward white. */
const BAND_DIM = mix(palette.warning, [40, 40, 44], 0.45);
const BAND_BRIGHT = mix(palette.warning, WHITE, 0.55);

/**
 * `word` with a band of light passing over it: each letter blends between the dim and the bright tone by its distance to a position that moves `BAND_SPEED`
 * letters a second from `BAND_REACH` letters before the start to as many after the end, and begins again (brightness = max(0, 1 − distance / `BAND_REACH`)).
 * Every letter is painted on its own, so the colors are exact and, like the rest, adapt to a 256-color terminal.
 */
function lightBand(word: string, now: number): string {
  const letters = Array.from(word);
  const position = ((now * BAND_SPEED) / 1000) % (letters.length + 2 * BAND_REACH) - BAND_REACH;
  return letters.map((letter, index) => paint(mix(BAND_DIM, BAND_BRIGHT, Math.max(0, 1 - Math.abs(index - position) / BAND_REACH)))(letter)).join("");
}

/** The «waiting» dot: danger that fades toward the surface and back, a full turn every `PULSE_SECONDS`, starting at full danger. */
function pulseDot(now: number): string {
  const wave = (1 - Math.cos((2 * Math.PI * now) / 1000 / PULSE_SECONDS)) / 2;
  return paint(mix(palette.danger, palette.surface, PULSE_DEPTH * wave))("●");
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
  /** An open text question (`ask`): the box takes the answer, Enter gives it back and Esc gives back nothing. */
  private textPrompt?: { title: string; placeholder: string; body?: string; resolve: (value?: string) => void };
  private pickerQuery = "";
  private repaint: () => void;
  /** When the flash that follows Working → Ready began (clock milliseconds), and the stop function of the repaint timer while one runs. */
  private flashStartedAt?: number;
  private stopRepaintTimer?: () => void;
  constructor(tui: TUI, private readonly locale: Locale = "en", private readonly clock: ComposerClock = realClock) {
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
    this.selectedChoice = Math.max(0, items.findIndex(item => item.value === (options.startAt ?? current)));
    this.currentValue = current;
    this.pickerQuery = "";
    return new Promise(resolve => {
      this.picker = { title, items, searchable: Boolean(options.searchable), numbered: options.numbered !== false, ...(options.footer ? { footer: options.footer } : {}), ...(options.body ? { body: options.body } : {}), resolve };
      this.repaint();
    });
  }
  /**
   * Asks for a line of free text — a note in the person's own words: the box is emptied and takes the answer, with `title` and `placeholder` (and `options.body`,
   * an explanation that goes away with the question) drawn above it. Enter resolves the answer trimmed (empty when nothing was written), Esc resolves nothing.
   * While it is open «/» is text: the command menu does not open and Enter runs no command.
   */
  ask(title: string, placeholder: string, options: { body?: string } = {}): Promise<string | undefined> {
    this.cancelChoice();
    this.setText("");
    return new Promise(resolve => {
      this.textPrompt = { title, placeholder, ...(options.body ? { body: options.body } : {}), resolve };
      this.repaint();
    });
  }
  /** Closes an open text question, resolving nothing, and empties what was typed into it. */
  private closeTextPrompt(answer?: string): void {
    const prompt = this.textPrompt; this.textPrompt = undefined;
    this.setText("");
    prompt?.resolve(answer);
    this.repaint();
  }
  /** Keys for a text question: Esc leaves it, a plain Enter answers it; everything else (a newline with Shift+Enter, pasted text) is the editor's own. */
  private handleTextPromptInput(data: string): void {
    if (matchesKey(data, "escape")) { this.closeTextPrompt(); return; }
    if (matchesKey(data, "enter")) { this.closeTextPrompt(this.getText().trim()); return; }
    super.handleInput(data);
    this.repaint();
  }
  cancelChoice(): void {
    const picker = this.picker; this.picker = undefined; this.currentValue = undefined; this.pickerQuery = ""; picker?.resolve();
    if (this.textPrompt) this.closeTextPrompt(); else this.repaint();
  }
  /** What the menu lists right now: the open picker's rows narrowed by what was typed, or the "/" and "$" suggestions. */
  private activeItems(): ComposerChoice[] {
    if (this.textPrompt) return [];
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
    if (this.textPrompt) { this.handleTextPromptInput(data); return; }
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
  /** Sets the assistant's status; the one that turns Working into Ready also starts the flash on «✓ Ready». */
  setStatus(status: string): void {
    if (isWorkingStatus(this.status) && isReadyStatus(status)) this.flashStartedAt = this.clock.now();
    this.status = status;
  }
  /** Whether the flash is still going at `now`. */
  private flashing(now: number): boolean { return this.flashStartedAt !== undefined && now - this.flashStartedAt < FLASH_MS; }
  /** Whether anything on screen is animated at `now`: working, waiting for an answer, or the flash. Only then does the screen repaint on its own. */
  private animated(now: number): boolean {
    const shown = this.shownStatus();
    return isWorkingStatus(shown) || isAwaitingStatus(shown) || this.flashing(now);
  }
  /**
   * Keeps the repaint timer in step with `animated`: one timer while something animates, none otherwise. It runs on every draw and on every tick, so the timer
   * starts with the first frame that needs it and stops itself on the first one that does not — nothing is left running on a quiet screen.
   */
  private syncRepaintTimer(now: number): void {
    if (this.animated(now)) { this.stopRepaintTimer ??= this.clock.every(REPAINT_MS, () => { this.syncRepaintTimer(this.clock.now()); this.repaint(); }); return; }
    this.stopRepaintTimer?.(); this.stopRepaintTimer = undefined;
  }
  /**
   * The status as the mode row draws it, with the room `max` columns leave for its text (a busy status gives up its middle part first, never its time):
   * «✓ Ready» in success (flashing toward white right after a turn), the spinner in warning with the first part of a busy status under the light band and the
   * rest in muted, the pulsing dot with «Waiting for your answer» in danger, and a fixed dot in the color `statusColor` gives any other.
   */
  private statusSegment(status: string, now: number, max: number): string {
    if (isReadyStatus(status)) {
      const age = this.flashStartedAt === undefined ? FLASH_MS : now - this.flashStartedAt;
      const flash = age >= 0 && age < FLASH_MS ? FLASH_START * (1 - age / FLASH_MS) : 0;
      return paint(mix(palette.success, WHITE, flash))(`✓ ${status}`);
    }
    if (isWorkingStatus(status)) {
      const [first = "", ...rest] = fitStatus(status, max).split(" · ");
      return `${warning(spinnerFrame(true, now))} ${lightBand(first, now)}${rest.length ? muted(` · ${rest.join(" · ")}`) : ""}`;
    }
    if (isAwaitingStatus(status)) return `${pulseDot(now)} ${danger(status)}`;
    return statusColor(status)(`● ${status}`);
  }
  /**
   * The status the box shows: while a selector or a question is open Shell waits for the person, and says so — «Waiting for your answer» — instead of
   * the assistant's «Working», however often the status is set meanwhile; when it closes, the assistant's own status shows again.
   */
  private shownStatus(): string { return this.picker || this.textPrompt ? getCatalog(this.locale).chat.awaitingAnswer : this.status; }
  /** The work mode to show under the input, as its adapter lists it (none shows the engine's own default), and the collaboration modes when Shift+Tab switches those. */
  setWorkModeHint(mode?: NativeWorkMode, collaboration?: CollaborationHint): void { this.workModeHint = mode; this.collaborationHint = collaboration; this.repaint(); }
  handleMouse(event: TuiMouseEvent) {
    // Own editor gestures so screen-level selection cannot highlight the
    // zero-width cursor marker (or the entire padded input row).
    if (event.button === "left" && ["press", "drag", "release"].includes(event.type)) return { handled: true, focus: true };
    const items = this.activeItems();
    const searchRows = this.picker?.searchable ? 1 : 0;
    const menuRows = this.textPrompt ? this.promptRows(Math.max(1, event.width - 4)).length + 1
      : items.length ? Math.min(5, items.length - Math.max(0, this.selectedChoice - 4)) + 2 + searchRows + this.bodyLines(event.width).length : searchRows ? 2 : 0;
    return super.handleMouse({ ...event, x: event.x - 4, y: event.y - 1 - menuRows, width: Math.max(1, event.width - 8) });
  }

  /** An explanation wrapped for a component of `width` columns (the same margin `render` leaves), or no rows when there is none. */
  private wrapBody(body: string | undefined, width: number): string[] {
    if (!body) return [];
    const inner = Math.max(1, width >= 14 ? width - 4 : width);
    return wrapTextWithAnsi(muted(body), inner).map(line => fit(line, inner));
  }
  /** The open picker's explanation, or no rows when it has none. */
  private bodyLines(width: number): string[] { return this.wrapBody(this.picker?.body, width); }
  /** What a text question draws above the box: its title, its explanation, the placeholder while nothing is typed, and the keys. `width` is the row width the menu is drawn at. */
  private promptRows(width: number): string[] {
    const prompt = this.textPrompt;
    if (!prompt) return [];
    return [
      fit(cyan(prompt.title), width),
      ...this.wrapBody(prompt.body, width + 4).map(line => fit(line, width)),
      ...(this.getText() ? [] : [fit(muted(prompt.placeholder), width)]),
      fit(muted(getCatalog(this.locale).chat.askFooter), width),
    ];
  }

  /**
   * The box with a margin of two columns on each side. The left one draws nothing (it follows the general background); the right one is painted with it on purpose:
   * the block's painter ends with «reset background», and cells that follow without a color of their own would show the terminal's own tone as a strip next to the block.
   * Only rows that end in such a painted block get it; a row with no background at all (a plain menu row) already follows the general one.
   */
  render(width: number): string[] {
    const margin = width >= 14 ? 2 : 0;
    const right = margin ? background(palette.background)(" ".repeat(margin)) : "";
    return this.renderContent(width - margin * 2).map(line => " ".repeat(margin) + line + (line.endsWith("\x1b[49m") ? right : ""));
  }
  /**
   * The box, top to bottom: the menu (when open), an empty row, then the surface-gray block of an empty row, the editor, an empty row, the status-and-mode row and an
   * empty row. The status-and-mode row is «status · mode» on the left and the shortcuts on the right; when it does not fit the shortcuts go first, then the middle of a
   * busy status (never its time) and last the row is clipped.
   */
  private renderContent(width: number): string[] {
    const t = getCatalog(this.locale).chat;
    const innerWidth = Math.max(1, width - 4);
    if (width < 10) return super.render(Math.max(1, width));
    const editor = super.render(innerWidth).slice(1, -1);
    const shown = this.shownStatus();
    const now = this.clock.now();
    this.syncRepaintTimer(now);
    const block = (content: string) => surface(`  ${fit(content, innerWidth)}  `);
    const mode = this.workModeHint || this.collaborationHint?.modes.length ? workModePresentation(this.workModeHint, this.locale, this.collaborationHint) : undefined;
    const hint = mode ? mode.text : muted(t.helpOrCommandsHint);
    const shortcuts = mode ? mode.help : muted(t.shiftEnterNewline);
    const separator = faint(" · ");
    const row = (status: string) => `${status}${separator}${hint}`;
    const full = row(this.statusSegment(shown, now, Infinity));
    const statusLine = innerWidth >= visibleWidth(full) + visibleWidth(shortcuts) + 2
      ? `${full}${" ".repeat(innerWidth - visibleWidth(full) - visibleWidth(shortcuts))}${shortcuts}`
      : row(this.statusSegment(shown, now, innerWidth - 2 - visibleWidth(separator) - visibleWidth(hint)));

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
    const menu = this.textPrompt ? this.promptRows(width) : items.length ? [
      ...searchRow,
      ...visibleItems.flatMap((item, offset) => [
        ...(offset === 0 || item.group !== visibleItems[offset - 1]?.group ? [fit(cyan(item.group ?? this.picker?.title ?? t.commandsFallbackTitle), width)] : []),
        ...(offset === 0 ? bodyRows : []),
        (() => {
          const isCursor = start + offset === this.selectedChoice;
          const isCurrent = item.value === this.currentValue;
          const color = isCursor ? cyan : isCurrent ? success : muted;
          // The cursor's row is a block of the elevated gray with an accent bar on its left; the other rows have no background.
          const left = color(`${isCursor ? "▎" : " "} ${fit(leftText(item, offset), leftWidth)}`);
          const row = fit(item.label ? `${left}  ${muted(item.label)}` : left, width);
          return isCursor ? elevated(row) : row;
        })(),
      ]),
      fit(muted(this.picker?.footer ?? t.menuFooter({ title: this.picker?.title ?? (skillList ? t.skillsFooterTitle : t.commandsFallbackTitle), ...elementRange(items, start, start + 5) })), width),
    ] : searchRow.length ? [...searchRow, fit(muted(t.searchNoMatches), width)] : [];
    return [
      ...menu,
      "",
      block(""),
      ...editor.map(block),
      block(""),
      block(statusLine),
      block(""),
    ];
  }
}

export function createComposer(tui: TUI = new TuiAltScreen(new ProcessTerminal()), locale: Locale = "en", clock?: ComposerClock): { component: ForgeComposer; input: ForgeComposer } {
  const input = new ForgeComposer(tui, locale, clock);
  return { component: input, input };
}
