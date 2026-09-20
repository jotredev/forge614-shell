import { TuiAltScreen } from "@earendil-works/pi-tui";
import type { Component, Terminal } from "@earendil-works/pi-tui";
import { workspaceTerminal } from "../basic/workspace.ts";
import { accent, border, fit, muted } from "../basic/theme.ts";

/** Shared startup surface; the terminal shell stays outside the alternate screen. */
export function startupFrame(terminal: Terminal, title: string, list: Component, hint?: Component, body?: Component): TuiAltScreen {
  const tui = new TuiAltScreen(workspaceTerminal(terminal));
  tui.addChild({
    invalidate() { list.invalidate(); hint?.invalidate(); body?.invalidate(); },
    render(width) {
      const inner = Math.max(1, width - 8);
      return ["", accent("FORGE614") + " / SHELL", border("─".repeat(inner)), "",
        accent(title), "",
        ...(body ? [...body.render(inner), ""] : []),
        ...list.render(inner), "",
        ...(hint?.render(inner) ?? []), "",
        muted("↑/↓ navigate · Enter select · Esc cancel"),
      ].map(line => fit("    " + fit(line, inner), width));
    },
  });
  tui.setFocus(list);
  return tui;
}
