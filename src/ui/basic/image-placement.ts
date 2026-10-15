import { getCapabilities, visibleWidth } from "@earendil-works/pi-tui";

/**
 * Orca (Electron, xterm.js and its image addon) keeps a kitty image in the cells it covers, so any character written on one of them erases that piece of the image, spaces and the erase of a line (`ESC[2K`) included.
 * Kitty and Ghostty draw images on another layer and do not do this, which is why pi-tui does not allow for it: it places an image on its row and then writes the rows under it (the whole screen when anything about an
 * image changes, only the rows that changed otherwise — the sidebar's text, say), so in Orca the image was gone in the same frame.
 *
 * Nor does Orca keep an image's data apart from its placement (its renderer, `addon-image-*.js`, Orca 1.4.224): any `a=d` — `d=a`, «keep the data», too — deletes the data (`_handleDelete`); an `a=p` with no data draws nothing
 * (`_handlePlacement`, `ENOENT`, silent with `q=2`); and when text covers every cell of an image, the next image placed sweeps it and its data go with it (`addImage`, `tileCount < 1`). pi-tui sends an image's data once and then
 * only `a=p` (`prepareKittyScreen`), and deletes the placements (`d=a`) whenever an image changes, so after the first draw its placements had no data to show.
 *
 * The way out chosen here is to place the images last, with their data. `ImagePlacer.frame` takes each frame pi-tui writes and takes every image out of its row. It keeps a copy of each image's data, by its `i=`, the first
 * time it sees them (pi-tui's `a=T`); and after the last row, for each image that has a row written in this frame, the cursor goes to the image's cell and the data and the placement go together as one `a=T` (`C=1`: the
 * cursor does not move; with the position and the crop pi-tui calculated), between `ESC 7` and `ESC 8` so that the cursor ends where pi-tui left it. Nothing is written on the image's cells after that, and no placement
 * depends on what Orca deleted or swept before. A simpler way — never writing on those cells — would need pi-tui's differential renderer to know about them (it clears whole rows with `ESC[2K`, and cuts and pads the rows
 * it writes), which it does not, and would not give the data back either; placing last works with any frame whatever it wrote.
 *
 * It is done only where the terminal erases (`setPlacingLast`, decided with `enableTerminalImages`: Orca, or `FORGE614_SHELL_IMAGES=kitty`): in a terminal that keeps images apart each frame would send an image's data
 * again for nothing.
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
/** The deletion of one image (pi-tui evicts the ones it no longer shows with `d=I`). */
const DELETE_ONE = /\x1b_Ga=d,d=[iI],i=(\d+)/g;
/** The controls of a kitty command that say where and how big an image is placed (`i` names it); the rest belong to the transmission. */
const PLACEMENT_KEYS = new Set(["x", "y", "w", "h", "X", "Y", "c", "r", "C", "U", "z", "P", "Q", "H", "V"]);
/** What the copies of images' data may add up to: the same ceiling pi-tui puts on the ones it keeps off screen. Past it the oldest copies of images not on screen go first. */
const MAX_COPY_BYTES = 32 * 1024 * 1024;

/** An image on the screen: its id, the 1-based `row` and 0-based `col` of its first cell, how many rows it covers, and the controls that place it (`C=1` among them). */
interface Placed { id: number; row: number; col: number; rows: number; controls: string }
/** An image's data as pi-tui sent them (`a=T`), written as a transmission with no placement (`a=t`): the first command carries the format and the id, the others the rest of the data. */
interface Copy { transmit: string }

/** One image command (or run of commands, if its data come in pieces) taken apart: what describes it, its data as a transmission (empty for a placement alone) and its placement's controls. */
function split(run: string): { id: number; transmit: string; controls: string; rows: number } {
  const first = /^\x1b_G([^;\x1b]*)/.exec(run)![1]!;
  const all = first.split(",");
  const id = Number(all.find(control => control.startsWith("i="))?.slice(2)) || 0;
  const rows = Number(all.find(control => control.startsWith("r="))?.slice(2)) || 1;
  const placement = all.filter(control => PLACEMENT_KEYS.has(control.split("=", 1)[0]!));
  if (!placement.includes("C=1")) placement.push("C=1");
  // A placement alone (`a=p`) has no data. `a=T` transmits and places: the transmission keeps what describes the data, with `a=t`; the data's other chunks go as they are.
  if (all.includes("a=p")) return { id, transmit: "", controls: placement.join(","), rows };
  const rest = all.filter(control => !control.startsWith("a=") && !PLACEMENT_KEYS.has(control.split("=", 1)[0]!));
  return { id, transmit: run.replace(/^\x1b_G[^;\x1b]*/, `\x1b_Ga=t,${rest.join(",")}`), controls: placement.join(","), rows };
}

/**
 * Rewrites the frames of one screen so that its images are placed last, with their data (see the top of this file). It remembers the images it has placed, to place again the ones a later frame writes over without being
 * told: a frame that rewrites only some rows leaves the other rows' images where they are, and they are placed again only if one of the rows written is one of theirs.
 */
export class ImagePlacer {
  private placed: Placed[] = [];
  /** The copies of the images' data by id; the Map's order is how long ago each was last used, the oldest first. */
  private readonly copies = new Map<number, Copy>();
  private copyBytes = 0;

  /** Forgets every image and its data: the screen was left or its images were deleted. */
  reset(): void { this.placed = []; this.copies.clear(); this.copyBytes = 0; }

  /** `data` as the terminal should get it: the same frame, with its images placed, with their data, after its last row. What is not a frame of rows goes through as it came. */
  frame(data: string): string {
    if (data.includes("\x1b_Ga=d,d=A") || data.includes("\x1b[?1049l")) this.reset();
    for (const match of data.matchAll(DELETE_ONE)) this.forget(Number(match[1]));
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
    // `out` ends with the frame's own tail (the cursor's position and visibility): the images come after it, and `ESC 8` gives the cursor back to where pi-tui put it.
    const images = touched.map(image => this.draw(image)).join("");
    this.trim();
    return out + (images ? `\x1b7${images}\x1b8` : "") + END_FRAME;
  }

  /** Where the cursor goes and the image's data with its placement. An image whose data were never seen (or were let go) is not drawn: Orca would draw nothing for a placement without data, and pi-tui sends them again once it forgets the image. */
  private draw(image: Placed): string {
    const copy = this.copies.get(image.id);
    if (!copy) return "";
    // Used now: it goes to the end of the Map's order.
    this.copies.delete(image.id); this.copies.set(image.id, copy);
    return `\x1b[${image.row};${image.col + 1}H${copy.transmit.replace("\x1b_Ga=t,", `\x1b_Ga=T,${image.controls},`)}`;
  }

  private forget(id: number): void {
    const copy = this.copies.get(id);
    if (copy) { this.copyBytes -= copy.transmit.length; this.copies.delete(id); }
  }

  /** Keeps the copies under the ceiling: the oldest go first, and never one of an image that is on the screen. */
  private trim(): void {
    if (this.copyBytes <= MAX_COPY_BYTES) return;
    const visible = new Set(this.placed.map(image => image.id));
    for (const id of [...this.copies.keys()]) {
      if (this.copyBytes <= MAX_COPY_BYTES) break;
      if (!visible.has(id)) this.forget(id);
    }
  }

  /** One row's text with its image commands taken out: where one was found, its data are kept (`copies`) and its placement is noted with the column it was at. */
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
      const { id, transmit, controls, rows } = split(run);
      if (transmit) {
        this.forget(id);
        this.copies.set(id, { transmit });
        this.copyBytes += transmit.length;
      }
      found.push({ id, row, col: visibleWidth(text.replace(APC, "")), rows, controls });
      position = end;
    }
    return text + body.slice(position);
  }
}
