import { deflateSync } from "node:zlib";

/** Images for the tests, made with `node:zlib` alone and independent of `png-strip.ts` (what the tests check). Not used by the program. */

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (bytes: Buffer) => { let c = 0xffffffff; for (const byte of bytes) c = crcTable[(c ^ byte) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const pngChunk = (type: string, body: Buffer) => { const out = Buffer.alloc(12 + body.length); out.writeUInt32BE(body.length, 0); out.write(type, 4); body.copy(out, 8); out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length); return out; };
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A real PNG (Photon can decode it) of `width` × `height` pixels, RGB, filter «none»: a gradient with noise, as heavy as a screenshot (several MB). `seed` makes each one different. */
export function realPng(width: number, height: number, seed = 1): Buffer {
  const row = width * 3 + 1;
  const raw = Buffer.alloc(row * height);
  let state = seed;
  for (let y = 0; y < height; y++) for (let x = 0; x < width * 3; x++) { state = (state * 1103515245 + 12345) & 0x7fffffff; raw[y * row + 1 + x] = ((x * 255) / (width * 3) + (y * 255) / height + ((state >> 16) % 64)) & 255; }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([SIGNATURE, pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}

/** A PNG that looks like a screenshot: flat areas, a few rectangles and lines of «text» (stripes), so it compresses like one (a few hundred KB for a screen) and keeps hard edges. RGB, filter «none». */
export function screenshotPng(width: number, height: number, seed = 1): Buffer {
  const row = width * 3 + 1;
  const raw = Buffer.alloc(row * height);
  const paint = (x: number, y: number, r: number, g: number, b: number) => { const at = y * row + 1 + x * 3; raw[at] = r; raw[at + 1] = g; raw[at + 2] = b; };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) paint(x, y, 28 + (y * 20) / height, 30 + (y * 20) / height, 36);
  let state = seed;
  const next = () => { state = (state * 1103515245 + 12345) & 0x7fffffff; return state >> 8; };
  for (let box = 0; box < 14; box++) {
    const x0 = next() % (width - 60); const y0 = next() % (height - 40); const w = 60 + (next() % (width / 3)); const h = 30 + (next() % (height / 4));
    const colors = [(next() % 200) + 30, (next() % 200) + 30, (next() % 200) + 30];
    for (let y = y0; y < Math.min(height, y0 + h); y++) for (let x = x0; x < Math.min(width, x0 + w); x++) paint(x, y, colors[0]!, colors[1]!, colors[2]!);
    for (let line = y0 + 6; line < Math.min(height, y0 + h) - 4; line += 10) for (let x = x0 + 6; x < Math.min(width, x0 + w) - 6; x++) if (((x - x0) >> 2) % 3 !== next() % 2) { paint(x, line, 235, 235, 240); paint(x, line + 1, 235, 235, 240); }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([SIGNATURE, pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}
