import { afterAll, beforeAll, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { resetCapabilitiesCache, setCapabilityOverrides, visibleWidth } from "@earendil-works/pi-tui";
import type { Component, OverlayOptions, TUI } from "@earendil-works/pi-tui";
import { ShellStatusBar } from "./status-bar.ts";
import { StatusPanelView, StatusPanels, attachStatusPanels } from "./status-panel.ts";
import type { Forge614Info } from "./status-panel.ts";
import { accent, danger, foreground, muted, success, warning } from "./theme.ts";
import type { McpServerState, McpState } from "../../engines/mcp-status.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";

/** These tests read the exact RGB codes the screen emits, so they pin the color mode instead of taking whatever terminal runs the suite. */
beforeAll(() => setCapabilityOverrides({ trueColor: true }));
afterAll(() => resetCapabilitiesCache());

const SURFACE = "48;2;24;24;27";
const plain = (text: string) => stripVTControlCharacters(text);
const squeeze = (text: string) => plain(text).replace(/\s+/g, " ").trim();

/** An open panel, drawn `width` columns wide on a terminal with `rows` rows, as its rows of text. */
function open(id: "mcp" | "forge614", source: { mcp?: McpServerState[]; forge614?: Forge614Info }, options: { locale?: Locale; rows?: number; width?: number } = {}) {
  const locale = options.locale ?? "en";
  const panels = new StatusPanels({ mcp: () => source.mcp, forge614: () => source.forge614 ?? {} }, locale);
  panels.toggle(id);
  const view = new StatusPanelView(panels, () => options.rows ?? 40);
  const width = options.width ?? view.contentWidth();
  return { panels, view, width, raw: view.render(width), rows: view.render(width).map(plain) };
}

const STATES: McpState[] = ["connected", "starting", "needs-sign-in", "failed", "cancelled", "disabled"];
/** The word of each state in each language, and the color the dot and the word are drawn in. */
const WORDS: Record<Locale, Record<McpState, string>> = {
  en: { connected: "connected", starting: "starting", "needs-sign-in": "needs sign-in", failed: "failed", cancelled: "cancelled", disabled: "disabled" },
  es: { connected: "conectado", starting: "iniciando", "needs-sign-in": "pide iniciar sesión", failed: "falló", cancelled: "cancelado", disabled: "desactivado" },
};
const COLORS: Record<McpState, (text: string) => string> = { connected: success, starting: warning, "needs-sign-in": warning, failed: danger, cancelled: muted, disabled: muted };

/** The words come from the catalog: the six states of the panel exist in both languages, with the words the owner approved. */
test("the catalog has the six state words in both languages", () => {
  for (const locale of ["en", "es"] as const) {
    const t = getCatalog(locale).statusPanel;
    expect([t.stateConnected, t.stateStarting, t.stateNeedsSignIn, t.stateFailed, t.stateCancelled, t.stateDisabled]).toEqual(STATES.map(state => WORDS[locale][state]));
  }
});

/**
 * One row per server: a dot in the color of its state, the name in normal text in an aligned column, and the word of the state in the color of the state — each of the six, in Spanish and in English. The
 * dots start in the same column, and so do the words.
 */
test("each MCP state has its word and its color on its own row, in both languages", () => {
  for (const locale of ["en", "es"] as const) {
    const servers: McpServerState[] = STATES.map(state => ({ name: `srv-${state}`, state }));
    const { raw, rows } = open("mcp", { mcp: servers }, { locale });
    for (const state of STATES) {
      const index = rows.findIndex(row => row.includes(`srv-${state}`));
      expect({ locale, state, found: index >= 0 }).toEqual({ locale, state, found: true });
      expect(squeeze(rows[index]!)).toBe(`● srv-${state} ${WORDS[locale][state]}`);
      expect(raw[index]).toContain(COLORS[state]("●"));
      expect(raw[index]).toContain(foreground(`srv-${state}`));
      expect(raw[index]).toContain(COLORS[state](WORDS[locale][state]));
    }
    const wordColumns = new Set(STATES.map(state => { const row = rows.find(line => line.includes(`srv-${state}`))!; return row.lastIndexOf(WORDS[locale][state]); }));
    expect(wordColumns.size).toBe(1);
    expect(new Set(STATES.map(state => rows.find(line => line.includes(`srv-${state}`))!.indexOf("●"))).size).toBe(1);
  }
});

/** The title is «MCP servers · <total>» in normal text with the total in the secondary gray, with an empty row above and below the block and an empty one under the title. */
test("the MCP panel's title carries the total in gray, between empty rows", () => {
  const { raw, rows } = open("mcp", { mcp: [{ name: "a", state: "connected" }, { name: "b", state: "failed" }, { name: "c", state: "connected" }] });
  expect(rows[0]!.trim()).toBe("");
  expect(squeeze(rows[1]!)).toBe("MCP servers · 3");
  expect(raw[1]).toContain(foreground("MCP servers") + muted(" · 3"));
  expect(rows[2]!.trim()).toBe("");
  expect(rows.at(-1)!.trim()).toBe("");
  expect(rows).toHaveLength(7);
  const es = open("mcp", { mcp: [{ name: "a", state: "connected" }] }, { locale: "es" });
  expect(squeeze(es.rows[1]!)).toBe("Servidores MCP · 1");
  expect(es.raw[1]).toContain(foreground("Servidores MCP") + muted(" · 1"));
});

/** A server Codex reports with no `runtimeStatus` has its row with a gray dot and no word. */
test("a server with no state has a gray dot and no word", () => {
  const { raw, rows } = open("mcp", { mcp: [{ name: "plain-server" }] });
  expect(squeeze(rows[3]!)).toBe("● plain-server");
  expect(raw[3]).toContain(muted("●"));
});

/** «Forge614 · Engram» is shown, in the accent color, only on the row of `forge614-engram`. */
test("only the forge614-engram row carries «Forge614 · Engram»", () => {
  const { raw, rows } = open("mcp", { mcp: [{ name: "forge614-engram", state: "connected" }, { name: "context7", state: "connected" }, { name: "forge614-engram-fork", state: "connected" }] });
  const tagged = rows.filter(row => row.includes("Forge614 · Engram"));
  expect(tagged).toHaveLength(1);
  expect(squeeze(tagged[0]!)).toBe("● forge614-engram connected Forge614 · Engram");
  expect(raw[rows.indexOf(tagged[0]!)]).toContain(accent("Forge614 · Engram"));
});

/** With more servers than rows above the bar, the rows that fit are shown and a last row says how many are left: «+N more» / «+N más», in the secondary gray. */
test("when the servers do not fit, the rows that fit and «+N more» are shown", () => {
  const servers: McpServerState[] = Array.from({ length: 12 }, (_, index) => ({ name: `s${index + 1}`, state: "connected" as const }));
  const en = open("mcp", { mcp: servers }, { rows: 9 });
  expect(en.rows).toHaveLength(9);
  expect(en.rows.filter(row => row.includes("●")).map(squeeze)).toEqual(["● s1 connected", "● s2 connected", "● s3 connected", "● s4 connected"]);
  expect(squeeze(en.rows[7]!)).toBe("+8 more");
  expect(en.raw[7]).toContain(muted("+8 more"));
  expect(en.rows[8]!.trim()).toBe("");
  const es = open("mcp", { mcp: servers }, { rows: 9, locale: "es" });
  expect(squeeze(es.rows[7]!)).toBe("+8 más");
  // Exactly enough rows for every server: none is hidden and no «+N» is drawn.
  const exact = open("mcp", { mcp: servers.slice(0, 4) }, { rows: 8 });
  expect(exact.rows.filter(row => row.includes("●"))).toHaveLength(4);
  expect(exact.rows.some(row => row.includes("+"))).toBe(false);
  // One row short: the last server gives way to the count.
  const short = open("mcp", { mcp: servers.slice(0, 4) }, { rows: 7 });
  expect(short.rows.filter(row => row.includes("●"))).toHaveLength(2);
  expect(squeeze(short.rows.at(-2)!)).toBe("+2 more");
  for (const rows of [en.rows, short.rows, exact.rows]) expect(rows.length).toBeLessThanOrEqual(9);
});

/** The block is the surface gray from edge to edge, with two columns of margin inside and no border, and is as wide as its content plus the margins (and never wider than the chat). */
test("the panel is a borderless surface block with two columns of margin", () => {
  const { raw, rows, width, view } = open("mcp", { mcp: [{ name: "forge614-engram", state: "connected" }, { name: "context7", state: "failed" }] });
  // The widest row is its content and the left margin; the right margin is the two columns after it.
  expect(width).toBe(Math.max(...rows.map(row => row.trimEnd().length)) + 2);
  for (const [index, row] of raw.entries()) {
    expect({ index, width: visibleWidth(row) }).toEqual({ index, width });
    expect(row.startsWith(`\x1b[${SURFACE}m`)).toBe(true);
  }
  expect(rows[3]!.startsWith("  ● ")).toBe(true);
  expect(rows.join("\n")).not.toMatch(/[╭╮╰╯│─]/);
  expect(view.contentWidth()).toBe(width);
  // Narrower than its content: the rows are cut, not overflowed.
  const narrow = view.render(20);
  for (const row of narrow) expect(visibleWidth(row)).toBeLessThanOrEqual(20);
});

/** The Forge614 panel: the title, and three rows with the name in gray and the version in normal text, with the memory state on Engram's row. */
test("the Forge614 panel shows the three versions and the memory in use", () => {
  const info: Forge614Info = { shell: "1.13.0", engines: { state: "version", version: "1.16.0" }, engram: { state: "version", version: "1.8.6" }, memoryInUse: true };
  const { raw, rows } = open("forge614", { forge614: info });
  expect(rows[0]!.trim()).toBe("");
  expect(squeeze(rows[1]!)).toBe("Forge614");
  expect(rows[2]!.trim()).toBe("");
  expect(rows.slice(3, 6).map(squeeze)).toEqual(["Shell 1.13.0", "Engines 1.16.0", "Engram 1.8.6 memory in use"]);
  expect(rows.at(-1)!.trim()).toBe("");
  expect(rows).toHaveLength(7);
  expect(raw[3]).toContain(muted("Shell")); expect(raw[3]).toContain(foreground("1.13.0"));
  expect(raw[4]).toContain(muted("Engines")); expect(raw[4]).toContain(foreground("1.16.0"));
  expect(raw[5]).toContain(muted("Engram")); expect(raw[5]).toContain(foreground("1.8.6")); expect(raw[5]).toContain(success("memory in use"));
  // The versions start in the same column.
  expect(new Set([rows[3]!.indexOf("1.13.0"), rows[4]!.indexOf("1.16.0"), rows[5]!.indexOf("1.8.6")]).size).toBe(1);
  const es = open("forge614", { forge614: info }, { locale: "es" });
  expect(squeeze(es.rows[5]!)).toBe("Engram 1.8.6 memoria en uso");
});

/** The memory row: «in use» when Engram's startup context reached this session, «not in use» (gray) when Engram is installed but it did not, and nothing while it is not known. */
test("the memory state is in use, not in use, or not shown while unknown", () => {
  const engram = { state: "version" as const, version: "1.8.6" };
  const row = (memoryInUse: boolean | undefined, locale: Locale = "en") => open("forge614", { forge614: { shell: "1.13.0", engines: { state: "version", version: "1.16.0" }, engram, ...(memoryInUse === undefined ? {} : { memoryInUse }) } }, { locale });
  expect(squeeze(row(true).rows[5]!)).toBe("Engram 1.8.6 memory in use");
  expect(squeeze(row(false).rows[5]!)).toBe("Engram 1.8.6 not in use");
  expect(row(false).raw[5]).toContain(muted("not in use"));
  expect(squeeze(row(false, "es").rows[5]!)).toBe("Engram 1.8.6 sin usar");
  expect(squeeze(row(undefined).rows[5]!)).toBe("Engram 1.8.6");
  expect(row(undefined).rows[5]).not.toContain("memory");
  expect(row(undefined).rows[5]).not.toContain("not in use");
});

/** A binary that does not exist reads «not installed» in gray where its version goes; one that exists but gave no version has its row with no version; and Engram not installed shows no memory state at all. */
test("a missing binary says not installed, an unreadable one has no version", () => {
  const missing = open("forge614", { forge614: { shell: "1.13.0", engines: { state: "missing" }, engram: { state: "missing" }, memoryInUse: false } });
  expect(missing.rows.slice(3, 6).map(squeeze)).toEqual(["Shell 1.13.0", "Engines not installed", "Engram not installed"]);
  expect(missing.raw[4]).toContain(muted("not installed")); expect(missing.raw[5]).toContain(muted("not installed"));
  expect(squeeze(open("forge614", { forge614: { shell: "1.13.0", engines: { state: "missing" }, engram: { state: "missing" } } }, { locale: "es" }).rows[4]!)).toBe("Engines no instalado");
  const unreadable = open("forge614", { forge614: { shell: "1.13.0", engines: { state: "unreadable" }, engram: { state: "unreadable" }, memoryInUse: true } });
  expect(unreadable.rows.slice(3, 6).map(squeeze)).toEqual(["Shell 1.13.0", "Engines", "Engram memory in use"]);
  // Not read yet: the same, rows with no version.
  const pending = open("forge614", { forge614: { shell: "1.13.0" } });
  expect(pending.rows.slice(3, 6).map(squeeze)).toEqual(["Shell 1.13.0", "Engines", "Engram"]);
});

/** A fake screen that records the overlay the panels ask for and every render they request. */
function fakeScreen(rows = 40, columns = 120) {
  const shown: { component: Component; options: OverlayOptions }[] = []; let renders = 0;
  const tui = {
    terminal: { rows, columns }, requestRender: () => { renders++; },
    showOverlay: (component: Component, options: OverlayOptions) => { shown.push({ component, options }); return { hide() {}, setHidden() {}, isHidden: () => false, focus() {}, unfocus() {}, isFocused: () => false, getBounds: () => undefined }; },
  } as unknown as TUI;
  return { tui, shown, renders: () => renders };
}

/**
 * The panel sits right above the bottom bar (anchored to the bottom, two rows up: the breathing row is under it and the bar's two rows below that), does not take the keyboard (the
 * writing box keeps it) and exists only while a panel is open. The Forge614 panel's left edge is the left edge of «F614»; the MCP panel's right edge is the end of «⇌ N MCP ▴».
 */
test("the overlay is above the bar, shows only while open, and aligns with its indicator", () => {
  const panels = new StatusPanels({ mcp: () => [{ name: "forge614-engram", state: "connected" }, { name: "github", state: "failed" }], forge614: () => ({ shell: "1.13.0" }) }, "en");
  const bar = new ShellStatusBar(() => ({ account: "connected", provider: "Claude Code", mcpServers: [{ name: "forge614-engram", state: "connected" }, { name: "github", state: "failed" }] }), "/Users/forge/project", undefined, "/Users/forge", "1.13.0", "en", () => true, panels);
  const { tui, shown, renders } = fakeScreen(40, 120);
  attachStatusPanels(tui, panels, { chatWidth: () => 82 });
  expect(shown).toHaveLength(1);
  const options = shown[0]!.options;
  expect(options).toMatchObject({ anchor: "bottom-left", margin: { bottom: 2 }, nonCapturing: true });
  expect(options.visible!(120, 40)).toBe(false);
  bar.render(82);
  const mcpEnd = panels.zone("mcp")!.end;
  panels.toggle("mcp");
  expect(options.visible!(120, 40)).toBe(true);
  expect(renders()).toBeGreaterThan(0);
  const mcpWidth = options.width as number;
  expect(mcpWidth).toBe(new StatusPanelView(panels, () => 38).contentWidth());
  expect((options.col as number) + mcpWidth).toBe(mcpEnd);
  panels.toggle("forge614");
  expect(options.col).toBe(2);
  expect(options.width).toBe(new StatusPanelView(panels, () => 38).contentWidth());
  panels.close();
  expect(options.visible!(120, 40)).toBe(false);
});

/** The panel is never wider than the chat and has at most the rows above the bar: the terminal's rows less the bar's two (its last row sits on the breathing row, right above the bar). */
test("the overlay is limited to the chat's width and the rows above the bar", () => {
  const long = "x".repeat(60);
  const panels = new StatusPanels({ mcp: () => [{ name: long, state: "connected" }], forge614: () => ({}) }, "en");
  const bar = new ShellStatusBar(() => ({ account: "connected", provider: "Claude Code", mcpServers: [{ name: long, state: "connected" }] }), undefined, undefined, undefined, undefined, "en", () => true, panels);
  const { tui, shown } = fakeScreen(30, 120);
  attachStatusPanels(tui, panels, { chatWidth: () => 40 });
  const options = shown[0]!.options;
  bar.render(40);
  panels.toggle("mcp");
  expect(options.width).toBe(40);
  expect(options.col).toBe(0);
  expect(options.maxHeight).toBe(28);
});
