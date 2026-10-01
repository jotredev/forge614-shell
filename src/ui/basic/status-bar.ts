import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import type { ShellSnapshot } from "./shell-state.ts";
import type { ProjectInfo } from "../../infrastructure/project-info.ts";
import { homeRelativePath } from "../../infrastructure/runtime-resources.ts";
import { spinnerFrame } from "./composer.ts";

import { accent as cyan, foreground, muted, warning } from "./theme.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";
const separator = muted(" · ");

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
 * move here, right after «F614» and before the folder: the model in normal text, the reasoning in the
 * warning color (the value the sidebar shows) and «context N %» in normal text, each only when known
 * and only with a connected account, like the sidebar's own session section. A non-connected
 * account is kept as a warning (with its `/login` hint) so it still reaches a terminal too narrow
 * for the sidebar. `sidebarVisible` says whether the sidebar is drawn right now; it is asked on each
 * draw, and by default the sidebar is taken to be on screen.
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
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const t = getCatalog(this.locale).statusBar;
    const snapshot = this.getSnapshot();
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
    const left = [cyan("F614"), ...session, ...details, ...project].join(separator);
    const release = this.version ? muted(`v${this.version}`) : undefined;
    const innerWidth = Math.max(0, width - 4);
    const availableLeft = Math.max(1, innerWidth - (release ? visibleWidth(release) + 1 : 0));
    const compactLeft = release ? truncateToWidth(left, availableLeft, "…") : left;
    const line = release && visibleWidth(release) < innerWidth
      ? `${compactLeft}${" ".repeat(Math.max(1, innerWidth - visibleWidth(compactLeft) - visibleWidth(release)))}${release}`
      : left;
    return [" ".repeat(Math.min(2, width)) + (visibleWidth(line) <= innerWidth ? line : truncateToWidth(line, innerWidth, "…")), ""];
  }
}
