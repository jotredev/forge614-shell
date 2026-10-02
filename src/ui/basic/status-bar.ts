import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { ShellSnapshot } from "./shell-state.ts";
import type { ProjectInfo } from "../../infrastructure/project-info.ts";
import { homeRelativePath } from "../../infrastructure/runtime-resources.ts";
import { spinnerFrame } from "./composer.ts";
import type { PanelId, StatusPanels, Zone } from "./status-panel.ts";
import { connectedCount } from "../../engines/mcp-status.ts";

import { accent as cyan, foreground, muted, warning } from "./theme.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";
const separator = muted(" · ");
/** The columns between the MCP indicator and the version, when both are drawn. */
const RIGHT_GAP = "   ";
/** The fewest visible columns the left part is cut down to to make room for the MCP indicator and the version; below this the version is given up first, then the MCP indicator. */
const MIN_LEFT_WIDTH = 20;

function backgroundActivityLabel(snapshot: ShellSnapshot, locale: Locale): string | undefined {
  const running = snapshot.backgroundActivity?.filter(activity => activity.state === "running").length ?? 0;
  if (!running) return undefined;
  return `${spinnerFrame(true)} ${getCatalog(locale).backgroundActivity.statusBarCount({ count: running })}`;
}

/**
 * A deliberately compact workspace footer: unknown data is never represented, and nothing the
 * sidebar already shows is repeated. With the sidebar on screen, the model, reasoning level and
 * context percentage live there only; here stay background work, folder, branch and Git state.
 * When the sidebar is not drawn (the person hid it, or the terminal is under 100 columns) those three
 * move here, right after «F614 ▴» and before the folder: the model in normal text, the reasoning in the
 * warning color (the value the sidebar shows) and «context N %» in normal text, each only when known
 * and only with a connected account, like the sidebar's own session section. A non-connected
 * account is kept as a warning (with its `/login` hint) so it still reaches a terminal too narrow
 * for the sidebar. `sidebarVisible` says whether the sidebar is drawn right now; it is asked on each
 * draw, and by default the sidebar is taken to be on screen.
 *
 * Two things on the line are touched with a click, both in the accent color with an arrow after them (▴ at rest, ▾ while their panel is open): «F614 ▴» at the start, which opens the Forge614
 * panel, and «⇌ N MCP ▴» at the right, right before the version and three spaces from it, which opens the MCP servers' panel (N counts the connected ones). The MCP indicator is drawn only when
 * the snapshot knows the MCP servers (what is not known is not represented). Nothing on the line reacts to the pointer moving over it: only a left click on the text of an indicator does, and
 * only where it was drawn (`panels` keeps those columns). When the line does not fit, the end of the left part (folder, branch and changes, the last things on it) is cut with «…» first, to leave room for the MCP indicator and the version; only if
 * that would leave the left part under 20 visible columns is the version given up, and if it still does not fit, the MCP indicator. «F614 ▴» stays while there is room for it, and the rest
 * of the line is cut with «…» as it always was.
 */
export class ShellStatusBar implements Component {
  constructor(
    private readonly getSnapshot: () => ShellSnapshot,
    private readonly cwd?: string,
    private readonly getProject?: () => ProjectInfo | undefined,
    private readonly home = process.env.HOME,
    private readonly version?: string,
    private readonly locale: Locale = "en",
    private readonly sidebarVisible: () => boolean = () => true,
    /** The panels the indicators open; without them the indicators are drawn and nothing answers a click. */
    private readonly panels?: StatusPanels,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const t = getCatalog(this.locale).statusBar;
    const snapshot = this.getSnapshot();
    const arrow = (id: PanelId) => this.panels?.current() === id ? t.arrowOpen : t.arrowClosed;
    const details = snapshot.account === "connected"
      ? [backgroundActivityLabel(snapshot, this.locale)].filter((part): part is string => Boolean(part))
      : snapshot.account === "checking" ? [t.checkingAccount] : [snapshot.account === "unknown" ? t.accountUnverified : t.disconnected, snapshot.loginCommand ?? "/login"];
    const session = !this.sidebarVisible() && snapshot.account === "connected" ? [
      ...(snapshot.model ? [foreground(snapshot.model)] : []),
      ...(snapshot.reasoning ? [warning(snapshot.reasoning)] : []),
      ...(snapshot.context && snapshot.context.window > 0 ? [foreground(t.context({ percent: Math.round((snapshot.context.used / snapshot.context.window) * 100) }))] : []),
    ] : [];
    const projectInfo = this.getProject?.();
    const project = this.cwd ? [
      muted(homeRelativePath(this.cwd, this.home)),
      ...(projectInfo?.git ? [cyan(projectInfo.branch ?? t.detachedHead), projectInfo.changedFiles ? warning(t.changes({ count: projectInfo.changedFiles })) : cyan(t.clean)] : []),
    ] : [];
    const forge614 = cyan(`${t.forge614Indicator} ${arrow("forge614")}`);
    const left = [forge614, ...session, ...details, ...project].join(separator);
    const mcp = snapshot.mcpServers ? cyan(`${t.mcpIndicator({ count: connectedCount(snapshot.mcpServers) })} ${arrow("mcp")}`) : undefined;
    const release = this.version ? muted(`v${this.version}`) : undefined;
    const innerWidth = Math.max(0, width - 4);
    const fullLeftWidth = visibleWidth(left);
    // What goes at the right, in the order it is given up when the line does not fit: the version first, then the MCP indicator.
    const candidates = [[mcp, release], [mcp], []].map(parts => parts.filter((part): part is string => Boolean(part)));
    const rightWidth = (parts: string[]) => parts.reduce((total, part) => total + visibleWidth(part), 0) + RIGHT_GAP.length * Math.max(0, parts.length - 1);
    // The end of the left part (folder, branch, changes) is cut with «…» first, to leave room for what goes at the right; a candidate is taken only while the left part keeps MIN_LEFT_WIDTH columns.
    const fitted = candidates.map(parts => ({ parts, room: parts.length ? innerWidth - 1 - rightWidth(parts) : innerWidth }))
      .find(({ parts, room }) => !parts.length || fullLeftWidth <= room || room >= MIN_LEFT_WIDTH) ?? { parts: [], room: innerWidth };
    const right = fitted.parts;
    const drawnLeft = fullLeftWidth <= fitted.room ? left : truncateToWidth(left, fitted.room, "…");
    const leftWidth = visibleWidth(drawnLeft);
    const gap = Math.max(1, innerWidth - leftWidth - rightWidth(right));
    const line = right.length ? `${drawnLeft}${" ".repeat(gap)}${right.join(RIGHT_GAP)}` : drawnLeft;
    const indent = Math.min(2, width);
    const shown = visibleWidth(line) <= innerWidth ? line : truncateToWidth(line, innerWidth, "…");
    // Where each indicator is, in the chat's columns, counting only what was really drawn.
    const zones: Partial<Record<PanelId, Zone>> = { forge614: { start: indent, end: indent + Math.min(visibleWidth(forge614), visibleWidth(shown)) } };
    if (mcp && right.includes(mcp)) { const start = indent + leftWidth + gap; zones.mcp = { start, end: start + visibleWidth(mcp) }; }
    this.panels?.setZones(zones);
    return [" ".repeat(indent) + shown, ""];
  }

  /**
   * The mouse on the footer, in its own coordinates (row 0 is the line): a left click on the text of an indicator opens its panel, closes it if it was open, or switches to it from the other.
   * The press and the rest of the gesture on that text are taken too, so the click reaches the bar. Nothing else is answered: not the pointer moving over the text (it changes nothing here), not another button,
   * not the empty row under the line, and not the columns around the text.
   */
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (!this.panels || event.y !== 0 || event.button !== "left") return undefined;
    const id = (["forge614", "mcp"] as const).find(candidate => { const zone = this.panels!.zone(candidate); return zone !== undefined && event.x >= zone.start && event.x < zone.end; });
    if (!id) return undefined;
    if (event.type === "click") { this.panels.toggle(id); return { handled: true, render: true }; }
    if (event.type === "press" || event.type === "drag" || event.type === "release") return { handled: true };
    return undefined;
  }
}
