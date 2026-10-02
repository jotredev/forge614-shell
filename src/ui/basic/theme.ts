import { Markdown, getCapabilities, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Component, TuiMouseEvent } from "@earendil-works/pi-tui";
import type { ChatLinks, LinkView } from "./chat-links.ts";

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
export class ChatText extends Markdown {
  private readonly linkView?: LinkView;
  /** Present only when the text has `links`: it reports the pointer over one of its links, and never takes the event. */
  handleMouse?: (event: TuiMouseEvent) => undefined;
  /**
   * `baseColor` lets an error message read as red at a glance instead of blending into normal chat text. A code block has no drawn border: its rows sit on the
   * surface background, the opening row keeps only the language (in the secondary gray) and the closing row is empty — pi-tui's Markdown hands the theme just the
   * text of those two rows, so they cannot be filled across the width. With `links`, a path in the text or in `inline code` that exists on disk is drawn as a link and the link
   * under the pointer is lit (see `ChatLinks`); without them the text is exactly what it always was.
   */
  constructor(text: string, baseColor: (text: string) => string = foreground, links?: ChatLinks) {
    super(text, 2, 1, {
      heading: text => accent(text.replace(/^#+\s*/, "")), link: accent, linkUrl: muted, code: links ? text => links.linkify(text, success) : success, codeBlock: text => surface(foreground(text)),
      codeBlockBorder: text => muted(text.replace(/```/g, "")), quote: muted, quoteBorder: accent, hr: faint, listBullet: accent,
      bold: text => `\x1b[1m${text}\x1b[22m`, italic: text => `\x1b[3m${text}\x1b[23m`,
      strikethrough: text => `\x1b[9m${text}\x1b[29m`, underline: text => `\x1b[4m${text}\x1b[24m`,
    }, { color: links ? text => links.linkify(text, baseColor) : baseColor });
    if (links) { this.linkView = links.view(); this.handleMouse = event => this.linkView!.pointer(event); }
  }

  override render(width: number): string[] {
    const rows = super.render(width);
    return this.linkView ? this.linkView.decorate(rows) : rows;
  }
}
