import { getCapabilities, visibleWidth } from "@earendil-works/pi-tui";

/**
 * Orca (Electron, xterm.js and its image addon) keeps a kitty image in the cells it covers, so any character written on one of them erases that piece of the image, spaces and the erase of a line (`ESC[2K`) included.
 * Kitty and Ghostty draw images on another layer and do not do this, which is why pi-tui does not allow for it: it places an image on its row and then writes the rows under it (the whole screen when anything about an
 * image changes, only the rows that changed otherwise — the sidebar's counter, say), so in Orca the image was gone in the same frame.
 *
 * The way out chosen here is to place the images last. `ImagePlacer.frame` takes each frame pi-tui writes and moves every image's placement to the end of it: the data are sent once as a transmission with no
 * placement (`a=t`), and after the last row, for each image that has a row written in this frame, the cursor goes to the image's cell and `a=p` places it again (`C=1`: the cursor does not move), between `ESC 7` and
 * `ESC 8` so that the cursor ends where pi-tui left it. Nothing is written on the image's cells after that. A simpler way — never writing on those cells — would need pi-tui's differential renderer to know about them
 * (it clears whole rows with `ESC[2K`, and cuts and pads the rows it writes), which it does not, and a scroll would move the image under text anyway; placing last works with any frame whatever it wrote.
 *
 * It is done only where the terminal erases (`setPlacingLast`, decided with `enableTerminalImages`: Orca, or `FORGE614_SHELL_IMAGES=kitty`): in a terminal that keeps images apart each frame would pile one more
 * placement of the same image on the last one, and the frame would carry bytes it has no use for.
 */

let placingLast = false;
/** Turns the placing-last behavior on or off (see `enableTerminalImages`, which decides it). */
export function setPlacingLast(enabled: boolean): void { placingLast = enabled; }
/** Whether frames are to go through `ImagePlacer`: decided at start and only while the capability is still kitty (pi-tui turns images off in some screens). */
export const placesImagesLast = (): boolean => placingLast && getCapabilities().images === "kitty";

const BEGIN_FRAME = "\x1b[?2026h";
const END_FRAME = "\x1b[?2026l";
/** How pi-tui starts each row of an alternate-screen frame: the cursor to its start and the line erased. */
const ROW_START = /\x1b\[(\d+);1H\x1b\[2K/g;
const APC = /\x1b_G[^\x1b]*\x1b\\/g;
/** The controls of a kitty command that say where and how big an image is placed (`i` and `p` name it); the rest belong to the transmission. */
const PLACEMENT_KEYS = new Set(["x", "y", "w", "h", "X", "Y", "c", "r", "C", "U", "z", "P", "Q", "H", "V"]);

/** An image placed on the screen: the 1-based `row` and 0-based `col` of its first cell, how many rows it covers, and the command that places it. */
interface Placed { row: number; col: number; rows: number; sequence: string }

/** Turns the frame's first command of an image (its controls) into what is placed: `a=p` with the controls that say where, and `C=1` so the cursor stays. */
function placement(controls: string[]): string {
  const keep = controls.filter(control => control.startsWith("i=") || PLACEMENT_KEYS.has(control.split("=", 1)[0]!));
  if (!keep.includes("C=1")) keep.push("C=1");
  return `\x1b_Ga=p,q=2,${keep.join(",")}\x1b\\`;
}

/** The commands of an image in one row, as a run: `[transmit, place]`. A placement alone (`a=p`, what pi-tui sends once the image is uploaded) has nothing to transmit. */
function split(run: string): { transmit: string; place: string; rows: number } {
  const first = /^\x1b_G([^;\x1b]*)/.exec(run)![1]!;
  const controls = first.split(",");
  const rows = Number(controls.find(control => control.startsWith("r="))?.slice(2)) || 1;
  if (controls.includes("a=p")) return { transmit: "", place: placement(controls.filter(control => control !== "a=p")), rows };
  // `a=T` transmits and places: the first command keeps what describes the data, with `a=t`; the data's other chunks go as they are.
  const rest = controls.filter(control => !control.startsWith("a=") && !PLACEMENT_KEYS.has(control.split("=", 1)[0]!));
  const transmit = run.replace(/^\x1b_G[^;\x1b]*/, `\x1b_Ga=t,${rest.join(",")}`);
  return { transmit, place: placement(controls.filter(control => control !== "a=T")), rows };
}

/**
 * Rewrites the frames of one screen so that its images are placed last (see the top of this file). It remembers the images it has placed, to place again the ones a later frame writes over without sending them:
 * a frame that rewrites only some rows leaves the other rows' images where they are, and they are placed again only if one of the rows written is one of theirs.
 */
export class ImagePlacer {
  private placed: Placed[] = [];

  /** Forgets every image: the screen was left or its images were deleted. */
  reset(): void { this.placed = []; }

  /** `data` as the terminal should get it: the same frame, with its images placed after its last row. What is not a frame of rows goes through as it came. */
  frame(data: string): string {
    if (data.includes("\x1b_Ga=d,d=A") || data.includes("\x1b[?1049l")) this.reset();
    if (!data.startsWith(BEGIN_FRAME) || !data.endsWith(END_FRAME)) return data;
    const starts = [...data.matchAll(ROW_START)];
    if (starts.length === 0) return data;
    const written = new Set<number>();
    const found: Placed[] = [];
    let out = data.slice(0, starts[0]!.index);
    starts.forEach((start, n) => {
      const row = Number(start[1]);
      const from = start.index + start[0].length;
      const body = data.slice(from, n + 1 < starts.length ? starts[n + 1]!.index : data.length - END_FRAME.length);
      written.add(row);
      out += start[0] + this.rewriteRow(row, body, found);
    });
    // The rows written now take back their images; a full redraw writes every row, so it takes back all of them.
    this.placed = this.placed.filter(image => !written.has(image.row)).concat(found);
    const touched = this.placed.filter(image => { for (let y = image.row; y < image.row + image.rows; y++) if (written.has(y)) return true; return false; });
    // `out` ends with the frame's own tail (the cursor's position and visibility): the placements come after it, and `ESC 8` gives the cursor back to where pi-tui put it.
    const placements = touched.map(image => `\x1b[${image.row};${image.col + 1}H${image.sequence}`).join("");
    return out + (touched.length ? `\x1b7${placements}\x1b8` : "") + END_FRAME;
  }

  /** One row's text with its image commands taken out: where one was found, its transmission stays (without placing) and its placement is noted with the column it was at. */
  private rewriteRow(row: number, body: string, found: Placed[]): string {
    let text = "";
    let position = 0;
    for (;;) {
      const start = body.indexOf("\x1b_G", position);
      if (start === -1) break;
      let end = start;
      while (body.startsWith("\x1b_G", end)) { const stop = body.indexOf("\x1b\\", end); if (stop === -1) break; end = stop + 2; }
      if (end === start) break;
      const run = body.slice(start, end);
      // Only a transmission or a placement is moved; any other command (a deletion) stays where it is.
      if (!/^\x1b_G(?:[^;\x1b]*,)?a=[Tp][,;\x1b]/.test(run)) { text += body.slice(position, end); position = end; continue; }
      text += body.slice(position, start);
      const { transmit, place, rows } = split(run);
      found.push({ row, col: visibleWidth(text.replace(APC, "")), rows, sequence: place });
      text += transmit;
      position = end;
    }
    return text + body.slice(position);
  }
}
