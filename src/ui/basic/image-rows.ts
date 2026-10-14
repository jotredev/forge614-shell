import { compositeTuiLine, sliceByColumn } from "@earendil-works/pi-tui";

/** The part of pi-tui's layout box this reads: where it is, what it clips to, the rows a leaf component drew (`lines`, from `lineOffset`) and its children. */
interface LayoutBoxLike {
  rect: { x: number; y: number; width: number; height: number };
  clip: { x: number; y: number; width: number; height: number };
  children: LayoutBoxLike[];
  lines?: string[];
  lineOffset?: number;
}

/** What `renderLayoutFrame` hands back, as far as this needs it. */
export interface LayoutFrameLike { root: LayoutBoxLike; width: number }

/** A row that carries a graphics sequence: kitty's (`ESC _ G`) or iTerm2's (`ESC ] 1337 ; File =`), the same test pi-tui makes. */
const isImageRow = (line: string) => line.includes("\x1b_G") || line.includes("\x1b]1337;File=");
/** The marker pi-tui's layout puts at the start of a row, which its screen drops. */
const ZONE_PREFIX = /^(?:\x1b\]133;[ABC](?:\x07|\x1b\\))+/;

/**
 * Gives back to the rows that carry an image what the rest of the screen painted on them. pi-tui's layout paints the boxes left to right — the chat, the grip, the sidebar — each onto the row with `compositeTuiLine`,
 * whose first line is `if (isImageLine(baseLine)) return baseLine`: once the chat has put an image on a row, whatever is painted after it, the grip and the sidebar's text of that row, is thrown away (`tui.js:134`).
 * So on the row where an image starts the sidebar went blank, and the terminal showed black stripes there. Here the rows of the screen that carry an image are painted again in the other order: every box that is not an
 * image first, and the image's own columns — as pi-tui already cropped them — on top, which `compositeTuiLine` does keep. The image sequence itself is not touched: it is cut from the row, with `sliceByColumn`, whole.
 */
export function restoreImageRows(screen: string[], frame: LayoutFrameLike): string[] {
  if (!screen.some(isImageRow)) return screen;
  const leaves: LayoutBoxLike[] = [];
  const collect = (box: LayoutBoxLike) => { if (box.lines) leaves.push(box); box.children.forEach(collect); };
  collect(frame.root);
  const out = screen.slice();
  for (let y = 0; y < out.length; y++) {
    if (!isImageRow(out[y]!)) continue;
    let row = "";
    const images: LayoutBoxLike[] = [];
    for (const box of leaves) {
      if (y < Math.max(box.rect.y, box.clip.y, 0) || y >= Math.min(box.rect.y + box.rect.height, box.clip.y + box.clip.height)) continue;
      const line = box.lines![(box.lineOffset ?? 0) + y - box.rect.y];
      if (line === undefined) continue;
      if (isImageRow(line)) images.push(box);
      else row = compositeTuiLine(row, line.replace(ZONE_PREFIX, ""), box.rect.x, box.rect.width, frame.width);
    }
    for (const box of images) row = compositeTuiLine(row, sliceByColumn(out[y]!, box.rect.x, box.rect.width, true), box.rect.x, box.rect.width, frame.width);
    if (images.length) out[y] = row;
  }
  return out;
}
