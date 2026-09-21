import { Markdown, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
export const paint = (rgb: string) => (text: string) => `\x1b[38;2;${rgb}m${text}\x1b[39m`;
export const accent = paint("70;222;224");
export const foreground = paint("220;230;235");
export const bold = (text: string) => `\x1b[1m${text}\x1b[22m`;
export const muted = paint("136;158;171");
export const border = paint("49;69;78");
export const success = paint("107;238;201");
export const warning = paint("237;183;88");
export const danger = paint("255;102;136");
export const added = paint("129;220;173");
export const removed = paint("240;150;160");
export const panelBackground = (text: string) => `\x1b[48;2;20;31;39m${text}\x1b[49m`;
export const addedBackground = (text: string) => `\x1b[48;2;21;48;36m${text}\x1b[49m`;
export const removedBackground = (text: string) => `\x1b[48;2;51;23;29m${text}\x1b[49m`;
export const fit = (text: string, width: number) => {
  const clipped = truncateToWidth(text, Math.max(0, width), "…");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
};
export class ChatText extends Markdown {
  /** `baseColor` lets an error message read as red at a glance instead of blending into normal chat text. */
  constructor(text: string, baseColor: (text: string) => string = foreground) {
    super(text, 2, 1, {
      heading: text => accent(text.replace(/^#+\s*/, "")), link: accent, linkUrl: muted, code: success, codeBlock: text => panelBackground(foreground(text)),
      codeBlockBorder: text => border(text.replace(/```/g, "───")), quote: muted, quoteBorder: accent, hr: border, listBullet: accent,
      bold: text => `\x1b[1m${text}\x1b[22m`, italic: text => `\x1b[3m${text}\x1b[23m`,
      strikethrough: text => `\x1b[9m${text}\x1b[29m`, underline: text => `\x1b[4m${text}\x1b[24m`,
    }, { color: baseColor });
  }
}
