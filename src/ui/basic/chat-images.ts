import { closeSync, lstatSync, openSync, readFileSync, readSync } from "node:fs";
import { basename } from "node:path";
import { Image, getCapabilities, getImageDimensions, setCapabilities } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import type { ChatLinks } from "./chat-links.ts";
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
 */
export function enableTerminalImages(env: NodeJS.ProcessEnv = process.env): void {
  const forced = env.FORGE614_SHELL_IMAGES?.trim().toLowerCase();
  const capabilities = getCapabilities();
  if (forced === "off") { if (capabilities.images) setCapabilities({ ...capabilities, images: null }); return; }
  if (forced === "kitty" || forced === "iterm2") { if (capabilities.images !== forced) setCapabilities({ ...capabilities, images: forced }); return; }
  if (capabilities.images || env.TERM_PROGRAM !== "Orca") return;
  if (env.TMUX !== undefined || env.STY !== undefined || /^(tmux|screen)/.test(env.TERM ?? "")) return;
  setCapabilities({ ...capabilities, images: "kitty" });
}

// ── Finding the images in what the person wrote ────────────────────────────────────────────

const EXTENSION = "(?:png|jpe?g)";
/** Where an absolute path starts, on any system: `/`, a drive (`C:\` or `C:/`) or a network share (`\\server\share`). The text is read the same way everywhere: a Windows path pasted on a Mac is recognized (and found missing). */
const ROOT = String.raw`(?:/|[A-Za-z]:[\\/]|\\\\)`;
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
      if (!getCapabilities().images || !image.base64) { rows.push(`${margin}${imageLine(image, this.options.links)}`); continue; }
      let thumbnail = this.thumbnails.get(image);
      if (!thumbnail) {
        thumbnail = new Image(image.base64, image.mime, { fallbackColor: muted }, { maxWidthCells: THUMBNAIL_COLUMNS, maxHeightCells: THUMBNAIL_ROWS, filename: image.name },
          image.widthPx && image.heightPx ? { widthPx: image.widthPx, heightPx: image.heightPx } : undefined);
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
