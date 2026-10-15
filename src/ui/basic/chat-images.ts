import { closeSync, lstatSync, openSync, readFileSync, readSync } from "node:fs";
import { basename } from "node:path";
import { Image, getCapabilities, getCellDimensions, getImageDimensions, setCapabilities } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import type { ChatLinks } from "./chat-links.ts";
import { setPlacingLast } from "./image-placement.ts";
import { muted } from "./theme.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";

/** The largest image file Shell reads to draw (20 MB); a bigger one, or one that cannot be read, is drawn only as its gray line. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
/** The most images drawn for one message or one tool result; the rest are counted in one line. */
export const MAX_THUMBNAILS = 4;
/** The largest a thumbnail is drawn, in terminal columns and rows. */
export const THUMBNAIL_COLUMNS = 40;
export const THUMBNAIL_ROWS = 14;
/** The most a thumbnail's data weigh, as base64 (what `resizeImage`'s `maxBytes` counts): in Orca every placement carries them, so four thumbnails in view cost about 4 × this in each frame. */
export const THUMBNAIL_MAX_BYTES = 140_000;
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

/** What is drawn of an image: its data (base64), the type and, when they are known, the size in pixels the data really have. */
interface Thumbnail { base64: string; mime: string; widthPx?: number; heightPx?: number }
/** The state of each image's thumbnail: ready, `pending` while it is being reduced (the gray line is drawn meanwhile) or `none` when there is nothing to draw. */
const thumbnails = new WeakMap<ChatImage, Thumbnail | "pending" | "none">();
let thumbnailReady: (() => void) | undefined;

/** Sets what is done when a thumbnail that was being reduced is ready (the screen repaints). One per running screen. */
export function onThumbnailReady(listener: (() => void) | undefined): void { thumbnailReady = listener; }

/**
 * The copy of an image that is drawn. One that weighs `THUMBNAIL_MAX_BYTES` or less is drawn as it is, at once. A heavier one is reduced with Photon (`resizeImage` of pi-coding-agent, in a worker thread, which is
 * why it is not waited for: `readImage` and the screen's rendering are synchronous and writing in the box must never stop): until it is ready the gray line is drawn, and then the screen is asked to repaint. The size
 * is that of the thumbnail's box (`THUMBNAIL_COLUMNS` × `THUMBNAIL_ROWS` cells) in pixels, twice over for Retina screens, and the data stay under `THUMBNAIL_MAX_BYTES`. If Photon does not load or cannot do it, an
 * original of `THUMBNAIL_FALLBACK_BYTES` or less is drawn as it is and a heavier one only as its gray line. The original's data are let go once the reduction is ready.
 */
function thumbnailOf(image: ChatImage): Thumbnail | "pending" | "none" {
  const known = thumbnails.get(image);
  if (known) return known;
  if (!image.base64) return "none";
  const original: Thumbnail = { base64: image.base64, mime: image.mime, ...(image.widthPx && image.heightPx ? { widthPx: image.widthPx, heightPx: image.heightPx } : {}) };
  if (image.base64.length <= THUMBNAIL_MAX_BYTES) { thumbnails.set(image, original); return original; }
  thumbnails.set(image, "pending");
  void reduce(original).then(result => {
    thumbnails.set(image, result);
    if (result !== "none" && result !== original) delete image.base64;
    thumbnailReady?.();
  });
  return "pending";
}

async function reduce(original: Thumbnail): Promise<Thumbnail | "none"> {
  try {
    const { resizeImage } = await import("@earendil-works/pi-coding-agent");
    const cell = getCellDimensions();
    const resized = await resizeImage(Buffer.from(original.base64, "base64"), original.mime, {
      maxWidth: THUMBNAIL_COLUMNS * cell.widthPx * 2, maxHeight: THUMBNAIL_ROWS * cell.heightPx * 2, maxBytes: THUMBNAIL_MAX_BYTES,
    });
    if (resized) return { base64: resized.data, mime: resized.mimeType, widthPx: resized.width, heightPx: resized.height };
  } catch { /* Photon did not load: the original or nothing, below. */ }
  return (original.base64.length * 3) / 4 <= THUMBNAIL_FALLBACK_BYTES ? original : "none";
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
 * The images of one message or tool card, drawn under its text: up to `MAX_THUMBNAILS` thumbnails (pi-tui's `Image`, at most `THUMBNAIL_COLUMNS` × `THUMBNAIL_ROWS` cells) each after a blank row and indented by `indent`
 * columns, and a line «+N images» for the rest. Where the terminal shows no images (see `enableTerminalImages`), or an image has no pixels to draw, its gray line (`imageLine`) is drawn instead. The rows of an image are
 * kept apart from the text's: they are never cut, padded or turned into links.
 */
export class ImageStrip implements Component {
  private readonly thumbnails = new Map<ChatImage, Image>();

  constructor(private readonly images: ChatImage[], private readonly options: { locale: Locale; links?: ChatLinks; indent: number }) {}

  invalidate(): void { this.thumbnails.clear(); }

  render(width: number): string[] {
    const { indent } = this.options;
    const margin = " ".repeat(Math.min(indent, Math.max(0, width - 1)));
    const rows: string[] = [];
    for (const image of this.images.slice(0, MAX_THUMBNAILS)) {
      rows.push("");
      const drawn = getCapabilities().images ? thumbnailOf(image) : "none";
      if (drawn === "none" || drawn === "pending") { rows.push(`${margin}${imageLine(image, this.options.links)}`); continue; }
      let thumbnail = this.thumbnails.get(image);
      if (!thumbnail) {
        thumbnail = new Image(drawn.base64, drawn.mime, { fallbackColor: muted }, { maxWidthCells: THUMBNAIL_COLUMNS, maxHeightCells: THUMBNAIL_ROWS, filename: image.name },
          drawn.widthPx && drawn.heightPx ? { widthPx: drawn.widthPx, heightPx: drawn.heightPx } : undefined);
        this.thumbnails.set(image, thumbnail);
      }
      const lines = thumbnail.render(Math.max(1, width - margin.length));
      rows.push(`${margin}${lines[0] ?? ""}`, ...lines.slice(1));
    }
    const more = this.images.length - MAX_THUMBNAILS;
    if (more > 0) rows.push("", `${margin}${muted(getCatalog(this.options.locale).chatImages.more({ count: more }))}`);
    return rows;
  }
}
