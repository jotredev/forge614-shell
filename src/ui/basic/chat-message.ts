import { Container, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Component, TuiMouseEvent } from "@earendil-works/pi-tui";
import type { ChatLinks, LinkView } from "./chat-links.ts";
import { ChatText, foreground, muted } from "./theme.ts";
import type { CodeBlockUi } from "./theme.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";

/** The widest an answer is drawn, in columns of text (the two columns of margin on each side come on top): a line longer than this is hard to read. */
export const MAX_READING_WIDTH = 100;
/** Columns of margin between the chat's edge and a message, on the side the message is not aligned to. */
const MARGIN = 2;
/** How long the button says «Copied» before it goes back to «Copy». */
const COPIED_MS = 2000;

/** The time as the chat shows it: hours and minutes of the person's locale. */
const clockTime = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * The quiet line over an answer: the agent's name and the time. `at` is the time of a message replayed from a saved conversation (milliseconds since the epoch); `null` means the time is not known, and the line
 * shows none rather than a false one; left out (a live message) it takes the time of now.
 */
export function messageStamp(name: string, at?: number | null): string {
  return at === null ? name : `${name} · ${clockTime(at ?? Date.now())}`;
}

/**
 * A message of the person, in the same style as the agent's answers but on the right: a quiet line over it with «Human · time» (the same format and color as the agent's name line, aligned to the right margin), and the
 * text under it with no background and no drawn border, as a block of at most two thirds of the width ending at the right margin, two columns from the edge. The text is cut inside that block and keeps its line
 * breaks. With `links` a path in the text that exists on disk is a link, like in the agent's answers.
 */
export class UserBubble implements Component {
  private readonly linkView?: LinkView;
  /** Present only when the message has `links`: it reports the pointer over one of its links, and never takes the event. */
  handleMouse?: (event: TuiMouseEvent) => undefined;
  private readonly stamp: string;
  private readonly links?: ChatLinks;

  constructor(private readonly text: string, options: { locale: Locale; at?: number | null; links?: ChatLinks }) {
    this.links = options.links;
    this.stamp = messageStamp(getCatalog(options.locale).chatRoles.human, options.at);
    if (this.links) { this.linkView = this.links.view(); this.handleMouse = event => this.linkView!.pointer(event); }
  }

  invalidate(): void {}

  render(width: number): string[] {
    const margin = Math.min(MARGIN, Math.max(0, width - 1));
    const blockMax = Math.max(1, Math.floor((width * 2) / 3));
    const lines = this.text.split("\n").flatMap(line => line === "" ? [""] : wrapTextWithAnsi(line, blockMax));
    const inner = Math.max(1, ...lines.map(line => visibleWidth(line)));
    const left = " ".repeat(Math.max(0, width - margin - inner));
    const rows = lines.map(line => line === "" ? "" : `${left}${this.links ? this.links.linkify(line, foreground) : foreground(line)}${" ".repeat(inner - visibleWidth(line))}`);
    const stamp = " ".repeat(Math.max(0, width - margin - visibleWidth(this.stamp))) + muted(this.stamp);
    const out = ["", stamp, ...rows];
    return this.linkView ? this.linkView.decorate(out) : out;
  }
}

/** Draws `child` no wider than the reading width plus its margins, and hands it the mouse at that width. */
class ReadingColumn implements Component {
  constructor(private readonly child: ChatText) {}
  private cap(width: number) { return Math.min(width, MAX_READING_WIDTH + MARGIN * 2); }
  invalidate(): void { this.child.invalidate(); }
  render(width: number): string[] { return this.child.render(this.cap(width)); }
  handleMouse(event: TuiMouseEvent) { return this.child.handleMouse({ ...event, width: this.cap(event.width) }); }
}

/** The grey line over an answer with the agent's name and the time, one blank row above it. */
class MessageStamp implements Component {
  constructor(private readonly stamp: string) {}
  invalidate(): void {}
  render(): string[] { return ["", `${" ".repeat(MARGIN)}${muted(this.stamp)}`]; }
}

export interface AssistantMessageOptions {
  /** The agent's name, for the quiet line over the answer. */
  agent: string;
  locale: Locale;
  /** See `messageStamp`. */
  at?: number | null;
  links?: ChatLinks;
  /** Puts `text` on the clipboard and answers whether it could (`copySelectionText` in the real screen). */
  copy: (text: string) => Promise<boolean>;
  /** Asked to redraw the screen when the button's label changes by itself. */
  onChange: () => void;
  /** Told when `copy` could not: the chat says there is no clipboard. */
  onCopyFailed?: () => void;
  /** The answer's base color, for a message that is not a normal answer. */
  baseColor?: (text: string) => string;
}

/**
 * An answer of the agent: on the left, without a bubble, with a quiet line of name and time over it, the text drawn as Markdown with two columns of margin and at most `MAX_READING_WIDTH` columns of text. Its text
 * arrives in parts (`setText` replaces it). The answer itself has no «Copy»: what the agents put in a fenced code block — a prompt, a command, code, a text for somewhere else — is what is meant to be copied and pasted, so
 * each such block carries its own grey «Copy» on the right of its first row (see `CodeBlockUi`). A block still being written has none until it closes or the answer is complete (`complete`). A click copies exactly the block's
 * original content — no fences, no language, none of the cuts Shell makes to fit lines — and its label says «Copied» for `COPIED_MS`.
 */
export class AssistantMessage extends Container {
  private readonly ui: CodeBlockUi;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly body: ChatText;

  constructor(private readonly options: AssistantMessageOptions) {
    super();
    const copy = getCatalog(options.locale).chatCopy;
    this.ui = { copyLabel: copy.copy, copiedLabel: copy.copied, complete: false, blocks: [] };
    this.body = new ChatText("", options.baseColor, options.links, 0, this.ui);
    this.body.onCopyBlock = (index, code) => void this.copyBlock(index, code);
    this.addChild(new MessageStamp(messageStamp(options.agent, options.at)));
    this.addChild(new ReadingColumn(this.body));
  }

  /** The answer as it is now, replacing what was there; `text` is exactly what the agent sent (the caller has only removed terminal control codes). */
  setText(text: string): void {
    this.body.setText(text);
  }

  /** The agent finished this answer: a code block left open gets its button too. */
  complete(): void {
    this.ui.complete = true;
    this.body.invalidate();
  }

  private async copyBlock(index: number, code: string): Promise<void> {
    let copied = false;
    try { copied = await this.options.copy(code); } catch { copied = false; }
    if (!copied) { this.options.onCopyFailed?.(); return; }
    this.ui.copied = index;
    this.body.invalidate();
    this.options.onChange();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.ui.copied = undefined; this.body.invalidate(); this.options.onChange(); }, COPIED_MS);
    this.timer.unref?.();
  }
}
