import { expect, test } from "bun:test";
import { isPngBase64 } from "./png-strip.ts";
import { realPng, screenshotPng } from "./png-fixtures.ts";

/**
 * U2-r7. The thumbnails are made with Photon (Rust/WASM, in `@silvia-odwyer/photon-node`, through `resizeImage` and `convertToPng` of pi-coding-agent). If Photon does not load on a system, the chat there only shows the gray
 * lines (or a PNG original of 256 KB or less), and that has to be known before publishing: this test runs on the three jobs of the CI and, if it fails, says which system.
 */
const system = `${process.platform}-${process.arch} (Bun ${Bun.version})`;
const photon = async () => {
  try { return await import("@earendil-works/pi-coding-agent"); } catch (error) { throw new Error(`Photon: pi-coding-agent no carga en ${system}: ${error instanceof Error ? error.message : String(error)}`); }
};

test("Photon carga y resizeImage devuelve una captura reducida y decodificable", async () => {
  const { resizeImage } = await photon();
  const resized = await resizeImage(screenshotPng(900, 560, 2), "image/png", { maxWidth: 396, maxHeight: 252, maxBytes: 8 * 1024 * 1024 });
  expect(resized, `Photon no reduce en ${system}: resizeImage devolvió null (solo se verían líneas grises)`).not.toBeNull();
  expect(resized!.width, system).toBeLessThanOrEqual(396);
  expect(resized!.height, system).toBeLessThanOrEqual(252);
  expect(resized!.wasResized, system).toBe(true);
  expect(Buffer.from(resized!.data, "base64").length, system).toBeGreaterThan(100);
}, { timeout: 30_000 });

test("Photon: convertToPng devuelve un PNG de verdad (con la firma) a partir de un JPEG", async () => {
  const { resizeImage, convertToPng } = await photon();
  // Un JPEG de verdad: con un tope chico `resizeImage` prefiere el JPEG al PNG.
  const jpeg = await resizeImage(realPng(500, 300, 6), "image/png", { maxWidth: 500, maxHeight: 300, maxBytes: 60_000 });
  expect(jpeg?.mimeType, `Photon no produce JPEG en ${system}`).toBe("image/jpeg");
  const png = await convertToPng(jpeg!.data, "image/jpeg");
  expect(png, `Photon no convierte a PNG en ${system}: convertToPng devolvió null (los JPEG solo se verían como línea gris)`).not.toBeNull();
  expect(png!.mimeType).toBe("image/png");
  expect(isPngBase64(png!.data), `los datos de convertToPng en ${system} no empiezan con la firma PNG: ${png!.data.slice(0, 16)}`).toBe(true);
}, { timeout: 30_000 });

test("Photon: resizeImage de un PNG devuelve un PNG con la firma, o un JPEG que convertToPng vuelve PNG", async () => {
  const { resizeImage, convertToPng } = await photon();
  const resized = (await resizeImage(realPng(900, 560, 7), "image/png", { maxWidth: 396, maxHeight: 252, maxBytes: 8 * 1024 * 1024 }))!;
  expect(resized, system).not.toBeNull();
  const png = resized.mimeType === "image/png" ? { data: resized.data } : (await convertToPng(resized.data, resized.mimeType))!;
  expect(isPngBase64(png.data), `en ${system} la reducción no se pudo dejar como PNG (${resized.mimeType})`).toBe(true);
}, { timeout: 30_000 });
