import { visibleWidth } from "@earendil-works/pi-tui";
import type { Component, Terminal, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { accent, faint, muted } from "./theme.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";
import { SIDEBAR_WIDTH, loadSidebarHidden, loadSidebarWidth, saveSidebarHidden, saveSidebarWidth } from "../../infrastructure/shell-preferences.ts";

/** What is remembered about the sidebar between sessions: its width in columns and whether the person hid it. */
export interface SidebarState { width: number; hidden: boolean }

export interface SidebarLayoutOptions {
  /** The screen's terminal: its rows place the grip, and the resize pointer is asked of it. */
  terminal: Terminal;
  locale?: Locale;
  /** The remembered width and hidden flag the screen opens with (36 columns, shown, when nothing is remembered). */
  width?: number;
  hidden?: boolean;
  /** Called with the new state when the person releases the grip or clicks a button, never while the pointer is still moving. */
  onChange?: (state: SidebarState) => void;
}

/** The sidebar is drawn from this many columns of terminal; narrower, it hides itself and no show button is offered. */
const NARROW_BELOW = 100;
/** Dragging the sidebar narrower than this many columns offers to hide it (and releasing there does). While offering, the sidebar is drawn this wide. */
const FOLD_BELOW = 24;
/** The chat never has fewer columns than this, whatever the sidebar's width. */
const CHAT_MIN_WIDTH = 60;
/** The grip between the chat and the sidebar: two columns the sidebar's edge is taken by. */
export const GRIP_WIDTH = 2;
/** The two escape sequences (OSC 22) that ask the terminal for the resize pointer and give it back; a terminal that does not know them ignores them. */
export const RESIZE_POINTER = "\x1b]22;ew-resize\x07";
export const DEFAULT_POINTER = "\x1b]22;default\x07";
/** The hand pointer (OSC 22) the chat asks for while the pointer is over a link; it is given back with `DEFAULT_POINTER`, the same way. */
export const LINK_POINTER = "\x1b]22;pointer\x07";

type Hovered = "grip" | "hide" | "show";

/**
 * Everything about where the sidebar is and how wide: the remembered width and hidden flag, the grip that drags its edge, the two buttons that hide and show it, and the
 * resize pointer. One instance is shared by the screen's layout (which sizes the columns from it and hands it each pass the terminal's width), the sidebar's column (the hide
 * button and the «release to hide it» hint), the header (the show button), the footer (which takes the sidebar's data when it is not drawn) and the «jump to latest» pill
 * (which centers on the chat column).
 *
 * The width is the person's choice between 28 and 70 columns, but what is drawn also leaves the chat at least 60 columns, so it can be narrower than the remembered one on a small terminal
 * without forgetting it. Dragging follows the pointer with the column that was taken staying under it; below 24 columns it shows the hint and releasing there hides the sidebar. The state is
 * reported through `onChange` only when the person lets go or clicks, never on each movement.
 */
export class SidebarLayout {
  private readonly terminal: Terminal;
  private readonly locale: Locale;
  private readonly onChange?: (state: SidebarState) => void;
  private width: number;
  private hidden: boolean;
  private columns = 0;
  private hovered?: Hovered;
  private drag?: { offset: number; raw: number; moved: boolean };
  private pointerRaised = false;
  private readonly gripComponent: Component;

  constructor(options: SidebarLayoutOptions) {
    this.terminal = options.terminal;
    this.locale = options.locale ?? "en";
    this.onChange = options.onChange;
    this.width = options.width !== undefined && options.width >= SIDEBAR_WIDTH.min && options.width <= SIDEBAR_WIDTH.max ? Math.round(options.width) : SIDEBAR_WIDTH.fallback;
    this.hidden = options.hidden === true;
    this.gripComponent = { invalidate() {}, render: () => this.renderGrip(), handleMouse: event => this.gripMouse(event) };
  }

  /** Whether the resize pointer is asked for right now (the grip is hovered or held); the chat's links do not take the pointer back while it is. */
  holdsPointer(): boolean { return this.pointerRaised; }

  /** Told by the layout, on each pass, how many columns the terminal has: everything else is measured from it. */
  observe(columns: number): void { this.columns = columns; }

  private columnsNow(): number { return this.columns || this.terminal.columns || 0; }

  /** Whether the terminal is too narrow for a sidebar (under 100 columns), which hides it by itself. */
  isNarrow(): boolean { return this.columnsNow() < NARROW_BELOW; }

  /** Whether the sidebar is drawn: the terminal is wide enough and the person has not hidden it (while the grip is held it stays drawn). */
  isVisible(): boolean { return !this.isNarrow() && (this.drag !== undefined || !this.hidden); }

  /** Whether the grip is being dragged below the point where releasing hides the sidebar. */
  isFolding(): boolean { return this.drag !== undefined && this.drag.raw < FOLD_BELOW; }

  /** The most columns the sidebar can have on this terminal: 70, or less so the chat keeps its 60. */
  private largest(): number { return Math.min(SIDEBAR_WIDTH.max, this.columnsNow() - GRIP_WIDTH - CHAT_MIN_WIDTH); }

  /** The columns the sidebar is drawn with right now (0 when it is not drawn): while folding 24, while dragging the pointer's width within the limits, otherwise the remembered one within the limits. */
  sidebarWidth(): number {
    if (!this.isVisible()) return 0;
    const within = (width: number) => Math.max(SIDEBAR_WIDTH.min, Math.min(this.largest(), Math.round(width)));
    if (this.drag) return this.isFolding() ? FOLD_BELOW : within(this.drag.raw);
    return within(this.width);
  }

  /** The columns the chat has: the whole terminal, less the sidebar and the grip when they are drawn. */
  chatWidth(): number { return Math.max(0, this.columnsNow() - (this.isVisible() ? this.sidebarWidth() + GRIP_WIDTH : 0)); }

  /** The remembered width and hidden flag: what is saved. */
  state(): SidebarState { return { width: this.width, hidden: this.hidden }; }

  /** The component that goes between the chat and the sidebar: the two columns of grip, which draws its dots and arrows and takes the mouse. */
  grip(): Component { return this.gripComponent; }

  /** Gives the pointer back and forgets any hover; true when something that is drawn changed. The layout calls this when the pointer moves over nothing that answers it. */
  leave(): boolean { return this.setHovered(undefined); }

  /** Hides the sidebar (the «hide ›» button) and remembers it. */
  hide(): void { this.setHidden(true); }

  /** Shows the sidebar again, with the width it last had (the «show sidebar» button), and remembers it. */
  show(): void { this.setHidden(false); }

  private setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.setHovered(undefined);
    this.onChange?.(this.state());
  }

  private setHovered(next: Hovered | undefined): boolean {
    const changed = this.hovered !== next;
    this.hovered = next;
    this.syncPointer();
    return changed;
  }

  /** Asks the terminal for the resize pointer while the grip is hovered or held, and gives it back once neither is so; it writes only when that changes. */
  private syncPointer(): void {
    const wanted = this.hovered === "grip" || this.drag !== undefined;
    if (wanted === this.pointerRaised) return;
    this.pointerRaised = wanted;
    this.terminal.write?.(wanted ? RESIZE_POINTER : DEFAULT_POINTER);
  }

  /**
   * The grip's rows, one per terminal row, two columns each: on the five rows around the middle one a faint «⋮» in the second column; hovered or held, «◂▸» on the middle row
   * and «⋮» on the other four, all in the accent color. No background of another color is painted, so nothing looks like a scroll bar.
   */
  private renderGrip(): string[] {
    const rows = this.terminal.rows ?? 0;
    const middle = Math.floor(rows / 2);
    const active = this.hovered === "grip" || this.drag !== undefined;
    return Array.from({ length: rows }, (_, row) => {
      if (row === middle) return active ? accent("◂▸") : ` ${faint("⋮")}`;
      if (Math.abs(row - middle) <= 2) return ` ${(active ? accent : faint)("⋮")}`;
      return "  ";
    });
  }

  /**
   * The mouse on the grip. Hovering shows the arrows and the resize pointer. A left press takes the grip: it is captured, so the drag and the release come here wherever the
   * pointer goes, and handled, so the screen starts no text selection. The width follows the pointer (the column taken on press stays under it), and on release the width is remembered, or
   * the sidebar hidden if it was dragged below 24 columns. A press and release without moving changes and saves nothing.
   */
  private gripMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "move") return { handled: true, render: this.setHovered("grip") };
    if (event.type === "press") {
      if (event.button !== "left") return { handled: true };
      this.drag = { offset: event.x, raw: this.sidebarWidth(), moved: false };
      this.setHovered("grip");
      return { handled: true, capture: true };
    }
    if (event.type === "drag") {
      if (!this.drag) return { handled: true };
      const raw = this.columnsNow() - GRIP_WIDTH - (event.screenX - this.drag.offset);
      if (raw !== this.drag.raw) this.drag = { ...this.drag, raw, moved: true };
      return { handled: true, capture: true };
    }
    if (event.type === "release") {
      const drag = this.drag;
      this.drag = undefined;
      this.setHovered(undefined);
      if (drag?.moved) {
        if (drag.raw < FOLD_BELOW) this.hidden = true;
        else { this.width = Math.max(SIDEBAR_WIDTH.min, Math.min(SIDEBAR_WIDTH.max, drag.raw)); this.hidden = false; }
        this.onChange?.(this.state());
      }
      return { handled: true, render: true };
    }
    return { handled: true, render: false };
  }

  /** The «hide ›» button's label and the columns it takes in a sidebar column `width` wide: right-aligned with two columns of margin. */
  private hideZone(width: number): { label: string; start: number; end: number } {
    const label = getCatalog(this.locale).sidebarControls.hide;
    const start = Math.max(0, width - 2 - visibleWidth(label));
    return { label, start, end: start + visibleWidth(label) };
  }

  /** The first row of the sidebar's column, `width` wide: empty, with the «hide ›» button at its right (the accent color while hovered, the secondary gray otherwise). */
  hideButtonRow(width: number): string {
    const { label, start } = this.hideZone(width);
    return " ".repeat(start) + (this.hovered === "hide" ? accent(label) : muted(label)) + " ".repeat(Math.max(0, width - start - visibleWidth(label)));
  }

  /** What the sidebar's column shows instead of its content while the grip is dragged below 24 columns. */
  releaseHint(): string { return getCatalog(this.locale).sidebarControls.releaseToHide; }

  /**
   * The mouse on the sidebar's column, in the column's own coordinates (`event.width` is its width): moving over the «hide ›» button on its first row turns it cyan and anywhere else on the
   * column clears any hover, and a click on the button hides the sidebar. Anything else is for the sidebar itself (nothing is returned).
   */
  railMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    const { start, end } = this.hideZone(event.width);
    const onButton = event.y === 0 && event.x >= start && event.x < end;
    if (event.type === "move") return { handled: true, render: this.setHovered(onButton ? "hide" : undefined) };
    if (event.type === "click" && event.button === "left" && onButton) { this.hide(); return { handled: true, render: true }; }
    return undefined;
  }

  /** Whether the header offers «‹ show sidebar»: the person hid the sidebar and the terminal is wide enough to draw it. */
  private showButtonOffered(): boolean { return this.hidden && !this.isNarrow() && this.drag === undefined; }

  /** The «‹ show sidebar» button as the header draws it (the accent color while hovered, the secondary gray otherwise), or nothing when it is not offered. */
  showButton(): string | undefined {
    if (!this.showButtonOffered()) return undefined;
    const label = getCatalog(this.locale).sidebarControls.show;
    return this.hovered === "show" ? accent(label) : muted(label);
  }

  /**
   * The mouse on the header, in the header's own coordinates (`event.width` is the chat's width), where the show button sits on the title row, right-aligned with two columns of margin: moving over
   * it turns it cyan, and a click shows the sidebar again. Nothing is returned when the button is not offered, so the screen treats the header like any other part of the chat.
   */
  headerMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (!this.showButtonOffered()) return undefined;
    const labelWidth = visibleWidth(getCatalog(this.locale).sidebarControls.show);
    const start = event.width - 2 - labelWidth;
    const onButton = event.y === 1 && event.x >= start && event.x < start + labelWidth;
    if (event.type === "move") return { handled: true, render: this.setHovered(onButton ? "show" : undefined) };
    if (!onButton || event.button !== "left") return undefined;
    if (event.type === "click") { this.show(); return { handled: true, render: true }; }
    // The rest of the left button's gestures on the label belong to it too, so pressing it never starts selecting the header's text.
    if (event.type === "press" || event.type === "drag" || event.type === "release") return { handled: true };
    return undefined;
  }
}

/**
 * The layout of a real screen: it opens with the width and hidden flag remembered in Shell's preferences (36 columns, shown, when none is saved or the saved value is invalid) and
 * remembers each change when the person lets go of the grip or clicks a button. `env` decides which preferences file, as in the rest of Shell.
 */
export function createSidebarLayout(terminal: Terminal, locale: Locale, env: NodeJS.ProcessEnv = process.env): SidebarLayout {
  const options = { env };
  return new SidebarLayout({
    terminal, locale, width: loadSidebarWidth(options), hidden: loadSidebarHidden(options),
    onChange: ({ width, hidden }) => { saveSidebarWidth(width, options); saveSidebarHidden(hidden, options); },
  });
}
