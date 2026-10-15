import { deflateSync, inflateSync } from "node:zlib";

/**
 * Just enough PNG to lay thumbnails side by side as ONE image (see `ImageStrip`): decode an 8-bit RGB or RGBA PNG (what Photon and screenshots produce), shrink it, paste it on a canvas and write the canvas as an RGBA PNG.
 * It is done here, with `node:zlib` and no library, because pi-coding-agent exports `resizeImage` and `convertToPng` but not Photon's pixels, and Shell may not add a dependency. pi-tui treats only the first image of a
 * line (`getKittyImagePlacement`, `cropKittyImageLine`), so a row of thumbnails must be one image for the crop and its cache to keep working.
 */

/** Pixels in RGBA order, `width` × `height`. */
export interface Raster { width: number; height: number; rgba: Uint8Array }

/** The most pixels a PNG may have to be decoded here (a decoded RGBA image takes four bytes each): a bigger one is not decoded. */
export const MAX_DECODE_PIXELS = 4_000_000;
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** The start of a PNG's base64: its signature. kitty's `f=100` takes only this; Orca refuses anything else without a word (`_createBitmap`). */
export const PNG_BASE64_START = "iVBORw0KGgo";
export const isPngBase64 = (base64: string): boolean => base64.startsWith(PNG_BASE64_START);

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (bytes: Uint8Array) => { let c = 0xffffffff; for (const byte of bytes) c = crcTable[(c ^ byte) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, body: Uint8Array) => {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0); out.write(type, 4, "latin1"); Buffer.from(body).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
};

const paeth = (a: number, b: number, c: number) => { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };

/** The pixels of an 8-bit, non-interlaced RGB or RGBA PNG, or undefined when it is anything else, broken, or has more than `MAX_DECODE_PIXELS` pixels. */
export function decodePng(bytes: Uint8Array): Raster | undefined {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (data.length < 33 || !data.subarray(0, 8).equals(SIGNATURE)) return undefined;
  let width = 0; let height = 0; let channels = 0; let ok = false;
  const parts: Buffer[] = [];
  try {
    for (let at = 8; at + 12 <= data.length;) {
      const length = data.readUInt32BE(at);
      const type = data.toString("latin1", at + 4, at + 8);
      const body = data.subarray(at + 8, at + 8 + length);
      if (body.length < length) return undefined;
      if (type === "IHDR") {
        width = body.readUInt32BE(0); height = body.readUInt32BE(4);
        const depth = body[8]; const colorType = body[9]; const interlace = body[12];
        channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
        ok = depth === 8 && channels > 0 && interlace === 0 && body[10] === 0 && body[11] === 0;
      } else if (type === "IDAT") parts.push(body);
      else if (type === "IEND") break;
      at += 12 + length;
    }
    if (!ok || width < 1 || height < 1 || width * height > MAX_DECODE_PIXELS || parts.length === 0) return undefined;
    const raw = inflateSync(Buffer.concat(parts));
    const stride = width * channels;
    if (raw.length < (stride + 1) * height) return undefined;
    const rgba = new Uint8Array(width * height * 4);
    let previous = new Uint8Array(stride);
    let line = new Uint8Array(stride);
    for (let y = 0; y < height; y++) {
      const filter = raw[y * (stride + 1)]!;
      const source = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
      for (let i = 0; i < stride; i++) {
        const left = i >= channels ? line[i - channels]! : 0;
        const up = previous[i]!;
        const upLeft = i >= channels ? previous[i - channels]! : 0;
        const predicted = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : filter === 4 ? paeth(left, up, upLeft) : -1;
        if (predicted < 0) return undefined;
        line[i] = (source[i]! + predicted) & 255;
      }
      for (let x = 0; x < width; x++) {
        const out = (y * width + x) * 4;
        rgba[out] = line[x * channels]!; rgba[out + 1] = line[x * channels + 1]!; rgba[out + 2] = line[x * channels + 2]!;
        rgba[out + 3] = channels === 4 ? line[x * channels + 3]! : 255;
      }
      [previous, line] = [line, previous];
    }
    return { width, height, rgba };
  } catch {
    return undefined;
  }
}

/** An RGBA PNG of `raster`. Each row takes the filter (none, sub, up or Paeth) whose output is the smallest in sum, and the data are deflated at the best level: thumbnails are the bytes every frame carries in Orca. */
export function encodePng(raster: Raster): Buffer {
  const { width, height, rgba } = raster;
  const stride = width * 4;
  const out = Buffer.alloc((stride + 1) * height);
  const candidates = [0, 1, 2, 4].map(() => new Uint8Array(stride));
  for (let y = 0; y < height; y++) {
    const row = rgba.subarray(y * stride, (y + 1) * stride);
    const above = y > 0 ? rgba.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    const sums = [0, 0, 0, 0];
    for (let i = 0; i < stride; i++) {
      const left = i >= 4 ? row[i - 4]! : 0; const up = above[i]!; const upLeft = i >= 4 ? above[i - 4]! : 0;
      const values = [row[i]!, (row[i]! - left) & 255, (row[i]! - up) & 255, (row[i]! - paeth(left, up, upLeft)) & 255];
      for (let k = 0; k < 4; k++) { candidates[k]![i] = values[k]!; sums[k]! += values[k]! < 128 ? values[k]! : 256 - values[k]!; }
    }
    const best = sums.indexOf(Math.min(...sums));
    out[y * (stride + 1)] = [0, 1, 2, 4][best]!;
    out.set(candidates[best]!, y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(out, { level: 9 })), chunk("IEND", new Uint8Array(0))]);
}

/** `raster` shrunk to `width` × `height` by averaging the area each new pixel covers (weighted by alpha, so a transparent edge does not darken its neighbors). A size that is not smaller returns the same raster. */
export function scaleRaster(raster: Raster, width: number, height: number): Raster {
  width = Math.max(1, Math.round(width)); height = Math.max(1, Math.round(height));
  if (width >= raster.width && height >= raster.height) return raster;
  width = Math.min(width, raster.width); height = Math.min(height, raster.height);
  const out = new Uint8Array(width * height * 4);
  const scaleX = raster.width / width; const scaleY = raster.height / height;
  for (let y = 0; y < height; y++) {
    const top = y * scaleY; const bottom = (y + 1) * scaleY;
    for (let x = 0; x < width; x++) {
      const left = x * scaleX; const right = (x + 1) * scaleX;
      let r = 0; let g = 0; let b = 0; let a = 0; let weight = 0;
      for (let sy = Math.floor(top); sy < Math.min(raster.height, Math.ceil(bottom)); sy++) {
        const wy = Math.min(bottom, sy + 1) - Math.max(top, sy);
        for (let sx = Math.floor(left); sx < Math.min(raster.width, Math.ceil(right)); sx++) {
          const w = wy * (Math.min(right, sx + 1) - Math.max(left, sx));
          const at = (sy * raster.width + sx) * 4;
          const alpha = raster.rgba[at + 3]! * w;
          r += raster.rgba[at]! * alpha; g += raster.rgba[at + 1]! * alpha; b += raster.rgba[at + 2]! * alpha; a += alpha; weight += w;
        }
      }
      const to = (y * width + x) * 4;
      if (a > 0) { out[to] = Math.round(r / a); out[to + 1] = Math.round(g / a); out[to + 2] = Math.round(b / a); }
      out[to + 3] = weight > 0 ? Math.round(a / weight) : 0;
    }
  }
  return { width, height, rgba: out };
}

/**
 * Thumbnails side by side on one transparent canvas: each is shrunk (never enlarged) to fit its slot of `slot.width` × `slot.height` pixels, keeping its proportion, and pasted at the slot's top left; the slots are
 * `gap` pixels apart. The canvas is as wide as all the slots and the gaps together and as tall as one slot, so its proportion is that of the cells it will take.
 */
export function composeRow(thumbnails: Raster[], slot: { width: number; height: number }, gap: number): Raster {
  const width = thumbnails.length * slot.width + Math.max(0, thumbnails.length - 1) * gap;
  const canvas = new Uint8Array(width * slot.height * 4);
  thumbnails.forEach((thumbnail, n) => {
    const factor = Math.min(1, slot.width / thumbnail.width, slot.height / thumbnail.height);
    const fitted = scaleRaster(thumbnail, thumbnail.width * factor, thumbnail.height * factor);
    const x0 = n * (slot.width + gap);
    for (let y = 0; y < fitted.height; y++) canvas.set(fitted.rgba.subarray(y * fitted.width * 4, (y + 1) * fitted.width * 4), (y * width + x0) * 4);
  });
  return { width, height: slot.height, rgba: canvas };
}
