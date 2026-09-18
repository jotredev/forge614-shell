import { Markdown, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
export const paint = (rgb: string) => (text: string) => `\x1b[38;2;${rgb}m${text}\x1b[39m`;
export const accent = paint("70;222;224");
export const foreground = paint("220;230;235");
export const muted = paint("136;158;171");
export const border = paint("49;69;78");
export const success = paint("107;238;201");
export const warning = paint("237;183;88");
export const panelBackground = (text: string) => `\x1b[48;2;20;31;39m${text}\x1b[49m`;
export const fit = (text: string, width: number) => {
  const clipped = truncateToWidth(text, Math.max(0, width), "…");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
};
export class ChatText extends Markdown {
  constructor(text: string) {
    super(text, 2, 1, {
      heading: text => accent(text.replace(/^#+\s*/, "")), link: accent, linkUrl: muted, code: success, codeBlock: text => panelBackground(foreground(text)),
      codeBlockBorder: text => border(text.replace(/```/g, "───")), quote: muted, quoteBorder: accent, hr: border, listBullet: accent,
      bold: text => `\x1b[1m${text}\x1b[22m`, italic: text => `\x1b[3m${text}\x1b[23m`,
      strikethrough: text => `\x1b[9m${text}\x1b[29m`, underline: text => `\x1b[4m${text}\x1b[24m`,
    }, { color: foreground });
  }
}
