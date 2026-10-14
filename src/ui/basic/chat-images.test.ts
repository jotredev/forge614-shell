import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { Container, TuiAltScreen, getCapabilities, resetCapabilitiesCache, setCapabilities, setCapabilityOverrides } from "@earendil-works/pi-tui";
import { ChatLinks } from "./chat-links.ts";
import { ImageStrip, MAX_THUMBNAILS, THUMBNAIL_COLUMNS, THUMBNAIL_ROWS, enableTerminalImages, findImagePaths, formatBytes, imageLine, imagesInText, readImage } from "./chat-images.ts";
import { UserBubble } from "./chat-message.ts";
import { ActivityCard } from "./transcript.ts";
import { toolResultImages } from "./tool-summary.ts";
import { createComposer } from "./composer.ts";
import { ShellSidebar } from "./sidebar.ts";
import { ShellStatusBar } from "./status-bar.ts";
import { IndependentScrollView, workspaceLayout, workspaceTerminal } from "./workspace.ts";
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

test("imagesInText: solo las que existen, son archivos normales y tienen la firma de bytes correcta", () => {
  const real = file("real.png", png(30, 20));
  const realJpeg = file("real.jpg", jpeg(30, 20));
  const notImage = file("falsa.png", "esto es texto, no una imagen");
  const wrongSignature = file("cambiada.jpg", png(30, 20)); // firma de PNG con extensión .jpg
  const folder = join(dir, "carpeta.png"); mkdirSync(folder);
  const link = join(dir, "enlace.png"); symlinkSync(real, link);
  const missing = join(dir, "no-existe.png");
  const found = imagesInText([real, realJpeg, notImage, wrongSignature, folder, link, missing].map(path => `"${path}"`).join(" "));
  expect(found.map(image => image.path)).toEqual([real, realJpeg]);
  expect(found[0]).toMatchObject({ name: "real.png", mime: "image/png", widthPx: 30, heightPx: 20 });
  expect(found[1]).toMatchObject({ name: "real.jpg", mime: "image/jpeg", widthPx: 30, heightPx: 20 });
  expect(found[0]!.base64).toBe(png(30, 20).toString("base64"));
});

test("un enlace simbólico no se sigue, ni siquiera a una imagen real", () => {
  const real = file("destino.png", png(8, 8));
  const link = join(dir, "atajo.png"); symlinkSync(real, link);
  expect(readImage(link)).toBeUndefined();
  expect(readImage(real)).toBeDefined();
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
  expect(rows.some(row => row.includes(`mira ${path}`))).toBe(true); // el texto con la ruta se queda
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

test("la miniatura de un mensaje cabe en 40 columnas y 14 renglones, a la izquierda con el margen de 2, debajo del texto", () => {
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
  expect(rows.length - 1 - at).toBe(height - 1); // el resto de las filas de la imagen: vacías
  expect(rows.slice(at + 1).every(row => row === "")).toBe(true);
  expect(plain(rows).join("\n")).toContain(path); // el texto con la ruta, como antes
});

test("hasta 4 miniaturas por mensaje y, si hay más, una línea «+N imágenes»", () => {
  const paths = Array.from({ length: 6 }, (_, i) => file(`m${i}.png`, png(100 + i, 80)));
  const rows = new UserBubble(paths.join(" "), { locale: "es", at: null }).render(120);
  expect(kittyOf(rows)).toHaveLength(MAX_THUMBNAILS);
  expect(plain(rows).filter(row => row.includes("+2 imágenes"))).toEqual(["  +2 imágenes"]);
  const one = Array.from({ length: 5 }, (_, i) => file(`n${i}.png`, png(50, 50)));
  expect(plain(new UserBubble(one.join(" "), { locale: "en", at: null }).render(120)).join("\n")).toContain("+1 image");
});

test("«Copiar» y la selección ven solo texto: la fila de la imagen no lleva texto copiable y el mensaje sigue siendo el texto", () => {
  const path = file("copia.png", png(300, 200));
  const rows = new UserBubble(`mira ${path}`, { locale: "es", at: null }).render(100);
  // Lo que el usuario puede seleccionar y copiar es el texto de las filas: quitada la secuencia gráfica (que la terminal no dibuja como texto), solo quedan el nombre y el mensaje.
  const text = plain(rows.map(row => row.replace(KITTY, ""))).join("\n").replace(/\n+/g, "\n");
  expect(text).not.toContain("iVBOR"); // ningún byte de la imagen aparece como texto
  expect(text).not.toContain("\x1b");
  expect(text.split("\n").filter(line => line.trim() !== "").map(line => line.trimEnd())).toEqual(["  Humano", `  mira ${path}`]);
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
  const surface = workspaceTerminal(terminal as never);
  const tui = new TuiAltScreen(surface);
  const transcript = new Container();
  children(transcript);
  const scroll = new IndependentScrollView(transcript, { follow: "none", primary: true, scrollbar: "hidden" });
  const snapshot = () => ({ account: "connected" as const, provider: "Claude Code", model: "m", reasoning: "medium", context: { used: 1, window: 100 }, usage: [] });
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
  const s = await screen(container => {
    container.addChild(new UserBubble(filler, { locale: "es", at: null }));
    container.addChild(new UserBubble(`mira ${path}`, { locale: "es", at: null }));
    container.addChild(new UserBubble(filler, { locale: "es", at: null }));
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
