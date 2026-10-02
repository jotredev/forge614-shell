import { afterAll, beforeAll, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { resetCapabilitiesCache, setCapabilityOverrides, visibleWidth } from "@earendil-works/pi-tui";
import type { Component, Terminal, TuiMouseEvent } from "@earendil-works/pi-tui";
import { renderLayoutFrame } from "../../../node_modules/@earendil-works/pi-tui/dist/layout.js";
import { ShellStatusBar } from "./status-bar.ts";
import { StatusPanels } from "./status-panel.ts";
import { workspaceLayout, workspaceTerminal } from "./workspace.ts";
import type { ShellSnapshot } from "./shell-state.ts";
import type { McpServerState } from "../../engines/mcp-status.ts";
import { accent, muted } from "./theme.ts";

/** These tests read the exact RGB codes the screen emits, so they pin the color mode instead of taking whatever terminal runs the suite. */
beforeAll(() => setCapabilityOverrides({ trueColor: true }));
afterAll(() => resetCapabilitiesCache());

const plain = (text: string) => stripVTControlCharacters(text);

/** Two servers connected and one failed: «⇌ 2 MCP». */
const SERVERS: McpServerState[] = [{ name: "forge614-engram", state: "connected" }, { name: "context7", state: "connected" }, { name: "github", state: "failed" }];

/**
 * A bar over a connected Claude Code account in `~/proj-longer-name` on `main`, with `servers` as the MCP data (none: nothing is known yet) and the real panels' controller.
 * The folder name makes the left part of the line 42 columns wide: «F614 ▴ · ~/proj-longer-name · main · Clean».
 */
function setup(options: { servers?: McpServerState[]; version?: string; locale?: "en" | "es" } = {}) {
  const locale = options.locale ?? "en";
  const panels = new StatusPanels({ mcp: () => options.servers, forge614: () => ({}) }, locale);
  const snapshot: ShellSnapshot = { account: "connected", provider: "Claude Code", ...(options.servers ? { mcpServers: options.servers } : {}) };
  const bar = new ShellStatusBar(() => snapshot, "/Users/forge/proj-longer-name", () => ({ path: "/p", git: true, branch: "main", changedFiles: 0 }), "/Users/forge", options.version, locale, () => true, panels);
  return { bar, panels };
}

/** A mouse event on the bar in its own coordinates (the line is row 0, the empty row under it is row 1); `width` is the chat's width the bar was drawn at. */
function mouse(type: TuiMouseEvent["type"], x: number, width: number, extra: Partial<TuiMouseEvent> = {}): TuiMouseEvent {
  return { type, button: type === "move" ? "none" : "left", x, y: 0, screenX: x, screenY: 38, width, height: 2, shift: false, alt: false, ctrl: false, ...extra } as TuiMouseEvent;
}

/** The raw sequences a terminal sends for the left button (SGR mode, 1-based columns and rows): a press, its release, a move and a wheel turn. */
const press = (x: number, y: number) => `\x1b[<0;${x + 1};${y + 1}M`;
const release = (x: number, y: number) => `\x1b[<0;${x + 1};${y + 1}m`;
const moved = (x: number, y: number) => `\x1b[<35;${x + 1};${y + 1}M`;
const wheel = (x: number, y: number) => `\x1b[<64;${x + 1};${y + 1}M`;

/** «F614 ▴» is the first thing of the line, always, and «⇌ N MCP ▴» is drawn only when something is known about the MCP servers (a Claude Code chat before its first message knows nothing). */
test("the line starts with «F614 ▴» and the MCP indicator exists only with MCP data", () => {
  const without = setup();
  expect(plain(without.bar.render(100)[0]!).trimEnd()).toBe("  F614 ▴ · ~/proj-longer-name · main · Clean");
  expect(plain(without.bar.render(100)[0]!)).not.toContain("MCP");
  const withData = setup({ servers: SERVERS });
  const line = plain(withData.bar.render(100)[0]!);
  expect(line.startsWith("  F614 ▴ · ~/proj-longer-name · main · Clean")).toBe(true);
  // With no version the indicator sits at the right edge of the line (two columns of margin).
  expect(line.trimEnd().endsWith("⇌ 2 MCP ▴")).toBe(true);
  expect(line.trimEnd().length).toBe(98);
});

/** The number counts the servers that are connected: a failed one, one still starting, one that needs a sign-in, a cancelled, a disabled and one with no state are not counted. */
test("«⇌ N MCP ▴» counts only the connected servers", () => {
  const count = (servers: McpServerState[]) => plain(setup({ servers }).bar.render(100)[0]!).match(/⇌ (\d+) MCP ▴/)?.[1];
  expect(count(SERVERS)).toBe("2");
  expect(count([
    { name: "a", state: "connected" }, { name: "b", state: "starting" }, { name: "c", state: "needs-sign-in" }, { name: "d", state: "failed" },
    { name: "e", state: "cancelled" }, { name: "f", state: "disabled" }, { name: "g" },
  ])).toBe("1");
  expect(count([{ name: "a", state: "failed" }])).toBe("0");
  expect(count([])).toBe("0");
});

/** The MCP indicator comes right before the version, with exactly three spaces between them; the version stays the secondary gray at the right edge, as it was. */
test("the MCP indicator is followed by three spaces and the version, at the right edge", () => {
  const { bar } = setup({ servers: SERVERS, version: "1.13.0" });
  const line = plain(bar.render(100)[0]!);
  expect(line.trimEnd().endsWith("⇌ 2 MCP ▴   v1.13.0")).toBe(true);
  expect(line.trimEnd().length).toBe(98);
  expect(line.indexOf("F614")).toBe(2);
  expect(line.indexOf("v1.13.0") + "v1.13.0".length).toBe(98);
});

/** Both indicators are in the accent color (the cyan «F614» already was) with « ▴» inside it; the version keeps its gray. While a panel is open the arrow of its indicator is «▾» and the other keeps «▴». */
test("both indicators are cyan and the arrow points down only while their panel is open", () => {
  const { bar, panels } = setup({ servers: SERVERS, version: "1.13.0" });
  const resting = bar.render(100)[0]!;
  expect(resting).toContain(accent("F614 ▴"));
  expect(resting).toContain(accent("⇌ 2 MCP ▴"));
  expect(resting).toContain(muted("v1.13.0"));
  panels.toggle("mcp");
  const mcpOpen = bar.render(100)[0]!;
  expect(mcpOpen).toContain(accent("F614 ▴"));
  expect(mcpOpen).toContain(accent("⇌ 2 MCP ▾"));
  panels.toggle("forge614");
  const forgeOpen = bar.render(100)[0]!;
  expect(forgeOpen).toContain(accent("F614 ▾"));
  expect(forgeOpen).toContain(accent("⇌ 2 MCP ▴"));
  panels.close();
  expect(bar.render(100)[0]).toBe(resting);
});

/**
 * A line that does not fit first cuts the END of the left part (folder, branch and changes, the last things on it) with «…», leaving room for the MCP indicator and the version; only when the
 * left part would be left with fewer than 20 visible columns is the version given up, and if it still does not fit, the MCP indicator; «F614 ▴» stays as long as it fits. With the left part
 * 42 columns wide: at 100 columns everything is there whole; at 60 (56 of line) the left part is cut to 36 columns and both indicators stay; at 40 (36 of line) the version would leave the
 * left part 16 columns, so it goes and the left part is cut to 26 beside the MCP indicator; at 30 (26 of line) not even that leaves 20 columns, so the MCP indicator goes too.
 */
test("at 100, 60, 40 and 30 columns the left part is cut first, then the version goes, then the MCP indicator, and «F614 ▴» stays", () => {
  const at = (width: number) => { const { bar, panels } = setup({ servers: SERVERS, version: "1.13.0" }); const row = plain(bar.render(width)[0]!); return { row, panels }; };
  const wide = at(100).row;
  expect(wide.startsWith("  F614 ▴ · ~/proj-longer-name · main · Clean")).toBe(true);
  expect(wide.trimEnd().endsWith("⇌ 2 MCP ▴   v1.13.0")).toBe(true);
  const medium = at(60).row;
  expect(medium).toBe("  F614 ▴ · ~/proj-longer-name · main … ⇌ 2 MCP ▴   v1.13.0");
  expect(visibleWidth(medium)).toBeLessThanOrEqual(60);
  const narrow = at(40).row;
  expect(narrow).toBe("  F614 ▴ · ~/proj-longer-na… ⇌ 2 MCP ▴");
  expect(narrow).not.toContain("v1.13.0");
  expect(visibleWidth(narrow)).toBeLessThanOrEqual(40);
  const tiny = at(30).row;
  expect(tiny).toBe("  F614 ▴ · ~/proj-longer-na…");
  expect(tiny).not.toContain("MCP");
  expect(visibleWidth(tiny)).toBeLessThanOrEqual(30);
});

/**
 * A folder whose path is 150 characters long used to push the MCP indicator and the version off a wide line, because they were drawn only when the left part fitted whole. Now the folder is cut
 * with «…» and both stay, at their place at the right edge, and the click zone of the MCP indicator is where it was really drawn.
 */
test("a 150-character folder at 120 columns is cut with «…» and keeps «F614 ▴», the MCP indicator and the version", () => {
  const folder = "/Users/forge/" + "a".repeat(137);
  const panels = new StatusPanels({ mcp: () => SERVERS, forge614: () => ({}) }, "en");
  const bar = new ShellStatusBar(() => ({ account: "connected", provider: "Claude Code", mcpServers: SERVERS }), folder, () => ({ path: "/p", git: true, branch: "main", changedFiles: 0 }), "/Users/forge", "1.13.0", "en", () => true, panels);
  const line = plain(bar.render(120)[0]!);
  expect(line.startsWith("  F614 ▴ · ~/aaa")).toBe(true);
  expect(line).toContain("…");
  expect(line.trimEnd().endsWith("⇌ 2 MCP ▴   v1.13.0")).toBe(true);
  expect(visibleWidth(line)).toBeLessThanOrEqual(120);
  expect(line.trimEnd().length).toBe(118);
  const mcpStart = line.indexOf("⇌");
  expect(panels.zone("mcp")).toEqual({ start: mcpStart, end: mcpStart + "⇌ 2 MCP ▴".length });
  expect(panels.zone("forge614")).toEqual({ start: 2, end: 8 });
});

/** The clickable zones exist only over what was drawn: with the MCP indicator given up, nothing answers where it was; the version has none. */
test("a clickable zone exists only for what the line drew", () => {
  const drawn = (width: number) => { const { bar, panels } = setup({ servers: SERVERS, version: "1.13.0" }); bar.render(width); return panels; };
  expect(drawn(100).zone("forge614")).toEqual({ start: 2, end: 8 });
  expect(drawn(100).zone("mcp")).toBeDefined();
  expect(drawn(60).zone("mcp")).toBeDefined();
  expect(drawn(40).zone("mcp")).toBeDefined();
  expect(drawn(30).zone("mcp")).toBeUndefined();
  expect(drawn(30).zone("forge614")).toEqual({ start: 2, end: 8 });
  // With no MCP data there is no MCP zone at any width.
  const { bar, panels } = setup(); bar.render(100);
  expect(panels.zone("mcp")).toBeUndefined();
});

/** A left click on the text of an indicator opens its panel, the same click closes it, a click on the other one switches panels. */
test("a left click on an indicator opens its panel, again closes it, and the other one switches", () => {
  const { bar, panels } = setup({ servers: SERVERS, version: "1.13.0" });
  const line = plain(bar.render(100)[0]!);
  const mcpStart = line.indexOf("⇌");
  expect(panels.zone("mcp")).toEqual({ start: mcpStart, end: mcpStart + "⇌ 2 MCP ▴".length });
  expect(bar.handleMouse(mouse("click", 3, 100))).toMatchObject({ handled: true });
  expect(panels.current()).toBe("forge614");
  bar.render(100);
  expect(bar.handleMouse(mouse("click", 3, 100))).toMatchObject({ handled: true });
  expect(panels.current()).toBeUndefined();
  bar.handleMouse(mouse("click", mcpStart + 2, 100));
  expect(panels.current()).toBe("mcp");
  bar.handleMouse(mouse("click", 5, 100));
  expect(panels.current()).toBe("forge614");
  bar.handleMouse(mouse("click", mcpStart, 100));
  expect(panels.current()).toBe("mcp");
  bar.handleMouse(mouse("click", mcpStart, 100));
  expect(panels.current()).toBeUndefined();
});

/** The zone is the text of the indicator and no more: its first and last column answer, the column before and the one after do not. */
test("a click just outside the text of an indicator opens nothing", () => {
  const { bar, panels } = setup({ servers: SERVERS, version: "1.13.0" });
  const line = plain(bar.render(100)[0]!);
  const mcpStart = line.indexOf("⇌"); const mcpEnd = mcpStart + "⇌ 2 MCP ▴".length;
  const clickAt = (x: number, y = 0) => { const result = bar.handleMouse(mouse("click", x, 100, { y })); const open = panels.current(); panels.close(); return { handled: result !== undefined, open }; };
  expect(clickAt(2)).toEqual({ handled: true, open: "forge614" });
  expect(clickAt(7)).toEqual({ handled: true, open: "forge614" });
  expect(clickAt(1)).toEqual({ handled: false, open: undefined });
  expect(clickAt(8)).toEqual({ handled: false, open: undefined });
  expect(clickAt(mcpStart)).toEqual({ handled: true, open: "mcp" });
  expect(clickAt(mcpEnd - 1)).toEqual({ handled: true, open: "mcp" });
  expect(clickAt(mcpStart - 1)).toEqual({ handled: false, open: undefined });
  expect(clickAt(mcpEnd)).toEqual({ handled: false, open: undefined });
  // The text in between, the version and the empty row under the line open nothing either.
  expect(clickAt(line.indexOf("main"))).toEqual({ handled: false, open: undefined });
  expect(clickAt(line.indexOf("v1.13.0"))).toEqual({ handled: false, open: undefined });
  expect(clickAt(3, 1)).toEqual({ handled: false, open: undefined });
  expect(clickAt(mcpStart, 1)).toEqual({ handled: false, open: undefined });
});

/** Only the left button opens a panel; a right or middle click, and the other pieces of the gesture on their own, do not. */
test("only a left click opens a panel", () => {
  const { bar, panels } = setup({ servers: SERVERS });
  bar.render(100);
  for (const button of ["right", "middle"] as const) { bar.handleMouse(mouse("click", 3, 100, { button })); expect(panels.current()).toBeUndefined(); }
  // The press and the release of a left click are the screen's: the click that follows them opens the panel, so they open nothing by themselves (the press is taken so the click reaches the bar).
  expect(bar.handleMouse(mouse("press", 3, 100))).toMatchObject({ handled: true });
  expect(panels.current()).toBeUndefined();
  bar.handleMouse(mouse("release", 3, 100));
  expect(panels.current()).toBeUndefined();
  bar.handleMouse(mouse("click", 3, 100));
  expect(panels.current()).toBe("forge614");
});

/** There is no hover on the bottom bar: the pointer moving over an indicator answers nothing and changes nothing on the screen. */
test("moving the pointer over an indicator changes nothing", () => {
  const { bar, panels } = setup({ servers: SERVERS, version: "1.13.0" });
  const before = bar.render(100);
  const mcpStart = plain(before[0]!).indexOf("⇌");
  for (const x of [3, mcpStart + 1]) {
    expect(bar.handleMouse(mouse("move", x, 100))).toBeUndefined();
    expect(bar.render(100)).toEqual(before);
  }
  expect(panels.current()).toBeUndefined();
});

/** An indicator that is not drawn has no zone: after the MCP data is gone (a new conversation) a click where it was opens nothing. */
test("a click where the MCP indicator was, once there is no MCP data, opens nothing", () => {
  let servers: McpServerState[] | undefined = SERVERS;
  const panels = new StatusPanels({ mcp: () => servers, forge614: () => ({}) }, "en");
  const bar = new ShellStatusBar(() => ({ account: "connected", provider: "Claude Code", ...(servers ? { mcpServers: servers } : {}) }), "/Users/forge/proj", undefined, "/Users/forge", "1.13.0", "en", () => true, panels);
  const mcpStart = plain(bar.render(100)[0]!).indexOf("⇌");
  servers = undefined;
  expect(plain(bar.render(100)[0]!)).not.toContain("MCP");
  expect(bar.handleMouse(mouse("click", mcpStart + 1, 100))).toBeUndefined();
  expect(panels.current()).toBeUndefined();
});

/** The screen the bar really lives in: the click goes through the layout to the bar, wherever the footer is, in the bar's own coordinates. */
test("in the assembled screen a click on the indicator reaches the bar", () => {
  const { bar, panels } = setup({ servers: SERVERS, version: "1.13.0" });
  const terminal = { rows: 40, columns: 120, write: () => {} } as unknown as Terminal;
  const empty: Component = { invalidate() {}, render: () => [] };
  const frame = renderLayoutFrame(workspaceLayout(empty, empty, empty, bar, terminal), 120, 40, () => {});
  const row = frame.lines.map(plain).findIndex(line => line.includes("F614 ▴"));
  // The status line is the first of the footer's two last rows.
  expect(row).toBe(38);
  const chat = frame.root.children[0]!;
  const footer = chat.children.at(-1)!;
  expect(footer.rect).toMatchObject({ x: 0, y: 38, height: 2 });
  expect(bar.handleMouse(mouse("click", 3 - footer.rect.x, footer.rect.width, { y: row - footer.rect.y }))).toMatchObject({ handled: true });
  expect(panels.current()).toBe("forge614");
});

/**
 * Outside the indicators nothing is clickable, but with a panel open a click anywhere else closes it and does nothing more: the press (and its release) are taken before the screen sees
 * them, so a click on text, on the sidebar or on the grip does not also do what it would do. A click on an indicator is left to the bar (it switches or closes), and a pointer move or a wheel turn does not close.
 */
test("with a panel open a click anywhere else closes it and is not passed on", () => {
  const { bar, panels } = setup({ servers: SERVERS, version: "1.13.0" });
  const line = plain(bar.render(100)[0]!);
  const rows = 40; const barRow = rows - 2;
  panels.toggle("mcp");
  // The pointer moving and the wheel turning are not clicks.
  expect(panels.intercept(moved(10, 10), rows)).toBe(false);
  expect(panels.intercept(wheel(10, 10), rows)).toBe(false);
  expect(panels.current()).toBe("mcp");
  // A press on an indicator is the bar's (the click that follows it switches or closes the panel).
  expect(panels.intercept(press(3, barRow), rows)).toBe(false);
  expect(panels.intercept(release(3, barRow), rows)).toBe(false);
  expect(panels.current()).toBe("mcp");
  // A press on the text of the line, or on the row under it, is outside.
  expect(panels.intercept(press(line.indexOf("main"), barRow), rows)).toBe(true);
  expect(panels.current()).toBeUndefined();
  // Its release is taken too, once; then clicks go through again.
  expect(panels.intercept(release(line.indexOf("main"), barRow), rows)).toBe(true);
  expect(panels.intercept(release(line.indexOf("main"), barRow), rows)).toBe(false);
  // With no panel open nothing is taken.
  expect(panels.intercept(press(30, 10), rows)).toBe(false);
  expect(panels.intercept("\x1b", rows)).toBe(false);
  // Anywhere in the chat, the sidebar or the empty row of the bar closes it as well.
  for (const [x, y] of [[30, 10], [110, 5], [3, barRow + 1], [50, barRow - 1]] as const) {
    panels.toggle("forge614");
    expect({ x, y, taken: panels.intercept(press(x, y), rows) }).toEqual({ x, y, taken: true });
    expect(panels.current()).toBeUndefined();
    panels.intercept(release(x, y), rows);
  }
  // Only the left button counts.
  panels.toggle("forge614");
  expect(panels.intercept(`\x1b[<2;31;11M`, rows)).toBe(false);
  expect(panels.current()).toBe("forge614");
});

/** Esc closes the open panel and is not passed on to the writing box; with no panel open it is not touched. */
test("Esc closes the open panel and nothing else receives it", () => {
  const { panels } = setup({ servers: SERVERS });
  panels.toggle("forge614");
  expect(panels.intercept("\x1b", 40)).toBe(true);
  expect(panels.current()).toBeUndefined();
  expect(panels.intercept("\x1b", 40)).toBe(false);
  // Other keys never close it and are never taken: typing in the writing box keeps working with a panel open.
  panels.toggle("mcp");
  for (const key of ["a", "\r", "\x7f", "\x1b[A", "\x03"]) expect({ key, taken: panels.intercept(key, 40) }).toEqual({ key, taken: false });
  expect(panels.current()).toBe("mcp");
});

/** A 120×40 terminal that hands whatever `send` is given to the function the screen started it with, as the real terminal does with what the keyboard and the mouse send. */
function fakeTerminal() {
  let input: (data: string) => void = () => {};
  const base = { rows: 40, columns: 120, start(callback: (data: string) => void) { input = callback; }, write() {} } as unknown as Terminal;
  return { base, send: (data: string) => input(data) };
}

/**
 * The same through the terminal the screen is built on: what `workspaceTerminal` hands to the screen. With a panel open Esc never reaches the screen's input (so neither the writing
 * box nor anything that stops the assistant's work sees it), and typed text still does; once it is closed Esc passes again.
 */
test("through the screen's terminal, Esc with a panel open does not reach the input, and typing does", () => {
  const { panels } = setup({ servers: SERVERS });
  const received: string[] = [];
  const { base, send } = fakeTerminal();
  workspaceTerminal(base, undefined, panels).start(data => { received.push(data); }, () => {});
  panels.toggle("forge614");
  send("\x1b");
  send("h");
  expect(received).toEqual(["h"]);
  expect(panels.current()).toBeUndefined();
  send("\x1b");
  expect(received).toEqual(["h", "\x1b"]);
});

/** The same terminal takes the press outside a panel and its release, and lets a press on an indicator through. */
test("through the screen's terminal a click outside the panel is taken and a click on an indicator is not", () => {
  const { bar, panels } = setup({ servers: SERVERS });
  bar.render(100);
  const received: string[] = [];
  const { base, send } = fakeTerminal();
  workspaceTerminal(base, undefined, panels).start(data => { received.push(data); }, () => {});
  panels.toggle("mcp");
  send(press(60, 10)); send(release(60, 10));
  expect(received).toEqual([]);
  expect(panels.current()).toBeUndefined();
  panels.toggle("mcp");
  send(press(3, 38)); send(release(3, 38));
  expect(received).toEqual([press(3, 38), release(3, 38)]);
  expect(panels.current()).toBe("mcp");
});
