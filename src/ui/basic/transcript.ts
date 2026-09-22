import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import { accent as cyan, added, addedBackground, muted, fit, panelBackground, removed, removedBackground } from "./theme.ts";
import type { DiffLine } from "./diff.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";

const MAX_DIFF_LINES_SHOWN = 60;


export function chatMessage(role: "user" | "assistant" | "system", content: string, locale: Locale = "en"): string {
  const t = getCatalog(locale).chatRoles;
  const label = role === "user" ? t.you : role === "assistant" ? t.assistant : t.system;
  return `## ${label} · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}\n\n${content}`;
}

/**
 * Activity line for a real tool event emitted by an engine.
 * Routine tool calls (searches, memory ops, reads) render as a plain, non-interactive bullet line
 * — no border, no background, no click-to-expand — matching how a plain agent CLI reports tool use.
 * There is nothing to expand: what you see is everything there is. Only `full` cards (a file edit's
 * diff, or a permission request that needs a decision) get the bordered detail box, because those
 * two are the cases where seeing the whole thing is the point.
 */
export class ActivityCard implements Component {
  constructor(
    private readonly title: string,
    private status: string,
    private detail: string = "",
    private readonly full = false,
    private diffLines?: DiffLine[],
  ) {}

  update(status: string, detail?: string): void {
    this.status = status;
    if (detail !== undefined) { this.detail = detail; this.diffLines = undefined; }
  }

  invalidate(): void {}

  private summary(): string {
    return this.status ? `${this.title} · ${this.status}` : this.title;
  }

  /** Renders a unified diff with a full-width green/red row highlight — computed fresh each call so it reflows on resize. */
  private diffBody(innerWidth: number): string[] {
    const lines = this.diffLines!;
    const shown = lines.slice(0, MAX_DIFF_LINES_SHOWN);
    const gutterWidth = Math.max(2, String(shown.reduce((max, line) => Math.max(max, line.lineNumber), 1)).length);
    const rows = shown.flatMap(line => {
      const marker = line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " ";
      const raw = `${String(line.lineNumber).padStart(gutterWidth, " ")} ${marker} ${line.text}`;
      return wrapTextWithAnsi(raw, innerWidth).map(sub => {
        const padded = fit(sub, innerWidth);
        if (line.kind === "add") return addedBackground(added(padded));
        if (line.kind === "remove") return removedBackground(removed(padded));
        return muted(padded);
      });
    });
    if (lines.length > shown.length) rows.push(muted(fit(`… ${lines.length - shown.length} more lines`, innerWidth)));
    return rows;
  }

  render(width: number): string[] {
    if (!this.full) {
      const line = fit(muted(`• ${this.summary()}`), width);
      const preview = this.detail.split("\n")[0]?.trim();
      return preview ? ["", line, fit(muted(`  └ ${preview}`), width)] : ["", line];
    }
    const outer = Math.min(2, Math.max(0, width - 1));
    const cardWidth = Math.max(1, width - outer * 2);
    const innerWidth = Math.max(1, cardWidth - 4);
    const top = `${cyan("│")} ${cyan(fit(`▾ ${this.summary()}`, innerWidth))}`;
    const body = this.diffLines
      ? this.diffBody(innerWidth).map(line => `${cyan("│")} ${line}`)
      : wrapTextWithAnsi(muted(this.detail), innerWidth).map(line => `${cyan("│")} ${fit(line, innerWidth)}`);
    const padding = `${cyan("│")} ${" ".repeat(innerWidth)}`;
    return ["", ...[padding, top, ...body, padding].map(line => " ".repeat(outer) + panelBackground(fit(line, cardWidth))), ""];
  }
}
