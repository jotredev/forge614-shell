import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import type { ShellSnapshot } from "./shell-state.ts";
import type { ProjectInfo } from "../../infrastructure/project-info.ts";
import { homeRelativePath } from "../../infrastructure/runtime-resources.ts";

import { accent as cyan, muted, warning } from "./theme.ts";
const separator = muted(" · ");

function contextPercent(snapshot: ShellSnapshot): string | undefined {
  if (!snapshot.context || snapshot.context.window <= 0) return undefined;
  return `ctx ${Math.round((snapshot.context.used / snapshot.context.window) * 100)}%`;
}

/** A deliberately compact workspace footer: unknown data is never represented. */
export class ShellStatusBar implements Component {
  constructor(
    private readonly getSnapshot: () => ShellSnapshot,
    private readonly cwd?: string,
    private readonly getProject?: () => ProjectInfo | undefined,
    private readonly home = process.env.HOME,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const snapshot = this.getSnapshot();
    const details = snapshot.account === "connected"
      ? [snapshot.provider, snapshot.model, snapshot.reasoning, contextPercent(snapshot)].filter((part): part is string => Boolean(part))
      : snapshot.account === "checking" ? ["Checking account…"] : [snapshot.account === "unknown" ? "Account unverified" : "Disconnected", "/login"];
    const projectInfo = this.getProject?.();
    const project = this.cwd ? [
      muted(homeRelativePath(this.cwd, this.home)),
      ...(projectInfo?.git ? [cyan(projectInfo.branch ?? "Detached HEAD"), projectInfo.changedFiles ? warning(`${projectInfo.changedFiles} changes`) : cyan("Clean")] : []),
    ] : [];
    const line = [cyan("F614"), ...details, ...project].join(separator);
    const innerWidth = Math.max(0, width - 4);
    return [" ".repeat(Math.min(2, width)) + (visibleWidth(line) <= innerWidth ? line : truncateToWidth(line, innerWidth, "…")), ""];
  }
}
