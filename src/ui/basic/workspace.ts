import { HStack, TuiAltScreen, VStack, ScrollView, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Component, OverlayHandle, OverlayOptions, TUI, Terminal, TuiMouseEvent } from "@earendil-works/pi-tui";
import { accent, elevated, fit, foreground, surface, warning, workspaceColors } from "./theme.ts";
import { DEFAULT_POINTER, GRIP_WIDTH, LINK_POINTER, RESIZE_POINTER, SidebarLayout } from "./sidebar-layout.ts";
import type { ChatLinks } from "./chat-links.ts";
import type { StatusPanels } from "./status-panel.ts";
import { copySelectionText } from "../../infrastructure/clipboard.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";

// Pi currently forwards residual wheel movement to the primary view even
// with overscroll=contain. Consume the residual at this independent pane.
export class IndependentScrollView extends ScrollView {
  private target?: number;
  private maximum = 0;
  private frame?: ReturnType<typeof setTimeout>;
  /** The rows the layout engine has assigned to this scrollable pane on its latest pass. */
  viewportRows = 0;
  private laidOutWidth?: number;
  private readonly widthListeners = new Set<() => void>();
  /**
   * Calls `listener` whenever a layout pass gives this pane a different width than the pass before (the first pass is not a change), while the layout is still being worked out, so what it
   * does is in place before the screen is drawn. Returns the function that stops listening.
   */
  onWidthChange(listener: () => void): () => void {
    this.widthListeners.add(listener);
    return () => { this.widthListeners.delete(listener); };
  }
  override getContentWidth(width: number): number {
    const previous = this.laidOutWidth;
    this.laidOutWidth = width;
    if (previous !== undefined && previous !== width) for (const listener of [...this.widthListeners]) listener();
    return super.getContentWidth(width);
  }
  override updateLayout(contentHeight: number, viewportHeight: number, render: () => void): void {
    const changedViewportRows = this.viewportRows !== viewportHeight;
    super.updateLayout(contentHeight, viewportHeight, render);
    this.viewportRows = viewportHeight;
    this.maximum = Math.max(0, contentHeight - viewportHeight);
    if (this.target !== undefined) this.target = Math.min(this.target, this.maximum);
    // pi-tui renders scroll content before it assigns this viewport height; request exactly one
    // following frame so height-aware content such as ChatLogo can draw from the current value.
    if (changedViewportRows) render();
  }
  override handleMouse(event: TuiMouseEvent) {
    if (event.type !== "wheel") return undefined;
    const target = { component: this, originX: event.screenX - event.x, originY: event.screenY - event.y, width: event.width, height: event.height };
    const delta = event.wheelDelta ?? 0;
    if (!Number.isFinite(delta) || delta === 0) return { handled: true as const, target };
    // Reverse immediately instead of making the user fight queued movement.
    if (this.target !== undefined && Math.sign(this.target - this.scrollTop) !== Math.sign(delta)) this.target = this.scrollTop;
    this.target = Math.max(0, Math.min(this.maximum, (this.target ?? this.scrollTop) + delta));
    if (!this.frame) this.advance();
    return { handled: true as const, target };
  }
  private advance = (): void => {
    this.frame = undefined;
    const distance = (this.target ?? this.scrollTop) - this.scrollTop;
    if (!distance) { this.target = undefined; return; }
    super.scrollBy(Math.sign(distance) * Math.max(1, Math.ceil(Math.abs(distance) * 0.4)));
    if (this.target === this.scrollTop) { this.target = undefined; return; }
    this.frame = setTimeout(this.advance, 16);
    this.frame.unref();
  };
  private cancelAnimation(): void {
    if (this.frame) clearTimeout(this.frame);
    this.frame = undefined; this.target = undefined;
  }
  override scrollTo(position: number, options?: Parameters<ScrollView["scrollTo"]>[1]): void { this.cancelAnimation(); super.scrollTo(position, options); }
  override scrollToStart(): void { this.cancelAnimation(); super.scrollToStart(); }
  override scrollToEnd(): void { this.cancelAnimation(); super.scrollToEnd(); }
  override scrollBy(lines: number): number { this.cancelAnimation(); super.scrollBy(lines); return 0; }
}

/** Small pill, styled like the rest of Shell's chrome, offering a click back to the latest message: one row of the elevated gray with its label, no box around it. */
class JumpToLatestButton implements Component {
  constructor(private readonly onClick: () => void, private readonly locale: Locale = "en") {}
  invalidate(): void {}
  handleMouse(event: TuiMouseEvent) {
    if (event.type === "click" && event.button === "left") { this.onClick(); return { handled: true as const, render: true }; }
    return undefined;
  }
  render(width: number): string[] {
    const label = getCatalog(this.locale).jumpToLatest.label;
    const inner = Math.min(Math.max(0, width), visibleWidth(label));
    return [elevated(foreground(fit(label, inner)))];
  }
}

/**
 * Shows the jump-to-latest pill above the composer whenever the transcript has been scrolled away
 * from the newest message, and hides it again once the person is back at the end. The pill is exactly
 * as wide as its label and is centered over the chat column, not the whole terminal: its column is read
 * from `layout` each time the screen is drawn, so it follows the sidebar's width (and the sidebar being
 * hidden). Without a `layout` the chat is taken to be the whole terminal.
 */
export function attachJumpToLatest(tui: TUI, scroll: IndependentScrollView, locale: Locale = "en", layout?: SidebarLayout): OverlayHandle {
  const label = visibleWidth(getCatalog(locale).jumpToLatest.label);
  const options: OverlayOptions = {
    // Near the top, not the bottom: a fixed bottom position sits over whatever text happens to be
    // scrolled to the last visible row, which is usually mid-paragraph. Just under the header is
    // reliably clear of chat content, and matches where a "new messages" banner belongs anyway —
    // it points back down to what you're missing, so it reads naturally near the top of your view.
    anchor: "top-left",
    margin: { top: 3 },
    width: label,
    // A getter, because pi-tui keeps this object and reads it again on every frame.
    get col() { return Math.max(0, Math.floor(((layout ? layout.chatWidth() : tui.terminal?.columns ?? 0) - label) / 2)); },
    nonCapturing: true,
    visible: () => !scroll.isFollowingEnd,
  };
  return tui.showOverlay(new JumpToLatestButton(() => scroll.scrollToEnd(), locale), options);
}

/** What `ChatScreen` reads and sets of pi-tui's private state. The names are those of pi-tui 0.85.1, which Shell pins exactly; the tests of the selection fail if a version renames any. */
interface PiScreenState {
  overlayStack?: { component: Component }[];
  isOverlayVisible?(entry: { component: Component }): boolean;
  selectionPressActive: boolean;
  selectionAnchor?: { scrollView?: unknown };
  pressedUrl?: string;
  stopSelectionAutoScroll(): void;
  clearTextSelection(): void;
  handleViewportInput(data: string): { consume?: boolean } | undefined;
}

/** A left button's release as the terminal reports it (SGR): no motion, no wheel and the left button's code, with or without a modifier key held. */
const LEFT_RELEASE = /^\x1b\[<(\d+);\d+;\d+m$/;

/**
 * The chat's alternate screen. It is pi-tui's own with four changes to how a selection made with the mouse behaves, all without touching pi-tui:
 * - The «jump to latest» pill does not count as a window over the chat when pi-tui asks (`hasOverlay`). pi-tui pins a selection to the chat's content rows only while no window is over the
 *   screen, and the pill is showing exactly when the person has scrolled up to read, so with it counted the selection was pinned to the screen's rows instead: turning the wheel left the highlight
 *   in place over other text, and a selection over several rows took the sidebar's columns too. The panels of the bottom bar still count.
 * - A selection ends, and what was selected in the chat is copied up to where it got, when the button is let go over something that answers the mouse itself (the sidebar, the writing box, the
 *   header, the bottom bar): pi-tui never sees that release, so it copied nothing and kept the selection held, following the next movement.
 * - A selection is removed when the chat's width changes (the terminal is resized, or the sidebar changes its width), because the text is laid out again and it would no longer be over the same words.
 * - The notice that the copy is done (pi-tui's «Copied!» / «Copy failed») is shown in Shell's language, with the catalog's text.
 */
class ChatScreen extends TuiAltScreen {
  private readonly watched = new WeakSet<IndependentScrollView>();
  private readonly notices: Record<string, string>;

  constructor(notices: { copied: string; copyFailed: string }, ...args: ConstructorParameters<typeof TuiAltScreen>) {
    super(...args);
    this.notices = { "Copied!": notices.copied, "Copy failed": notices.copyFailed };
    // pi-tui calls its input handler through the instance, so shadowing it here runs the extra step after pi-tui's own, on everything the screen is given.
    const pi = this.pi();
    const handle = pi.handleViewportInput.bind(this);
    pi.handleViewportInput = data => { const result = handle(data); this.afterViewportInput(data); return result; };
  }

  private pi(): PiScreenState { return this as unknown as PiScreenState; }

  /** Shows a transient notice. pi-tui's two copy notices are swapped for the catalog's text; anything else is shown as it comes. */
  override flash(message: string, durationMs?: number): void {
    super.flash(this.notices[message] ?? message, durationMs);
  }

  /** Whether a window other than the pill is visible. If pi-tui no longer has the state this reads, it answers as pi-tui does, so a renamed field makes the selection fail the tests, not the screen. */
  override hasOverlay(): boolean {
    const pi = this.pi();
    if (!Array.isArray(pi.overlayStack) || typeof pi.isOverlayVisible !== "function") return super.hasOverlay();
    return pi.overlayStack.some(entry => !(entry.component instanceof JumpToLatestButton) && pi.isOverlayVisible!(entry));
  }

  /** Runs after pi-tui has dealt with `data`: it starts watching the pane a selection began in, and finishes a selection whose release pi-tui did not see. */
  private afterViewportInput(data: string): void {
    const pi = this.pi();
    const scroll = pi.selectionAnchor?.scrollView;
    if (scroll instanceof IndependentScrollView) this.watchWidth(scroll);
    const release = LEFT_RELEASE.exec(data);
    if (!release || (Number(release[1]) & 0x63) !== 0 || !pi.selectionPressActive || !pi.selectionAnchor) return;
    // The release was answered by a component, so pi-tui is still waiting for it: end the selection where it got, copy it as pi-tui does at a release, and let go of the button.
    pi.selectionPressActive = false;
    pi.stopSelectionAutoScroll();
    pi.pressedUrl = undefined;
    if (this.getCopyOnSelect()) void this.copyActiveSelectionToClipboard();
    this.requestRender();
  }

  /** Removes the selection when `scroll`, the pane it was made in, gets a different width. Once per pane. */
  private watchWidth(scroll: IndependentScrollView): void {
    if (this.watched.has(scroll)) return;
    this.watched.add(scroll);
    scroll.onWidthChange(() => { if (this.pi().selectionAnchor?.scrollView === scroll) this.pi().clearTextSelection(); });
  }
}

/**
 * The alternate screen of the chat, the same for Codex and Claude Code: the session-local terminal (`workspaceTerminal`) with the mouse on, and the clicks on links sent to `links`,
 * which also draws the hover and asks for the hand pointer through that terminal. With `panels`, the bottom bar's panels are closed by Esc and by a click anywhere else before the screen sees
 * either (see `StatusPanels.intercept`). The screen keeps a mouse selection on its text while the chat scrolls (see `ChatScreen`). Returns the terminal to build the layout on and the screen.
 * What is selected is copied with `options.copySelection`, by default the system's clipboard (`copySelectionText`, with OSC 52 written to the terminal as a fallback): without a clipboard of its
 * own pi-tui writes OSC 52, which macOS Terminal does not understand. `options.locale` is the language of the copy notice.
 */
export function chatScreen(
  terminal: Terminal, links: ChatLinks, panels?: StatusPanels, options: { copySelection?: (text: string) => Promise<boolean>; locale?: Locale } = {},
): { surface: Terminal; tui: TuiAltScreen } {
  const surface = workspaceTerminal(terminal, links, panels);
  const copySelection = options.copySelection ?? ((text: string) => copySelectionText(text, { write: data => surface.write(data) }));
  const tui = new ChatScreen(getCatalog(options.locale ?? "en").chatSelection, surface, true, undefined, { mouse: true, openUrl: url => links.open(url), copySelection });
  links.bind({ requestRender: () => tui.requestRender(), write: data => surface.write(data) });
  return { surface, tui };
}

/**
 * Apply a session-local background, restoring the terminal on leaving alternate screen. It also notes whether a pointer was asked for (OSC 22, by the sidebar's grip or by a link under
 * the mouse) and not yet given back, so that leaving the alternate screen gives the pointer back first: closing the screen with the pointer over either never leaves the terminal stuck on it.
 * With `links`, everything the terminal sends is shown to them first, which is how they know the mouse moved. With `panels`, it is then offered to the bottom bar's open panel, which spends the Esc that
 * closes it and the click that closes it: what it spends never reaches the screen, the writing box or anything else.
 */
export function workspaceTerminal(terminal: Terminal, links?: ChatLinks, panels?: StatusPanels): Terminal {
  let active = false;
  let pointerRaised = false;
  return new Proxy(terminal, { get(target, key) {
    if (key === "start" && (links || panels)) return (onInput: (data: string) => void, onResize: () => void) => target.start(data => {
      links?.observe(data);
      if (panels?.intercept(data, target.rows)) return;
      onInput(data);
    }, onResize);
    if (key === "write") return (data: string) => {
      if (data.includes(RESIZE_POINTER) || data.includes(LINK_POINTER)) pointerRaised = true;
      if (data.includes(DEFAULT_POINTER)) pointerRaised = false;
      if (data.includes("\x1b[?1049h")) active = true;
      if (data.includes("\x1b[?1049l")) { active = false; target.write((pointerRaised ? DEFAULT_POINTER : "") + "\x1b[0m" + data); pointerRaised = false; return; }
      // Asked on every write, like every painter in theme.ts, so the base colors follow the terminal's current color support.
      const colors = workspaceColors();
      target.write(active ? colors + data.replace(/\x1b\[0m/g, "\x1b[0m" + colors) : data);
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

/**
 * The sidebar's column: the sidebar itself with two columns of padding on each side and a blank row above, all on the surface background from the top to the
 * last row of the terminal (even where its content ends), with no line drawn at its edge. The two columns between it and the chat keep the general background,
 * which is where the contrast comes from (the grip lives there). Mouse events reach the sidebar in its own coordinates: two columns and one row in, and four columns narrower.
 * With a `layout`, the blank row above holds the «hide ›» button (right-aligned, two columns of margin), the column answers the mouse for it, and while the grip is dragged below 24
 * columns the content is replaced by the «release to hide it» hint in the warning color (wrapped, not cut, when the language needs more than the column's width).
 */
export function sidebarRail(sidebar: Component, terminal: Terminal, layout?: SidebarLayout): Component {
  return { invalidate() { sidebar.invalidate(); }, handleMouse(event) {
    const own = layout?.railMouse(event);
    if (own) return own;
    return sidebar.handleMouse?.({ ...event, x: event.x - 2, y: event.y - 1, width: Math.max(1, event.width - 4) });
  }, render(width) {
    const inner = Math.max(1, width - 4);
    const content = layout?.isFolding() ? ["", ...wrapTextWithAnsi(layout.releaseHint(), inner).map(warning)] : sidebar.render(inner);
    return Array.from({ length: Math.max(content.length + 2, terminal.rows) }, (_, i) =>
      surface(i === 0 && layout ? layout.hideButtonRow(width) : "  " + fit(content[i - 1] ?? "", Math.max(0, width - 4)) + "  "));
  } };
}

/**
 * The workspace's one row: the chat (which takes what is left), the grip, and the sidebar with the width `layout` says. The sidebar's size is read from `layout` each pass (a getter
 * on its entry), and each pass tells `layout` how many columns the terminal has. Moving the mouse over something that answers nothing clears any hover, which is how the grip and the buttons
 * go back to rest when the pointer leaves them.
 */
class WorkspaceRow extends HStack {
  constructor(chat: Component, grip: Component, sidebar: Component, private readonly layout: SidebarLayout) {
    super([
      { component: chat, basis: 0, grow: 1, minSize: 1, visible: viewport => { layout.observe(viewport.width); return true; } },
      { component: grip, basis: GRIP_WIDTH, minSize: GRIP_WIDTH, maxSize: GRIP_WIDTH, visible: () => layout.isVisible() },
      { component: sidebar, basis: 0, visible: () => layout.isVisible() },
    ], { gap: 0 });
    const entry = this.entries.find(candidate => candidate.component === sidebar)!;
    for (const size of ["basis", "minSize", "maxSize"] as const) Object.defineProperty(entry, size, { enumerable: true, configurable: true, get: () => layout.sidebarWidth() });
  }
  override handleMouse(event: TuiMouseEvent) {
    if (event.type !== "move" || !this.layout.leave()) return undefined;
    return { handled: true as const, render: true, target: { component: this, originX: event.screenX - event.x, originY: event.screenY - event.y, width: event.width, height: event.height } };
  }
}

/**
 * Builds the shared Claude Code and Codex workspace in three columns: the chat column (header, transcript, composer, one breathing row and the two-row status footer, all
 * only as wide as the chat), the two-column grip that drags the sidebar's edge and, from 100 columns of terminal unless the person hid it, the sidebar, which runs down to the last row
 * of the terminal. The widths come from `layout` (36 columns by default, shown): the person drags the grip, or hides and shows the sidebar with the buttons, and the footer and the
 * «jump to latest» pill read the same `layout`. The header starts in the same column as the composer's block (two columns in) and says only «FORGE614 / SHELL», with the «‹ show sidebar»
 * button at its right while the sidebar is hidden: the folder lives in the footer.
 */
export function workspaceLayout(transcriptScroll: Component, composer: Component, sidebar: Component, footer: Component, terminal: Terminal, layout: SidebarLayout = new SidebarLayout({ terminal })): Component {
  const header: Component = { invalidate() {}, handleMouse: event => layout.headerMouse(event), render(width) {
    const margin = width >= 14 ? 2 : 0;
    const title = " ".repeat(margin) + accent("FORGE614") + " / SHELL";
    const button = layout.showButton();
    return [" ".repeat(width), fit(button ? title + " ".repeat(Math.max(1, width - 2 - visibleWidth(title) - visibleWidth(button))) + button : title, width), " ".repeat(width)];
  } };
  const rail = sidebarRail(sidebar, terminal, layout);
  /** A non-empty rendered row is required: pi-tui measures an empty Text component as zero rows. */
  const footerSpacer: Component = { invalidate() {}, render(width) { return [" ".repeat(width)]; } };
  const chat = new VStack([
    header,
    { component: transcriptScroll, basis: 0, grow: 1, minSize: 1 },
    composer,
    { component: footerSpacer, basis: 1, minSize: 1, maxSize: 1 },
    { component: footer, basis: 2, minSize: 2, maxSize: 2 },
  ], { gap: 0 });
  return new WorkspaceRow(chat, layout.grip(), new IndependentScrollView(rail, { follow: "none", scrollbar: "hidden", overscroll: "contain" }), layout);
}
