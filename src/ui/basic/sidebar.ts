import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Component, TuiMouseEvent } from "@earendil-works/pi-tui";
import type { ShellSnapshot } from "./shell-state.ts";
import { readProjectInfo, type ProjectInfo } from "../../infrastructure/project-info.ts";
import { formatMemory } from "../../infrastructure/runtime-resources.ts";

import { accent as mint, warning as amber, muted, border, success } from "./theme.ts";
import { compactNumber, contextRing, isDisplayableUsage, progressBar, resetLabel, usageTitle } from "./metrics.ts";
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
  setRefreshAction(action: () => Promise<void | string>, repaint: () => void): void { this.refreshAction = action; this.repaint = repaint; }
  async refreshUsage(): Promise<void> {
    const t = getCatalog(this.locale).sidebar;
    if (this.refreshing) return;
    if (!this.refreshAction) throw new Error(t.refreshNotSupported);
    if (this.getSnapshot().account !== "connected") throw new Error(t.connectFirst);
    this.refreshing = true; this.refreshMessage = ""; this.repaint();
    try { this.refreshMessage = await this.refreshAction() || t.usageUpdated; }
    catch { this.refreshMessage = t.refreshFailed; }
    finally { this.refreshing = false; this.repaint(); }
  }
  handleMouse(event: TuiMouseEvent) {
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
    const heading = (title: string) => [line(mint(`// ${title}`)), border("─".repeat(Math.max(0, width)))];
    if (snapshot.account !== "connected") {
      const label = snapshot.account === "checking" ? t.checking : snapshot.account === "unknown" ? t.unverified : t.disconnected;
      return [...heading(t.headingSession), line(`${t.fieldAccount}  ${amber(label)}`), "", ...(snapshot.account === "checking" ? [line(muted(t.checkingNativeAccount))] : [line(mint(t.loginToConnect))])];
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
      const details = [t.conversationLabel, t.percentUsed({ percent: used }), t.percentFree({ percent: Math.max(0, 100 - used) })];
      lines.push("", ...heading(t.headingContext), ...contextRing(used).map((ring, i) => line(ring + "  " + muted(details[i - 1] ?? ""))), line(`${compactNumber(snapshot.context.used)} / ${compactNumber(snapshot.context.window)} tokens`));
    } else lines.push("", ...heading(t.headingContext), line(muted(snapshot.sessionId ? t.measurementUnavailable : t.availableAfterFirstResponse)));
    const usage = snapshot.usage?.filter(item => isDisplayableUsage(item.label)) ?? [];
    if (usage.length) {
      lines.push("", ...heading(t.headingPlanUsage), ...usage.flatMap(usage => [
        ...wrapTextWithAnsi(`${usageTitle(usage.label, this.locale)} · ${t.percentUsed({ percent: usage.usedPercent })}`, Math.max(1, width)),
        progressBar(usage.usedPercent, width),
        ...(usage.reset ? [line(muted(resetLabel(usage.reset, undefined, this.locale)))] : []),
        "",
      ]));
    } else lines.push("", ...heading(t.headingPlanUsage), line(muted(t.usageUnavailable)));
    // Token/cost figures for the last turn live right under PLAN USAGE — they're consumption info
    // too, not a system resource like RAM below.
    if (snapshot.inputTokens !== undefined || snapshot.outputTokens !== undefined) {
      lines.push(line(`${muted(t.fieldLastTurn)}  ${snapshot.inputTokens ?? "?"} ${t.tokensIn} · ${snapshot.outputTokens ?? "?"} ${t.tokensOut}`));
    }
    if (snapshot.estimateUSD !== undefined) {
      lines.push(line(`${muted(t.fieldEstimatedCost)}  $${snapshot.estimateUSD.toFixed(4)}`));
      lines.push(line(muted(t.referenceOnlyNotBilled)));
    }
    if (snapshot.resources) {
      lines.push("", ...heading(t.headingResources), line(`${muted(t.fieldShellRam)}  ${formatMemory(snapshot.resources.shellRssBytes)}`));
      lines.push(line(`${muted(t.fieldEngineRam)}  ${snapshot.resources.engineRssBytes === undefined ? t.notReportedByEngine : formatMemory(snapshot.resources.engineRssBytes)}`));
    }
    return lines;
  }
}
