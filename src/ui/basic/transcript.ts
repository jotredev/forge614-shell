import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Component, TuiMouseEvent } from "@earendil-works/pi-tui";
import type { ChatLinks, LinkView } from "./chat-links.ts";
import { accent as cyan, added, addedBackground, muted, fit, removed, removedBackground, surface } from "./theme.ts";
import type { DiffLine } from "./diff.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";

const MAX_DIFF_LINES_SHOWN = 60;

/**
 * Columns a routine tool line is pushed in from the chat's left edge. Assistant headers and text
 * start at column 2 (the markdown padding), so 4 puts the grey line clearly inside the message it
 * belongs to, and the `└` preview one step further in.
 */
export const TOOL_INDENT = 4;


/**
 * A chat message: a header with the role and the time, then the text. `at` is the time of a message replayed from a saved
 * conversation (milliseconds since the epoch); `null` means the time is not known, and the header shows none rather than a
 * false one; left out (a live message) it takes the time of now.
 */
export function chatMessage(role: "user" | "assistant" | "system", content: string, locale: Locale = "en", at?: number | null): string {
  const t = getCatalog(locale).chatRoles;
  const label = role === "user" ? t.you : role === "assistant" ? t.assistant : t.system;
  const time = at === null ? "" : ` · ${new Date(at ?? Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return `## ${label}${time}\n\n${content}`;
}

/**
 * Activity line for a real tool event emitted by an engine.
 * Routine tool calls (searches, memory ops, reads) render as a plain, non-interactive bullet line
 * — no background, no click-to-expand — matching how a plain agent CLI reports tool use.
 * There is nothing to expand: what you see is everything there is. Only `full` cards (a file edit's
 * diff, or a permission request that needs a decision) get the detail block (surface background, no drawn border), because those
 * two are the cases where seeing the whole thing is the point.
 */
export class ActivityCard implements Component {
  constructor(
    private readonly title: string,
    private status: string,
    private detail: string = "",
    private readonly full = false,
    private diffLines?: DiffLine[],
    /** Left indent of a routine (non-`full`) line. The chat uses the default; the narrow sidebar passes 0. */
    private readonly indent = TOOL_INDENT,
    /** Whether a routine line adds a second `└` row with the detail's first line. The sidebar turns it off: there the title, state and time are the whole row. */
    private readonly showPreview = true,
    /** The chat passes its links: a path in the title, the detail or a full card's body that exists on disk becomes a link, and the link under the pointer is lit. The sidebar passes none. */
    private readonly links?: ChatLinks,
  ) {
    if (links) { this.linkView = links.view(); this.handleMouse = event => this.linkView!.pointer(event); }
  }

  private readonly linkView?: LinkView;
  /** Present only when the card has `links`: it reports the pointer over one of its links, and never takes the event (a card without links has no mouse handling at all). */
  handleMouse?: (event: TuiMouseEvent) => undefined;

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

  /** `text` painted with `paint`, with the paths in it that exist drawn as links when the card has links. */
  private paint(text: string, paint: (text: string) => string): string {
    return this.links ? this.links.linkify(text, paint) : paint(text);
  }

  render(width: number): string[] {
    const rows = this.rows(width);
    return this.linkView ? this.linkView.decorate(rows) : rows;
  }

  private rows(width: number): string[] {
    if (!this.full) {
      const pad = " ".repeat(Math.min(this.indent, Math.max(0, width - 1)));
      const line = fit(this.paint(`${pad}• ${this.summary()}`, muted), width);
      const preview = !this.showPreview ? undefined : this.detail.split("\n")[0]?.trim();
      return preview ? ["", line, fit(this.paint(`${pad}  └ ${preview}`, muted), width)] : ["", line];
    }
    const outer = Math.min(2, Math.max(0, width - 1));
    const cardWidth = Math.max(1, width - outer * 2);
    // A block of the surface gray with one column of padding on each side; nothing is drawn at its edge.
    const innerWidth = Math.max(1, cardWidth - 2);
    const row = (content: string) => ` ${fit(content, innerWidth)} `;
    const top = row(this.paint(`▾ ${this.summary()}`, cyan));
    const body = this.diffLines
      ? this.diffBody(innerWidth).map(row)
      : wrapTextWithAnsi(this.paint(this.detail, muted), innerWidth).map(row);
    const padding = row("");
    return ["", ...[padding, top, ...body, padding].map(line => " ".repeat(outer) + surface(fit(line, cardWidth))), ""];
  }
}
