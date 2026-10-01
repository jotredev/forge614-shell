import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Component, TuiMouseEvent } from "@earendil-works/pi-tui";
import type { ShellSnapshot } from "./shell-state.ts";
import { readProjectInfo, type ProjectInfo } from "../../infrastructure/project-info.ts";
import { ActivityCard } from "./transcript.ts";
import { formatDuration } from "./duration.ts";

import { accent as mint, warning as amber, bold, muted } from "./theme.ts";
import { compactNumber, contextRing, formatCount, formatUsd, isDisplayableUsage, progressBar, resetLabel, usageTitle } from "./metrics.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";

function cut(text: string, width: number): string {
  return truncateToWidth(text, Math.max(0, width), "…");
}

function percent(used: number, window: number): number {
  return Math.round((used / window) * 100);
}

export class ShellSidebar implements Component {
  private refreshAction?: () => Promise<void | string>;
  private repaint: () => void = () => {};
  private refreshRow = -1;
  private refreshing = false;
  private refreshMessage = "";
  private expandedActivityIds = new Set<string>();
  private activityRows = new Map<number, string>();
  setRefreshAction(action: () => Promise<void | string>, repaint: () => void): void { this.refreshAction = action; this.repaint = repaint; }
  async refreshUsage(): Promise<void> {
    const t = getCatalog(this.locale).sidebar;
    if (this.refreshing) return;
    if (!this.refreshAction) throw new Error(t.refreshNotSupported);
    if (this.getSnapshot().account !== "connected") throw new Error(t.connectFirst({ command: this.getSnapshot().loginCommand ?? "/login" }));
    this.refreshing = true; this.refreshMessage = ""; this.repaint();
    try { this.refreshMessage = await this.refreshAction() || t.usageUpdated; }
    catch { this.refreshMessage = t.refreshFailed; }
    finally { this.refreshing = false; this.repaint(); }
  }
  /**
   * Consumes the left button's press/drag/release, exactly like the composer, so dragging a
   * selection in the chat can never spill into this column. Clicks still reach the activity rows.
   * (Keeping a selection still while the screen scrolls depends on pi-tui and is not handled here.)
   */
  handleMouse(event: TuiMouseEvent) {
    if (event.button === "left" && (event.type === "press" || event.type === "drag" || event.type === "release")) return { handled: true };
    const activityId = this.activityRows.get(event.y);
    if (activityId !== undefined && event.type === "click" && event.button === "left" && event.x >= 0) {
      if (this.expandedActivityIds.has(activityId)) this.expandedActivityIds.delete(activityId);
      else this.expandedActivityIds.add(activityId);
      this.repaint();
      return { handled: true, render: true };
    }
    if (this.refreshRow < 0 || event.y !== this.refreshRow || event.x < 0 || event.type !== "click" || event.button !== "left") return undefined;
    void this.refreshUsage(); return { handled: true, render: true };
  }
  private project?: ProjectInfo;
  async refreshProject(): Promise<void> { if (this.cwd) this.project = await readProjectInfo(this.cwd); }
  projectInfo(): ProjectInfo | undefined { return this.project; }
  constructor(private readonly getSnapshot: () => ShellSnapshot, private readonly cwd?: string, private readonly home = process.env.HOME, private readonly locale: Locale = "en") {}

  invalidate(): void {}

  render(width: number): string[] {
    const t = getCatalog(this.locale).sidebar;
    this.refreshRow = -1;
    const snapshot = this.getSnapshot();
    const line = (text = "") => cut(text, width);
    // Explanatory text wraps instead of being cut with "…": a reason the person cannot read is worse than a second row.
    const note = (text: string) => wrapTextWithAnsi(muted(text), Math.max(1, width));
    // A section title is one row in the accent color, bold, followed by an empty row before its content: the space above it separates the sections, no rule is drawn under it.
    const heading = (title: string) => [line(bold(mint(`// ${title}`))), ""];
    if (snapshot.account !== "connected") {
      const label = snapshot.account === "checking" ? t.checking : snapshot.account === "unknown" ? t.unverified : t.disconnected;
      return [...heading(t.headingSession), line(`${t.fieldAccount}  ${amber(label)}`), "", ...(snapshot.account === "checking" ? [line(muted(t.checkingNativeAccount))] : [line(mint(t.loginToConnect({ command: snapshot.loginCommand ?? "/login" })))])];
    }

    const lines = [...heading(t.headingSession), line(`${t.fieldAccount}  ${mint(t.fieldConnected)}`), line(`${muted(t.fieldProvider)}  ${snapshot.provider}`)];
    lines.push(line(`${muted(t.fieldUser)}  ${snapshot.user ?? t.notReported}`));
    lines.push("", line(`${muted(t.fieldModel)}  ${snapshot.model ?? t.notReportedYet}`));
    lines.push(line(`${muted(t.fieldReasoning)}  ${amber(snapshot.reasoning ?? getCatalog(this.locale).metrics.reasoningDefaultLabel)}`));
    lines.push("", line(`${muted(t.fieldSession)}  ${snapshot.sessionId ?? t.newConversation}`));
    if (snapshot.startedAt) {
      lines.push(line(`${muted(t.fieldOpened)}  ${new Date(snapshot.startedAt).toLocaleTimeString()}`));
      lines.push(line(`${muted(t.fieldShellUptime)}  ${Math.max(0, Math.floor((Date.now() - snapshot.startedAt) / 60000))}m`));
    }
    if (snapshot.context) {
      const used = percent(snapshot.context.used, snapshot.context.window);
      // The three lines beside the ring sit on its rows 3 to 5 of 7, around the middle row where the percentage is written.
      const details = [t.conversationLabel, t.percentUsed({ percent: used }), t.percentFree({ percent: Math.max(0, 100 - used) })];
      lines.push("", ...heading(t.headingContext), ...contextRing(used).map((ring, i) => line(ring + "  " + muted(details[i - 2] ?? ""))), line(`${compactNumber(snapshot.context.used)} / ${compactNumber(snapshot.context.window)} tokens`));
    } else lines.push("", ...heading(t.headingContext), ...note(snapshot.sessionId ? t.contextAfterNextMessage : t.contextAfterFirstMessage));
    const usage = snapshot.usage?.filter(item => isDisplayableUsage(item.label)) ?? [];
    if (usage.length) {
      lines.push("", ...heading(t.headingPlanUsage), ...usage.flatMap(usage => [
        ...wrapTextWithAnsi(`${usageTitle(usage.label, this.locale)} · ${t.percentUsed({ percent: usage.usedPercent })}`, Math.max(1, width)),
        progressBar(usage.usedPercent, width),
        ...(usage.reset ? [line(muted(resetLabel(usage.reset, undefined, this.locale)))] : []),
        "",
      ]));
    } else lines.push("", ...heading(t.headingPlanUsage), ...note(t.usageUnavailable));
    // The last message's tokens and the pay-per-use estimate live right under PLAN USAGE — they're
    // consumption info too. Each is a short title followed by plain-language rows, so nothing has to fit on one line.
    if (snapshot.inputTokens !== undefined || snapshot.outputTokens !== undefined) {
      lines.push(line(t.lastMessageTitle));
      if (snapshot.inputTokens !== undefined) lines.push(...note(t.lastMessageRead({ tokens: formatCount(snapshot.inputTokens, this.locale) })));
      if (snapshot.outputTokens !== undefined) lines.push(...note(t.lastMessageWrote({ tokens: formatCount(snapshot.outputTokens, this.locale) })));
    }
    if (snapshot.estimateUSD !== undefined) {
      if (snapshot.inputTokens !== undefined || snapshot.outputTokens !== undefined) lines.push("");
      lines.push(line(t.payPerUseTitle));
      lines.push(...note(snapshot.estimateUSD < 0.01 ? t.payPerUseUnderOneCent : t.payPerUseAmount({ amount: formatUsd(snapshot.estimateUSD, this.locale) })));
      lines.push(...note(t.planDoesNotBill));
    }
    this.activityRows = new Map();
    if (snapshot.backgroundActivitySupported !== undefined) {
      const ba = getCatalog(this.locale).backgroundActivity;
      lines.push("", ...heading(ba.heading));
      if (!snapshot.backgroundActivitySupported) {
        lines.push(line(muted(ba.notReportedByEngine)));
      } else if (!snapshot.backgroundActivity?.length) {
        lines.push(line(muted(ba.idle)));
      } else {
        for (const activity of snapshot.backgroundActivity) {
          const elapsed = formatDuration(((activity.endedAt ?? Date.now()) - activity.startedAt) / 1000);
          const stateLabel = activity.state === "running" ? ba.running : activity.state === "done" ? ba.done : ba.failed;
          const expanded = this.expandedActivityIds.has(activity.id);
          const status = `${stateLabel} · ${elapsed}`;
          // One row: the title gives way (cut with "…") so the state and time stay visible; expanded, the full title shows.
          const room = Math.max(1, width - visibleWidth(`• `) - visibleWidth(` · ${status}`));
          const title = expanded ? activity.label : truncateToWidth(activity.label.replace(/\s+/g, " "), room, "…");
          const card = new ActivityCard(title, status, (activity.detail ?? "").slice(0, 2000), expanded, undefined, 0, false);
          const cardLines = card.render(width);
          // Collapsed cards render ["", summary, preview?] — the title sits at index 1.
          // Expanded cards render ["", padding, "▾ title", ...body, padding, ""] — the title sits at index 2.
          this.activityRows.set(lines.length + (expanded ? 2 : 1), activity.id);
          lines.push(...cardLines);
        }
      }
    }
    return lines;
  }
}
