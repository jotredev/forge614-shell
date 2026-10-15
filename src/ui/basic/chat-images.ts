import { closeSync, lstatSync, openSync, readFileSync, readSync } from "node:fs";
import { basename } from "node:path";
import { Image, getCapabilities, getCellDimensions, getImageDimensions, setCapabilities } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import type { ChatLinks } from "./chat-links.ts";
import { setPlacingLast } from "./image-placement.ts";
import { composeRow, decodePng, encodePng, isPngBase64, scaleRaster } from "./png-strip.ts";
import { muted } from "./theme.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";

/** The largest image file Shell reads to draw (20 MB); a bigger one, or one that cannot be read, is drawn only as its gray line. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
/** The most images drawn for one message or one tool result; the rest are counted in one line. */
export const MAX_THUMBNAILS = 4;
/** The box a thumbnail fits in, in terminal columns and rows: small, so that up to four go side by side in one row (`ImageStrip`), `THUMBNAIL_GAP` columns apart. */
export const THUMBNAIL_COLUMNS = 22;
export const THUMBNAIL_ROWS = 7;
export const THUMBNAIL_GAP = 2;
/** Thumbnails are made with this many pixels per pixel of the terminal's cells, for Retina screens. */
const RETINA = 2;
/** The width a row of thumbnails may take at most, as the reading width of the chat (see `MAX_READING_WIDTH` in chat-message.ts), the margin included. */
const READING_WIDTH = 100;
/** The most a thumbnail's data weigh, as PNG in base64: in Orca every placement carries them, so a row of thumbnails costs about its bytes in each frame. */
export const THUMBNAIL_MAX_BYTES = 140_000;
/** The most a whole row of thumbnails weighs, as PNG in base64 (four thumbnails of `THUMBNAIL_MAX_BYTES` at the very most, and room left in the frame for its text): if it weighs more, its pixels are reduced, never its format. */
export const STRIP_MAX_BYTES = 540_000;
/** The heaviest original that is drawn as it is when it cannot be reduced (Photon did not load); a heavier one is shown only as its gray line. */
export const THUMBNAIL_FALLBACK_BYTES = 256 * 1024;

/** What Shell knows about one image it may draw: where it came from (`path`, for the link), its pixels as base64 (`base64`, absent when it was not read), and what the gray line says (`widthPx`, `heightPx`, `bytes`). */
export interface ChatImage {
  name: string;
  mime: string;
  path?: string;
  base64?: string;
  widthPx?: number;
  heightPx?: number;
  bytes?: number;
}

// ── Whether the terminal can show images ───────────────────────────────────────────────────

/**
 * Decides how this chat draws images and tells pi-tui, keeping every other capability as it was. `FORGE614_SHELL_IMAGES` forces it: `kitty` or `iterm2` choose that protocol and `off` draws only the gray lines;
 * without it nothing changes anywhere except in Orca (`TERM_PROGRAM=Orca`, an Electron app with xterm.js whose graphics support pi-tui does not know), where `kitty` is turned on unless pi-tui already found a protocol or the
 * session runs under tmux or screen, which do not pass graphics through. Kitty is the choice because pi-tui crops a kitty image when the chat scrolls it half out of view; iTerm2's protocol cannot be cropped, and
 * pi-tui itself turns it off while the alternate screen is open (`TuiAltScreen.beforeTerminalStart`), so `iterm2` forced here gets the gray lines too. Called when a chat screen opens, before it starts.
 * It also decides where images are placed last (`ImagePlacer`): in Orca, and with `FORGE614_SHELL_IMAGES=kitty`, whose terminals erase an image when anything is written over it.
 */
export function enableTerminalImages(env: NodeJS.ProcessEnv = process.env): void {
  const forced = env.FORGE614_SHELL_IMAGES?.trim().toLowerCase();
  chooseImages(env, forced);
  // A forced `kitty` is the way to ask for this in any terminal; otherwise only Orca (where the images are turned on above) needs it. `off` and `iterm2` draw no kitty image at all.
  setPlacingLast(getCapabilities().images === "kitty" && (forced === "kitty" || (forced !== "off" && forced !== "iterm2" && env.TERM_PROGRAM === "Orca" && !underMultiplexer(env))));
}

const underMultiplexer = (env: NodeJS.ProcessEnv) => env.TMUX !== undefined || env.STY !== undefined || /^(tmux|screen)/.test(env.TERM ?? "");

function chooseImages(env: NodeJS.ProcessEnv, forced: string | undefined): void {
  const capabilities = getCapabilities();
  if (forced === "off") { if (capabilities.images) setCapabilities({ ...capabilities, images: null }); return; }
  if (forced === "kitty" || forced === "iterm2") { if (capabilities.images !== forced) setCapabilities({ ...capabilities, images: forced }); return; }
  if (capabilities.images || env.TERM_PROGRAM !== "Orca" || underMultiplexer(env)) return;
  setCapabilities({ ...capabilities, images: "kitty" });
}

// ── Finding the images in what the person wrote ────────────────────────────────────────────

const EXTENSION = "(?:png|jpe?g)";
/** Where an absolute path starts, on any system: `/`, a drive (`C:\` or `C:/`) or a network share (`\\server\share`). The text is read the same way everywhere: a Windows path pasted on a Mac is recognized (and found missing). */
const ROOT = String.raw`(?:/|[A-Za-z]:[\\/]|\\\\)`;
/**
 * The path an engine's line `Image: <path>` announces (Codex's `item/completed`, in `src/engines/codex/session.ts`), or undefined when the text is anything else. The path is absolute on any system: the line is
 * written where the engine runs, and on Windows that is `C:\Users\…`, which a test for a leading «/» never matched (Verify 38648343395: the card was never drawn).
 */
export const announcedImagePath = (text: string): string | undefined => new RegExp(String.raw`^Image: (${ROOT}[^\n]*)$`).exec(text)?.[1];

/** An absolute path in single or double quotes (spaces allowed inside), as PowerShell and Windows Terminal paste them. */
const QUOTED_PATH = new RegExp(String.raw`(["'])(${ROOT}[^"'\n]*?\.${EXTENSION})\1`, "gi");
/** A Unix path with no quotes, whose spaces, if any, are escaped with a backslash. */
const UNIX_BARE_PATH = new RegExp(String.raw`(?<![\w/\\~.\-:])(/(?:[^\s"'\\]|\\ )+?\.${EXTENSION})(?=$|[\s"'),;:!?])`, "gi");
/** A Windows path (`C:\…`, `C:/…`, `\\server\…`) with no quotes: backslashes are separators, and a space, if any, is escaped with a backtick (PowerShell's escape). */
const WINDOWS_BARE_PATH = new RegExp(String.raw`(?<![\w/\\~.\-:])((?:[A-Za-z]:[\\/]|\\\\)(?:[^\s"'<>|*?:\x60]|\x60 )+?\.${EXTENSION})(?=$|[\s"'),;:!?])`, "gi");

/**
 * The absolute `.png`, `.jpg` and `.jpeg` paths written in `text`, in order and without repeats: Unix paths and Windows ones (`C:\…`, `C:/…`, `\\server\share\…`), in quotes, or with spaces escaped by `\` (Unix) or by a backtick
 * (Windows). Relative paths are never invented. They are only candidates: `readImage` says which are real images.
 */
export function findImagePaths(text: string): string[] {
  const found: { index: number; path: string }[] = [];
  for (const match of text.matchAll(QUOTED_PATH)) found.push({ index: match.index, path: match[2]! });
  for (const match of text.matchAll(UNIX_BARE_PATH)) found.push({ index: match.index, path: match[1]!.replace(/\\ /g, " ") });
  for (const match of text.matchAll(WINDOWS_BARE_PATH)) found.push({ index: match.index, path: match[1]!.replace(/\x60 /g, " ") });
  const seen = new Set<string>();
  return found.sort((a, b) => a.index - b.index).map(item => item.path).filter(path => !seen.has(path) && !!seen.add(path));
}

const mimeOf = (path: string): string => /\.png$/i.test(path) ? "image/png" : "image/jpeg";

/** Whether `header` (a file's first bytes) is that of a PNG (`89 50 4E 47`) or of a JPEG (`FF D8 FF`) as `mime` says. */
const hasSignature = (header: Buffer, mime: string) => mime === "image/png"
  ? header.length >= 4 && header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47
  : header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;

/**
 * The image at `path`, or undefined when it is not one Shell may show: the path must be a regular file — `lstat`, so a symbolic link is never followed — with a PNG or JPEG signature in its first bytes (a `.png` that is
 * really text is not an image). The file is read once, with `maxBytes` as the limit: a bigger one, or one that cannot be read, comes back without pixels, so only its gray line is drawn.
 */
export function readImage(path: string, maxBytes = MAX_IMAGE_BYTES): ChatImage | undefined {
  const mime = mimeOf(path);
  const name = basename(path);
  try {
    const stat = lstatSync(path);
    // `lstat` does not follow the last component: a symbolic link is not a regular file. On Windows Node also reports as links the junctions and the other reparse points that redirect (`isSymbolicLink`), so they
    // are refused too; the placeholders of a cloud service are plain files to Node, which cannot tell them apart, and redirect nowhere.
    if (stat.isSymbolicLink() || !stat.isFile()) return undefined;
    const header = Buffer.alloc(8);
    const descriptor = openSync(path, "r");
    try { readSync(descriptor, header, 0, header.length, 0); } finally { closeSync(descriptor); }
    if (!hasSignature(header, mime)) return undefined;
    if (stat.size > maxBytes) return { name, mime, path, bytes: stat.size };
    const base64 = readFileSync(path).toString("base64");
    const dimensions = getImageDimensions(base64, mime);
    return { name, mime, path, base64, bytes: stat.size, ...(dimensions ? { widthPx: dimensions.widthPx, heightPx: dimensions.heightPx } : {}) };
  } catch {
    // It exists but cannot be read (permissions, gone in between): the line says only its name.
    try { return lstatSync(path).isFile() ? { name, mime, path } : undefined; } catch { return undefined; }
  }
}

/** The images written as paths in `text` that are really there (see `findImagePaths` and `readImage`). */
export const imagesInText = (text: string): ChatImage[] => findImagePaths(text).flatMap(path => readImage(path) ?? []);

// ── Drawing them ───────────────────────────────────────────────────────────────────────────

/**
 * What is drawn of an image: its data as a PNG in base64 — always a PNG: kitty's `f=100`, which pi-tui always sends, takes only PNG, and Orca refuses anything else without a word (`_createBitmap` throws a `RangeError`) —
 * and the size in pixels it really has, when known.
 */
interface Thumbnail { base64: string; widthPx?: number; heightPx?: number }
/** The state of each image's thumbnail: ready, `pending` while it is being made (the gray line is drawn meanwhile) or `none` when there is nothing to draw. */
const thumbnails = new WeakMap<ChatImage, Thumbnail | "pending" | "none">();
let thumbnailReady: (() => void) | undefined;

/** Sets what is done when a thumbnail that was being made is ready (the screen repaints). One per running screen. */
export function onThumbnailReady(listener: (() => void) | undefined): void { thumbnailReady = listener; }

/**
 * The thumbnail of an image, as a PNG. A PNG of `THUMBNAIL_MAX_BYTES` or less is drawn as it is, at once. Any other (a JPEG, even a light one, or a heavier PNG) is made with Photon (`resizeImage` of pi-coding-agent, in
 * a worker thread, which is why it is not waited for: `readImage` and the screen's rendering are synchronous and writing in the box must never stop): until it is ready the gray line is drawn, and then the screen is asked
 * to repaint. `resizeImage` shrinks it to the box (`THUMBNAIL_COLUMNS` × `THUMBNAIL_ROWS` cells, twice over for Retina screens) and may answer with a JPEG, which `convertToPng` turns into a PNG; a thumbnail that weighs
 * more than `THUMBNAIL_MAX_BYTES` is shrunk some more (fewer pixels, never another format). If Photon does not load or cannot do it, a PNG original of `THUMBNAIL_FALLBACK_BYTES` or less is drawn as it is, and a JPEG
 * or a heavier PNG only as its gray line. The original's data are let go once the thumbnail is ready.
 */
function thumbnailOf(image: ChatImage): Thumbnail | "pending" | "none" {
  const known = thumbnails.get(image);
  if (known) return known;
  if (!image.base64) return "none";
  const original: Thumbnail = { base64: image.base64, ...(image.widthPx && image.heightPx ? { widthPx: image.widthPx, heightPx: image.heightPx } : {}) };
  if (image.mime === "image/png" && isPngBase64(image.base64) && image.base64.length <= THUMBNAIL_MAX_BYTES) { thumbnails.set(image, original); return original; }
  thumbnails.set(image, "pending");
  void reduce(image.base64, image.mime).then(result => {
    thumbnails.set(image, result);
    if (result !== "none" && result.base64 !== image.base64) delete image.base64;
    thumbnailReady?.();
  });
  return "pending";
}

/** `png` (base64) as it is when it weighs `maxBytes` or less; otherwise shrunk, step by step, until it does (fewer pixels, always a PNG); undefined when it cannot be decoded or stays too heavy. */
function fitPng(png: string, widthPx: number | undefined, heightPx: number | undefined, maxBytes: number): Thumbnail | undefined {
  if (png.length <= maxBytes) return { base64: png, ...(widthPx && heightPx ? { widthPx, heightPx } : {}) };
  const raster = decodePng(Buffer.from(png, "base64"));
  if (!raster) return undefined;
  for (const factor of [0.8, 0.64, 0.5, 0.4]) {
    const scaled = scaleRaster(raster, raster.width * factor, raster.height * factor);
    const base64 = encodePng(scaled).toString("base64");
    if (base64.length <= maxBytes) return { base64, widthPx: scaled.width, heightPx: scaled.height };
  }
  return undefined;
}

async function reduce(base64: string, mime: string): Promise<Thumbnail | "none"> {
  try {
    const { resizeImage, convertToPng } = await import("@earendil-works/pi-coding-agent");
    const cell = getCellDimensions();
    // The byte limit is only a ceiling Photon should not hit (it would shrink further on its own and may prefer a JPEG); `fitPng` applies the real one, to the PNG.
    const resized = await resizeImage(Buffer.from(base64, "base64"), mime, {
      maxWidth: THUMBNAIL_COLUMNS * cell.widthPx * RETINA, maxHeight: THUMBNAIL_ROWS * cell.heightPx * RETINA, maxBytes: 8 * 1024 * 1024,
    });
    const png = resized && (resized.mimeType === "image/png" ? { data: resized.data } : await convertToPng(resized.data, resized.mimeType));
    const fitted = png && resized && isPngBase64(png.data) ? fitPng(png.data, resized.width, resized.height, THUMBNAIL_MAX_BYTES) : undefined;
    if (fitted) return fitted;
  } catch { /* Photon did not load: the original or nothing, below. */ }
  return mime === "image/png" && isPngBase64(base64) && (base64.length * 3) / 4 <= THUMBNAIL_FALLBACK_BYTES ? { base64 } : "none";
}

/** A row of thumbnails composed as one PNG (see `composeStrip`), with the columns it takes. */
interface Composed extends Thumbnail { columns: number }

/**
 * Lays `thumbnails` side by side as ONE PNG — `THUMBNAIL_GAP` columns apart, each in its box of `columns` × `THUMBNAIL_ROWS` cells — so that the row has a single kitty image: pi-tui treats only the first image of a line
 * (`getKittyImagePlacement`, `cropKittyImageLine`), so a second one on the same line would not be cropped when it scrolls out at the bottom, would be drawn over the writing box and would not enter pi-tui's cache. The
 * canvas has the proportion of the cells it takes, and if its PNG weighs more than `STRIP_MAX_BYTES` its pixels are reduced (never its format; the floor is one pixel per Retina pixel, so the cells it takes stay the
 * same). A thumbnail that cannot be decoded is left out of the row.
 */
async function composeStrip(thumbnails: Thumbnail[], columns: number): Promise<Composed | "none"> {
  const cell = getCellDimensions();
  const rasters = thumbnails.flatMap(thumbnail => decodePng(Buffer.from(thumbnail.base64, "base64")) ?? []);
  if (rasters.length === 0) return "none";
  const row = composeRow(rasters, { width: columns * cell.widthPx * RETINA, height: THUMBNAIL_ROWS * cell.heightPx * RETINA }, THUMBNAIL_GAP * cell.widthPx * RETINA);
  const cells = rasters.length * columns + (rasters.length - 1) * THUMBNAIL_GAP;
  for (const factor of [1, 0.75, 0.6, 0.5]) {
    const scaled = factor === 1 ? row : scaleRaster(row, row.width * factor, row.height * factor);
    const base64 = encodePng(scaled).toString("base64");
    if (base64.length <= STRIP_MAX_BYTES) return { base64, widthPx: scaled.width, heightPx: scaled.height, columns: cells };
  }
  return "none";
}

/** `266 KB`, `1.4 MB`: a file's size for the gray line. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The gray line that stands for an image where it cannot be drawn: `🖼 name.png · 1600×1400 · 266 KB`, the name a link that opens the file when the image has a path. */
export function imageLine(image: ChatImage, links?: ChatLinks): string {
  const name = image.path && links ? links.linkTo(image.path, image.name, muted) : muted(image.name);
  const facts = [image.widthPx && image.heightPx ? `${image.widthPx}×${image.heightPx}` : undefined, image.bytes !== undefined ? formatBytes(image.bytes) : undefined].filter(Boolean);
  return `${muted("🖼 ")}${name}${facts.length ? muted(` · ${facts.join(" · ")}`) : ""}`;
}

/**
 * The images of one message or tool card, drawn under its text: up to `MAX_THUMBNAILS` thumbnails laid out in rows, each row ONE image (pi-tui's `Image`) after a blank row and indented by `indent` columns: a lone
 * thumbnail is drawn as it is and several are composed side by side (`composeStrip`). As many go in a row as fit in the chat's reading width (`READING_WIDTH`) with `THUMBNAIL_GAP` columns between them, each in a box of
 * `THUMBNAIL_COLUMNS` × `THUMBNAIL_ROWS` cells; in a narrow window the ones that do not fit go to the next row. Under the rows there is one gray line (`imageLine`) per image, in the same order — one each so that each
 * name is its own link to its file, and so that each says its own size and weight — and a line «+N images» for the rest. Where the terminal shows no images (see `enableTerminalImages`), or while the thumbnails are being made,
 * only the gray lines are drawn. The rows of an image are kept apart from the text's: they are never cut, padded or turned into links.
 */
export class ImageStrip implements Component {
  /** The composed rows by what they are made of (which thumbnails, how wide a box, the cells' size): `pending` while being composed. */
  private readonly composed = new Map<string, "pending" | Composed | "none">();
  /** pi-tui's image of each thumbnail (or composed row) by the columns it may take: the same object each time it is asked, so pi-tui's cache and its image id stay. */
  private readonly drawn = new WeakMap<Thumbnail, Map<number, Image>>();
  private readonly ids = new WeakMap<Thumbnail, number>();
  private nextId = 1;

  constructor(private readonly images: ChatImage[], private readonly options: { locale: Locale; links?: ChatLinks; indent: number }) {}

  /** Nothing to drop: the composed rows are kept by everything they depend on (the thumbnails, the box and the cells' size), so a stale one is never found. */
  invalidate(): void {}

  /** The pi-tui image of a row of `group` (one or more thumbnails) in boxes of `columns` columns, or undefined while it is being composed or when there is nothing to draw. */
  private rowImage(group: Thumbnail[], columns: number): Image | undefined {
    if (group.length === 1) return this.imageOf(group[0]!, columns);
    const cell = getCellDimensions();
    const id = (thumbnail: Thumbnail) => this.ids.get(thumbnail) ?? (this.ids.set(thumbnail, this.nextId), this.nextId++);
    const key = `${group.map(id).join(",")}|${columns}|${cell.widthPx}x${cell.heightPx}`;
    const state = this.composed.get(key);
    if (state === undefined) {
      this.composed.set(key, "pending");
      void composeStrip(group, columns).then(result => { this.composed.set(key, result); thumbnailReady?.(); });
      return undefined;
    }
    return state === "pending" || state === "none" ? undefined : this.imageOf(state, state.columns);
  }

  /** pi-tui's image of `thumbnail`, at most `columns` × `THUMBNAIL_ROWS` cells. */
  private imageOf(thumbnail: Thumbnail, columns: number): Image {
    const byColumns = this.drawn.get(thumbnail) ?? new Map<number, Image>();
    this.drawn.set(thumbnail, byColumns);
    let image = byColumns.get(columns);
    if (!image) {
      image = new Image(thumbnail.base64, "image/png", { fallbackColor: muted }, { maxWidthCells: columns, maxHeightCells: THUMBNAIL_ROWS },
        thumbnail.widthPx && thumbnail.heightPx ? { widthPx: thumbnail.widthPx, heightPx: thumbnail.heightPx } : undefined);
      byColumns.set(columns, image);
    }
    return image;
  }

  render(width: number): string[] {
    const { indent } = this.options;
    const margin = " ".repeat(Math.min(indent, Math.max(0, width - 1)));
    const shown = this.images.slice(0, MAX_THUMBNAILS);
    const rows: string[] = [];
    const states = getCapabilities().images ? shown.map(thumbnailOf) : [];
    // Thumbnails are laid out only once every one of them is settled (made, or known to be missing): meanwhile there are only the gray lines.
    if (states.length && !states.includes("pending")) {
      const ready = states.flatMap(state => state !== "pending" && state !== "none" ? [state] : []);
      const available = Math.max(1, Math.min(width, READING_WIDTH) - margin.length);
      const columns = Math.min(THUMBNAIL_COLUMNS, available);
      const perRow = Math.max(1, Math.min(MAX_THUMBNAILS, Math.floor((available + THUMBNAIL_GAP) / (columns + THUMBNAIL_GAP))));
      for (let first = 0; first < ready.length; first += perRow) {
        const image = this.rowImage(ready.slice(first, first + perRow), columns);
        if (!image) continue;
        // pi-tui keeps 2 columns of the width it is given: it is given them back, so the thumbnails take the whole box.
        const lines = image.render(available + 2);
        rows.push("", `${margin}${lines[0] ?? ""}`, ...lines.slice(1));
      }
    }
    if (rows.length === 0) rows.push("");
    for (const image of shown) rows.push(`${margin}${imageLine(image, this.options.links)}`);
    const more = this.images.length - MAX_THUMBNAILS;
    if (more > 0) rows.push("", `${margin}${muted(getCatalog(this.options.locale).chatImages.more({ count: more }))}`);
    return rows;
  }
}
