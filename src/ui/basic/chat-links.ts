import { randomBytes } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import { getCapabilities, setCapabilities, visibleWidth } from "@earendil-works/pi-tui";
import type { TuiMouseEvent } from "@earendil-works/pi-tui";
import { accent, linkHover } from "./theme.ts";
import { DEFAULT_POINTER, LINK_POINTER } from "./sidebar-layout.ts";
import { isOpenableWebUrl, openWebPage } from "../../infrastructure/browser.ts";
import { openLocalPath, resolveLocalPath } from "../../infrastructure/local-path.ts";

/** What a click on a link does, each replaceable so a test opens nothing for real: open a web page, open (or only show) a path. Both answer false when they could not. */
export interface ChatLinkTools { openWeb(url: string): Promise<boolean>; openPath(path: string): Promise<boolean> }

/** The real openers: `openWebPage` for `http:`/`https:` and `openLocalPath` for paths. */
export const realChatLinkTools: ChatLinkTools = { openWeb: url => openWebPage(url), openPath: path => openLocalPath(path) };

export interface ChatLinksOptions {
  /** The session's folder, which a relative path is relative to. */
  cwd: string;
  /** The person's home folder, for `~/…`. */
  home?: string;
  tools?: ChatLinkTools;
  /** Told the path or address when opening it failed, so the chat can say so. */
  onFailure?: (target: string) => void;
  /** The secret that marks the links Shell itself made (random for each run); a test fixes it to read the addresses. */
  nonce?: string;
}

/**
 * Whether Shell should turn the terminal's hyperlinks (OSC 8) on by itself: Terminal.app (`Apple_Terminal`) and Orca, which pi-tui does not know and so leaves off, although the
 * screen's own mouse handling makes a click on a link work in both. Under tmux or screen, with an unknown terminal, or when the person set `PI_HYPERLINKS`, pi-tui's answer stays.
 */
export function terminalWantsLinks(env: NodeJS.ProcessEnv): boolean {
  if (env.PI_HYPERLINKS !== undefined || env.TMUX !== undefined || env.STY !== undefined || /^(tmux|screen)/.test(env.TERM ?? "")) return false;
  return env.TERM_PROGRAM === "Apple_Terminal" || env.TERM_PROGRAM === "Orca";
}

/** Turns pi-tui's hyperlink capability on when `terminalWantsLinks` says so, keeping every other capability as it was. Called when a chat screen opens, before any text is drawn. */
export function enableTerminalLinks(env: NodeJS.ProcessEnv = process.env): void {
  if (terminalWantsLinks(env) && !getCapabilities().hyperlinks) setCapabilities({ ...getCapabilities(), hyperlinks: true });
}

/** A run of text without spaces or quotes or brackets that may be a path; it ends where an `=` or a quote, comma, bracket or space does, and starts at the beginning of the text or after one. */
const TOKEN = /(?<=^|[\s(\[{"'`<,;=])[^\s"'`<>()\[\]{}|,;*?=]{2,1024}/g;
/** The full-stop, colon or bang a sentence puts after a path, which is not part of it. */
const TRAILING_PUNCTUATION = /[.:!]+$/;

/** Reconoce rutas absolutas, `~/`, `./`, `../`, carpetas y nombres con extensión. En Windows acepta `\\` como separador; excluye direcciones `://` y rutas que empiezan con `//`. */
function looksLikePath(token: string): boolean {
  if (token.includes("://") || token.startsWith("//")) return false;
  if (token.startsWith("/")) return token.length > 1;
  if (token.startsWith("~/") || token.startsWith("./") || token.startsWith("../")) return token.length > 2;
  if (token.includes("/") || (process.platform === "win32" && token.includes("\\"))) return true;
  return /^[\w@+-][\w@+.-]*\.[A-Za-z0-9]+(?::\d+(?::\d+)?)?$/.test(token);
}

/** An OSC 8 sequence: the parameters (like `id=`) and the address, which is empty when the sequence closes a link. */
const OSC8 = /\x1b\]8;([^;\x07\x1b]*);([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
const SGR = /\x1b\[[0-9;]*m/g;

/** One link on one row: where its sequences are in the string, which columns it covers, and (set later) which link of the whole text it belongs to. */
interface Span { url: string; open: number; contentStart: number; contentEnd: number; end: number; start: number; stop: number; group: number }

/** The links of a row: every OSC 8 hyperlink that opens, with its position in the string and the visible columns it covers (`start` included, `stop` not). */
function spansOf(row: string): Span[] {
  if (!row.includes("\x1b]8;")) return [];
  const spans: Span[] = [];
  let current: { url: string; open: number; contentStart: number } | undefined;
  const close = (contentEnd: number, end: number) => {
    if (!current) return;
    spans.push({ ...current, contentEnd, end, start: visibleWidth(row.slice(0, current.contentStart)), stop: visibleWidth(row.slice(0, contentEnd)), group: -1 });
    current = undefined;
  };
  for (const match of row.matchAll(OSC8)) {
    close(match.index, match.index + match[0].length);
    if (match[2]) current = { url: match[2], open: match.index, contentStart: match.index + match[0].length };
  }
  close(row.length, row.length);
  return spans;
}

const sameHover = (a: Hover | undefined, b: Hover | undefined) => a?.view === b?.view && a?.group === b?.group;
interface Hover { view: LinkView; group: number }

/**
 * The links of one component (a message, a tool card): it finds them in the rows the component drew, tells which rows belong to the same link (one that wrapped onto a second
 * row), draws the hovered one lit and answers which link is under the pointer. One instance per component, made by `ChatLinks.view()`.
 */
export class LinkView {
  private spans: Span[][] = [];
  private lastRows?: string[];
  private lastGroup?: number;
  private lastOut: string[] = [];
  constructor(private readonly links: ChatLinks) {}

  /**
   * The rows to draw. First, a Markdown link to an existing local path becomes one of Shell's own path links (`adoptMarkdownPaths`). Links that wrap are grouped by reading the rows in order: a link that ends its row and the next row's first link, with the same address and nothing but
   * blanks before it, are one link. The hovered link (if it is this component's) gets every one of its columns in the hover style: bold, underlined, and the brighter cyan,
   * replacing the colors it had. The answer is the same array when nothing is lit, and is remembered while neither the rows nor the hover change.
   */
  decorate(source: string[]): string[] {
    const hovered = this.links.hoveredGroup(this);
    if (source === this.lastRows && hovered === this.lastGroup) return this.lastOut;
    const rows = source.map(row => this.links.adoptMarkdownPaths(row));
    this.spans = rows.map(spansOf);
    let next = 0;
    let carry: { url: string; group: number } | undefined;
    rows.forEach((row, index) => {
      const spans = this.spans[index]!;
      spans.forEach((span, position) => {
        const continues = position === 0 && carry?.url === span.url && stripVTControlCharacters(row.slice(0, span.open)).trim() === "";
        span.group = continues ? carry!.group : next++;
      });
      const last = spans.at(-1);
      carry = last && stripVTControlCharacters(row.slice(last.end)).trim() === "" ? { url: last.url, group: last.group } : undefined;
    });
    const out = hovered === undefined ? rows : rows.map((row, index) => {
      let styled = row;
      for (const span of this.spans[index]!.filter(candidate => candidate.group === hovered).reverse()) {
        styled = styled.slice(0, span.contentStart) + linkHover(styled.slice(span.contentStart, span.contentEnd).replace(SGR, "")) + styled.slice(span.contentEnd);
      }
      return styled;
    });
    this.lastRows = source; this.lastGroup = hovered; this.lastOut = out;
    return out;
  }

  /** The link under column `x` of row `y` of the rows last drawn, if any. */
  private linkAt(x: number, y: number): Span | undefined {
    return this.spans[y]?.find(span => x >= span.start && x < span.stop);
  }

  /**
   * The component's mouse handler: a move, a press or a release over one of its links makes that link the hovered one. It never takes the event (it answers nothing), so the screen keeps
   * doing everything it did — text selection, the click that opens the link, clearing the sidebar's own hover.
   */
  pointer(event: TuiMouseEvent): undefined {
    if (event.type !== "move" && event.type !== "press" && event.type !== "release") return undefined;
    const span = this.linkAt(event.x, event.y);
    if (span) this.links.hover(this, span.group);
    return undefined;
  }
}

/**
 * Everything the chat does with links, for one screen. It makes the paths in a text into links (only those that exist when the text is drawn), opens a link when the screen reports a
 * click on it (web pages and paths, with the safety rules), tells the chat when opening failed, and runs the hover: which link is lit and the terminal's hand pointer.
 *
 * Paths are links of a kind of Shell's own: `f614-path:<secret>:<path>`, with a secret that is new on every run, so a link an assistant writes — `file:`, `javascript:`, or one that imitates
 * Shell's — is never taken for one. The hover is cleared at the start of every mouse event the terminal sends and set again by the component under the pointer if it is over a link; once
 * the event has been handled the screen is redrawn if the lit link changed and the pointer is asked for or given back.
 */
export class ChatLinks {
  /** Answers true while another part of the screen (the sidebar's grip) holds the terminal's pointer, so leaving a link does not take it away. */
  pointerHeldElsewhere?: () => boolean;
  private readonly nonce: string;
  private readonly cwd: string;
  private readonly home?: string;
  private readonly tools: ChatLinkTools;
  private readonly onFailure?: (target: string) => void;
  private hooks?: { requestRender(): void; write(data: string): void };
  private hovered?: Hover;
  private before?: Hover;
  private scheduled = false;
  private pointerRaised = false;

  constructor(options: ChatLinksOptions) {
    this.cwd = options.cwd; this.home = options.home;
    this.tools = options.tools ?? realChatLinkTools;
    this.onFailure = options.onFailure;
    this.nonce = options.nonce ?? randomBytes(16).toString("hex");
  }

  /** Connects the screen: how to redraw it and how to write to the terminal. */
  bind(hooks: { requestRender(): void; write(data: string): void }): void { this.hooks = hooks; }

  /** The address Shell gives a link to `path`: the secret marks it as Shell's own, and the path is percent-encoded so nothing in it can end the OSC 8 sequence. */
  pathUrl(path: string): string { return `f614-path:${this.nonce}:${encodeURIComponent(path)}`; }

  /** The path a Shell-made address names, or undefined when `url` is anything else (including an address with the wrong secret). */
  private pathOf(url: string): string | undefined {
    const match = /^f614-path:([^:]+):(.+)$/.exec(url);
    if (!match || match[1] !== this.nonce) return undefined;
    try { return decodeURIComponent(match[2]!); } catch { return undefined; }
  }

  /**
   * `text` painted with `paint`, except that each path in it that exists right now is drawn as a link in the link color. Where the terminal has no hyperlinks, or there is no path, the
   * answer is exactly `paint(text)`. The text must be plain (no escape sequences): a message's text, a tool card's title or detail.
   */
  linkify(text: string, paint: (text: string) => string): string {
    if (!getCapabilities().hyperlinks) return paint(text);
    let out = ""; let last = 0;
    for (const match of text.matchAll(TOKEN)) {
      const token = match[0].replace(TRAILING_PUNCTUATION, "");
      if (token.length < 2 || !looksLikePath(token)) continue;
      const found = resolveLocalPath(token, { cwd: this.cwd, home: this.home });
      if (!found) continue;
      if (match.index > last) out += paint(text.slice(last, match.index));
      out += `\x1b]8;;${this.pathUrl(found.path)}\x1b\\${accent(token)}\x1b]8;;\x1b\\`;
      last = match.index + token.length;
    }
    if (last === 0) return paint(text);
    return last < text.length ? out + paint(text.slice(last)) : out;
  }

  /**
   * Turns the Markdown links of a drawn row whose destination is a local path into Shell's own path links. A destination counts when it has no scheme (`file:`, `javascript:`, `mailto:`
   * and the rest are left alone; `:12` or `:12:3` after a path is a line, not a scheme) and is not an anchor or `//…`; it is read like a path written in the text — absolute, `~/`, `./`,
   * `../` or relative to the session's folder — and becomes a link only if it exists right now. One that does not exist keeps pi-tui's link exactly as drawn and opens nothing.
   */
  adoptMarkdownPaths(row: string): string {
    if (!row.includes("\x1b]8;")) return row;
    return row.replace(OSC8, (sequence, parameters: string, url: string) => {
      if (!url || /^[A-Za-z][A-Za-z0-9+.-]*:(?!\d+(?::\d+)?$)/.test(url) || url.startsWith("#") || url.startsWith("//")) return sequence;
      let written = url;
      try { written = decodeURIComponent(url); } catch { /* keep it as written */ }
      const found = resolveLocalPath(written, { cwd: this.cwd, home: this.home });
      if (!found) return sequence;
      return `\x1b]8;${parameters};${this.pathUrl(found.path)}${sequence.endsWith("\x07") ? "\x07" : "\x1b\\"}`;
    });
  }

  /** A new view for a component that draws links. */
  view(): LinkView { return new LinkView(this); }

  /**
   * What a click on a link does; the screen calls it with the address of the OSC 8 link that was pressed and released. A path Shell made is opened (or only shown, see `openLocalPath`); an
   * `http:`/`https:` address is opened in the browser; anything else does nothing. If opening fails — the opener says so, throws, or the path is gone — the chat is told the path or address.
   */
  open(url: string): void {
    const path = this.pathOf(url);
    if (path === undefined && !isOpenableWebUrl(url)) return;
    const target = path ?? url;
    void (async () => {
      let opened = false;
      try { opened = await (path === undefined ? this.tools.openWeb(target) : this.tools.openPath(target)); } catch { opened = false; }
      if (!opened) this.onFailure?.(target);
    })();
  }

  // ── Hover ──────────────────────────────────────────────────────────────────────────────────

  /** Which link of `view` is lit, if it is that view's. */
  hoveredGroup(view: LinkView): number | undefined { return this.hovered?.view === view ? this.hovered.group : undefined; }

  /** A component reports that the pointer is over one of its links. */
  hover(view: LinkView, group: number): void {
    const previous = this.hovered;
    this.hovered = { view, group };
    if (this.scheduled) return;
    if (!sameHover(previous, this.hovered)) this.hooks?.requestRender();
    this.syncPointer();
  }

  /**
   * Called with everything the terminal sends, before the screen handles it. A mouse event clears the hover at once and arranges for the result to be settled right after the event
   * has gone through the components (they set it again if the pointer is over a link), so a pointer that left a link, pressed elsewhere or scrolled the chat un-lights it.
   */
  observe(data: string): void {
    if (!/\x1b\[<\d+;\d+;\d+[Mm]/.test(data)) return;
    if (!this.scheduled) { this.scheduled = true; this.before = this.hovered; queueMicrotask(() => this.settle()); }
    this.hovered = undefined;
  }

  private settle(): void {
    const before = this.before;
    this.before = undefined; this.scheduled = false;
    if (!sameHover(before, this.hovered)) this.hooks?.requestRender();
    this.syncPointer();
  }

  /** Asks the terminal for the hand pointer while a link is lit and gives it back when none is, writing only when that changes; it does not take it back from the sidebar's grip. */
  private syncPointer(): void {
    const wanted = this.hovered !== undefined;
    if (wanted === this.pointerRaised) return;
    this.pointerRaised = wanted;
    if (wanted) this.hooks?.write(LINK_POINTER);
    else if (!this.pointerHeldElsewhere?.()) this.hooks?.write(DEFAULT_POINTER);
  }
}
