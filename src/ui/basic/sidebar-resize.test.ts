import { afterAll, beforeAll, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { Container, resetCapabilitiesCache, setCapabilityOverrides, visibleWidth } from "@earendil-works/pi-tui";
import type { Component, TUI, Terminal, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { getLayoutBoxesAt, renderLayoutFrame } from "../../../node_modules/@earendil-works/pi-tui/dist/layout.js";
import type { LayoutFrame } from "../../../node_modules/@earendil-works/pi-tui/dist/layout.js";
import { IndependentScrollView, attachJumpToLatest, workspaceLayout, workspaceTerminal } from "./workspace.ts";
import { SidebarLayout } from "./sidebar-layout.ts";
import type { SidebarLayoutOptions, SidebarState } from "./sidebar-layout.ts";
import { ShellSidebar } from "./sidebar.ts";
import type { ShellSnapshot } from "./shell-state.ts";
import { ShellStatusBar } from "./status-bar.ts";
import { foreground, warning } from "./theme.ts";
import { getCatalog } from "../../i18n/index.ts";

const plain = (lines: string[]) => lines.map(stripVTControlCharacters);

/** These tests read the exact RGB codes the screen emits, so they pin the color mode instead of taking whatever terminal runs the suite. */
beforeAll(() => setCapabilityOverrides({ trueColor: true }));
afterAll(() => resetCapabilitiesCache());

const FAINT = "38;2;63;63;70";
const ACCENT = "38;2;70;222;224";
const MUTED = "38;2;161;161;170";
const WARNING = "38;2;237;183;88";

/**
 * The text color each visible column of a row is drawn in, read from its escape codes: `38;…` sets it and `39`, `0` or an empty code clears it (`null` is the
 * terminal's own). Every character in these screens is one column wide; pi-tui's hyperlink sequences, which take no column, are left out first.
 */
function foregrounds(row: string): (string | null)[] {
  const columns: (string | null)[] = [];
  let current: string | null = null;
  for (const part of row.replace(/\x1b\]8;;[^\x07]*\x07/g, "").split(/(\x1b\[[0-9;]*m)/)) {
    const code = /^\x1b\[([0-9;]*)m$/.exec(part)?.[1];
    if (code === undefined) { for (const _ of Array.from(part)) columns.push(current); continue; }
    if (code.startsWith("38;")) current = code;
    else if (code === "" || code === "0" || code === "39") current = null;
  }
  return columns;
}

/** The background each visible column of a row is drawn on (`48;…`), read the same way; `null` is the general background. */
function backgrounds(row: string): (string | null)[] {
  const columns: (string | null)[] = [];
  let current: string | null = null;
  for (const part of row.replace(/\x1b\]8;;[^\x07]*\x07/g, "").split(/(\x1b\[[0-9;]*m)/)) {
    const code = /^\x1b\[([0-9;]*)m$/.exec(part)?.[1];
    if (code === undefined) { for (const _ of Array.from(part)) columns.push(current); continue; }
    if (code.startsWith("48;")) current = code;
    else if (code === "" || code === "0" || code === "49") current = null;
  }
  return columns;
}

const empty = { invalidate() {}, render: () => [] as string[] };
const connectedSidebar = () => new ShellSidebar(() => ({ account: "connected", provider: "Claude Code", model: "claude-opus", reasoning: "medium" }));

/**
 * The screen as pi-tui's alternate screen drives it, reduced to what these tests need: the layout is drawn after every event, a mouse event goes to the deepest component
 * under the pointer that handles it (layout containers with the default handler are skipped, as pi-tui does), and a component that answers with `capture` gets the following
 * events in coordinates local to where it was first reached, until the button is released.
 */
class Screen {
  private captured?: { component: Component; originX: number; originY: number; width: number; height: number };
  private frame!: LayoutFrame;
  constructor(private readonly root: Component, readonly columns: number, readonly rows: number) { this.draw(); }
  draw(): LayoutFrame { this.frame = renderLayoutFrame(this.root, this.columns, this.rows, () => {}); return this.frame; }
  get raw(): string[] { return this.frame.lines; }
  get lines(): string[] { return plain(this.frame.lines); }
  /** The widths and left edges of the layout's columns, from left to right: the chat, the grip when there is a sidebar, and the sidebar. */
  get columnBoxes(): { x: number; width: number }[] { return this.frame.root.children.map(box => ({ x: box.rect.x, width: box.rect.width })); }
  send(type: TuiMouseEvent["type"], x: number, y: number): TuiMouseEventResult | undefined {
    const event = { type, button: type === "move" ? "none" : "left", x, y, screenX: x, screenY: y, width: this.columns, height: this.rows, shift: false, alt: false, ctrl: false } as TuiMouseEvent;
    let result: TuiMouseEventResult | undefined;
    if (this.captured) {
      const target = this.captured;
      result = target.component.handleMouse?.({ ...event, x: x - target.originX, y: y - target.originY, width: target.width, height: target.height });
      if (type === "release") this.captured = undefined;
    } else {
      for (const box of getLayoutBoxesAt(this.frame, x, y)) {
        if (box.component.handleMouse === Container.prototype.handleMouse) continue;
        const answer = box.component.handleMouse?.({ ...event, x: x - box.rect.x, y: y - box.rect.y, width: box.rect.width, height: box.rect.height });
        if (!answer || !(answer.handled || answer.capture || answer.focus)) continue;
        result = answer;
        if (answer.capture) this.captured = { component: box.component, originX: box.rect.x, originY: box.rect.y, width: box.rect.width, height: box.rect.height };
        break;
      }
    }
    this.draw();
    return result;
  }
}

/** A workspace on a `columns`×40 terminal that records what is written to the terminal and every state the layout reports as changed. */
function workspace(options: { columns?: number; width?: number; hidden?: boolean; locale?: "es" | "en"; terminal?: Terminal } = {}) {
  const columns = options.columns ?? 120;
  const writes: string[] = [];
  const saves: SidebarState[] = [];
  const terminal = options.terminal ?? ({ rows: 40, columns, write: (data: string) => { writes.push(data); } } as unknown as Terminal);
  const layoutOptions: SidebarLayoutOptions = { terminal, locale: options.locale ?? "en", onChange: state => { saves.push(state); }, ...(options.width === undefined ? {} : { width: options.width }), ...(options.hidden === undefined ? {} : { hidden: options.hidden }) };
  const layout = new SidebarLayout(layoutOptions);
  const screen = new Screen(workspaceLayout(empty, empty, connectedSidebar(), empty, terminal, layout), columns, 40);
  return { screen, layout, writes, saves, terminal };
}

/** The columns of a 120-wide terminal with the default 36-column sidebar: the chat is 82 wide, the grip is columns 82–83 and the sidebar starts at column 84. */
const MIDDLE = 20; // floor(40 / 2): the middle row of a 40-row terminal

/**
 * At rest, with the pointer elsewhere, the two-column grip between the chat and the sidebar shows only a faint «⋮» in its second column on the five rows around the
 * middle row of the terminal, with no background of another color, so nothing looks like a scroll bar. It exists because the owner approved exactly this drawing.
 */
test("the grip at rest is five faint dots around the middle row and nothing else", () => {
  const { screen } = workspace();
  expect(screen.columnBoxes).toEqual([{ x: 0, width: 82 }, { x: 82, width: 2 }, { x: 84, width: 36 }]);
  for (const row of [MIDDLE - 2, MIDDLE - 1, MIDDLE, MIDDLE + 1, MIDDLE + 2]) {
    expect({ row, cells: screen.lines[row]!.slice(82, 84), color: foregrounds(screen.raw[row]!)[83] }).toEqual({ row, cells: " ⋮", color: FAINT });
  }
  for (const row of [0, 1, MIDDLE - 3, MIDDLE + 3, 39]) expect({ row, cells: screen.lines[row]!.slice(82, 84) }).toEqual({ row, cells: "  " });
  for (const [row, line] of screen.raw.entries()) expect({ row, grip: backgrounds(line).slice(82, 84) }).toEqual({ row, grip: [null, null] });
});

/**
 * With the pointer over the grip the middle row reads «◂▸» across both columns and the other four rows keep their «⋮», all in the accent color, and the terminal is
 * asked for the resize pointer (OSC 22 `ew-resize`) once. Moving within the grip asks for nothing more; leaving it gives the pointer back (`default`) and the drawing returns to rest.
 */
test("hovering the grip draws arrows and dots in cyan and asks for the resize pointer; leaving gives it back", () => {
  const { screen, writes } = workspace();
  screen.send("move", 83, MIDDLE);
  expect(screen.lines[MIDDLE]!.slice(82, 84)).toBe("◂▸");
  expect(foregrounds(screen.raw[MIDDLE]!).slice(82, 84)).toEqual([ACCENT, ACCENT]);
  for (const row of [MIDDLE - 2, MIDDLE - 1, MIDDLE + 1, MIDDLE + 2]) {
    expect({ row, cells: screen.lines[row]!.slice(82, 84), color: foregrounds(screen.raw[row]!)[83] }).toEqual({ row, cells: " ⋮", color: ACCENT });
  }
  for (const row of [MIDDLE - 3, MIDDLE + 3]) expect({ row, cells: screen.lines[row]!.slice(82, 84) }).toEqual({ row, cells: "  " });
  expect(writes).toEqual(["\x1b]22;ew-resize\x07"]);
  screen.send("move", 82, MIDDLE - 4);
  expect(writes).toEqual(["\x1b]22;ew-resize\x07"]);
  screen.send("move", 10, 10);
  expect(writes).toEqual(["\x1b]22;ew-resize\x07", "\x1b]22;default\x07"]);
  for (const row of [MIDDLE - 2, MIDDLE - 1, MIDDLE, MIDDLE + 1, MIDDLE + 2]) {
    expect({ row, cells: screen.lines[row]!.slice(82, 84), color: foregrounds(screen.raw[row]!)[83] }).toEqual({ row, cells: " ⋮", color: FAINT });
  }
});

/** Moving from the grip straight onto the sidebar also gives the pointer back, because the sidebar answers the move itself. */
test("moving from the grip onto the sidebar gives the resize pointer back", () => {
  const { screen, writes } = workspace();
  screen.send("move", 83, MIDDLE);
  screen.send("move", 100, 10);
  expect(writes).toEqual(["\x1b]22;ew-resize\x07", "\x1b]22;default\x07"]);
});

/**
 * Pressing on the grip and dragging makes the sidebar's width follow the pointer: the column that was taken stays under it. Taking the grip by its second column (83) and
 * moving to column 73 puts the grip at columns 72–73 and the sidebar 46 wide (120 − 2 − 73 + 1); the chat takes the rest. Nothing is saved until the button is released.
 */
test("dragging the grip resizes the sidebar to the exact width and keeps the taken column under the pointer", () => {
  const { screen, layout, saves } = workspace();
  expect(screen.send("press", 83, MIDDLE)).toEqual({ handled: true, capture: true });
  screen.send("drag", 80, MIDDLE);
  screen.send("drag", 76, MIDDLE);
  screen.send("drag", 73, MIDDLE);
  expect(layout.sidebarWidth()).toBe(46);
  expect(screen.columnBoxes).toEqual([{ x: 0, width: 72 }, { x: 72, width: 2 }, { x: 74, width: 46 }]);
  expect(screen.lines[MIDDLE]!.slice(72, 74)).toBe("◂▸");
  expect(saves).toEqual([]);
  expect(screen.send("release", 73, MIDDLE)).toMatchObject({ handled: true });
  expect(saves).toEqual([{ width: 46, hidden: false }]);
  expect(layout.state()).toEqual({ width: 46, hidden: false });
  expect(screen.columnBoxes).toEqual([{ x: 0, width: 72 }, { x: 72, width: 2 }, { x: 74, width: 46 }]);
});

/** The grip is taken by either of its two columns: the one that was pressed stays under the pointer, so there is no jump when the drag starts and the width follows the offset exactly. */
test("the column taken on press stays under the pointer, with no jump when the drag begins", () => {
  for (const [pressed, gripLeft, width] of [[82, 70, 48], [83, 69, 49]] as const) {
    const { screen, layout } = workspace();
    screen.send("press", pressed, MIDDLE);
    screen.send("drag", pressed, MIDDLE);
    expect({ pressed, width: layout.sidebarWidth() }).toEqual({ pressed, width: 36 });
    screen.send("drag", 70, MIDDLE);
    expect({ pressed, width: layout.sidebarWidth(), grip: screen.columnBoxes[1] }).toEqual({ pressed, width, grip: { x: gripLeft, width: 2 } });
    expect(gripLeft + (pressed - 82)).toBe(70);
  }
});

/** A press and release on the grip without moving changes nothing and saves nothing: it must not overwrite a remembered width the screen is currently too small to show. */
test("pressing the grip and releasing without moving saves nothing and keeps the width", () => {
  const { screen, layout, saves, writes } = workspace({ width: 36 });
  screen.send("press", 82, MIDDLE);
  screen.send("release", 82, MIDDLE);
  expect(saves).toEqual([]);
  expect(layout.state()).toEqual({ width: 36, hidden: false });
  expect(writes).toEqual(["\x1b]22;ew-resize\x07", "\x1b]22;default\x07"]);
  const narrow = workspace({ columns: 100, width: 70 });
  narrow.screen.send("press", 61, MIDDLE);
  narrow.screen.send("release", 61, MIDDLE);
  expect(narrow.saves).toEqual([]);
  expect(narrow.layout.state()).toEqual({ width: 70, hidden: false });
});

/**
 * The width is between 28 and 70, and the chat never has fewer than 60 columns: dragging all the way to the left gives 70 on a 160-column terminal (chat 88), 58 on a
 * 120-column one (chat 60) and 38 on a 100-column one (chat 60); a drag that ends at raw width 24 or more but under 28 gives 28.
 */
test("the width stays between 28 and 70 and the chat keeps at least 60 columns", () => {
  for (const [columns, sidebar, chat] of [[160, 70, 88], [120, 58, 60], [100, 38, 60]] as const) {
    const { screen, layout } = workspace({ columns });
    screen.send("press", columns - 36 - 1, MIDDLE);
    screen.send("drag", 0, MIDDLE);
    expect({ columns, width: layout.sidebarWidth(), chat: screen.columnBoxes[0]!.width }).toEqual({ columns, width: sidebar, chat });
    screen.send("release", 0, MIDDLE);
  }
  for (const [x, width] of [[94, 28], [95, 28]] as const) {
    const { screen, layout, saves } = workspace();
    screen.send("press", 83, MIDDLE);
    screen.send("drag", x, MIDDLE);
    expect({ x, width: layout.sidebarWidth() }).toEqual({ x, width });
    screen.send("release", x, MIDDLE);
    expect(saves).toEqual([{ width: 28, hidden: false }]);
  }
});

/**
 * Dragging below 24 columns draws the sidebar 24 wide with, instead of its content, «release to hide it» in the warning color (Spanish: «suelta para ocultarla», which does not
 * fit the 20 inner columns on one row, so it continues on a second row instead of being cut); releasing there hides the sidebar and remembers the width it had.
 */
test("dragging below 24 columns shows the release hint and releasing there hides the sidebar", () => {
  const { screen, layout, saves } = workspace();
  screen.send("press", 83, MIDDLE);
  screen.send("drag", 95, MIDDLE);
  expect(layout.sidebarWidth()).toBe(28);
  screen.send("drag", 96, MIDDLE);
  expect(layout.sidebarWidth()).toBe(24);
  expect(screen.columnBoxes).toEqual([{ x: 0, width: 94 }, { x: 94, width: 2 }, { x: 96, width: 24 }]);
  const hint = screen.lines.findIndex(line => line.includes("release to hide it"));
  expect(hint).toBe(2);
  expect(screen.lines[hint]!.slice(96).trimEnd()).toBe("  release to hide it");
  expect(foregrounds(screen.raw[hint]!)[100]).toBe(WARNING);
  expect(screen.lines.join("\n")).not.toContain("SESSION");
  expect(saves).toEqual([]);
  screen.send("release", 96, MIDDLE);
  expect(saves).toEqual([{ width: 36, hidden: true }]);
  expect(layout.isVisible()).toBe(false);
  expect(screen.columnBoxes).toEqual([{ x: 0, width: 120 }]);

  const spanish = workspace({ locale: "es" });
  spanish.screen.send("press", 83, MIDDLE);
  spanish.screen.send("drag", 100, MIDDLE);
  expect(spanish.screen.lines.slice(2, 4).map(line => line.slice(96).trim())).toEqual(["suelta para", "ocultarla"]);
  expect(foregrounds(spanish.screen.raw[2]!)[100]).toBe(WARNING);
  expect(foregrounds(spanish.screen.raw[3]!)[100]).toBe(WARNING);
});

/** The width the sidebar had survives being hidden and shown again: hiding by dragging, then clicking «show sidebar», brings back the 46 columns it was last dragged to. */
test("showing the sidebar again brings back the last width", () => {
  const { screen, layout, saves } = workspace();
  screen.send("press", 83, MIDDLE); screen.send("drag", 73, MIDDLE); screen.send("release", 73, MIDDLE);
  screen.send("press", 73, MIDDLE); screen.send("drag", 110, MIDDLE); screen.send("release", 110, MIDDLE);
  expect(saves).toEqual([{ width: 46, hidden: false }, { width: 46, hidden: true }]);
  expect(screen.columnBoxes).toEqual([{ x: 0, width: 120 }]);
  screen.send("click", 110, 1);
  expect(saves.at(-1)).toEqual({ width: 46, hidden: false });
  expect(layout.sidebarWidth()).toBe(46);
  expect(screen.columnBoxes).toEqual([{ x: 0, width: 72 }, { x: 72, width: 2 }, { x: 74, width: 46 }]);
});

/**
 * Pressing on the grip is answered with `handled` and `capture`: handled so the screen does not start a text selection under the press, and capture so the drag and
 * the release keep coming to the grip wherever the pointer goes. It exists because a drag that left the grip used to be able to turn into a selection of the chat.
 */
test("a press on the grip captures the drag and starts no text selection", () => {
  const { screen } = workspace();
  expect(screen.send("press", 82, MIDDLE)).toEqual({ handled: true, capture: true });
  expect(screen.send("drag", 5, 3)).toMatchObject({ handled: true });
  expect(screen.send("release", 5, 3)).toMatchObject({ handled: true });
});

/**
 * While the grip is held the terminal has the resize pointer, from the press until the button is released (also when the pointer left the grip's two columns), and gets it back
 * on release; nothing is saved by the moves in between, only once by the release.
 */
test("the resize pointer stays while dragging and is given back on release, and the width is saved once, on release", () => {
  const { screen, saves, writes } = workspace();
  screen.send("move", 83, MIDDLE);
  screen.send("press", 83, MIDDLE);
  for (const x of [80, 77, 74, 71, 68]) { screen.send("drag", x, MIDDLE); expect({ x, saves: saves.length }).toEqual({ x, saves: 0 }); }
  expect(writes).toEqual(["\x1b]22;ew-resize\x07"]);
  screen.send("release", 68, MIDDLE);
  expect(writes).toEqual(["\x1b]22;ew-resize\x07", "\x1b]22;default\x07"]);
  expect(saves).toEqual([{ width: 51, hidden: false }]);
});

/** The two buttons are real clicks: «hide ›» in the sidebar's first row hides it, and «‹ show sidebar» on the header row shows it again with the same width. Beside the label, nothing happens. */
test("the hide button hides the sidebar with a click and the show button brings it back", () => {
  const { screen, layout, saves } = workspace();
  expect(screen.lines[0]!.slice(112, 118)).toBe("hide ›");
  expect(screen.lines[0]!.slice(118)).toBe("  ");
  screen.send("click", 111, 0);
  screen.send("click", 118, 0);
  screen.send("click", 114, 1);
  expect(saves).toEqual([]);
  expect(screen.send("click", 114, 0)).toMatchObject({ handled: true });
  expect(saves).toEqual([{ width: 36, hidden: true }]);
  expect(layout.isVisible()).toBe(false);
  expect(screen.columnBoxes).toEqual([{ x: 0, width: 120 }]);
  expect(screen.lines[1]!.slice(104, 118)).toBe("‹ show sidebar");
  expect(screen.lines[1]!.slice(0, 20)).toBe("  FORGE614 / SHELL  ");
  screen.send("click", 103, 1);
  expect(saves).toHaveLength(1);
  expect(screen.send("click", 110, 1)).toMatchObject({ handled: true });
  expect(saves).toEqual([{ width: 36, hidden: true }, { width: 36, hidden: false }]);
  expect(screen.columnBoxes).toEqual([{ x: 0, width: 82 }, { x: 82, width: 2 }, { x: 84, width: 36 }]);
});

/** Both buttons are in the secondary gray and turn cyan with the pointer over them (and back when it leaves), without asking for the resize pointer. */
test("both buttons are muted and turn cyan under the pointer", () => {
  const shown = workspace();
  expect(foregrounds(shown.screen.raw[0]!)[112]).toBe(MUTED);
  shown.screen.send("move", 114, 0);
  expect(foregrounds(shown.screen.raw[0]!)[112]).toBe(ACCENT);
  shown.screen.send("move", 114, 5);
  expect(foregrounds(shown.screen.raw[0]!)[112]).toBe(MUTED);
  expect(shown.writes).toEqual([]);

  const hidden = workspace({ hidden: true });
  expect(foregrounds(hidden.screen.raw[1]!)[104]).toBe(MUTED);
  hidden.screen.send("move", 110, 1);
  expect(foregrounds(hidden.screen.raw[1]!)[104]).toBe(ACCENT);
  hidden.screen.send("move", 50, 20);
  expect(foregrounds(hidden.screen.raw[1]!)[104]).toBe(MUTED);
  expect(hidden.writes).toEqual([]);
});

/** The buttons read in the person's language: «ocultar ›» and «‹ mostrar barra», right-aligned with two columns of margin like the English ones. */
test("the buttons are written in Spanish with the Spanish catalog", () => {
  const shown = workspace({ locale: "es" });
  expect(shown.screen.lines[0]!.slice(109, 118)).toBe("ocultar ›");
  const hidden = workspace({ locale: "es", hidden: true });
  expect(hidden.screen.lines[1]!.slice(103, 118)).toBe("‹ mostrar barra");
});

/** Under 100 columns the sidebar hides itself as before and there is no show button, hidden by the person or not; the header keeps only its title. */
test("under 100 columns the sidebar is hidden by itself and no show button appears", () => {
  for (const hidden of [false, true]) {
    const { screen, layout, saves } = workspace({ columns: 99, hidden });
    expect(screen.columnBoxes).toEqual([{ x: 0, width: 99 }]);
    expect(screen.lines[1]!.trimEnd()).toBe("  FORGE614 / SHELL");
    expect(screen.send("click", 90, 1)).toBeUndefined();
    expect(saves).toEqual([]);
    expect(layout.isVisible()).toBe(false);
  }
  expect(workspace({ columns: 100 }).screen.columnBoxes).toEqual([{ x: 0, width: 62 }, { x: 62, width: 2 }, { x: 64, width: 36 }]);
});

/**
 * Closing the screen gives the pointer back too: if the resize pointer was asked for and the screen leaves its alternate screen without the pointer having left the grip,
 * the write that leaves it first restores `default`; with no pointer asked for, that write is exactly what it was.
 */
test("closing the screen restores the pointer only when the resize one was asked for", () => {
  for (const hover of [true, false]) {
    const out: string[] = [];
    const base = { rows: 40, columns: 120, write: (data: string) => { out.push(data); } } as unknown as Terminal;
    const surface = workspaceTerminal(base);
    surface.write("\x1b[?1049h");
    const { screen } = workspace({ terminal: surface });
    if (hover) screen.send("move", 83, MIDDLE);
    surface.write("\x1b[?1049l");
    expect({ hover, last: out.at(-1) }).toEqual({ hover, last: hover ? "\x1b]22;default\x07\x1b[0m\x1b[?1049l" : "\x1b[0m\x1b[?1049l" });
    if (hover) expect(out.join("")).toContain("\x1b]22;ew-resize\x07");
  }
});

/** The «jump to latest» pill is centered over the chat column, not the whole terminal: with a 36-column sidebar the chat is 82 wide, with a 50-column one 68, and with the sidebar hidden it is the whole 120. */
test("the jump-to-latest pill is centered over the chat column and follows the sidebar's width", () => {
  const label = visibleWidth(getCatalog("en").jumpToLatest.label);
  for (const [options, chat] of [[{ width: 36 }, 82], [{ width: 50 }, 68], [{ hidden: true }, 120]] as const) {
    const { screen, layout } = workspace(options);
    const content = { render: () => Array(50).fill("line") as string[], invalidate() {} };
    const scroll = new IndependentScrollView(content, { follow: "end", primary: true, scrollbar: "hidden" });
    let shown: { component: Component; options?: { col?: number; width?: number; visible?: () => boolean } } | undefined;
    const fakeTui = { showOverlay: (component: Component, overlay?: { col?: number; width?: number }) => { shown = { component, options: overlay }; return { hide() {}, setHidden() {}, isHidden: () => false, focus() {}, unfocus() {}, isFocused: () => false, getBounds: () => undefined }; } } as unknown as TUI;
    attachJumpToLatest(fakeTui, scroll, "en", layout);
    expect({ chat, chatWidth: screen.columnBoxes[0]!.width, width: shown!.options!.width, col: shown!.options!.col }).toEqual({ chat, chatWidth: chat, width: label, col: Math.floor((chat - label) / 2) });
  }
});

/**
 * The bottom bar carries what the sidebar would show when the sidebar is not on screen: the model (normal text), the reasoning (the warning color, the same value the sidebar
 * shows) and the context percentage (normal text), right after «F614» and before the folder, separated with « · ». It exists because hiding the sidebar must not hide where the
 * conversation is.
 */
test("with no sidebar the footer shows model, reasoning and context right after F614", () => {
  const snapshot: ShellSnapshot = { account: "connected", provider: "Claude Code", model: "Opus 5.5", reasoning: "high", context: { used: 68_000, window: 200_000 } };
  const bar = (visible: () => boolean, locale: "es" | "en" = "en", state: ShellSnapshot = snapshot) => new ShellStatusBar(() => state, "/Users/forge/project", () => ({ path: "/p", git: true, branch: "main", changedFiles: 0 }), "/Users/forge", undefined, locale, visible);
  const row = bar(() => false).render(100)[0]!;
  expect(stripVTControlCharacters(row).trimEnd()).toBe("  F614 · Opus 5.5 · high · context 34% · ~/project · main · Clean");
  expect(row).toContain(foreground("Opus 5.5"));
  expect(row).toContain(warning("high"));
  expect(row).toContain(foreground("context 34%"));
  expect(stripVTControlCharacters(bar(() => false, "es").render(100)[0]!).trimEnd()).toBe("  F614 · Opus 5.5 · high · contexto 34 % · ~/project · main · Limpio");
  // What is not known is not represented.
  expect(stripVTControlCharacters(bar(() => false, "en", { account: "connected", provider: "Claude Code", reasoning: "high" }).render(100)[0]!).trimEnd()).toBe("  F614 · high · ~/project · main · Clean");
  expect(stripVTControlCharacters(bar(() => false, "en", { account: "connected", provider: "Claude Code" }).render(100)[0]!).trimEnd()).toBe("  F614 · ~/project · main · Clean");
  expect(stripVTControlCharacters(bar(() => false, "en", { account: "disconnected", provider: "Claude Code", model: "Opus 5.5" }).render(100)[0]!).trimEnd()).toBe("  F614 · Disconnected · /login · ~/project · main · Clean");
  // Too narrow: cut with «…» like the rest of the row.
  const cut = bar(() => false).render(30)[0]!;
  expect(stripVTControlCharacters(cut)).toBe("  F614 · Opus 5.5 · high · …");
  expect(visibleWidth(cut)).toBeLessThanOrEqual(30);
  // With the sidebar on screen none of the three is repeated.
  for (const visible of [() => true, undefined]) {
    const shown = stripVTControlCharacters((visible ? bar(visible) : new ShellStatusBar(() => snapshot, "/Users/forge/project", undefined, "/Users/forge")).render(100)[0]!);
    for (const repeated of ["Opus 5.5", "high", "context", "34%"]) expect({ visible: Boolean(visible), repeated, found: shown.includes(repeated) }).toEqual({ visible: Boolean(visible), repeated, found: false });
  }
});

/** In the assembled screen the three data move to the footer exactly when the sidebar is not drawn: hidden by the person, or the terminal under 100 columns; with the sidebar on screen the footer does not repeat them. */
test("the footer takes the data when the sidebar is hidden or the terminal is narrow, and not otherwise", () => {
  const snapshot = () => ({ account: "connected" as const, provider: "Claude Code", model: "Opus 5.5", reasoning: "high", context: { used: 68_000, window: 200_000 } });
  const footerRow = (columns: number, hidden: boolean) => {
    const terminal = { rows: 40, columns, write: () => {} } as unknown as Terminal;
    const layout = new SidebarLayout({ terminal, locale: "en", hidden });
    const footer = new ShellStatusBar(snapshot, "/Users/forge/project", () => ({ path: "/p", git: true, branch: "main", changedFiles: 0 }), "/Users/forge", undefined, "en", () => layout.isVisible());
    const sidebar = new ShellSidebar(snapshot);
    const screen = new Screen(workspaceLayout(empty, empty, sidebar, footer, terminal, layout), columns, 40);
    return screen.lines.find(line => line.includes("F614 ·"))!.trimEnd();
  };
  expect(footerRow(120, false)).toBe("  F614 · ~/project · main · Clean");
  expect(footerRow(120, true)).toBe("  F614 · Opus 5.5 · high · context 34% · ~/project · main · Clean");
  expect(footerRow(99, false)).toBe("  F614 · Opus 5.5 · high · context 34% · ~/project · main · Clean");
});
