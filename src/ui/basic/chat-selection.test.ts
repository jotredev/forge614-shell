import { afterAll, beforeAll, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { Container, resetCapabilitiesCache, setCapabilityOverrides } from "@earendil-works/pi-tui";
import type { Component, Terminal, TuiMouseEvent } from "@earendil-works/pi-tui";
import { renderLayoutFrame } from "../../../node_modules/@earendil-works/pi-tui/dist/layout.js";
import { ChatLinks } from "./chat-links.ts";
import type { ChatLinkTools } from "./chat-links.ts";
import { ChatText } from "./theme.ts";
import { IndependentScrollView, attachJumpToLatest, chatScreen, workspaceLayout } from "./workspace.ts";
import { SidebarLayout } from "./sidebar-layout.ts";
import { ShellSidebar } from "./sidebar.ts";
import { StatusPanels, attachStatusPanels } from "./status-panel.ts";
import { getCatalog } from "../../i18n/index.ts";

beforeAll(() => setCapabilityOverrides({ trueColor: true, hyperlinks: true }));
afterAll(() => resetCapabilitiesCache());

const tick = () => new Promise(resolve => setTimeout(resolve, 25));
const COLUMNS = 120;
const ROWS = 30;
/** The chat is 82 columns of the 120 (the sidebar takes 36 and the grip 2), so the sidebar's column starts at 84. */
const SIDEBAR_COLUMN = 84;
/** The transcript's rows start under the three-row header; `scrollTo(TOP)` makes the first row on screen be `Row 040`. */
const TOP = 40;
const FIRST_ROW_Y = 3;
const pill = getCatalog("en").jumpToLatest.label;

class TestTerminal implements Terminal {
  kittyProtocolActive = false; output = "";
  input: (data: string) => void = () => {};
  resize: () => void = () => {};
  constructor(public columns: number, public rows: number) {}
  start(input: (data: string) => void, resize: () => void) { this.input = input; this.resize = resize; }
  stop() {} async drainInput() {} write(data: string) { this.output += data; }
  moveBy() {} hideCursor() {} showCursor() {} clearLine() {} clearFromCursor() {} clearScreen() {} setTitle() {} setProgress() {}
}

/** One transcript row, as the tests write them: `Row 042 alpha beta gamma 42`, so every row has its own number to tell it apart by. */
const rowText = (n: number) => `Row ${String(n).padStart(3, "0")} alpha beta gamma ${n}`;

/** A transcript that is just numbered rows; `count` can be raised later to simulate the assistant writing more. */
class Rows implements Component {
  constructor(public count = 120) {}
  invalidate() {}
  render(): string[] { return Array.from({ length: this.count }, (_, index) => rowText(index)); }
}

/** The writing box as the layout sees it: it answers (consumes) the left button's press, drag and release, like the real one. */
const composer: Component = {
  invalidate() {},
  handleMouse: (event: TuiMouseEvent) => event.button === "left" && ["press", "drag", "release"].includes(event.type) ? { handled: true as const } : undefined,
  render: width => ["Write here", "          ", "          "].map(line => line.padEnd(width)),
};
const footer: Component = { invalidate() {}, render: width => [" ".repeat(width), " ".repeat(width)] };

/**
 * The whole chat screen as Codex and Claude Code assemble it — the real alternate screen, layout, «jump to latest» pill and bottom bar's panels — over a fake terminal that is given real
 * SGR mouse sequences (the same harness as `chat-links.test.ts`, plus the pill, the panels, a writing box that answers the mouse and a resizable terminal). `copies()` is what the screen
 * asked the terminal to copy (OSC 52, decoded); `selected()` copies the current selection and returns exactly its text.
 */
function chat(tools?: ChatLinkTools) {
  const terminal = new TestTerminal(COLUMNS, ROWS);
  const opened: string[] = [];
  const links = new ChatLinks({ cwd: process.cwd(), home: process.cwd(), tools: tools ?? { openWeb: async url => { opened.push(url); return true; }, openPath: async () => true }, onFailure: () => {}, nonce: "test-nonce" });
  const panels = new StatusPanels({ mcp: () => [{ name: "forge614-engram", state: "connected" }], forge614: () => ({}) }, "en");
  const { surface, tui } = chatScreen(terminal, links, panels);
  const layout = new SidebarLayout({ terminal: surface });
  links.pointerHeldElsewhere = () => layout.holdsPointer();
  const rows = new Rows();
  const transcript = new Container();
  transcript.addChild(rows);
  const scroll = new IndependentScrollView(transcript, { follow: "end", primary: true, scrollbar: "hidden" });
  const root = workspaceLayout(scroll, composer, new ShellSidebar(() => ({ account: "connected", provider: "Claude Code" })), footer, surface, layout);
  tui.setLayoutRoot(root);
  attachJumpToLatest(tui, scroll, "en", layout);
  attachStatusPanels(tui, panels, { chatWidth: () => layout.chatWidth() });
  tui.start();
  const copies = () => [...terminal.output.matchAll(/\x1b\]52;c;([A-Za-z0-9+/=]*)\x07/g)].map(match => Buffer.from(match[1]!, "base64").toString());
  const screen = {
    terminal, tui, scroll, layout, panels, rows, transcript, links, opened, copies,
    plain: () => renderLayoutFrame(root, terminal.columns, terminal.rows, () => {}).lines.map(stripVTControlCharacters),
    at: (text: string) => { const lines = screen.plain(); const y = lines.findIndex(line => line.includes(text)); if (y < 0) throw new Error(`"${text}" is not on screen:\n${lines.join("\n")}`); return { x: lines[y]!.indexOf(text), y }; },
    /** Where the numbered row `n` is on screen, when it is. */
    rowY: (n: number) => screen.at(rowText(n).slice(0, 7)).y,
    send: async (type: "move" | "press" | "release" | "drag" | "up" | "down", x: number, y: number) => {
      const button = { move: 35, press: 0, release: 0, drag: 32, up: 64, down: 65 }[type];
      terminal.input(`\x1b[<${button};${x + 1};${y + 1}${type === "release" ? "m" : "M"}`); await tick();
    },
    /** Lets the wheel's eased scrolling finish: waits until the scroll position stays the same. */
    settle: async () => { let last = -1; for (let i = 0; i < 40; i++) { await tick(); if (scroll.scrollTop === last) { await tick(); if (scroll.scrollTop === last) return; } last = scroll.scrollTop; } },
    /** Scrolls the transcript so `Row 040` is the first on screen (and the pill is showing). */
    scrollUp: async () => { scroll.scrollTo(TOP); tui.requestRender(); await tick(); },
    /** Press at `from`, drag to `to` and release there. */
    select: async (from: { x: number; y: number }, to: { x: number; y: number }) => {
      await screen.send("press", from.x, from.y); await screen.send("drag", (from.x + to.x) >> 1, (from.y + to.y) >> 1); await screen.send("drag", to.x, to.y); await screen.send("release", to.x, to.y);
    },
    /** Copies whatever is selected right now and returns exactly that text (undefined when nothing is). */
    selected: async () => { const before = copies().length; const ok = await tui.copyActiveSelectionToClipboard(); return ok ? copies().slice(before).at(-1) : undefined; },
    stop: () => tui.stop({ preserveScreen: true }),
  };
  return screen;
}

/** The text of a selection from `startRow` at column `startCol` to `endRow` at column `endCol` (inclusive), as the screen copies it: the first row from its column, whole rows between, the last up to its column. */
function between(startRow: number, startCol: number, endRow: number, endCol: number): string {
  const lines: string[] = [];
  for (let row = startRow; row <= endRow; row++) lines.push(rowText(row).slice(row === startRow ? startCol : 0, row === endRow ? endCol + 1 : undefined).trimEnd());
  return lines.join("\n");
}

/** The pill is showing: it is shown only while the transcript is scrolled away from its end, and `plain()` does not draw overlays, so what the terminal was last given is checked too. */
const pillShowing = (screen: ReturnType<typeof chat>) => !screen.scroll.isFollowingEnd && stripVTControlCharacters(screen.terminal.output).includes(pill.trim());
/** Where the pill is on screen: its row is the third under the top, and it is centered over the chat's column. */
const pillSpot = (screen: ReturnType<typeof chat>) => ({ x: Math.floor((screen.layout.chatWidth() - pill.length) / 2) + 3, y: 3 });

// ── The selection stays on its text while the screen scrolls ─────────────────────────────────

/**
 * With the «jump to latest» pill showing (the chat was scrolled up to read), a selection made with the mouse over some words of one row stays on those words when the wheel is turned afterwards.
 * It exists because the pill is an overlay, and pi-tui used to pin the selection to the screen's rows whenever any overlay was visible, so after the wheel the same screen rows held other text.
 */
test("with the pill showing, a selection keeps its text when the wheel is turned afterwards", async () => {
  const screen = chat();
  try {
    await tick(); await screen.scrollUp();
    expect(pillShowing(screen)).toBe(true);
    const at = screen.rowY(44);
    await screen.select({ x: 4, y: at }, { x: 19, y: at });
    expect(screen.copies()).toEqual([between(44, 4, 44, 19)]);
    expect(await screen.selected()).toBe("044 alpha beta g");
    for (let i = 0; i < 5; i++) await screen.send("down", 20, 10);
    await screen.settle();
    expect(screen.scroll.scrollTop).toBe(TOP + 5);
    expect(await screen.selected()).toBe("044 alpha beta g");
    for (let i = 0; i < 9; i++) await screen.send("up", 20, 10);
    await screen.settle();
    expect(screen.scroll.scrollTop).toBe(TOP - 4);
    expect(await screen.selected()).toBe("044 alpha beta g");
  } finally { screen.stop(); }
});

/** The same over several rows: what is selected is exactly the same text after the wheel, and the first copy, at release, already has it. */
test("with the pill showing, a selection over several rows keeps its text when the wheel is turned afterwards", async () => {
  const screen = chat();
  try {
    await tick(); await screen.scrollUp();
    const start = screen.rowY(44); const end = screen.rowY(46);
    await screen.select({ x: 4, y: start }, { x: 9, y: end });
    expect(screen.copies()).toEqual([between(44, 4, 46, 9)]);
    for (let i = 0; i < 5; i++) await screen.send("down", 20, 10);
    await screen.settle();
    expect(await screen.selected()).toBe(between(44, 4, 46, 9));
  } finally { screen.stop(); }
});

/**
 * Turning the wheel while the button is still down and then letting go copies from the word where the selection began, also the rows that already went out of sight, up to the text that
 * is under the pointer when the button is released.
 */
test("turning the wheel with the button down copies from where it began, including the rows that scrolled out of sight", async () => {
  const screen = chat();
  try {
    await tick(); await screen.scrollUp();
    expect(pillShowing(screen)).toBe(true);
    const start = screen.rowY(42);
    await screen.send("press", 2, start); await screen.send("drag", 9, start + 4);
    for (let i = 0; i < 8; i++) await screen.send("down", 9, start + 4);
    await screen.settle();
    expect(screen.scroll.scrollTop).toBe(TOP + 8);
    expect(screen.plain().some(line => line.includes(rowText(42)))).toBe(false); // where the selection began is no longer on screen
    expect(screen.copies()).toEqual([]);
    await screen.send("release", 9, start + 4);
    expect(screen.copies()).toEqual([between(42, 2, 54, 9)]);
  } finally { screen.stop(); }
});

/**
 * Over several rows the selection takes only the chat's columns: the sidebar's text, which is on the same screen rows, is not highlighted and not copied. It exists because a selection
 * pinned to the screen took every row between the first and last whole, from the left edge to the right one.
 */
test("with the pill showing, a selection over several rows takes no column of the sidebar", async () => {
  const screen = chat();
  try {
    await tick(); await screen.scrollUp();
    const top = screen.rowY(42); const bottom = screen.rowY(46);
    expect(screen.plain().slice(top, bottom + 1).filter(row => row.slice(SIDEBAR_COLUMN).trim() !== "").length).toBeGreaterThan(1); // the rows do have sidebar text, so the check below says something
    await screen.select({ x: 4, y: top }, { x: 9, y: bottom });
    expect(screen.copies()).toEqual([between(42, 4, 46, 9)]);
    for (let i = 0; i < 3; i++) await screen.send("down", 20, 10);
    await screen.settle();
    const text = await screen.selected();
    expect(text).toBe(between(42, 4, 46, 9));
    for (const line of screen.plain().map(row => row.slice(SIDEBAR_COLUMN).trim()).filter(Boolean)) expect(text!.includes(line)).toBe(false);
  } finally { screen.stop(); }
});

// ── What counts as a window over the chat ────────────────────────────────────────────────────

/**
 * Only the pill is left out when asking whether a window is over the chat: with the panel of the bottom bar open pi-tui is still told there is one, and the first click outside it
 * closes it, as before, without starting a selection.
 */
test("the bottom bar's panel still counts as a window and the first click outside closes it", async () => {
  const screen = chat();
  try {
    await tick();
    expect(screen.tui.hasOverlay()).toBe(false);
    await screen.scrollUp();
    expect(pillShowing(screen)).toBe(true);
    expect(screen.tui.hasOverlay()).toBe(false); // the pill alone is not a window for the selection
    screen.panels.toggle("mcp"); await tick();
    expect(screen.tui.hasOverlay()).toBe(true);
    const at = screen.rowY(44);
    await screen.send("press", 4, at); await screen.send("drag", 12, at); await screen.send("release", 12, at);
    expect(screen.panels.current()).toBeUndefined();
    expect(screen.tui.hasActiveSelection()).toBe(false);
    expect(screen.copies()).toEqual([]);
    expect(screen.tui.hasOverlay()).toBe(false);
    screen.panels.toggle("mcp"); await tick();
    expect(screen.tui.hasOverlay()).toBe(true);
    screen.scroll.scrollToEnd(); screen.panels.toggle("mcp"); await tick(); // closing it and being at the end: nothing counts
    expect(screen.tui.hasOverlay()).toBe(false);
  } finally { screen.stop(); }
});

// ── Letting go over something that answers the mouse ─────────────────────────────────────────

/**
 * Letting go of the button over the sidebar or over the writing box ends the selection all the same and copies what was selected in the chat up to where it got; the selection is no longer
 * held, so a movement afterwards, even a drag with no press, does not change it. It exists because those two answer the release themselves, and pi-tui never saw it: nothing was copied and the
 * selection stayed «pressed» and followed the next movement.
 */
test("letting go over the sidebar or over the writing box copies what was selected and ends the selection", async () => {
  for (const target of [{ name: "sidebar", x: 100, y: 7 }, { name: "writing box", x: 10, y: 25 }]) {
    const screen = chat();
    try {
      await tick(); await screen.scrollUp();
      const start = screen.rowY(42); const end = screen.rowY(44);
      await screen.send("press", 4, start); await screen.send("drag", 9, end);
      await screen.send("drag", target.x, target.y);
      expect([target.name, screen.copies()]).toEqual([target.name, []]);
      await screen.send("release", target.x, target.y);
      expect([target.name, screen.copies()]).toEqual([target.name, [between(42, 4, 44, 9)]]);
      expect([target.name, await screen.selected()]).toEqual([target.name, between(42, 4, 44, 9)]);
      await screen.send("move", 30, FIRST_ROW_Y + 12); await screen.send("drag", 30, FIRST_ROW_Y + 12); await screen.send("drag", 5, FIRST_ROW_Y + 15);
      expect([target.name, await screen.selected()]).toEqual([target.name, between(42, 4, 44, 9)]);
      expect([target.name, screen.copies().length]).toEqual([target.name, 3]); // the one at release and the two asked for by the test
    } finally { screen.stop(); }
  }
});

// ── A change of the chat's width ─────────────────────────────────────────────────────────────

/**
 * When the chat's width changes — the terminal is made narrower or the sidebar's width changes — a live selection is removed, because the text would be laid out again and the selection would
 * no longer be over the same words. The assistant writing more, which only makes the chat longer at the bottom, does not remove it.
 */
test("a change of the chat's width removes the selection, and the chat growing downwards does not", async () => {
  const screen = chat();
  try {
    await tick(); await screen.scrollUp();
    const start = screen.rowY(42); const end = screen.rowY(44);
    await screen.select({ x: 4, y: start }, { x: 9, y: end });
    expect(await screen.selected()).toBe(between(42, 4, 44, 9));
    screen.rows.count = 160; screen.transcript.invalidate(); screen.tui.requestRender(); await tick(); // a new message
    expect(pillShowing(screen)).toBe(true);
    expect(await screen.selected()).toBe(between(42, 4, 44, 9));
    screen.terminal.columns = 110; screen.terminal.resize(); await tick();
    expect(screen.tui.hasActiveSelection()).toBe(false);
    expect(await screen.selected()).toBeUndefined();
    // A selection made again at the new width is kept, and then so is the sidebar changing its width.
    await screen.select({ x: 4, y: screen.rowY(42) }, { x: 9, y: screen.rowY(44) });
    expect(await screen.selected()).toBe(between(42, 4, 44, 9));
    screen.layout.hide(); screen.tui.requestRender(); await tick();
    expect(screen.tui.hasActiveSelection()).toBe(false);
    screen.layout.show(); screen.tui.requestRender(); await tick();
    await screen.select({ x: 4, y: screen.rowY(42) }, { x: 9, y: screen.rowY(44) });
    expect(await screen.selected()).toBe(between(42, 4, 44, 9));
    screen.terminal.columns = 130; screen.terminal.resize(); await tick();
    expect(screen.tui.hasActiveSelection()).toBe(false);
  } finally { screen.stop(); }
});

// ── What does not change ─────────────────────────────────────────────────────────────────────

/** With the pill showing, a click on a link in the chat still opens it, and a click on the pill still takes the chat to its end (and does not start a selection). */
test("with the pill showing, a click on a link still opens it and a click on the pill still goes to the end", async () => {
  const screen = chat();
  try {
    await tick();
    screen.transcript.children.unshift(new ChatText("first\n\nGo to https://example.com/page and read", undefined, screen.links));
    screen.transcript.invalidate(); screen.scroll.scrollTo(0); screen.tui.requestRender(); await tick();
    expect(pillShowing(screen)).toBe(true);
    const link = screen.at("https://example.com/page");
    await screen.send("press", link.x + 5, link.y); await screen.send("release", link.x + 5, link.y);
    expect(screen.opened).toEqual(["https://example.com/page"]);
    expect(screen.copies()).toEqual([]);
    const spot = pillSpot(screen);
    await screen.send("press", spot.x + 3, spot.y); await screen.send("release", spot.x + 3, spot.y);
    await screen.settle();
    expect(screen.scroll.isFollowingEnd).toBe(true);
    expect(pillShowing(screen)).toBe(false);
    expect(screen.tui.hasActiveSelection()).toBe(false);
  } finally { screen.stop(); }
});
