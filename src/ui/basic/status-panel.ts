import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import type { Component, OverlayHandle, OverlayOptions, TUI } from "@earendil-works/pi-tui";
import { accent, danger, fit, foreground, muted, success, surface, warning } from "./theme.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";
import { ENGRAM_SERVER } from "../../engines/mcp-labels.ts";
import type { McpServerState, McpState } from "../../engines/mcp-status.ts";
import type { ToolVersion } from "../../infrastructure/ecosystem-versions.ts";

/** The two panels the bottom bar opens: Forge614's (from «F614 ▴») and the MCP servers' (from «⇌ N MCP ▴»). */
export type PanelId = "forge614" | "mcp";

/** The columns an indicator took on the bar's line, in the chat's own columns: `start` is its first, `end` the one after its last. */
export interface Zone { start: number; end: number }

/**
 * What the Forge614 panel shows besides the title. Each field is only there when known: `shell` is Shell's own version, `engines` and `engram` come from their `--version`
 * (read once when Shell opens; absent until then) and `memoryInUse` says whether Engram's startup context reached this session (absent until the session has asked).
 */
export interface Forge614Info {
  shell?: string;
  engines?: ToolVersion;
  engram?: ToolVersion;
  memoryInUse?: boolean;
}

/** Where the panels get their data, asked each time they are drawn: the MCP servers (undefined: nothing known) and what the Forge614 panel shows. */
export interface StatusPanelSource {
  mcp: () => McpServerState[] | undefined;
  forge614: () => Forge614Info;
}

/** The status line is the first of the footer's two last rows, so it is this many rows above the bottom of the terminal. */
const STATUS_LINE_FROM_BOTTOM = 2;
/** The Forge614 panel's name column (the version starts after it) and the width the version column takes when the memory state follows it. */
const LABEL_COLUMN = 12;
const VERSION_COLUMN = 9;
/** The rows of a panel that are not its items: the empty row above, the title, the empty row under it and the empty row below. */
const FRAME_ROWS = 4;
/** The columns of margin on each side of a panel's content. */
const MARGIN = 2;

/**
 * Which panel is open, where each indicator sits on the bar (told by the bar each time it draws) and the two ways a panel is closed from outside the bar: Esc, and a click anywhere else
 * (`intercept`, which the screen's terminal asks about everything it receives, before the screen sees it). Only one panel is open at a time; a click on the other indicator switches.
 * `onChange` is called when the open panel changes, so the screen draws again.
 */
export class StatusPanels {
  private open?: PanelId;
  private zones: Partial<Record<PanelId, Zone>> = {};
  private swallowRelease = false;
  onChange?: () => void;

  constructor(readonly source: StatusPanelSource, readonly locale: Locale = "en") {}

  /** The panel that is open, if any. */
  current(): PanelId | undefined { return this.open; }

  /** A click on an indicator: opens its panel, closes it when it was the open one, or switches from the other. */
  toggle(id: PanelId): void {
    this.open = this.open === id ? undefined : id;
    this.onChange?.();
  }

  /** Closes the open panel, if any. */
  close(): void {
    if (!this.open) return;
    this.open = undefined;
    this.onChange?.();
  }

  /** Told by the bar on every draw where each indicator is (only the ones it drew); a panel whose indicator is no longer drawn (no room, or its data is gone) closes with it. */
  setZones(zones: Partial<Record<PanelId, Zone>>): void {
    this.zones = zones;
    if (this.open && !zones[this.open]) this.open = undefined;
  }

  /** Where the indicator of `id` is on the bar, or undefined when it is not drawn. */
  zone(id: PanelId): Zone | undefined { return this.zones[id]; }

  private onIndicator(x: number): boolean {
    return Object.values(this.zones).some(zone => x >= zone.start && x < zone.end);
  }

  /**
   * Everything the terminal sends, offered here first; true means it was spent and the screen must not see it. With a panel open Esc closes it and nothing else receives that Esc (neither
   * the writing box nor anything that stops the assistant's work), and a left press anywhere but on an indicator closes it and is not passed on, nor is its release: the click only closes the
   * panel. A press on an indicator is left to the bar (its click switches or closes the panel); the pointer moving, the wheel, the other buttons and typing are never touched. `rows` is the
   * terminal's rows, which tell where the status line is. With no panel open nothing is spent.
   */
  intercept(data: string, rows: number): boolean {
    const mouse = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(data);
    if (mouse) {
      // Only the plain left button: the modifier bits (shift 4, alt 8, ctrl 16) are ignored, but motion (32), the wheel (64) and the other buttons are not a click.
      if ((Number(mouse[1]) & ~28) !== 0) return false;
      if (mouse[4] === "m") {
        const spent = this.swallowRelease;
        this.swallowRelease = false;
        return spent;
      }
      if (!this.open) return false;
      const x = Number(mouse[2]) - 1; const y = Number(mouse[3]) - 1;
      if (y === rows - STATUS_LINE_FROM_BOTTOM && this.onIndicator(x)) return false;
      this.close();
      this.swallowRelease = true;
      return true;
    }
    if (this.open && matchesKey(data, "escape")) { this.close(); return true; }
    return false;
  }
}

/** The color each MCP state is drawn in, for its dot and its word. */
const STATE_COLOR: Record<McpState, (text: string) => string> = { connected: success, starting: warning, "needs-sign-in": warning, failed: danger, cancelled: muted, disabled: muted };

/** The word of an MCP state, from the catalog. */
function stateWord(t: ReturnType<typeof getCatalog>["statusPanel"], state: McpState): string {
  switch (state) {
    case "connected": return t.stateConnected;
    case "starting": return t.stateStarting;
    case "needs-sign-in": return t.stateNeedsSignIn;
    case "failed": return t.stateFailed;
    case "cancelled": return t.stateCancelled;
    case "disabled": return t.stateDisabled;
  }
}

const spaces = (count: number) => " ".repeat(Math.max(0, count));

/** One row per MCP server: the dot and the word of its state in the state's color, the name in normal text in an aligned column, and «Forge614 · Engram» in the accent color on Engram's own server. */
function mcpItems(servers: McpServerState[], t: ReturnType<typeof getCatalog>["statusPanel"]): string[] {
  const nameWidth = Math.max(0, ...servers.map(server => visibleWidth(server.name)));
  const wordWidth = Math.max(0, ...servers.map(server => server.state ? visibleWidth(stateWord(t, server.state)) : 0));
  return servers.map(server => {
    const color = server.state ? STATE_COLOR[server.state] : muted;
    const word = server.state ? stateWord(t, server.state) : "";
    const tag = server.name === ENGRAM_SERVER ? `  ${accent(t.engramServer)}` : "";
    return `${color("●")} ${foreground(server.name)}${spaces(nameWidth - visibleWidth(server.name))}${word ? `  ${color(word)}${spaces(wordWidth - visibleWidth(word))}` : ""}${tag}`;
  });
}

/** A version cell: the version in normal text, «not installed» in gray for a binary that is not there, and nothing for one with no version (unreadable, or not read yet). */
function versionCell(tool: ToolVersion | undefined, t: ReturnType<typeof getCatalog>["statusPanel"]): { text: string; width: number } {
  if (tool?.state === "version") return { text: foreground(tool.version), width: visibleWidth(tool.version) };
  if (tool?.state === "missing") return { text: muted(t.notInstalled), width: visibleWidth(t.notInstalled) };
  return { text: "", width: 0 };
}

/** The Forge614 panel's three rows: the name in gray and the version in normal text, and on Engram's row the memory state when Engram is installed and it is known. */
function forge614Items(info: Forge614Info, t: ReturnType<typeof getCatalog>["statusPanel"]): string[] {
  const name = (text: string) => `${muted(text)}${spaces(LABEL_COLUMN - visibleWidth(text))}`;
  const engram = versionCell(info.engram, t);
  const memory = info.engram?.state === "missing" || info.memoryInUse === undefined ? "" : info.memoryInUse ? success(t.memoryInUse) : muted(t.memoryNotInUse);
  return [
    `${name(t.shell)}${info.shell ? foreground(info.shell) : ""}`,
    `${name(t.engines)}${versionCell(info.engines, t).text}`,
    `${name(t.engram)}${engram.text}${memory ? `${spaces(Math.max(2, VERSION_COLUMN - engram.width))}${memory}` : ""}`,
  ];
}

/**
 * The open panel as the screen draws it: a block of the surface gray, no border and no shadow, with an empty row above and below, two columns of margin inside and the rows of its content
 * (the title and an empty row under it, then the items). It is as wide as its content plus the margins and has at most `availableRows()` rows: when the items do not fit, the ones that fit
 * and a last row «+N more». Nothing is drawn while no panel is open.
 */
export class StatusPanelView implements Component {
  constructor(private readonly panels: StatusPanels, private readonly availableRows: () => number) {}

  invalidate(): void {}

  /** The title and the content rows of the open panel, with the items cut to what fits. */
  private body(): string[] {
    const id = this.panels.current();
    if (!id) return [];
    const t = getCatalog(this.panels.locale).statusPanel;
    const servers = this.panels.source.mcp() ?? [];
    const title = id === "mcp" ? `${foreground(t.mcpTitle)}${muted(` · ${servers.length}`)}` : foreground(t.forge614Title);
    const items = id === "mcp" ? mcpItems(servers, t) : forge614Items(this.panels.source.forge614(), t);
    const room = Math.max(0, this.availableRows() - FRAME_ROWS);
    const shown = items.length <= room ? items : [...items.slice(0, Math.max(0, room - 1)), muted(t.more({ count: items.length - Math.max(0, room - 1) }))];
    return [title, "", ...shown];
  }

  /** The columns the open panel needs: its widest row plus the margin on both sides (0 while none is open). */
  contentWidth(): number {
    const lines = this.body();
    return lines.length ? Math.max(...lines.map(line => visibleWidth(line))) + 2 * MARGIN : 0;
  }

  render(width: number): string[] {
    const lines = this.body();
    if (!lines.length) return [];
    const blank = surface(spaces(width));
    return [blank, ...lines.map(line => surface(`${fit(`${spaces(MARGIN)}${line}`, Math.max(0, width - MARGIN))}${spaces(MARGIN)}`)), blank];
  }
}

/**
 * Puts the panels on the screen as an overlay that does not take the keyboard (the writing box keeps it) and exists only while a panel is open. It sits right above the bottom bar: anchored to
 * the bottom with the bar's two rows below it, so its last row is the breathing row. The Forge614 panel's left edge is the left edge of «F614»; the MCP panel's right edge is the end of «⇌ N MCP ▴».
 * It is as wide as its content, never wider than the chat (`chatWidth`), and has at most the rows above the bar. Its geometry is read again on every frame.
 */
export function attachStatusPanels(tui: TUI, panels: StatusPanels, options: { chatWidth: () => number }): OverlayHandle {
  const rows = () => Math.max(0, (tui.terminal?.rows ?? 0) - STATUS_LINE_FROM_BOTTOM);
  const view = new StatusPanelView(panels, rows);
  panels.onChange = () => tui.requestRender();
  const width = () => Math.min(view.contentWidth(), Math.max(1, options.chatWidth()));
  const overlay: OverlayOptions = {
    anchor: "bottom-left",
    margin: { bottom: STATUS_LINE_FROM_BOTTOM },
    get width() { return width(); },
    get maxHeight() { return rows(); },
    get col() {
      const id = panels.current();
      const zone = id ? panels.zone(id) : undefined;
      const wanted = id === "mcp" && zone ? zone.end - width() : zone?.start ?? 0;
      return Math.max(0, Math.min(wanted, options.chatWidth() - width()));
    },
    nonCapturing: true,
    visible: () => panels.current() !== undefined,
  };
  return tui.showOverlay(view, overlay);
}
