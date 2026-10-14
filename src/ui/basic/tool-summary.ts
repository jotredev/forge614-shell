import { stripVTControlCharacters } from "node:util";
import { getImageDimensions } from "@earendil-works/pi-tui";
import { MAX_IMAGE_BYTES } from "./chat-images.ts";
import type { ChatImage } from "./chat-images.ts";
import type { Catalog } from "../../i18n/index.ts";

/** The words a summary needs, from the catalog. */
type SummaryText = Pick<Catalog, "toolSummary">;

/** The most titles a summary of results names, and the most `key: value` pairs a summary of any other object shows. */
const MAX_TITLES = 3;
const MAX_PAIRS = 3;
/** The longest a single value is shown in a summary. */
const MAX_VALUE = 60;

const clean = (text: string) => stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const short = (value: string) => value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE - 1)}…` : value;

/** The title of one search result: Engram gives it as `title`, or inside `memory`. */
function titleOf(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined;
  if (typeof result.title === "string") return result.title;
  if (isRecord(result.memory) && typeof result.memory.title === "string") return result.memory.title;
  return typeof result.name === "string" ? result.name : undefined;
}

/**
 * A tool's result as one short, readable line when it is JSON; the text as it came when it is not (or is JSON of a shape with nothing simple to say). The cases Engram's tools return:
 * `results` (a search) → «3 results: title, title, title»; `memory` with a `title` → the title; `sessionId` → «session <id>»; any other object → its first three simple `key: value` pairs joined by « · ».
 */
export function summarizeToolText(text: string, t: SummaryText): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return text;
  let parsed: unknown;
  try { parsed = JSON.parse(trimmed); } catch { return text; }
  if (!isRecord(parsed)) return text;
  if (Array.isArray(parsed.results)) {
    const titles = parsed.results.map(titleOf).filter((title): title is string => title !== undefined);
    const named = titles.slice(0, MAX_TITLES).map(short).join(", ");
    return t.toolSummary.results({ count: parsed.results.length, titles: named && titles.length > MAX_TITLES ? `${named}…` : named });
  }
  if (isRecord(parsed.memory) && typeof parsed.memory.title === "string") return short(parsed.memory.title);
  if (typeof parsed.sessionId === "string") return t.toolSummary.session({ id: parsed.sessionId });
  const pairs = Object.entries(parsed)
    .filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    .slice(0, MAX_PAIRS)
    .map(([key, value]) => `${key}: ${short(String(value))}`);
  return pairs.length ? pairs.join(" · ") : text;
}

/** The image types Shell draws, with the extension the gray line gives an image that has no name. */
const DRAWN_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg" };

/**
 * The images of a tool result (`tool_result.content`): each `image` block with base64 data, as a `ChatImage` for the card to draw. Only PNG and JPEG have pixels to draw (the sizes pi-tui can read); another
 * type, or data bigger than `MAX_IMAGE_BYTES`, comes without pixels, so the card shows just its gray line. The image has no file name: it is called «image.png» (in the catalog's language).
 */
export function toolResultImages(content: unknown, t: Pick<Catalog, "chatImages">): ChatImage[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((block): ChatImage[] => {
    if (!isRecord(block) || block.type !== "image" || !isRecord(block.source)) return [];
    const { media_type: mime, data } = block.source;
    if (typeof mime !== "string" || typeof data !== "string" || data === "") return [];
    const extension = DRAWN_TYPES[mime] ?? mime.replace(/^image\//, "");
    const bytes = Math.floor((data.length * 3) / 4);
    const name = `${t.chatImages.unnamed}.${extension}`;
    if (!DRAWN_TYPES[mime] || bytes > MAX_IMAGE_BYTES) return [{ name, mime, bytes }];
    const dimensions = getImageDimensions(data, mime);
    return [{ name, mime, base64: data, bytes, ...(dimensions ? { widthPx: dimensions.widthPx, heightPx: dimensions.heightPx } : {}) }];
  });
}

/**
 * The line a tool card shows under its title for a result Claude Code delivers (`tool_result.content`): a string, or an array of blocks. The `text` blocks are summarized (`summarizeToolText`); any other block —
 * an image— is summarized as before, without its bytes, keeping only its type and media type; the parts go on one line joined by « · ». Control codes are removed and the length is limited.
 */
export function toolResultPreview(content: unknown, t: SummaryText): string {
  const parts = Array.isArray(content) ? content.map(block => {
    if (!isRecord(block)) return typeof block === "string" ? summarizeToolText(block, t) : JSON.stringify(block ?? "");
    if (block.type === "text" && typeof block.text === "string") return summarizeToolText(block.text, t);
    if (block.type !== "image") return JSON.stringify(block);
    const source = block.source;
    const mediaType = isRecord(source) ? source.media_type : undefined;
    return JSON.stringify(typeof mediaType === "string" ? { type: "image", media_type: mediaType } : { type: "image" });
  }) : [typeof content === "string" ? summarizeToolText(content, t) : JSON.stringify(content ?? "")];
  return clean(parts.join(" · ")).slice(0, 3000);
}
