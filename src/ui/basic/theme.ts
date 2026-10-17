import { stripVTControlCharacters } from "node:util";
import { Markdown, getCapabilities, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Component, DefaultTextStyle, MarkdownOptions, MarkdownTheme, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { ChatLinks, LinkView, PointerClient } from "./chat-links.ts";
import { TABLE_LANG, renderTable, tableFences } from "./chat-table.ts";
import type { CellRenderer } from "./chat-table.ts";

/** A color as red, green and blue, each 0–255. */
export type Rgb = readonly [number, number, number];

/**
 * Every color Shell draws, and the only place that names one. The neutral grays have no blue tint: `background` is the whole screen, `surface` the zones that
 * stand out from it (sidebar, writing box, cards, code blocks), `elevated` what is chosen inside a surface or a menu; `foreground` is normal text, `muted` the
 * secondary text and `faint` what is only there to be seen faintly (the empty part of the usage bars and the ring, a Markdown rule). The rest are status and
 * accent colors, which keep their value. Zones are told apart by contrast and space, never by drawn lines.
 */
export const palette = {
  background: [10, 10, 11],
  surface: [24, 24, 27],
  elevated: [39, 39, 42],
  foreground: [228, 228, 231],
  muted: [161, 161, 170],
  faint: [63, 63, 70],
  accent: [70, 222, 224],
  /** The accent, brighter: a link under the pointer. */
  accentBright: [150, 245, 247],
  success: [107, 238, 201],
  warning: [237, 183, 88],
  danger: [255, 102, 136],
  added: [129, 220, 173],
  removed: [240, 150, 160],
  addedBackground: [21, 48, 36],
  removedBackground: [51, 23, 29],
  purple: [176, 132, 255],
  planning: [52, 170, 166],
  /** Codex's footer draws «Plan mode» in magenta (`CollaborationModeIndicator::styled_line`). */
  magenta: [217, 112, 214],
} as const satisfies Record<string, Rgb>;

/** The six levels of each channel in the 256-color palette's 6×6×6 cube (indexes 16–231). */
const CUBE_LEVELS: readonly number[] = [0, 95, 135, 175, 215, 255];

/**
 * The one conversion to the 256-color palette: the index (16–255) of the color closest to `rgb`, by squared distance in RGB, among the 6×6×6 cube and the
 * 24-step gray ramp (indexes 232–255, from 8 to 238 in steps of 10). A neutral gray almost always lands on the ramp, whose steps are finer than the cube's; a tie goes to the cube.
 */
export function nearestAnsi256(rgb: Rgb): number {
  const distance = (other: Rgb) => (other[0] - rgb[0]) ** 2 + (other[1] - rgb[1]) ** 2 + (other[2] - rgb[2]) ** 2;
  const level = (channel: number) => CUBE_LEVELS.reduce((best, value, index) => Math.abs(value - channel) < Math.abs(CUBE_LEVELS[best]! - channel) ? index : best, 0);
  const [r, g, b] = [level(rgb[0]), level(rgb[1]), level(rgb[2])] as const;
  const cubeIndex = 16 + 36 * r + 6 * g + b;
  const cubeDistance = distance([CUBE_LEVELS[r]!, CUBE_LEVELS[g]!, CUBE_LEVELS[b]!]);
  let grayStep = 0;
  for (let step = 1; step < 24; step++) if (distance(grayLevel(step)) < distance(grayLevel(grayStep))) grayStep = step;
  return distance(grayLevel(grayStep)) < cubeDistance ? 232 + grayStep : cubeIndex;
}

/** The gray of step `step` (0–23) of the 256-color palette's ramp. */
const grayLevel = (step: number): Rgb => [8 + 10 * step, 8 + 10 * step, 8 + 10 * step];

/**
 * The parameters of an SGR color code: `38` is the text color and `48` the background. With true color (pi-tui's `getCapabilities().trueColor`, which already
 * reads COLORTERM and TERM_PROGRAM and honors PI_TRUE_COLOR) they are the plain RGB `;2;r;g;b`; without it, the nearest 256-color index `;5;n`. It asks every time it
 * paints, so the answer is always the terminal's current one; nothing is told to the person.
 */
function sgr(layer: 38 | 48, rgb: Rgb): string {
  return getCapabilities().trueColor ? `${layer};2;${rgb[0]};${rgb[1]};${rgb[2]}` : `${layer};5;${nearestAnsi256(rgb)}`;
}

/** `from` mixed `amount` (0–1) of the way toward `to`, each channel rounded: the one place animated colors are computed, so they are painted with the same conversion as the rest. */
export function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  return [0, 1, 2].map(channel => Math.round(from[channel]! + (to[channel]! - from[channel]!) * amount)) as unknown as Rgb;
}

/** A painter that colors its text with `rgb` and gives the terminal's text color back afterwards. */
export const paint = (rgb: Rgb) => (text: string) => `\x1b[${sgr(38, rgb)}m${text}\x1b[39m`;

/**
 * A painter that puts `rgb` behind its text. A reset inside the text (`\x1b[0m`, `\x1b[m` or `\x1b[49m`, which pi-tui's own pieces and the diff rows emit) would
 * end the block half way across the row, so the background is put back right after each one.
 */
export const background = (rgb: Rgb) => (text: string) => {
  const code = `\x1b[${sgr(48, rgb)}m`;
  return `${code}${text.replace(/\x1b\[(?:0|49)?m/g, reset => reset + code)}\x1b[49m`;
};

export const accent = paint(palette.accent);
export const foreground = paint(palette.foreground);
/** How a link looks with the pointer over it: the brighter cyan, in bold and underlined. Nothing else changes: no box, no background. */
export const linkHover = (text: string) => `\x1b[1m\x1b[4m${paint(palette.accentBright)(text)}\x1b[24m\x1b[22m`;
export const bold = (text: string) => `\x1b[1m${text}\x1b[22m`;
export const muted = paint(palette.muted);
export const faint = paint(palette.faint);
export const success = paint(palette.success);
export const warning = paint(palette.warning);
export const danger = paint(palette.danger);
export const added = paint(palette.added);
export const removed = paint(palette.removed);
export const purple = paint(palette.purple);
export const planning = paint(palette.planning);
export const magenta = paint(palette.magenta);
/** The zones that stand out from the general background: sidebar, writing box, tool cards, code blocks. */
export const surface = background(palette.surface);
/** What is chosen inside a menu, a list or the «jump to latest» pill: one step lighter than `surface`. */
export const elevated = background(palette.elevated);
export const addedBackground = background(palette.addedBackground);
export const removedBackground = background(palette.removedBackground);
/** The general background and normal text color of the whole screen, as the one escape sequence the terminal gets when Shell enters its alternate screen. */
export const workspaceColors = () => `\x1b[${sgr(48, palette.background)}m\x1b[${sgr(38, palette.foreground)}m`;
/** Only the general background of the screen: what the workspace puts back after every `\x1b[49m`, which on its own would hand the rest of the row to the terminal's own default background. */
export const workspaceBackground = () => `\x1b[${sgr(48, palette.background)}m`;
export const fit = (text: string, width: number) => {
  const clipped = truncateToWidth(text, Math.max(0, width), "…");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
};
/**
 * A panel whose rows keep their own layout (columns, hanging indents): `lines` is asked, every time it is drawn, for the rows that fit the width the text really has — the box's
 * width minus the two columns of side margin `ChatText` uses — so a description continues under its own column at the width the screen has, not at a guessed one. A row that
 * still does not fit (one unbreakable word) is broken by the terminal-safe fallback rather than overflowing. It keeps `ChatText`'s blank line above and below.
 */
export class PanelText implements Component {
  private readonly lines: (width: number) => string[];
  constructor(lines: (width: number) => string[]) { this.lines = lines; }
  invalidate(): void {}
  render(width: number): string[] {
    const inner = Math.max(1, width - 4);
    const rows = this.lines(inner).flatMap(line => visibleWidth(line) > inner ? wrapTextWithAnsi(line, inner) : [line]);
    return ["", ...rows.map(line => `  ${foreground(line)}`), ""];
  }
}
/** Columns of space inside a code block, on each side of its text (and of its button's row). */
const CODE_PADDING = 2;
/** Languages whose label says nothing (a block fenced as ```text), so the first row of the block stays empty instead of showing the word. */
const GENERIC_LANGUAGES = new Set(["text", "txt", "plain", "plaintext"]);

/** Columns taken away from a code block that sits inside a list or a quote, on top of the indent of its fence: pi-tui puts the list's bullet and its nesting indent in front of every row, and re-wraps (breaking the block) any row that no longer fits. */
const NESTED_CODE_MARGIN = 4;

/** A fenced code block as the source has it: the columns of indent in front of its opening fence, whether its closing fence has arrived (a block still being written has not), and its language. */
export interface FenceInfo { prefix: number; closed: boolean; language: string }

/**
 * Every fenced code block of `markdown`, in order. pi-tui does not tell the theme how wide the space for a block is, so `chatMarkdown` reads the indent here (spaces, `>` quote marks and list markers): a block inside a list
 * item or a quote is drawn narrower by that indent, and never wider than the room it has. A block at the left edge has 0. Whether it is closed says if its «Copy» button can already show. Tabs count as pi-tui's three spaces.
 */
export function fenceInfo(markdown: string): FenceInfo[] {
  const blocks: FenceInfo[] = [];
  let open: { char: string; length: number; block: FenceInfo } | undefined;
  for (const line of markdown.replace(/\t/g, "   ").split("\n")) {
    const match = /^((?:[ >]|[-+*] |\d{1,9}[.)] )*)(`{3,}|~{3,})(.*)$/.exec(line);
    if (!open) {
      if (match && !(match[2]![0] === "`" && match[3]!.includes("`"))) {
        const block: FenceInfo = { prefix: match[1]!.length, closed: false, language: match[3]!.trim() };
        blocks.push(block);
        open = { char: match[2]![0]!, length: match[2]!.length, block };
      }
    } else if (match && match[2]![0] === open.char && match[2]!.length >= open.length && match[3]!.trim() === "") { open.block.closed = true; open = undefined; }
  }
  return blocks;
}

/** The indent of each fenced code block, in order (see `fenceInfo`). */
export const fencePrefixes = (markdown: string): number[] => fenceInfo(markdown).map(block => block.prefix);

/**
 * What the «Copy» buttons of the code blocks of a text need, shared between the text that draws them (`ChatText`) and the message that owns it: the words, whether the answer is complete (a block still being written has no
 * button until it closes or the answer ends), which block shows «Copied», and — filled in every time the text is drawn — each block's original content and where its button is, for the click.
 */
export interface CodeBlockUi {
  copyLabel: string;
  copiedLabel: string;
  complete: boolean;
  copied?: number;
  /** The block whose button has the pointer over it (see `ChatLinks.watchPointer`). */
  hovered?: number;
  /** Each block's original content and the button's place: its row among the text's rows and its columns (the whole pill, padding included). */
  blocks: { code: string; button?: { row: number; col: number; width: number } }[];
}

/** The text of a «Copy» button: an icon, the word, and one space of padding on each side — the button is a pill, so the click covers all of it. */
const pillText = (label: string, copied: boolean) => ` ${copied ? "✓" : "⧉"} ${label} `;
/** The pill while the pointer is over it: the accent as background with the screen's dark color on it, in bold. */
const pillHover = (text: string) => background(palette.accent)(`\x1b[1m${paint(palette.background)(text)}\x1b[22m`);

/** An invisible mark (an APC sequence, which terminals ignore and pi-tui measures as zero columns) at the start of the first row of a block that has a button, so `ChatText.render` can find that row; it is taken out before the row is returned. */
const copyMark = (index: number) => `\x1b_f614-copy:${index}\x07`;
const COPY_MARK = /\x1b_f614-copy:(\d+)\x07/;

/** What a row of a table block carries so `ChatText.render` can take it out: the blank rows pi-tui puts around a fenced block, which for a table would be a second blank line. */
const DROP_ROW = "\x1b[8888m";

/**
 * `line` (a line of code) cut into rows of at most `width` columns, at the last space that fits; only a word that alone does not fit is cut where the row ends. The line's own indent stays on the first row and the
 * rows that continue it carry that indent plus `extra` spaces (2 for code; none if there is no room). A line that fits, empty or not, is one row, as it came.
 */
export function hardWrap(line: string, width: number, extra = 2): string[] {
  if (visibleWidth(line) <= width) return [line];
  const indent = /^ */.exec(line)![0];
  const continuation = visibleWidth(indent) + extra < width ? `${indent}${" ".repeat(extra)}` : "";
  const rows: string[] = [];
  let current = indent; let fresh = true; let gap = "";
  const next = () => { rows.push(current); current = continuation; fresh = true; gap = ""; };
  for (const token of line.slice(indent.length).match(/ +|[^ ]+/g) ?? []) {
    if (token.startsWith(" ")) { gap = fresh ? "" : token; continue; }
    if (visibleWidth(current + gap + token) <= width) { current += gap + token; fresh = false; gap = ""; continue; }
    if (!fresh) next();
    for (const char of Array.from(token)) {
      if (!fresh && visibleWidth(current + char) > width) next();
      current += char; fresh = false;
    }
    gap = "";
  }
  if (!fresh || rows.length === 0) rows.push(current);
  return rows;
}

/**
 * The pieces `ChatText` hands pi-tui's Markdown (everything after the text). pi-tui draws a code block as an opening row (`codeBlockBorder` of «```lang»), the text rows (here `highlightCode`) and a closing row
 * (`codeBlockBorder` of «```»), then wraps every row at the content width without an indent — which is why the second half of a long code line used to land at the margin, outside the block. Here the block is
 * built row by row at the width pi-tui reports in `transform` (it is called at the start of every drawing, with the exact content width): the opening row carries the language in the secondary gray, the text
 * rows are cut by `hardWrap` and every one — also the continuation of a long line — is painted edge to edge on the surface background with `CODE_PADDING` columns of space, and the closing row is the empty bottom of the block.
 * The opening and closing rows are told apart by their order (`state.open`), because both reach the theme as plain «```» when the block has no language. A block inside a list or a quote is narrower, by the indent of its
 * fence in the source (`fencePrefixes`) plus `NESTED_CODE_MARGIN`: pi-tui draws the list's bullet in front of every row and re-wraps a row that no longer fits, which would break the block, and the theme is never told that width.
 */
function chatMarkdown(baseColor: (text: string) => string, links: ChatLinks | undefined, paddingY: number, ui?: CodeBlockUi): [paddingX: number, paddingY: number, theme: MarkdownTheme, defaultTextStyle: DefaultTextStyle, options: MarkdownOptions] {
  const state = { width: 80, open: false, table: false, fences: [] as FenceInfo[], next: 0, blockWidth: 80, block: -1 };
  const row = (content: string, paint: (text: string) => string = foreground) => {
    const inner = Math.max(1, state.blockWidth - CODE_PADDING * 2);
    const pad = " ".repeat(CODE_PADDING);
    return surface(paint(`${pad}${content}${" ".repeat(Math.max(0, inner - visibleWidth(content)))}${pad}`));
  };
  const inlineCode = (text: string) => surface(success(text));
  const theme: MarkdownTheme = {
    heading: text => accent(text.replace(/^#+\s*/, "")), link: accent, linkUrl: muted,
    code: links ? text => links.linkify(text, inlineCode) : inlineCode,
    codeBlock: text => surface(foreground(text)),
    codeBlockBorder: text => {
      state.open = !state.open;
      if (!state.open) return state.table ? DROP_ROW : row("");
      const info = state.fences[state.next++];
      const prefix = info?.prefix ?? 0;
      state.blockWidth = Math.max(CODE_PADDING * 2 + 1, state.width - (prefix > 0 ? prefix + NESTED_CODE_MARGIN : 0));
      const language = text.replace(/^`+/, "").trim();
      state.table = language === TABLE_LANG;
      if (state.table) return DROP_ROW;
      const label = language && !GENERIC_LANGUAGES.has(language.toLowerCase()) ? language : "";
      if (!ui) return label ? row(label, muted) : row("");
      // A block of the answer gets its «Copy» pill on the right of this first row, on its own row above the content — the language, if any, in gray on the left — unless the block is still being written (its closing
      // fence has not arrived and the answer is not complete) or there is no room for it. The pill is lighter than the block (`elevated`), with the text in the normal color; lit with the accent under the pointer;
      // after copying, `✓ Copied` in the success color.
      state.block = ui.blocks.push({ code: "" }) - 1;
      const copied = ui.copied === state.block;
      const caption = pillText(copied ? ui.copiedLabel : ui.copyLabel, copied);
      const room = state.blockWidth - CODE_PADDING * 2;
      if (!(info?.closed ?? true) && !ui.complete || room < visibleWidth(label) + 1 + visibleWidth(caption)) return row(label, muted);
      const pill = copied ? elevated(success(caption)) : ui.hovered === state.block ? pillHover(caption) : elevated(foreground(caption));
      const pad = " ".repeat(CODE_PADDING);
      return copyMark(state.block) + surface(`${pad}${muted(label)}${" ".repeat(room - visibleWidth(label) - visibleWidth(caption))}${pill}${pad}`);
    },
    codeBlockIndent: "",
    // The first row of the content is an empty row of the block, so the text does not sit right under the button's row.
    highlightCode: (code, language) => {
      if (language === TABLE_LANG) return renderTable(code, state.blockWidth, cell, row => surface(`\x1b[1m${row}\x1b[22m`));
      if (ui && ui.blocks[state.block]) ui.blocks[state.block]!.code = code;
      return [row(""), ...code.split("\n").flatMap(line => hardWrap(line, Math.max(1, state.blockWidth - CODE_PADDING * 2))).map(piece => row(piece))];
    },
    quote: muted, quoteBorder: accent, hr: faint, listBullet: accent,
    bold: text => `\x1b[1m${text}\x1b[22m`, italic: text => `\x1b[3m${text}\x1b[23m`,
    strikethrough: text => `\x1b[9m${text}\x1b[29m`, underline: text => `\x1b[4m${text}\x1b[24m`,
  };
  const style: DefaultTextStyle = { color: links ? text => links.linkify(text, baseColor) : baseColor };
  /** One cell of a table, drawn by pi-tui's own Markdown with this same theme, so its bold, `code` and links look like the rest of the text. */
  const cell: CellRenderer = (text, width) => new Markdown(text, 0, 0, theme, style).render(Math.max(1, width));
  return [2, paddingY, theme, style, {
    transform: (markdown, width) => {
      const source = tableFences(markdown);
      state.width = width; state.blockWidth = width; state.open = false; state.table = false; state.fences = fenceInfo(source); state.next = 0; state.block = -1;
      if (ui) ui.blocks.length = 0;
      return source;
    },
  }];
}

export class ChatText extends Markdown {
  private readonly linkView?: LinkView;
  private readonly codeUi?: CodeBlockUi;
  /** Told, when the person clicks a code block's «Copy», which block (its position among the text's blocks) and its original content. Only a text made with `codeUi` has such buttons. */
  onCopyBlock?: (index: number, code: string) => void;
  /**
   * `baseColor` lets an error message read as red at a glance instead of blending into normal chat text. A code block has no drawn border: it is a block of the surface background across the whole width of the text,
   * with its language, if any, in the secondary gray in the first row (see `chatMarkdown`), and `inline code` has the surface background too. With `links`, a path in the text or in `inline code` that exists on disk is
   * drawn as a link and the link under the pointer is lit (see `ChatLinks`); without them the text is exactly what it always was. `paddingY` is the blank rows above and below (1, or 0 when the caller draws its own).
   * With `codeUi`, each code block gets a «Copy» on the right of its first row (see `CodeBlockUi`).
   */
  constructor(text: string, baseColor: (text: string) => string = foreground, links?: ChatLinks, paddingY = 1, codeUi?: CodeBlockUi) {
    super(text, ...chatMarkdown(baseColor, links, paddingY, codeUi));
    this.codeUi = codeUi;
    if (links) this.linkView = links.view();
    // The highlight of a button under the pointer is turned off by the links' mouse watching (see `ChatLinks.watchPointer`), which also redraws the screen when it changes.
    if (links && codeUi) {
      this.pointerClient = { hovered: () => codeUi.hovered, clear: () => this.setHovered(undefined) };
      links.watchPointer(this.pointerClient);
    }
  }

  private readonly pointerClient?: PointerClient;
  private copyPressActive = false;

  /** Lights (or turns off) the button of block `index`; the drawn rows are cached, so they are drawn again. */
  private setHovered(index: number | undefined): void {
    if (!this.codeUi || this.codeUi.hovered === index) return;
    this.codeUi.hovered = index;
    this.invalidate();
  }

  /** The block whose «Copy» pill covers the cell at (`x`, `y`) of the text, if any. */
  private buttonAt(event: TuiMouseEvent): number | undefined {
    const index = this.codeUi?.blocks.findIndex(block => block.button && block.button.row === event.y && event.x >= block.button.col && event.x < block.button.col + block.button.width);
    return index === undefined || index < 0 ? undefined : index;
  }

  /**
   * The pointer over one of the text's links lights it (it never takes that event); over a code block's «Copy» pill it lights the pill; a left click on the pill — any column of it — is taken and reported to
   * `onCopyBlock`. Copy on press: pi-tui treats a release outside the exact pressed cell, a drag, or a second quick click as text selection. Taking the press both prevents that selection and fixes the block's
   * content to the screen state at the moment the person chose it; movement, scrolling, and streaming before release cannot change what gets copied.
   */
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    this.linkView?.pointer(event);
    if (!this.codeUi) return undefined;
    if (event.type === "press") this.copyPressActive = false;
    const index = this.buttonAt(event);
    if (event.type === "move" || event.type === "press" || event.type === "release") this.setHovered(index);
    if (event.type === "press" && event.button === "left" && index !== undefined && this.onCopyBlock) {
      this.copyPressActive = true;
      this.onCopyBlock(index, this.codeUi.blocks[index]!.code);
      return { handled: true, render: true };
    }
    if (this.copyPressActive && event.button === "left" && (event.type === "drag" || event.type === "release")) {
      return { handled: true, render: false };
    }
    if (this.copyPressActive && event.type === "click" && event.button === "left") {
      this.copyPressActive = false;
      return { handled: true, render: false };
    }
    if (index === undefined || event.type !== "click" || event.button !== "left" || !this.onCopyBlock) return undefined;
    this.onCopyBlock(index, this.codeUi.blocks[index]!.code);
    return { handled: true, render: true };
  }

  override render(width: number): string[] {
    // pi-tui pads each row to the width after cutting it (`markdown.js:236-241`), and when a background — an inline code — is still open at the end of a cut row because the code goes on in the next one, the padding is
    // painted with it up to the edge. The background is closed right before that padding.
    const rows = super.render(width).filter(row => !row.includes(DROP_ROW)).map(row => row.includes("\x1b[48;") ? row.replace(/( +)$/, "\x1b[49m$1") : row);
    // Where each «Copy» is: the row that carries its mark and the column of its label there. The marks are taken out.
    if (this.codeUi) {
      for (const block of this.codeUi.blocks) delete block.button;
      rows.forEach((row, y) => {
        const mark = COPY_MARK.exec(row);
        if (!mark) return;
        rows[y] = row.replace(COPY_MARK, "");
        const block = this.codeUi!.blocks[Number(mark[1])];
        if (!block) return;
        const copied = this.codeUi!.copied === Number(mark[1]);
        const text = pillText(copied ? this.codeUi!.copiedLabel : this.codeUi!.copyLabel, copied);
        const visible = stripVTControlCharacters(rows[y]!);
        block.button = { row: y, col: visibleWidth(visible.slice(0, visible.lastIndexOf(text))), width: visibleWidth(text) };
      });
    }
    return this.linkView ? this.linkView.decorate(rows) : rows;
  }
}
