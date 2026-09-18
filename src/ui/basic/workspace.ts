import { HStack, VStack, ScrollView, Text } from "@earendil-works/pi-tui";
import type { Component, Terminal, TuiMouseEvent } from "@earendil-works/pi-tui";
import { basename } from "node:path";
import { accent, border, fit, muted } from "./theme.ts";

// Pi currently forwards residual wheel movement to the primary view even
// with overscroll=contain. Consume the residual at this independent pane.
export class IndependentScrollView extends ScrollView {
  private target?: number;
  private maximum = 0;
  private frame?: ReturnType<typeof setTimeout>;
  override updateLayout(contentHeight: number, viewportHeight: number, render: () => void): void {
    super.updateLayout(contentHeight, viewportHeight, render);
    this.maximum = Math.max(0, contentHeight - viewportHeight);
    if (this.target !== undefined) this.target = Math.min(this.target, this.maximum);
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

/** Apply a session-local background, restoring the terminal on leaving alternate screen. */
export function workspaceTerminal(terminal: Terminal): Terminal {
  let active = false;
  const colors = "\x1b[48;2;12;19;24m\x1b[38;2;220;230;235m";
  return new Proxy(terminal, { get(target, key) {
    if (key === "write") return (data: string) => {
      if (data.includes("\x1b[?1049h")) active = true;
      if (data.includes("\x1b[?1049l")) { active = false; target.write("\x1b[0m" + data); return; }
      target.write(active ? colors + data.replace(/\x1b\[0m/g, "\x1b[0m" + colors) : data);
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

export function workspaceLayout(transcript: Component, composer: Component, sidebar: Component, footer: Component, terminal: Terminal, cwd: string): Component {
  const header: Component = { invalidate() {}, render(width) {
    const title = accent("FORGE614") + " / SHELL";
    const location = basename(cwd);
    const line = width >= 40 ? fit(" " + title, Math.max(1, width - location.length - 3)) + muted(location) + "  " : " " + title;
    return [" ".repeat(width), fit(line, width), border("─".repeat(width))];
  } };
  const rail: Component = { invalidate() { sidebar.invalidate(); }, handleMouse(event) {
    return sidebar.handleMouse?.({ ...event, x: event.x - 3, y: event.y - 1, width: Math.max(1, event.width - 5) });
  }, render(width) {
    const content = sidebar.render(Math.max(1, width - 5));
    return Array.from({ length: Math.max(content.length + 2, terminal.rows - 1) }, (_, i) => border("│") + "  " + fit(content[i - 1] ?? "", Math.max(0, width - 5)) + "  ");
  } };
  const left = new VStack([
    header,
    { component: new IndependentScrollView(transcript, { follow: "end", primary: true, scrollbar: "hidden" }), basis: 0, grow: 1, minSize: 1 },
    composer,
    new Text("", 0, 0),
  ], { gap: 0 });
  const body = new HStack([
    { component: left, basis: 0, grow: 1, minSize: 1 },
    { component: new IndependentScrollView(rail, { follow: "none", scrollbar: "hidden", overscroll: "contain" }), basis: 36, minSize: 32, maxSize: 42, visible: viewport => viewport.width >= 100 },
  ], { gap: 2 });
  return new VStack([
    { component: body, basis: 0, grow: 1, minSize: 1 },
    { component: footer, basis: 2, minSize: 2, maxSize: 2 },
  ]);
}
