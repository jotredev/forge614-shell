import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { realPng, screenshotPng } from "./png-fixtures.ts";
import { decodePng } from "./png-strip.ts";
import { Container, getCapabilities, getCellDimensions, getImageDimensions, resetCapabilitiesCache, setCapabilities, setCapabilityOverrides, visibleWidth } from "@earendil-works/pi-tui";
import { ChatLinks } from "./chat-links.ts";
import { ImageStrip, MAX_THUMBNAILS, THUMBNAIL_COLUMNS, THUMBNAIL_GAP, THUMBNAIL_MAX_BYTES, THUMBNAIL_ROWS, thumbnailLayout, enableTerminalImages, findImagePaths, formatBytes, imageLine, imagesInText, readImage } from "./chat-images.ts";
import { UserBubble } from "./chat-message.ts";
import { ActivityCard } from "./transcript.ts";
import { toolResultImages } from "./tool-summary.ts";
import { createComposer } from "./composer.ts";
import { ShellSidebar } from "./sidebar.ts";
import { ShellStatusBar } from "./status-bar.ts";
import { IndependentScrollView, chatScreen, workspaceLayout } from "./workspace.ts";
import { getCatalog } from "../../i18n/index.ts";

/** A PNG with only the part pi-tui reads (the signature and the size in the header): enough to be drawn as a thumbnail, never decoded here. */
const png = (width: number, height: number) => {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8); bytes.write("IHDR", 12); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes;
};
/** A JPEG with a signature and a start-of-frame header that gives its size. */
const jpeg = (width: number, height: number) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);

let dir = "";
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "forge614-images-")); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); resetCapabilitiesCache(); });
beforeEach(() => setCapabilities({ images: "kitty", trueColor: true, hyperlinks: false }));
afterEach(() => resetCapabilitiesCache());

const file = (name: string, content: Buffer | string) => { const path = join(dir, name); writeFileSync(path, content); return path; };
/** Makes `link` a symbolic link to `target`; false when the system does not allow it (Windows without the privilege). */
const tryLink = (target: string, link: string) => { try { symlinkSync(target, link); return true; } catch { return false; } };
/** What a row's text says with the line breaks and spaces taken out: a long path (`C:\Users\…\Temp\…` is) is cut into several rows, and the cuts are not what a test is about. */
const solid = (rows: string[]) => plain(rows).join("").replace(/\s+/g, "");
const plain = (rows: string[]) => rows.map(row => stripVTControlCharacters(row));
const KITTY = /\x1b_G[^\x1b]*\x1b\\/g;

// ── Detecting the images in a message ──────────────────────────────────────────────────────

test("findImagePaths: una ruta absoluta, entre comillas dobles o simples, y con espacios escapados con \\", () => {
  expect(findImagePaths("mira /var/folders/x/orca-paste-1-abc.png por favor")).toEqual(["/var/folders/x/orca-paste-1-abc.png"]);
  expect(findImagePaths('mira "/Users/yo/Mis capturas/a b.PNG" y')).toEqual(["/Users/yo/Mis capturas/a b.PNG"]);
  expect(findImagePaths("mira '/Users/yo/Mis capturas/foto.jpeg' y")).toEqual(["/Users/yo/Mis capturas/foto.jpeg"]);
  expect(findImagePaths("mira /Users/yo/Mis\\ capturas/pantalla\\ 1.jpg, luego")).toEqual(["/Users/yo/Mis capturas/pantalla 1.jpg"]);
  expect(findImagePaths("dos: /a/uno.png y /b/dos.jpg y otra vez /a/uno.png")).toEqual(["/a/uno.png", "/b/dos.jpg"]);
  // Lo que no es una ruta absoluta a una imagen no cuenta.
  expect(findImagePaths("relativa ./uno.png y ~/dos.png y https://x.dev/tres.png y /a/cuatro.gif y /a/cinco.txt")).toEqual([]);
});

/**
 * Reconocimiento de rutas de Windows: solo mira el texto, así que corre igual en todos los sistemas. Es la causa de las 10 fallas de Verify 38643143183 en Windows: `tmpdir()` da `C:\Users\…\Temp\…` y
 * `findImagePaths` solo entendía `/…`, de modo que las pruebas nunca encontraban sus imágenes.
 */
test("findImagePaths reconoce rutas de Windows: C:\\…, C:/…, de red \\\\servidor\\…, entre comillas y con espacios escapados", () => {
  expect(findImagePaths("mira C:\\Users\\Ana\\Pictures\\captura.png por favor")).toEqual(["C:\\Users\\Ana\\Pictures\\captura.png"]);
  expect(findImagePaths("mira C:/Users/Ana/foto.JPG, luego")).toEqual(["C:/Users/Ana/foto.JPG"]);
  expect(findImagePaths("mira \\\\servidor\\recurso\\carpeta\\a.png y")).toEqual(["\\\\servidor\\recurso\\carpeta\\a.png"]);
  // Como las pega PowerShell o Windows Terminal: entre comillas dobles (o simples) y con espacios.
  expect(findImagePaths('"C:\\Users\\Ana\\Pictures\\captura 1.png"')).toEqual(["C:\\Users\\Ana\\Pictures\\captura 1.png"]);
  expect(findImagePaths("mira 'C:\\Users\\Ana\\Mis capturas\\a b.jpeg' y")).toEqual(["C:\\Users\\Ana\\Mis capturas\\a b.jpeg"]);
  expect(findImagePaths('mira "\\\\servidor\\mi recurso\\a.png" y')).toEqual(["\\\\servidor\\mi recurso\\a.png"]);
  // Espacios escapados: con \ en Unix, con acento grave (el escape de PowerShell) en Windows.
  expect(findImagePaths("mira C:\\Users\\Ana\\Mis` capturas\\a` b.png, luego")).toEqual(["C:\\Users\\Ana\\Mis capturas\\a b.png"]);
  // Varias, mezcladas con las de Unix y sin repetir.
  expect(findImagePaths('/tmp/uno.png y "C:\\Temp\\dos.jpg" y C:\\Temp\\dos.jpg y /tmp/uno.png')).toEqual(["/tmp/uno.png", "C:\\Temp\\dos.jpg"]);
  // Lo que no es una ruta absoluta de imagen no cuenta: relativas, de unidad sin raíz, direcciones y otros tipos.
  expect(findImagePaths("a.png .\\a.png ..\\a.png C:a.png Users\\Ana\\a.png https://x.dev/a.png file:///C:/a.png C:\\Temp\\a.gif C:\\Temp\\a.txt")).toEqual([]);
});

test("una ruta de Unix en Windows y una de Windows en Unix se reconocen en el texto pero no abren nada si no existen", () => {
  const unixPath = "/ruta/que/no/existe/captura.png";
  const windowsPath = "C:\\ruta\\que\\no\\existe\\captura.png";
  const unc = "\\\\servidor-que-no-existe\\recurso\\captura.png";
  for (const path of [unixPath, windowsPath, unc]) {
    expect(findImagePaths(`mira ${path}`)).toEqual([path]);
    expect(readImage(path)).toBeUndefined();
    expect(imagesInText(`mira "${path}"`)).toEqual([]);
  }
});

test("imagesInText: solo las que existen, son archivos normales y tienen la firma de bytes correcta", () => {
  const real = file("real.png", png(30, 20));
  const realJpeg = file("real.jpg", jpeg(30, 20));
  const notImage = file("falsa.png", "esto es texto, no una imagen");
  const wrongSignature = file("cambiada.jpg", png(30, 20)); // firma de PNG con extensión .jpg
  const folder = join(dir, "carpeta.png"); mkdirSync(folder);
  const link = join(dir, "enlace.png"); const linked = tryLink(real, link);
  const missing = join(dir, "no-existe.png");
  // Las rutas van en el texto tal como las da el sistema (con `\` en Windows), entre comillas como las pegan PowerShell o Windows Terminal.
  const found = imagesInText([real, realJpeg, notImage, wrongSignature, folder, ...(linked ? [link] : []), missing].map(path => `"${path}"`).join(" "));
  expect(found.map(image => image.path)).toEqual([real, realJpeg]);
  expect(found[0]).toMatchObject({ name: "real.png", mime: "image/png", widthPx: 30, heightPx: 20 });
  expect(found[1]).toMatchObject({ name: "real.jpg", mime: "image/jpeg", widthPx: 30, heightPx: 20 });
  expect(found[0]!.base64).toBe(png(30, 20).toString("base64"));
});

test("un enlace simbólico no se sigue, ni siquiera a una imagen real", () => {
  const real = file("destino.png", png(8, 8));
  const link = join(dir, "atajo.png");
  expect(readImage(real)).toBeDefined();
  if (!tryLink(real, link)) return; // en Windows crear un enlace pide privilegios que una cuenta común puede no tener
  expect(readImage(link)).toBeUndefined();
});

test("el tope de tamaño: un archivo más grande se lee solo por su firma y queda sin píxeles, con su tamaño para la línea gris", () => {
  const path = file("grande.png", Buffer.concat([png(40, 30), Buffer.alloc(5000)]));
  const image = readImage(path, 1000)!;
  expect(image.base64).toBeUndefined();
  expect(image).toMatchObject({ name: "grande.png", path, bytes: 5033 });
  expect(readImage(path, 10_000)!.base64).toBeDefined();
  // El tope real es de 20 MB.
  expect(readImage(file("normal.png", png(4, 4)))!.base64).toBeDefined();
});

test("un archivo que no se puede leer deja solo la línea de respaldo, con su nombre", () => {
  if (process.platform === "win32" || process.getuid?.() === 0) return; // los permisos no se aplican igual
  const path = file("secreta.png", png(4, 4));
  require("node:fs").chmodSync(path, 0o000);
  try { expect(readImage(path)).toEqual({ name: "secreta.png", mime: "image/png", path }); } finally { require("node:fs").chmodSync(path, 0o600); }
});

// ── Gray line ──────────────────────────────────────────────────────────────────────────────

test("la línea de respaldo dice nombre, medidas y tamaño, y el nombre abre el archivo", () => {
  expect(formatBytes(266 * 1024)).toBe("266 KB");
  expect(formatBytes(500)).toBe("500 B");
  expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
  const image = { name: "captura.png", mime: "image/png", path: "/tmp/captura.png", widthPx: 1600, heightPx: 1400, bytes: 266 * 1024 };
  expect(stripVTControlCharacters(imageLine(image))).toBe("🖼 captura.png · 1600×1400 · 266 KB");
  expect(stripVTControlCharacters(imageLine({ name: "x.png", mime: "image/png" }))).toBe("🖼 x.png");
  // Con enlaces: el nombre es un enlace de Shell a la ruta.
  setCapabilities({ images: null, trueColor: true, hyperlinks: true });
  const links = new ChatLinks({ cwd: "/", nonce: "n" });
  const line = imageLine(image, links);
  expect(line).toContain(`\x1b]8;;f614-path:n:${encodeURIComponent("/tmp/captura.png")}\x1b\\`);
  expect(line.indexOf("\x1b]8;;f614-path")).toBeLessThan(line.indexOf("captura.png"));
  expect(stripVTControlCharacters(line)).toBe("🖼 captura.png · 1600×1400 · 266 KB");
});

test("sin soporte de imágenes (otra terminal o desactivadas) cada imagen se ve como su línea gris, debajo del texto y con el mismo margen", () => {
  setCapabilities({ images: null, trueColor: true, hyperlinks: false });
  const path = file("respaldo.png", png(1600, 1400));
  const rows = plain(new UserBubble(`mira ${path}`, { locale: "es", at: null }).render(100));
  expect(rows.at(-1)).toBe("  🖼 respaldo.png · 1600×1400 · 33 B");
  expect(solid(rows)).toContain(`mira${path}`.replace(/\s+/g, "")); // el texto con la ruta se queda (aunque la ruta ocupe varios renglones)
  expect(rows.join("\n")).not.toContain("\x1b_G");
});

// ── Activation ─────────────────────────────────────────────────────────────────────────────

test("en Orca se activa kitty cuando pi-tui no encontró imágenes; en otras terminales no cambia nada", () => {
  setCapabilities({ images: null, trueColor: true, hyperlinks: true });
  enableTerminalImages({ TERM_PROGRAM: "Orca", TERM: "xterm-256color" });
  expect(getCapabilities()).toEqual({ images: "kitty", trueColor: true, hyperlinks: true }); // lo demás igual
  for (const env of [{ TERM_PROGRAM: "Apple_Terminal" }, { TERM_PROGRAM: "vscode" }, {}, { TERM_PROGRAM: "Orca", TMUX: "/tmp/tmux-1/default,1,0" }, { TERM_PROGRAM: "Orca", TERM: "screen-256color" }]) {
    setCapabilities({ images: null, trueColor: false, hyperlinks: false });
    enableTerminalImages(env);
    expect(getCapabilities().images).toBeNull();
  }
  // Si pi-tui ya encontró un protocolo, Orca no lo pisa.
  setCapabilities({ images: "iterm2", trueColor: true, hyperlinks: true });
  enableTerminalImages({ TERM_PROGRAM: "Orca" });
  expect(getCapabilities().images).toBe("iterm2");
});

test("FORGE614_SHELL_IMAGES fuerza kitty, iterm2 o off, en cualquier terminal, y un valor desconocido no hace nada", () => {
  setCapabilities({ images: null, trueColor: true, hyperlinks: false });
  enableTerminalImages({ FORGE614_SHELL_IMAGES: "kitty" });
  expect(getCapabilities().images).toBe("kitty");
  enableTerminalImages({ FORGE614_SHELL_IMAGES: " ITERM2 " });
  expect(getCapabilities().images).toBe("iterm2");
  enableTerminalImages({ FORGE614_SHELL_IMAGES: "off", TERM_PROGRAM: "Orca" });
  expect(getCapabilities().images).toBeNull();
  setCapabilities({ images: "kitty", trueColor: true, hyperlinks: false });
  enableTerminalImages({ FORGE614_SHELL_IMAGES: "off" });
  expect(getCapabilities()).toEqual({ images: null, trueColor: true, hyperlinks: false });
  setCapabilities({ images: "kitty", trueColor: true, hyperlinks: false });
  enableTerminalImages({ FORGE614_SHELL_IMAGES: "quizás" });
  expect(getCapabilities().images).toBe("kitty");
  // Off también gana en Orca.
  setCapabilities({ images: null, trueColor: true, hyperlinks: false });
  enableTerminalImages({ FORGE614_SHELL_IMAGES: "off", TERM_PROGRAM: "Orca" });
  expect(getCapabilities().images).toBeNull();
});

// ── Thumbnails ─────────────────────────────────────────────────────────────────────────────

const kittyOf = (rows: string[]) => rows.join("").match(KITTY) ?? [];
const sizeOf = (sequence: string) => ({ columns: Number(/[,;]c=(\d+)/.exec(sequence)![1]), rows: Number(/[,;]r=(\d+)/.exec(sequence)![1]) });

test("la miniatura de un mensaje cabe en 22 columnas y 7 renglones, a la izquierda con el margen de 2, debajo del texto y con su línea gris debajo", () => {
  const path = file("grande-1600.png", png(1600, 1400));
  const rows = new UserBubble(`mira ${path}`, { locale: "es", at: null }).render(100);
  const sequences = kittyOf(rows);
  expect(sequences).toHaveLength(1);
  const { columns, rows: height } = sizeOf(sequences[0]!);
  expect(columns).toBeLessThanOrEqual(THUMBNAIL_COLUMNS);
  expect(height).toBeLessThanOrEqual(THUMBNAIL_ROWS);
  expect(columns).toBeGreaterThan(10);
  const at = rows.findIndex(row => row.includes("\x1b_G"));
  expect(rows[at]!.startsWith("  \x1b_G")).toBe(true); // margen de 2
  expect(at).toBeGreaterThan(rows.findIndex(row => row.includes("mira"))); // debajo del texto
  expect(rows[at - 1]).toBe(""); // con aire arriba
  expect(rows.length - 1 - at).toBe(height); // el resto de las filas de la imagen (vacías) y, debajo, su línea gris
  expect(rows.slice(at + 1, at + height).every(row => row === "")).toBe(true);
  expect(plain(rows).at(-1)).toBe("  🖼 grande-1600.png · 1600×1400 · 33 B");
  expect(solid(rows)).toContain(path.replace(/\s+/g, "")); // el texto con la ruta, como antes
});

/** How many images a render draws (each `a=T` is one image's start; its other chunks carry no `a=`). */
const imagesDrawn = (rows: string[]) => (rows.join("").match(/\x1b_Ga=T,/g) ?? []).length;

test("hasta 4 miniaturas por mensaje van en UN renglón, como UNA sola imagen kitty, con su línea gris cada una, y si hay más, una línea «+N imágenes»", async () => {
  const paths = Array.from({ length: 6 }, (_, i) => file(`m${i}.png`, realPng(160 + i, 120, i + 1)));
  const bubble = new UserBubble(paths.join(" "), { locale: "es", at: null });
  // Mientras se componen, solo las líneas grises.
  expect(imagesDrawn(bubble.render(120))).toBe(0);
  await until(() => imagesDrawn(bubble.render(120)) > 0, 10_000);
  const rows = bubble.render(120);
  expect(MAX_THUMBNAILS).toBe(4);
  expect(imagesDrawn(rows)).toBe(1); // las 4 miniaturas, una sola imagen
  const at = rows.findIndex(row => row.includes("\x1b_Ga=T,"));
  expect(rows.slice(at).filter(row => row.includes("\x1b_G"))).toHaveLength(1); // solo una fila lleva la imagen
  const { columns, rows: height } = sizeOf(kittyOf(rows)[0]!);
  expect(columns).toBeGreaterThan(THUMBNAIL_COLUMNS * 3); // se ven las cuatro: ocupan más de 3 cajas...
  expect(columns).toBeLessThanOrEqual(4 * THUMBNAIL_COLUMNS + 3 * THUMBNAIL_GAP); // ...y no más de 4 cajas con sus separaciones (94 columnas: caben en el ancho de lectura de 100)
  expect(height).toBeLessThanOrEqual(THUMBNAIL_ROWS);
  // Debajo de la tira, una línea gris por imagen, en el orden de la tira; y «+2 imágenes».
  const grays = plain(rows).filter(row => row.includes("🖼"));
  expect(grays).toHaveLength(4);
  expect(grays.map(row => row.trim().split(" ")[1])).toEqual(["m0.png", "m1.png", "m2.png", "m3.png"]);
  expect(plain(rows).filter(row => row.includes("+2 imágenes"))).toEqual(["  +2 imágenes"]);
  const one = Array.from({ length: 5 }, (_, i) => file(`n${i}.png`, png(50, 50)));
  expect(plain(new UserBubble(one.join(" "), { locale: "en", at: null }).render(120)).join("\n")).toContain("+1 image");
});

test("en una ventana angosta las miniaturas que no caben bajan al renglón siguiente, cada renglón una sola imagen, y en una muy angosta van de una en una", async () => {
  const paths = Array.from({ length: 4 }, (_, i) => file(`w${i}.png`, realPng(160 + i, 120, i + 1)));
  const wide = new UserBubble(paths.join(" "), { locale: "es", at: null });
  await until(() => imagesDrawn(wide.render(120)) > 0, 10_000);
  // 60 columnas (58 libres): cuatro cajas de 14 no caben (4·14 + 3·2 = 62), pero tres de 18 sí (3·18 + 2·2 = 58) → una tira de 3 y la cuarta sola en otro renglón.
  const narrow = new UserBubble(paths.join(" "), { locale: "es", at: null });
  await until(() => imagesDrawn(narrow.render(60)) > 1, 10_000);
  const rows = narrow.render(60);
  expect(imagesDrawn(rows)).toBe(2);
  const widths = (rows.join("").match(/\x1b_Ga=T,[^;\x1b]*/g) ?? []).map(sequence => sizeOf(sequence).columns).sort((a, b) => b - a);
  expect(widths[0]).toBeLessThanOrEqual(3 * 18 + 2 * THUMBNAIL_GAP);
  expect(widths[0]).toBeGreaterThan(2 * 18 + THUMBNAIL_GAP);
  expect(widths[1]).toBeLessThanOrEqual(18);
  expect(plain(rows).filter(row => row.includes("🖼"))).toHaveLength(4);
  // 30 columnas: de una en una (cada una su caja de 22), 4 imágenes.
  const tiny = new UserBubble(paths.join(" "), { locale: "es", at: null });
  await until(() => imagesDrawn(tiny.render(30)) > 3, 10_000);
  expect(imagesDrawn(tiny.render(30))).toBe(4);
});

test("«Copiar» y la selección ven solo texto: la fila de la imagen no lleva texto copiable y el mensaje sigue siendo el texto", () => {
  const path = file("copia.png", png(300, 200));
  const rows = new UserBubble(`mira ${path}`, { locale: "es", at: null }).render(100);
  // Lo que el usuario puede seleccionar y copiar es el texto de las filas: quitada la secuencia gráfica (que la terminal no dibuja como texto), solo quedan el nombre y el mensaje.
  const text = plain(rows.map(row => row.replace(KITTY, ""))).join("\n").replace(/\n+/g, "\n");
  expect(text).not.toContain("iVBOR"); // ningún byte de la imagen aparece como texto
  expect(text).not.toContain("\x1b");
  const lines = text.split("\n").filter(line => line.trim() !== "");
  expect(lines[0]!.trimEnd()).toBe("  Humano");
  // El mensaje (aunque la ruta ocupe varios renglones) y la línea gris de la imagen, que es texto: nada de datos.
  expect(lines.slice(1).join("").replace(/\s+/g, "")).toBe(`mira${path}🖼copia.png·300×200·33B`.replace(/\s+/g, ""));
});

// ── Image blocks in a tool result ──────────────────────────────────────────────────────────

test("un bloque image de un resultado de herramienta se dibuja dentro de la tarjeta, con el mismo tamaño máximo", () => {
  const data = png(1200, 900).toString("base64");
  const es = getCatalog("es");
  const images = toolResultImages([{ type: "text", text: "vista" }, { type: "image", source: { type: "base64", media_type: "image/png", data } }], es);
  expect(images).toEqual([{ name: "imagen.png", mime: "image/png", base64: data, bytes: png(1200, 900).length, widthPx: 1200, heightPx: 900 }]);
  const card = new ActivityCard("Read · captura.png", "Completado · 0s", "vista");
  card.setImages(new ImageStrip(images, { locale: "es", indent: 6 }));
  const rows = card.render(100);
  const sequences = kittyOf(rows);
  expect(sequences).toHaveLength(1);
  expect(sizeOf(sequences[0]!).columns).toBeLessThanOrEqual(THUMBNAIL_COLUMNS);
  expect(sizeOf(sequences[0]!).rows).toBeLessThanOrEqual(THUMBNAIL_ROWS);
  expect(rows.findIndex(row => row.includes("• Read"))).toBeLessThan(rows.findIndex(row => row.includes("\x1b_G")));
  expect(rows.find(row => row.includes("\x1b_G"))!.startsWith("      \x1b_G")).toBe(true);
  // Sin soporte, la tarjeta muestra la línea gris de la imagen.
  setCapabilities({ images: null, trueColor: true, hyperlinks: false });
  const fallback = new ActivityCard("Read", "ok", "vista");
  fallback.setImages(new ImageStrip(images, { locale: "es", indent: 6 }));
  expect(plain(fallback.render(100)).at(-1)).toBe(`      🖼 imagen.png · 1200×900 · 33 B`);
  // Otros tipos o datos vacíos: sin píxeles o ninguna imagen.
  expect(toolResultImages([{ type: "image", source: { type: "base64", media_type: "image/webp", data: "AAAA" } }], es)).toEqual([{ name: "imagen.webp", mime: "image/webp", bytes: 3 }]);
  expect(toolResultImages([{ type: "image", source: { type: "base64", media_type: "image/png", data: "" } }, { type: "text", text: "x" }], es)).toEqual([]);
  expect(toolResultImages("texto", es)).toEqual([]);
});

// ── The composed screen ────────────────────────────────────────────────────────────────────

/** Draws `children` in the real layout (sidebar, status bar, writing box) in a terminal `columns` × `rows`, and gives the output and the pieces to scroll and stop it. */
async function screen(children: (container: Container) => void, columns = 120, rows = 50) {
  let output = "";
  const terminal = { columns, rows, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {}, write(data: string) { output += data; }, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {} };
  // The screen as the app builds it (`ChatScreen`, with the step that gives the sidebar's text back to the rows that carry an image).
  const { surface, tui } = chatScreen(terminal as never, new ChatLinks({ cwd: process.cwd() }), undefined, { copySelection: async () => true });
  const transcript = new Container();
  children(transcript);
  const scroll = new IndependentScrollView(transcript, { follow: "none", primary: true, scrollbar: "hidden" });
  const snapshot = () => ({ account: "connected" as const, provider: "Claude Code", model: "claude-opus", reasoning: "High", context: { used: 1, window: 100 }, usage: [{ label: "Weekly", usedPercent: 74 }] });
  const { input } = createComposer(tui);
  tui.setLayoutRoot(workspaceLayout(scroll, input, new ShellSidebar(snapshot), new ShellStatusBar(snapshot), surface));
  tui.setFocus(input); tui.start();
  const settle = () => new Promise(resolve => setTimeout(resolve, 60));
  await settle();
  const mark = () => output.length;
  return { scroll, tui, settle, mark, since: (from: number) => output.slice(from), all: () => output, stop: () => tui.stop({ preserveScreen: true }) };
}

/** The screen's rows from a chunk of output: the frame is cut at every cursor move `ESC[row;1H`. */
const rowsOf = (chunk: string) => new Map(chunk.split(/(\x1b\[\d+;1H)/).flatMap((part, i, parts) => i % 2 === 1 ? [[Number(/\[(\d+);/.exec(part)![1]), parts[i + 1]!] as const] : []));

test("en el frame compuesto el renglón de la imagen no se corta ni se rellena, y comparte fila con la barra lateral intacta", async () => {
  const path = file("frame.png", png(1600, 1400));
  const bubble = new UserBubble(`mira ${path}`, { locale: "es", at: null });
  const s = await screen(container => container.addChild(bubble));
  const rows = rowsOf(s.all());
  const imageRow = [...rows].find(([, row]) => row.includes("\x1b_G"))!;
  expect(imageRow).toBeDefined();
  // La secuencia kitty está completa (todos sus trozos, tal como la dibuja la miniatura) y empieza tras 2 columnas de margen.
  const expected = kittyOf(bubble.render(120))[0]!;
  const drawn = imageRow[1].match(KITTY)!;
  expect(drawn.join("")).toBe(expected);
  expect(stripVTControlCharacters(imageRow[1].slice(0, imageRow[1].indexOf("\x1b_G"))).replace(/^\s*/, "").length).toBeLessThanOrEqual(2 + 4);
  // La barra lateral de esa misma fila sigue completa (la fila no se cortó para meter la imagen).
  expect(stripVTControlCharacters(imageRow[1])).toMatch(/[A-Za-z]/);
  expect(stripVTControlCharacters(imageRow[1]).trimEnd().length).toBeGreaterThan(80);
  s.stop();
});

test("al desplazar, una imagen medio fuera por abajo se recorta, y fuera de la vista no queda pintada encima de otras filas", async () => {
  const path = file("scroll.png", png(1600, 1400));
  // Mucho texto antes y después para poder desplazar.
  const filler = Array.from({ length: 40 }, (_, i) => `línea ${i + 1} de relleno`).join("\n");
  // Con la caja de 7 renglones la imagen es más baja: el relleno de abajo es más largo para que se pueda desplazar hasta que la imagen salga por arriba.
  const after = Array.from({ length: 90 }, (_, i) => `línea ${i + 1} de relleno`).join("\n");
  const s = await screen(container => {
    container.addChild(new UserBubble(filler, { locale: "es", at: null }));
    container.addChild(new UserBubble(`mira ${path}`, { locale: "es", at: null }));
    container.addChild(new UserBubble(after, { locale: "es", at: null }));
  });
  // Solo las secuencias que abren una imagen o un puesto (las que traen c= y r=); los trozos de datos intermedios no.
  const heightOf = (chunk: string) => (chunk.match(KITTY) ?? []).filter(sequence => /[,;]r=\d+/.test(sequence) && /[,;]c=\d+/.test(sequence)).map(sequence => sizeOf(sequence).rows);
  // Se desplaza hasta que la imagen aparece por abajo con solo unas filas visibles y luego se sigue hasta que sale por arriba.
  let sawCropped = false; let sawFull = false;
  for (let top = 0; top <= 120; top += 2) {
    s.scroll.scrollTo(top);
    const from = s.mark();
    s.tui.requestRender();
    await new Promise(resolve => setTimeout(resolve, 25));
    const rows = heightOf(s.since(from));
    if (rows.length) { if (Math.min(...rows) < THUMBNAIL_ROWS && Math.min(...rows) > 0) sawCropped = true; if (Math.max(...rows) >= 6) sawFull = true; }
  }
  expect(sawFull).toBe(true);
  expect(sawCropped).toBe(true);
  // La imagen ya salió por arriba (su primera fila quedó fuera de la vista): desaparece y el cuadro dibujado no lleva ninguna imagen ni queda nada pintado encima de otras filas.
  s.scroll.scrollTo(60);
  const from = s.mark();
  s.tui.requestRender();
  await s.settle();
  const last = s.since(from);
  expect(rowsOf(last).size).toBeGreaterThan(0);
  expect(last.match(/\x1b_Ga=[Tp]/g) ?? []).toHaveLength(0);
  s.stop();
});

test("al cerrar la pantalla no quedan imágenes kitty pegadas en la terminal", async () => {
  const path = file("cierre.png", png(300, 200));
  const s = await screen(container => container.addChild(new UserBubble(`mira ${path}`, { locale: "es", at: null })));
  expect(s.all()).toContain("\x1b_Ga=T");
  const from = s.mark();
  s.stop();
  expect(s.since(from)).toContain("\x1b_Ga=d,d=A");
});

test("sin imágenes activadas (FORGE614_SHELL_IMAGES=off) el frame compuesto no lleva ninguna secuencia gráfica, solo la línea gris", async () => {
  setCapabilityOverrides({ trueColor: true });
  setCapabilities({ images: "kitty", trueColor: true, hyperlinks: false });
  enableTerminalImages({ FORGE614_SHELL_IMAGES: "off" });
  const path = file("apagada.png", png(300, 200));
  const s = await screen(container => container.addChild(new UserBubble(`mira ${path}`, { locale: "es", at: null })));
  expect(s.all()).not.toContain("\x1b_G");
  expect(stripVTControlCharacters(s.all())).toContain("🖼 apagada.png · 300×200");
  s.stop();
});

// ── The bytes the terminal gets (U2-r3) ────────────────────────────────────────────────────

/** A PNG as big as a thumbnail may be (`THUMBNAIL_MAX_BYTES` as base64 allows ~105 KB), so its kitty sequence has dozens of `m=1` chunks (the 33-byte fixtures above fit in one and hid the defect). A heavier one is reduced first (see `thumbnailOf`). */
const bigPng = (width: number, height: number, extra = 100_000) => Buffer.concat([png(width, height), Buffer.from(Array.from({ length: extra }, (_, i) => (i * 31) % 256))]);
/** The text of a row with the graphics sequences taken out (they are zero columns wide) and the terminal's controls removed: what the person reads on that row. */
const visible = (row: string) => stripVTControlCharacters(row.replace(KITTY, ""));
/** Cuts the frame at each cursor move (`ESC[row;1H`): the last time each row was written. */
const lastRows = (chunk: string) => { const rows: string[] = []; const parts = chunk.split(/(\x1b\[\d+;1H)/); for (let i = 1; i < parts.length; i += 2) rows[Number(/\[(\d+);/.exec(parts[i]!)![1])] = parts[i + 1]!; return rows; };

/**
 * Draws one transcript, with a recognizable sidebar, in the real layout; returns the rows the person reads on the right (the sidebar's columns) and the raw output. `images` off draws the same transcript with the gray lines,
 * which is the reference: the sidebar of every row must read the same with an image as without one.
 */
async function sidebarOf(build: (container: Container) => void, images: boolean) {
  setCapabilities({ images: images ? "kitty" : null, trueColor: true, hyperlinks: true });
  let output = "";
  const terminal = { columns: 120, rows: 50, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {}, write(data: string) { output += data; }, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {} };
  // The screen as the app builds it (`ChatScreen`, with the step that gives the sidebar's text back to the rows that carry an image).
  const { surface, tui } = chatScreen(terminal as never, new ChatLinks({ cwd: process.cwd() }), undefined, { copySelection: async () => true });
  const transcript = new Container();
  build(transcript);
  const scroll = new IndependentScrollView(transcript, { follow: "none", primary: true, scrollbar: "hidden" });
  const snapshot = () => ({ account: "connected" as const, provider: "Claude Code", model: "claude-opus", reasoning: "High", context: { used: 1, window: 100 }, usage: [{ label: "Weekly", usedPercent: 74 }] });
  const { input } = createComposer(tui);
  tui.setLayoutRoot(workspaceLayout(scroll, input, new ShellSidebar(snapshot), new ShellStatusBar(snapshot), surface));
  tui.setFocus(input); tui.start();
  await new Promise(resolve => setTimeout(resolve, 80));
  const before = output.length;
  tui.stop({ preserveScreen: true });
  const rows = lastRows(output.slice(0, before));
  return { rows, right: rows.map(row => visible(row ?? "").slice(-36)), output, stopped: output.slice(before) };
}

test("el frame real entrega la secuencia kitty de una imagen grande completa y la barra lateral de esa fila intacta", async () => {
  const path = file("captura-real.png", bigPng(1600, 1400));
  // La fila donde empieza la imagen se barre sobre 8 filas seguidas: en alguna cae sobre texto de la barra lateral (en otras la barra está vacía y el defecto no se ve).
  for (let lead = 0; lead < 8; lead++) await expectImageRowIntact(lead, path);
});

async function expectImageRowIntact(lead: number, path: string) {
  const build = (container: Container) => container.addChild(new UserBubble(`${"\n".repeat(lead)}mira ${path}`, { locale: "es", at: null }));
  const reference = await sidebarOf(build, false);
  const drawn = await sidebarOf(build, true);
  // 1. La secuencia llega completa: sus trozos `m=1…` y el final `m=0`, cada uno cerrado, sin nada insertado en medio.
  const chunks = drawn.output.match(KITTY)!.filter(chunk => !chunk.startsWith("\x1b_Ga=d"));
  expect(chunks.length).toBeGreaterThan(20);
  expect(chunks[0]).toMatch(/^\x1b_Ga=T,f=100,q=2,C=1,c=\d+,r=\d+,i=\d+,m=1;[A-Za-z0-9+/=]+\x1b\\$/);
  for (const chunk of chunks.slice(1, -1)) expect(chunk).toMatch(/^\x1b_Gm=1;[A-Za-z0-9+/=]+\x1b\\$/);
  expect(chunks.at(-1)).toMatch(/^\x1b_Gm=0;[A-Za-z0-9+/=]+\x1b\\$/);
  const payload = chunks.map(chunk => chunk.slice(chunk.indexOf(";") + 1, -2)).join("");
  expect(payload).toBe(bigPng(1600, 1400).toString("base64"));
  // 2. Los trozos van seguidos: entre el primero y el último no hay ningún otro código.
  const start = drawn.output.indexOf(chunks[0]!);
  expect(drawn.output.slice(start, start + chunks.join("").length)).toBe(chunks.join(""));
  // 3. El texto de la barra lateral de cada fila llega igual que sin imagen, también en la fila donde empieza la imagen.
  const imageRow = drawn.rows.findIndex(row => row?.includes("a=T"));
  expect(imageRow).toBeGreaterThan(0);
  for (let y = 3; y < 30; y++) expect(drawn.right[y], `con ${lead} líneas antes, fila ${y}`).toBe(reference.right[y]);
  // 4. Y viene después del cierre de la secuencia en esa misma fila.
  const row = drawn.rows[imageRow]!;
  const tail = reference.right[imageRow]!.trim();
  expect(visible(row.slice(row.lastIndexOf("\x1b\\") + 2)).includes(tail), `con ${lead} líneas antes, el texto «${tail}» de la barra lateral viene tras el cierre`).toBe(true);
}

test("lo mismo con la imagen dentro de una tarjeta de herramienta (Read) y después de desplazar", async () => {
  const data = bigPng(1200, 900).toString("base64");
  const images = toolResultImages([{ type: "image", source: { type: "base64", media_type: "image/png", data } }], getCatalog("es"));
  const build = (container: Container) => {
    for (let i = 0; i < 3; i++) container.addChild(new UserBubble(`relleno ${i}`, { locale: "es", at: null }));
    const card = new ActivityCard("Read · captura.png", "Completado · 0s", "imagen");
    card.setImages(new ImageStrip(images, { locale: "es", indent: 6 }));
    container.addChild(card);
  };
  const reference = await sidebarOf(build, false);
  const drawn = await sidebarOf(build, true);
  const chunks = drawn.output.match(KITTY)!.filter(chunk => !chunk.startsWith("\x1b_Ga=d"));
  expect(chunks.map(chunk => chunk.slice(chunk.indexOf(";") + 1, -2)).join("")).toBe(data);
  for (let y = 3; y < 30; y++) expect(drawn.right[y], `fila ${y}`).toBe(reference.right[y]);
  // Después de desplazar: la imagen medio recortada por abajo conserva la barra lateral de su fila.
  const path = file("para-desplazar.png", bigPng(1600, 1400));
  // La barra lateral no depende del contenido del chat: en cada fila lee lo mismo que con un chat cualquiera, esté la imagen donde esté (la referencia va antes: apaga las imágenes mientras se calcula).
  const sidebar = (await sidebarOf(container => container.addChild(new UserBubble("hola", { locale: "es", at: null })), false)).right;
  setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
  const filler = Array.from({ length: 70 }, (_, i) => `línea ${i + 1}`).join("\n");
  const s = await screen(container => { container.addChild(new UserBubble(filler, { locale: "es", at: null })); container.addChild(new UserBubble(`mira ${path}`, { locale: "es", at: null })); container.addChild(new UserBubble(filler, { locale: "es", at: null })); }, 120, 50);
  let withImage = 0;
  for (const top of [0, 10, 20, 28, 32, 36, 40, 44, 48, 52, 56, 60]) {
    s.scroll.scrollTo(top);
    const from = s.mark();
    s.tui.requestRender(); await s.settle();
    const rows = lastRows(s.all());
    if (rows.some(row => row?.includes("\x1b_Ga="))) withImage++; // hay imagen (entera o recortada) en el cuadro
    for (let y = 3; y < 30; y++) expect(visible(rows[y] ?? "").slice(-36), `desplazado a ${top}, fila ${y}`).toBe(sidebar[y]!);
  }
  expect(withImage).toBeGreaterThan(3); // la prueba mira cuadros que de verdad llevan la imagen
  s.stop();
});

// ── The gray line that does not run off (U2-r8) ────────────────────────────────────────────

test("U2-r8: la línea gris con el nombre real de Orca a 76 columnas acorta el nombre con … en medio, deja el tamaño entero y el enlace apunta a la ruta completa", () => {
  setCapabilities({ images: null, trueColor: true, hyperlinks: true });
  const name = "orca-paste-1792039483269-eefa0ae4-5b1e-4c8d-9a27-3f0d1c6f1ca9.png";
  const path = file(name, png(1903, 1047));
  const image = { ...readImage(path)!, bytes: 1_468_006 }; // 1.4 MB
  const links = new ChatLinks({ cwd: process.cwd() });
  // El chat mide 76 columnas y la línea lleva 2 de margen: caben 74.
  const rows = new ImageStrip([image], { locale: "es", links, indent: 2 }).render(76);
  const line = rows.find(row => row.includes("🖼"))!;
  const text = stripVTControlCharacters(line);
  expect(visibleWidth(text), text).toBeLessThanOrEqual(76);
  expect(text.endsWith(" · 1903×1047 · 1.4 MB")).toBe(true); // el tamaño y el peso, enteros
  const shown = /🖼 (\S+) ·/.exec(text)![1]!;
  expect(shown).toContain("…");
  expect(shown.startsWith("orca-paste-1792")).toBe(true);
  expect(shown.endsWith("f1ca9.png")).toBe(true);
  expect(shown.length).toBeLessThan(name.length);
  // El enlace sigue apuntando al archivo completo, no al nombre acortado.
  const target = /\x1b\]8;;([^\x1b]*)\x1b\\/.exec(line)![1]!;
  expect(decodeURIComponent(target)).toContain(name);
  // Con sitio de sobra el nombre va entero, y con las demás anchuras la línea nunca se sale.
  expect(stripVTControlCharacters(new ImageStrip([image], { locale: "es", links, indent: 2 }).render(120).find(row => row.includes("🖼"))!)).toContain(name);
  for (const width of [30, 40, 50, 60, 76, 100]) {
    const narrow = stripVTControlCharacters(new ImageStrip([image], { locale: "es", links, indent: 2 }).render(width).find(row => row.includes("🖼"))!);
    expect(visibleWidth(narrow), `${width} columnas: ${narrow}`).toBeLessThanOrEqual(Math.max(width, 3 + 1 + 21 + 2));
    expect(narrow.endsWith(" · 1903×1047 · 1.4 MB"), narrow).toBe(true);
  }
});

// ── The strip's size (U2-r7) ───────────────────────────────────────────────────────────────

test("thumbnailLayout: hasta 4 por renglón mientras cada caja mida 14 columnas o más (22 como máximo, 2 de hueco); solo si no caben 4 de 14 bajan las que sobran", () => {
  // Con espacio de sobra: 4 cajas de 22 (94 columnas) y menos imágenes también de 22.
  expect(thumbnailLayout(4, 98)).toEqual({ perRow: 4, columns: 22 });
  expect(thumbnailLayout(2, 98)).toEqual({ perRow: 2, columns: 22 });
  expect(thumbnailLayout(1, 98)).toEqual({ perRow: 1, columns: 22 });
  // 74 columnas libres (un chat de 76 con margen de 2): 4 cajas de 17.
  expect(thumbnailLayout(4, 74)).toEqual({ perRow: 4, columns: 17 });
  expect(thumbnailLayout(3, 74)).toEqual({ perRow: 3, columns: 22 });
  // El límite: 4 de 14 ocupan 62; con 61 libres ya no caben y van 3 de 18.
  expect(thumbnailLayout(4, 62)).toEqual({ perRow: 4, columns: 14 });
  expect(thumbnailLayout(4, 61)).toEqual({ perRow: 3, columns: 19 });
  expect(thumbnailLayout(4, 58)).toEqual({ perRow: 3, columns: 18 });
  // Muy angosto: de una en una, con la caja que haya.
  expect(thumbnailLayout(4, 28)).toEqual({ perRow: 1, columns: 22 });
  expect(thumbnailLayout(4, 10)).toEqual({ perRow: 1, columns: 10 });
});

test("U2-r7: con 76 columnas de chat, 4 capturas de 1903×1047 quedan en UNA tira, de cajas de 17 columnas", async () => {
  const paths = [1, 2, 3, 4].map(n => file(`tira76-${n}.png`, screenshotPng(1903, 1047, n)));
  const bubble = new UserBubble(paths.join(" "), { locale: "es", at: null });
  await until(() => imagesDrawn(bubble.render(76)) > 0, 15_000);
  const rows = bubble.render(76);
  expect(imagesDrawn(rows)).toBe(1);
  const { columns } = sizeOf(kittyOf(rows)[0]!);
  expect(columns).toBeGreaterThan(3 * 17); // se ven las cuatro: más de 3 cajas...
  expect(columns).toBeLessThanOrEqual(4 * 17 + 3 * THUMBNAIL_GAP); // ...y dentro de las 74 columnas libres
  expect(plain(rows).filter(row => row.includes("🖼"))).toHaveLength(4);
}, { timeout: 30_000 });

test("U2-r7: la tira mide lo que la miniatura más alta, en renglones reales, sin renglones vacíos de sobra debajo", async () => {
  // Una captura ancha (1903×1047) y una vertical (600×900): la tira es tan alta como la vertical.
  const wide = file("alta-ancha.png", screenshotPng(1903, 1047, 1));
  const wide2 = file("alta-ancha-2.png", screenshotPng(1903, 1047, 3)); // otra ruta: la misma ruta repetida cuenta una sola vez
  const tall = file("alta-vertical.png", screenshotPng(600, 900, 2));
  const check = async (paths: string[], expectedRows: (cell: { widthPx: number; heightPx: number }, columns: number) => number, columns = 22, width = 120) => {
    const bubble = new UserBubble(paths.join(" "), { locale: "es", at: null });
    await until(() => imagesDrawn(bubble.render(width)) > 0, 15_000);
    const rows = bubble.render(width);
    const first = kittyOf(rows)[0]!;
    const cell = getCellDimensions();
    const chunks = firstImageData(rows.join(""));
    const raster = decodePng(Buffer.from(chunks.base64, "base64"))!;
    // El lienzo tiene alto de renglones enteros, los que toma en la terminal.
    const rowsTaken = sizeOf(first).rows;
    expect(raster.height, "alto del lienzo en píxeles").toBe(rowsTaken * cell.heightPx * 2);
    expect(rowsTaken).toBe(expectedRows(cell, columns));
    // Sin hueco de sobra: la última fila de píxeles con algo dibujado está a menos de un renglón del final.
    let lastDrawn = -1;
    for (let y = raster.height - 1; y >= 0 && lastDrawn < 0; y--) for (let x = 0; x < raster.width; x++) if (raster.rgba[(y * raster.width + x) * 4 + 3]! > 0) { lastDrawn = y; break; }
    expect(raster.height - 1 - lastDrawn, "píxeles vacíos al pie").toBeLessThan(cell.heightPx * 2);
    return rowsTaken;
  };
  // Dos anchas: la caja de 22 columnas da un ancho de 396 px y un alto de 396/1.8176 = 218 px → ceil(218/36) = 7 renglones.
  const twoWide = await check([wide, wide2], (cell, columns) => Math.ceil(Math.round((columns * cell.widthPx * 2) / (1903 / 1047)) / (cell.heightPx * 2)));
  // Una ancha y una vertical: la vertical manda y la tira llega al máximo de 7 renglones.
  const mixed = await check([wide, tall], () => THUMBNAIL_ROWS);
  expect(twoWide).toBeLessThanOrEqual(THUMBNAIL_ROWS);
  expect(mixed).toBe(THUMBNAIL_ROWS);
  // Cuatro anchas con 76 columnas de chat: cajas de 17 columnas → 306 px de ancho, 168 px de alto → 5 renglones (con la caja fija de 7 sobraban 2 vacíos, lo que se vio en Orca).
  const extra = [file("alta-ancha-3.png", screenshotPng(1903, 1047, 4)), file("alta-ancha-4.png", screenshotPng(1903, 1047, 5))];
  const four = await check([wide, wide2, ...extra], (cell, columns) => Math.ceil(Math.round((columns * cell.widthPx * 2) / (1903 / 1047)) / (cell.heightPx * 2)), 17, 76);
  expect(four).toBe(5);
}, { timeout: 30_000 });

// ── Thumbnails reduced with Photon (U2-r5) ─────────────────────────────────────────────────

const until = async (ready: () => boolean, ms = 15_000) => { const end = Date.now() + ms; while (!ready() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 25)); };
/** The data of the first image drawn in `output` (its chunks joined, from its first `a=T`/`a=t` to its last `m=0`). */
function firstImageData(output: string): { base64: string; sequence: string } {
  const chunks = output.match(KITTY) ?? [];
  const start = chunks.findIndex(chunk => /^\x1b_Ga=[Tt],/.test(chunk));
  const end = chunks.findIndex((chunk, index) => index >= start && !/(?:,|_G)m=1;/.test(chunk));
  const own = chunks.slice(start, end + 1);
  return { base64: own.map(chunk => chunk.slice(chunk.indexOf(";") + 1, -2)).join(""), sequence: own[0]! };
}

test("U2-r5: una captura de 1683×1047 se dibuja como una miniatura reducida (≤ 140 000 base64, dentro de 40×14 celdas ×2), llega sola, y la línea gris dice el original", async () => {
  const original = realPng(1683, 1047);
  const path = file("captura-real-1683.png", original);
  const image = readImage(path)!;
  expect(image).toMatchObject({ widthPx: 1683, heightPx: 1047, bytes: original.length });
  const s = await screen(container => container.addChild(new UserBubble(`mira ${path}`, { locale: "es", at: null })), 120, 50);
  // Al principio solo la línea gris (la miniatura se está reduciendo y escribir no se detiene); luego la miniatura aparece sola, sin que nadie pida otro cuadro.
  expect(s.all()).not.toMatch(/\x1b_Ga=[Tpt]/);
  await until(() => s.all().includes("\x1b_Ga=T"));
  const { base64, sequence } = firstImageData(s.all());
  expect(base64.length).toBeGreaterThan(1000);
  expect(base64.length).toBeLessThanOrEqual(THUMBNAIL_MAX_BYTES);
  expect(base64.length).toBeLessThan(original.length / 4);
  const mime = Buffer.from(base64, "base64")[0] === 0x89 ? "image/png" : "image/jpeg";
  const dimensions = getImageDimensions(base64, mime)!;
  const cell = getCellDimensions();
  expect(dimensions.widthPx).toBeLessThanOrEqual(THUMBNAIL_COLUMNS * cell.widthPx * 2);
  expect(dimensions.heightPx).toBeLessThanOrEqual(THUMBNAIL_ROWS * cell.heightPx * 2);
  expect(dimensions.widthPx / dimensions.heightPx).toBeCloseTo(1683 / 1047, 1);
  expect(sizeOf(sequence).columns).toBeLessThanOrEqual(THUMBNAIL_COLUMNS);
  expect(sizeOf(sequence).rows).toBeLessThanOrEqual(THUMBNAIL_ROWS);
  console.log(`U2-r5 miniatura de 1683×1047 (${Math.round(original.length / 1024)} KB): ${dimensions.widthPx}×${dimensions.heightPx} px, ${Math.round((base64.length * 3) / 4 / 1024)} KB (${base64.length} base64), ${mime}, ${sizeOf(sequence).columns}×${sizeOf(sequence).rows} celdas`);
  s.stop();
  // La línea gris (donde no hay imágenes) sigue diciendo las medidas y el peso del original.
  expect(plain([imageLine(image)])[0]).toContain(`1683×1047 · ${formatBytes(original.length)}`);
});

test("U2-r5: si Photon no puede reducir la imagen, un original de 256 KB o menos se dibuja tal cual y uno más pesado solo es su línea gris", async () => {
  // Datos que Photon no decodifica (la cabecera sí es de un PNG): sin reducción posible.
  const light = file("sin-photon-ligera.png", bigPng(1200, 900, 200 * 1024 - 33));
  const heavy = file("sin-photon-pesada.png", bigPng(1200, 900, 300 * 1024 - 33));
  const s = await screen(container => { container.addChild(new UserBubble(`ligera ${light}`, { locale: "es", at: null })); container.addChild(new UserBubble(`pesada ${heavy}`, { locale: "es", at: null })); }, 120, 60);
  await until(() => s.all().includes("\x1b_Ga=T"));
  await s.settle();
  // Una sola imagen dibujada (la ligera, tal cual: su carga es el archivo entero) y la pesada con su línea gris.
  const drawn = (s.all().match(/\x1b_Ga=T,/g) ?? []).length;
  expect(drawn).toBeGreaterThan(0);
  const { base64 } = firstImageData(s.all());
  expect(base64).toBe(bigPng(1200, 900, 200 * 1024 - 33).toString("base64"));
  expect(stripVTControlCharacters(s.all())).toContain("🖼 sin-photon-pesada.png · 1200×900");
  // Solo un id de imagen se transmite: la pesada nunca se dibuja.
  expect(new Set((s.all().match(/\x1b_Ga=T,[^;\x1b]*/g) ?? []).map(first => /i=(\d+)/.exec(first)![1])).size).toBe(1);
  s.stop();
});
