import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Component, TuiMouseEvent } from "@earendil-works/pi-tui";
import type { ShellSnapshot } from "./shell-state.ts";
import { readProjectInfo, type ProjectInfo } from "../../infrastructure/project-info.ts";
import { formatMemory } from "../../infrastructure/runtime-resources.ts";

import { accent as mint, warning as amber, muted, border, success } from "./theme.ts";
import { contextRing, isDisplayableUsage, progressBar, resetLabel, usageTitle } from "./metrics.ts";

function cut(text: string, width: number): string {
  return truncateToWidth(text, Math.max(0, width), "…");
}

function percent(used: number, window: number): number {
  return Math.round((used / window) * 100);
}

function compactNumber(value: number): string {
  return value >= 1_000 ? `${Math.round(value / 1_000)}k` : String(value);
}

export class ShellSidebar implements Component {
  private refreshAction?: () => Promise<void | string>;
  private repaint: () => void = () => {};
  private refreshRow = -1;
  private refreshing = false;
  private refreshMessage = "";
  setRefreshAction(action: () => Promise<void | string>, repaint: () => void): void { this.refreshAction = action; this.repaint = repaint; }
  async refreshUsage(): Promise<void> {
    if (this.refreshing) return;
    if (!this.refreshAction) throw new Error("Usage refresh is not supported by this engine.");
    if (this.getSnapshot().account !== "connected") throw new Error("Connect with /login first.");
    this.refreshing = true; this.refreshMessage = ""; this.repaint();
    try { this.refreshMessage = await this.refreshAction() || "Usage updated"; }
    catch { this.refreshMessage = "Refresh failed · try again"; }
    finally { this.refreshing = false; this.repaint(); }
  }
  handleMouse(event: TuiMouseEvent) {
    if (this.refreshRow < 0 || event.y !== this.refreshRow || event.x < 0 || event.type !== "click" || event.button !== "left") return undefined;
    void this.refreshUsage(); return { handled: true, render: true };
  }
  private project?: ProjectInfo;
  async refreshProject(): Promise<void> { if (this.cwd) this.project = await readProjectInfo(this.cwd); }
  projectInfo(): ProjectInfo | undefined { return this.project; }
  constructor(private readonly getSnapshot: () => ShellSnapshot, private readonly cwd?: string, private readonly home = process.env.HOME) {}

  invalidate(): void {}

  render(width: number): string[] {
    this.refreshRow = -1;
    const snapshot = this.getSnapshot();
    const line = (text = "") => cut(text, width);
    const heading = (title: string) => [line(mint(`// ${title}`)), border("─".repeat(Math.max(0, width)))];
    if (snapshot.account !== "connected") {
      const label = snapshot.account === "checking" ? "Checking…" : snapshot.account === "unknown" ? "Unverified" : "Disconnected";
      return [...heading("SESSION"), line(`Account  ${amber(label)}`), "", ...(snapshot.account === "checking" ? [line(muted("Checking native account"))] : [line(mint("/login to connect an account"))])];
    }

    const lines = [...heading("SESSION"), line(`Account  ${mint("Connected")}`), line(`${muted("Provider")}  ${snapshot.provider}`)];
    lines.push(line(`${muted("User")}  ${snapshot.user ?? "Not reported"}`));
    lines.push("", line(`${muted("Model")}  ${snapshot.model ?? "Engine default"}`));
    lines.push(line(`${muted("Reasoning")}  ${amber(snapshot.reasoning ?? "Provider default")}`));
    lines.push("", line(`${muted("Session")}  ${snapshot.sessionId ?? "New conversation"}`));
    if (snapshot.startedAt) {
      lines.push(line(`${muted("Opened")}  ${new Date(snapshot.startedAt).toLocaleTimeString()}`));
      lines.push(line(`${muted("Shell uptime")}  ${Math.max(0, Math.floor((Date.now() - snapshot.startedAt) / 60000))}m`));
    }
    if (snapshot.context) {
      const used = percent(snapshot.context.used, snapshot.context.window);
      const details = ["Conversation", `${used}% used`, `${Math.max(0, 100 - used)}% free`];
      lines.push("", ...heading("CONTEXT"), ...contextRing(used).map((ring, i) => line(ring + "  " + muted(details[i - 1] ?? ""))), line(`${compactNumber(snapshot.context.used)} / ${compactNumber(snapshot.context.window)} tokens`));
    } else lines.push("", ...heading("CONTEXT"), line(muted(snapshot.sessionId ? "Measurement unavailable" : "Available after first response")));
    const usage = snapshot.usage?.filter(item => isDisplayableUsage(item.label)) ?? [];
    if (usage.length) {
      lines.push("", ...heading("PLAN USAGE"), ...usage.flatMap(usage => [
        ...wrapTextWithAnsi(`${usageTitle(usage.label)} · ${usage.usedPercent}% used`, Math.max(1, width)),
        progressBar(usage.usedPercent, width),
        ...(usage.reset ? [line(muted(resetLabel(usage.reset)))] : []),
        "",
      ]));
    } else lines.push("", ...heading("PLAN USAGE"), line(muted("Usage unavailable from provider")));
    if (snapshot.resources) {
      lines.push("", ...heading("RESOURCES"), line(`${muted("Shell RAM")}  ${formatMemory(snapshot.resources.shellRssBytes)}`));
      lines.push(line(`${muted("Engine RAM")}  ${snapshot.resources.engineRssBytes === undefined ? "Not reported by engine" : formatMemory(snapshot.resources.engineRssBytes)}`));
    }
    if (snapshot.inputTokens !== undefined) lines.push(line(`Last input  ${snapshot.inputTokens} tokens`));
    if (snapshot.outputTokens !== undefined) lines.push(line(`Last output  ${snapshot.outputTokens} tokens`));
    if (snapshot.estimateUSD !== undefined) lines.push(line(`API estimate  $${snapshot.estimateUSD.toFixed(4)}`), line(muted("Not your subscription bill")));
    return lines;
  }
}
