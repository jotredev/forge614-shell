import { TuiAltScreen } from "@earendil-works/pi-tui";
import type { Component, Terminal, TuiStopOptions } from "@earendil-works/pi-tui";
import { workspaceTerminal } from "../basic/workspace.ts";
import { accent, bold, border, fit, muted } from "../basic/theme.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";

/** Shared startup surface; the terminal shell stays outside the alternate screen. */
export function startupFrame(terminal: Terminal, title: string, list: Component, hint?: Component, body?: Component, version?: string): TuiAltScreen {
  const tui = new TuiAltScreen(workspaceTerminal(terminal));
  tui.addChild({
    invalidate() { list.invalidate(); hint?.invalidate(); body?.invalidate(); },
    render(width) {
      const inner = Math.max(1, width - 8);
      const navHint = "↑/↓ navigate · Enter select · Esc cancel";
      const versionText = version ? `v${version}` : "";
      const navLine = versionText && inner >= navHint.length + versionText.length + 2
        ? `${muted(navHint)}${" ".repeat(inner - navHint.length - versionText.length)}${muted(versionText)}`
        : muted(navHint);
      return ["", bold(accent("FORGE614")) + " / SHELL", border("─".repeat(inner)), "",
        accent(title), "",
        ...(body ? [...body.render(inner), ""] : []),
        ...list.render(inner), "",
        ...(hint?.render(inner) ?? []), "",
        navLine,
      ].map(line => fit("    " + fit(line, inner), width));
    },
  });
  tui.setFocus(list);
  return tui;
}

/**
 * One persistent alternate-screen session reused across every step of `init --product engram`.
 * Screens swap their title/list/hint/body in place via `setScreen`; the alt-screen itself is
 * created once and torn down once, so the person never sees the normal terminal reappear between
 * questions, the summary, memory setup, the preview, and the final result.
 */
export class EngramFlowScreen {
  readonly tui: TuiAltScreen;
  private title = "";
  private list: Component = { render: () => [], invalidate: () => {} };
  private hint?: Component;
  private body?: Component;

  constructor(terminal: Terminal, private readonly version?: string, private readonly locale: Locale = "en") {
    this.tui = new TuiAltScreen(workspaceTerminal(terminal));
    this.tui.addChild({
      invalidate: () => { this.list.invalidate(); this.hint?.invalidate(); this.body?.invalidate(); },
      render: (width: number) => {
        const inner = Math.max(1, width - 8);
        const navHint = getCatalog(this.locale).engramInit.navHint;
        const versionText = this.version ? `v${this.version}` : "";
        const navLine = versionText && inner >= navHint.length + versionText.length + 2
          ? `${muted(navHint)}${" ".repeat(inner - navHint.length - versionText.length)}${muted(versionText)}`
          : muted(navHint);
        return ["", bold(accent("FORGE614")) + " / SHELL", border("─".repeat(inner)), "",
          accent(this.title), "",
          ...(this.body ? [...this.body.render(inner), ""] : []),
          ...this.list.render(inner), "",
          ...(this.hint?.render(inner) ?? []), "",
          navLine,
        ].map(line => fit("    " + fit(line, inner), width));
      },
    });
  }

  setScreen(title: string, list: Component, opts: { hint?: Component; body?: Component } = {}): void {
    this.title = title; this.list = list; this.hint = opts.hint; this.body = opts.body;
    this.tui.setFocus(list);
    this.tui.requestRender(true);
  }

  start(): void { this.tui.start(); }
  stop(options?: TuiStopOptions): void { this.tui.stop(options); }
}
