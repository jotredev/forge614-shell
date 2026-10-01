import { HStack, VStack, ScrollView, visibleWidth } from "@earendil-works/pi-tui";
import type { Component, OverlayHandle, TUI, Terminal, TuiMouseEvent } from "@earendil-works/pi-tui";
import { accent, elevated, fit, foreground, surface, workspaceColors } from "./theme.ts";
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
    const inner = Math.min(Math.max(0, width - 2), visibleWidth(label));
    return [elevated(foreground(fit(label, inner)))];
  }
}

/**
 * Shows the jump-to-latest pill above the composer whenever the transcript has been scrolled away
 * from the newest message, and hides it again once the person is back at the end.
 */
export function attachJumpToLatest(tui: TUI, scroll: IndependentScrollView, locale: Locale = "en"): OverlayHandle {
  return tui.showOverlay(new JumpToLatestButton(() => scroll.scrollToEnd(), locale), {
    // Near the top, not the bottom: a fixed bottom position sits over whatever text happens to be
    // scrolled to the last visible row, which is usually mid-paragraph. Just under the header is
    // reliably clear of chat content, and matches where a "new messages" banner belongs anyway —
    // it points back down to what you're missing, so it reads naturally near the top of your view.
    anchor: "top-center",
    margin: { top: 3 },
    nonCapturing: true,
    visible: () => !scroll.isFollowingEnd,
  });
}

/** Apply a session-local background, restoring the terminal on leaving alternate screen. */
export function workspaceTerminal(terminal: Terminal): Terminal {
  let active = false;
  return new Proxy(terminal, { get(target, key) {
    if (key === "write") return (data: string) => {
      if (data.includes("\x1b[?1049h")) active = true;
      if (data.includes("\x1b[?1049l")) { active = false; target.write("\x1b[0m" + data); return; }
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
 * last row of the terminal (even where its content ends), with no line drawn at its edge. The two columns of gap between it and the chat keep the general background,
 * which is where the contrast comes from. Mouse events reach the sidebar in its own coordinates: two columns and one row in, and four columns narrower.
 */
export function sidebarRail(sidebar: Component, terminal: Terminal): Component {
  return { invalidate() { sidebar.invalidate(); }, handleMouse(event) {
    return sidebar.handleMouse?.({ ...event, x: event.x - 2, y: event.y - 1, width: Math.max(1, event.width - 4) });
  }, render(width) {
    const content = sidebar.render(Math.max(1, width - 4));
    return Array.from({ length: Math.max(content.length + 2, terminal.rows) }, (_, i) => surface("  " + fit(content[i - 1] ?? "", Math.max(0, width - 4)) + "  "));
  } };
}

/**
 * Builds the shared Claude Code and Codex workspace in two columns: the chat column (header, transcript, composer, one breathing row and the two-row status footer, all
 * only as wide as the chat) and, from 100 columns of terminal, the sidebar, which runs down to the last row of the terminal. The header starts in the same column as the
 * composer's block (two columns in) and says only «FORGE614 / SHELL»: the folder lives in the footer.
 */
export function workspaceLayout(transcriptScroll: Component, composer: Component, sidebar: Component, footer: Component, terminal: Terminal): Component {
  const header: Component = { invalidate() {}, render(width) {
    const margin = width >= 14 ? 2 : 0;
    return [" ".repeat(width), fit(" ".repeat(margin) + accent("FORGE614") + " / SHELL", width), " ".repeat(width)];
  } };
  const rail = sidebarRail(sidebar, terminal);
  /** A non-empty rendered row is required: pi-tui measures an empty Text component as zero rows. */
  const footerSpacer: Component = { invalidate() {}, render(width) { return [" ".repeat(width)]; } };
  const chat = new VStack([
    header,
    { component: transcriptScroll, basis: 0, grow: 1, minSize: 1 },
    composer,
    { component: footerSpacer, basis: 1, minSize: 1, maxSize: 1 },
    { component: footer, basis: 2, minSize: 2, maxSize: 2 },
  ], { gap: 0 });
  return new HStack([
    { component: chat, basis: 0, grow: 1, minSize: 1 },
    { component: new IndependentScrollView(rail, { follow: "none", scrollbar: "hidden", overscroll: "contain" }), basis: 36, minSize: 32, maxSize: 42, visible: viewport => viewport.width >= 100 },
  ], { gap: 2 });
}
