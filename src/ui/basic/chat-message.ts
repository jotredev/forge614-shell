import { Container } from "@earendil-works/pi-tui";
import type { Component, TuiMouseEvent } from "@earendil-works/pi-tui";
import type { ChatLinks, LinkView } from "./chat-links.ts";
import { ChatText, accent, foreground, hardWrap, muted } from "./theme.ts";
import type { CodeBlockUi } from "./theme.ts";
import { ImageStrip, imagesInText } from "./chat-images.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";
import type { ClipboardCopyResult } from "../../infrastructure/clipboard.ts";

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
 * A message of the person, drawn like the agent's answers: on the left, with two columns of margin on each side, no background and no drawn border, and a quiet line over it with
 * «Human · time». To tell at a glance who speaks, the word «Human» is in the accent color and the time in gray, while the agent's name line is all gray. The text is plain text, not Markdown — what a person types is not
 * always Markdown, and a `#` or a `-` of theirs must not change shape — cut at the last space that fits (`hardWrap`, which keeps the indent and the spaces of what was pasted, and adds none to the rows that continue a line),
 * with its line breaks and blank lines kept; it is never cut off, however long. With `links` a path in the text that exists on disk is a link, like in the agent's answers.
 */
export class UserBubble implements Component {
  private readonly linkView?: LinkView;
  /** Present only when the message has `links`: it reports the pointer over one of its links, and never takes the event. */
  handleMouse?: (event: TuiMouseEvent) => undefined;
  private readonly name: string;
  private readonly time: string;
  private readonly links?: ChatLinks;
  private readonly strip?: ImageStrip;

  constructor(private readonly text: string, options: { locale: Locale; at?: number | null; links?: ChatLinks }) {
    this.links = options.links;
    this.name = getCatalog(options.locale).chatRoles.human;
    this.time = messageStamp(this.name, options.at).slice(this.name.length);
    // The images the person pasted as paths (a screenshot pasted into the terminal arrives as the path of its file) are drawn under the text; the text, with its path as a link, stays.
    const images = imagesInText(text);
    if (images.length) this.strip = new ImageStrip(images, { locale: options.locale, links: options.links, indent: MARGIN });
    if (this.links) { this.linkView = this.links.view(); this.handleMouse = event => this.linkView!.pointer(event); }
  }

  invalidate(): void { this.strip?.invalidate(); }

  render(width: number): string[] {
    const margin = " ".repeat(Math.min(MARGIN, Math.max(0, width - 1)));
    const textWidth = Math.max(1, width - MARGIN * 2);
    const rows = this.text.split("\n").flatMap(line => hardWrap(line, textWidth, 0))
      .map(line => line === "" ? "" : `${margin}${this.links ? this.links.linkify(line, foreground) : foreground(line)}`);
    const out = ["", `${margin}${accent(this.name)}${this.time ? muted(this.time) : ""}`, ...rows];
    // The image rows come after the link handling: they are never turned into links, cut or padded as text.
    return [...(this.linkView ? this.linkView.decorate(out) : out), ...(this.strip?.render(width) ?? [])];
  }
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
  /** Puts `text` on the clipboard or sends OSC 52 to the terminal (`copySelectionText` in the real screen). */
  copy: (text: string) => Promise<ClipboardCopyResult | boolean>;
  /** Asked to redraw the screen when the button's label changes by itself. */
  onChange: () => void;
  /** Told when `copy` could not: the chat says there is no clipboard. */
  onCopyFailed?: () => void;
  /** Told when the copy command only reached the terminal through OSC 52 and the terminal may ignore it. */
  onCopyTerminalFallback?: () => void;
  /** The answer's base color, for a message that is not a normal answer. */
  baseColor?: (text: string) => string;
}

/**
 * An answer of the agent: on the left, without a bubble, with a quiet line of name and time over it, the text drawn as Markdown with two columns of margin on each side. Its text
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
    this.addChild(this.body);
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
    let result: ClipboardCopyResult;
    try {
      const answer = await this.options.copy(code);
      result = answer === true ? "clipboard" : answer === false ? "failed" : answer;
    } catch { result = "failed"; }
    if (result === "terminal") { this.options.onCopyTerminalFallback?.(); return; }
    if (result === "failed") { this.options.onCopyFailed?.(); return; }
    this.ui.copied = index;
    this.body.invalidate();
    this.options.onChange();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.ui.copied = undefined; this.body.invalidate(); this.options.onChange(); }, COPIED_MS);
    this.timer.unref?.();
  }
}
