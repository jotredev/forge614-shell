import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createComposer } from "./composer.ts";
import { attachImagePaste, pastedPathText, pasteNotice } from "./paste-image.ts";
import { imagesInText } from "./chat-images.ts";
import { pasteImageKey } from "../../infrastructure/clipboard.ts";
import type { PastedImage } from "../../infrastructure/clipboard.ts";
import { getCatalog } from "../../i18n/index.ts";

/** The key as the terminal sends it: Ctrl+V is the byte 0x16; Alt+V is Esc and V. The platform of the test decides, as it does for the box. */
const KEY = pasteImageKey() === "alt+v" ? "\x1bv" : "\x16";

const setup = (paste: () => Promise<PastedImage>, locale: "es" | "en" = "es") => {
  const flashed: string[] = [];
  let renders = 0;
  const screen = { requestRender() { renders++; }, flash(message: string) { flashed.push(message); } };
  const { input } = createComposer(screen as never, locale);
  attachImagePaste(input, screen, locale, paste);
  return { input, flashed, renders: () => renders };
};
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

test("la tecla de pegar imagen escribe la ruta en la caja, con un espacio detrás, y no manda nada", async () => {
  const { input, flashed } = setup(async () => ({ kind: "image", path: "/var/folders/x/forge614-shell/paste-20261015-153012-345.png" }));
  input.setText("mira ");
  input.handleInput(KEY);
  await settle();
  expect(input.getText()).toBe("mira /var/folders/x/forge614-shell/paste-20261015-153012-345.png ");
  expect(flashed).toEqual([]);
});

test("una ruta con espacios (la carpeta temporal de un usuario de Windows) va entre comillas, y esa ruta llega a la miniatura por el camino de siempre", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge614 paste "));
  try {
    mkdirSync(join(root, "forge614-shell"));
    const path = join(root, "forge614-shell", "paste-20261015-153012-345.png");
    const header = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
    header.writeUInt32BE(13, 8); header.write("IHDR", 12); header.writeUInt32BE(640, 16); header.writeUInt32BE(480, 20);
    writeFileSync(path, header);
    expect(pastedPathText(path)).toBe(`"${path}" `);
    const { input } = setup(async () => ({ kind: "image", path }));
    input.handleInput(KEY);
    await settle();
    expect(input.getText()).toBe(`"${path}" `);
    // Lo que queda en la caja se encuentra como imagen igual que la ruta que pegaría Orca.
    const images = imagesInText(`mira ${input.getText()}`);
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ path, widthPx: 640, heightPx: 480 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("sin imagen en el portapapeles se avisa con una línea breve y no se escribe nada, en español y en inglés", async () => {
  for (const locale of ["es", "en"] as const) {
    const { input, flashed } = setup(async () => ({ kind: "empty" }), locale);
    input.setText("hola");
    input.handleInput(KEY);
    await settle();
    expect(input.getText()).toBe("hola");
    expect(flashed).toEqual([getCatalog(locale).chatImages.pasteEmpty]);
  }
  expect(getCatalog("es").chatImages.pasteEmpty).toBe("No hay una imagen en el portapapeles");
});

test("la herramienta que falta, el tamaño y el fallo tienen su aviso, y un error inesperado no rompe la caja", async () => {
  expect(pasteNotice({ kind: "missing-tool", tools: "wl-clipboard" }, "es")).toBe("No se pudo leer el portapapeles: instala wl-clipboard");
  expect(pasteNotice({ kind: "missing-tool", tools: "xclip" }, "en")).toBe("Could not read the clipboard: install xclip");
  expect(pasteNotice({ kind: "too-big" }, "es")).toContain("20 MB");
  expect(pasteNotice({ kind: "failed" }, "en")).toBe("Could not read the image on the clipboard");
  const missing = setup(async () => ({ kind: "missing-tool", tools: "wl-clipboard o xclip" }));
  missing.input.handleInput(KEY);
  await settle();
  expect(missing.flashed).toEqual(["No se pudo leer el portapapeles: instala wl-clipboard o xclip"]);
  const broken = setup(async () => { throw new Error("boom"); });
  broken.input.handleInput(KEY);
  await settle();
  expect(broken.flashed).toEqual([getCatalog("es").chatImages.pasteFailed]);
  expect(broken.input.getText()).toBe("");
});

test("pegar es de uno en uno: la tecla pulsada de nuevo mientras se lee el portapapeles no hace nada, y después vuelve a funcionar", async () => {
  let calls = 0;
  let release!: () => void;
  const { input } = setup(() => { calls++; return new Promise<PastedImage>(resolve => { release = () => resolve({ kind: "image", path: "/tmp/uno.png" }); }); });
  input.handleInput(KEY); input.handleInput(KEY); input.handleInput(KEY);
  expect(calls).toBe(1);
  release();
  await settle();
  expect(input.getText()).toBe("/tmp/uno.png ");
  input.handleInput(KEY);
  expect(calls).toBe(2);
});

test("sin el gancho la tecla no hace nada de esto, y en la otra tecla (Ctrl+V en Windows) el texto sigue siendo del editor", async () => {
  const { input } = createComposer({ requestRender() {} } as never, "es");
  input.handleInput(KEY);
  expect(input.getText()).toBe("");
  // En Windows Ctrl+V no es la tecla de la imagen: no se intercepta.
  if (pasteImageKey() === "alt+v") {
    let calls = 0;
    const withHook = setup(async () => { calls++; return { kind: "empty" }; });
    withHook.input.handleInput("\x16");
    expect(calls).toBe(0);
  }
});
