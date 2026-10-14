import { Markdown, getCapabilities, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Component, DefaultTextStyle, MarkdownOptions, MarkdownTheme, TuiMouseEvent } from "@earendil-works/pi-tui";
import type { ChatLinks, LinkView } from "./chat-links.ts";
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
/** Columns of space inside a code block, on each side of its text. */
const CODE_PADDING = 1;
/** Languages whose label says nothing (a block fenced as ```text), so the first row of the block stays empty instead of showing the word. */
const GENERIC_LANGUAGES = new Set(["text", "txt", "plain", "plaintext"]);

/** Columns taken away from a code block that sits inside a list or a quote, on top of the indent of its fence: pi-tui puts the list's bullet and its nesting indent in front of every row, and re-wraps (breaking the block) any row that no longer fits. */
const NESTED_CODE_MARGIN = 4;

/**
 * For each fenced code block of `markdown`, in order, the columns of indent in front of its opening fence (spaces, `>` quote marks and list markers). pi-tui does not tell the theme how wide the space for a block is, so
 * `chatMarkdown` reads it here: a block inside a list item or a quote is drawn narrower by that indent, and never wider than the room it has. A block at the left edge has 0. Tabs count as pi-tui's three spaces.
 */
export function fencePrefixes(markdown: string): number[] {
  const prefixes: number[] = [];
  let open: { char: string; length: number } | undefined;
  for (const line of markdown.replace(/\t/g, "   ").split("\n")) {
    const match = /^((?:[ >]|[-+*] |\d{1,9}[.)] )*)(`{3,}|~{3,})(.*)$/.exec(line);
    if (!open) {
      if (match && !(match[2]![0] === "`" && match[3]!.includes("`"))) { open = { char: match[2]![0]!, length: match[2]!.length }; prefixes.push(match[1]!.length); }
    } else if (match && match[2]![0] === open.char && match[2]!.length >= open.length && match[3]!.trim() === "") open = undefined;
  }
  return prefixes;
}

/** What a row of a table block carries so `ChatText.render` can take it out: the blank rows pi-tui puts around a fenced block, which for a table would be a second blank line. */
const DROP_ROW = "\x1b[8888m";

/**
 * `line` (a line of code) cut into rows of at most `width` columns, at the last space that fits; only a word that alone does not fit is cut where the row ends. The line's own indent stays on the first row and the
 * rows that continue it carry that indent plus 2 spaces (none if there is no room). A line that fits, empty or not, is one row, as it came.
 */
export function hardWrap(line: string, width: number): string[] {
  if (visibleWidth(line) <= width) return [line];
  const indent = /^ */.exec(line)![0];
  const continuation = visibleWidth(indent) + 2 < width ? `${indent}  ` : "";
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
function chatMarkdown(baseColor: (text: string) => string, links: ChatLinks | undefined, paddingY: number): [paddingX: number, paddingY: number, theme: MarkdownTheme, defaultTextStyle: DefaultTextStyle, options: MarkdownOptions] {
  const state = { width: 80, open: false, table: false, prefixes: [] as number[], next: 0, blockWidth: 80 };
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
      const prefix = state.prefixes[state.next++] ?? 0;
      state.blockWidth = Math.max(CODE_PADDING * 2 + 1, state.width - (prefix > 0 ? prefix + NESTED_CODE_MARGIN : 0));
      const language = text.replace(/^`+/, "").trim();
      state.table = language === TABLE_LANG;
      if (state.table) return DROP_ROW;
      return language && !GENERIC_LANGUAGES.has(language.toLowerCase()) ? row(language, muted) : row("");
    },
    codeBlockIndent: "",
    highlightCode: (code, language) => language === TABLE_LANG
      ? renderTable(code, state.blockWidth, cell, row => surface(`\x1b[1m${row}\x1b[22m`))
      : code.split("\n").flatMap(line => hardWrap(line, Math.max(1, state.blockWidth - CODE_PADDING * 2))).map(piece => row(piece)),
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
      state.width = width; state.blockWidth = width; state.open = false; state.table = false; state.prefixes = fencePrefixes(source); state.next = 0;
      return source;
    },
  }];
}

export class ChatText extends Markdown {
  private readonly linkView?: LinkView;
  /** Present only when the text has `links`: it reports the pointer over one of its links, and never takes the event. */
  handleMouse?: (event: TuiMouseEvent) => undefined;
  /**
   * `baseColor` lets an error message read as red at a glance instead of blending into normal chat text. A code block has no drawn border: it is a block of the surface background across the whole width of the text,
   * with its language, if any, in the secondary gray in the first row (see `chatMarkdown`), and `inline code` has the surface background too. With `links`, a path in the text or in `inline code` that exists on disk is
   * drawn as a link and the link under the pointer is lit (see `ChatLinks`); without them the text is exactly what it always was. `paddingY` is the blank rows above and below (1, or 0 when the caller draws its own).
   */
  constructor(text: string, baseColor: (text: string) => string = foreground, links?: ChatLinks, paddingY = 1) {
    super(text, ...chatMarkdown(baseColor, links, paddingY));
    if (links) { this.linkView = links.view(); this.handleMouse = event => this.linkView!.pointer(event); }
  }

  override render(width: number): string[] {
    const rows = super.render(width).filter(row => !row.includes(DROP_ROW));
    return this.linkView ? this.linkView.decorate(rows) : rows;
  }
}
