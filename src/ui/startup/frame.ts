import { TuiAltScreen } from "@earendil-works/pi-tui";
import type { Component, Terminal } from "@earendil-works/pi-tui";
import { workspaceTerminal } from "../basic/workspace.ts";
import { accent, bold, border, fit, muted } from "../basic/theme.ts";

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
