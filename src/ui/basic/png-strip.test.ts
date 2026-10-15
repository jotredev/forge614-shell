import { expect, test } from "bun:test";
import { MAX_DECODE_PIXELS, composeRow, decodePng, encodePng, isPngBase64, scaleRaster } from "./png-strip.ts";
import type { Raster } from "./png-strip.ts";
import { realPng, screenshotPng } from "./png-fixtures.ts";

/** A raster where each pixel is given by `paint(x, y)`. */
const raster = (width: number, height: number, paint: (x: number, y: number) => [number, number, number, number]): Raster => {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgba.set(paint(x, y), (y * width + x) * 4);
  return { width, height, rgba };
};
const pixel = (r: Raster, x: number, y: number) => [...r.rgba.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 4)];

test("encodePng y decodePng van y vienen sin perder un solo píxel, con degradados, bordes duros y transparencia", () => {
  const original = raster(37, 23, (x, y) => [x * 6 % 256, y * 11 % 256, (x * y) % 256, x > 20 && y < 8 ? 0 : 255 - (x % 5) * 10]);
  const png = encodePng(original);
  expect(isPngBase64(png.toString("base64"))).toBe(true);
  const back = decodePng(png)!;
  expect(back.width).toBe(37);
  expect(back.height).toBe(23);
  expect(back.rgba).toEqual(original.rgba);
});

test("la codificación elige filtros: un degradado pesa mucho menos que sus píxeles", () => {
  const gradient = raster(200, 100, (x, y) => [x, y, (x + y) % 256, 255]);
  expect(encodePng(gradient).length).toBeLessThan(200 * 100 * 4 / 8);
});

test("decodePng lee los PNG de RGB (filtro ninguno) y los de RGBA que escribe Photon, con todos sus filtros", async () => {
  const rgb = decodePng(realPng(120, 80, 4))!;
  expect([rgb.width, rgb.height]).toEqual([120, 80]);
  expect(rgb.rgba[3]).toBe(255); // sin canal alfa: opaco
  // Photon (lo que hace `resizeImage`) escribe RGBA con filtros adaptativos.
  const { resizeImage } = await import("@earendil-works/pi-coding-agent");
  const resized = (await resizeImage(screenshotPng(900, 560, 3), "image/png", { maxWidth: 300, maxHeight: 187, maxBytes: 8 * 1024 * 1024 }))!;
  expect(resized.mimeType).toBe("image/png");
  const photon = decodePng(Buffer.from(resized.data, "base64"))!;
  expect([photon.width, photon.height]).toEqual([resized.width, resized.height]);
  // El resultado de volver a escribirlo y leerlo es el mismo.
  expect(decodePng(encodePng(photon))!.rgba).toEqual(photon.rgba);
}, { timeout: 30_000 });

test("decodePng rechaza lo que no es un PNG de 8 bits sin entrelazar, lo roto y lo desmesurado", () => {
  const good = realPng(40, 30);
  expect(decodePng(Buffer.from("/9j/4AAQSkZJRgABAQ", "base64"))).toBeUndefined(); // un JPEG
  expect(decodePng(good.subarray(0, 60))).toBeUndefined(); // cortado
  expect(decodePng(Buffer.alloc(100))).toBeUndefined();
  const sixteen = Buffer.from(good); sixteen[24] = 16; // profundidad de 16 bits
  expect(decodePng(sixteen)).toBeUndefined();
  const palette = Buffer.from(good); palette[25] = 3; // paleta
  expect(decodePng(palette)).toBeUndefined();
  const interlaced = Buffer.from(good); interlaced[28] = 1;
  expect(decodePng(interlaced)).toBeUndefined();
  const huge = Buffer.from(good); huge.writeUInt32BE(5000, 16); huge.writeUInt32BE(5000, 20); // 25 millones de píxeles
  expect(5000 * 5000).toBeGreaterThan(MAX_DECODE_PIXELS);
  expect(decodePng(huge)).toBeUndefined();
});

test("scaleRaster promedia el área, no agranda y no oscurece los bordes transparentes", () => {
  const checker = raster(4, 4, (x, y) => (x + y) % 2 === 0 ? [200, 0, 0, 255] : [0, 0, 200, 255]);
  const half = scaleRaster(checker, 2, 2);
  expect([half.width, half.height]).toEqual([2, 2]);
  expect(pixel(half, 0, 0)).toEqual([100, 0, 100, 255]);
  expect(scaleRaster(checker, 10, 10)).toBe(checker); // nunca agranda
  // Un pixel transparente (negro) junto a uno rojo opaco: el promedio es rojo, con la mitad de opacidad.
  const edge = raster(2, 1, x => x === 0 ? [255, 0, 0, 255] : [0, 0, 0, 0]);
  expect(pixel(scaleRaster(edge, 1, 1), 0, 0)).toEqual([255, 0, 0, 128]);
});

test("composeRow pone las miniaturas lado a lado, cada una en su caja arriba a la izquierda, con la separación transparente, sin agrandar y reduciendo la que no cabe", () => {
  const red = raster(10, 6, () => [255, 0, 0, 255]);
  const blue = raster(40, 40, () => [0, 0, 255, 255]); // no cabe en una caja de 20×20: se reduce a 20×20
  const row = composeRow([red, blue], { width: 20, height: 20 }, 4);
  expect([row.width, row.height]).toEqual([44, 20]);
  expect(pixel(row, 0, 0)).toEqual([255, 0, 0, 255]);
  expect(pixel(row, 9, 5)).toEqual([255, 0, 0, 255]);
  expect(pixel(row, 10, 0)[3]).toBe(0); // el resto de la caja y la separación, transparentes
  expect(pixel(row, 0, 6)[3]).toBe(0);
  expect(pixel(row, 22, 10)[3]).toBe(0);
  expect(pixel(row, 24, 0)).toEqual([0, 0, 255, 255]); // la segunda caja empieza tras 20 + 4
  expect(pixel(row, 43, 19)).toEqual([0, 0, 255, 255]);
  // Una sola miniatura: el lienzo es una caja.
  expect(composeRow([red], { width: 20, height: 20 }, 4).width).toBe(20);
});
