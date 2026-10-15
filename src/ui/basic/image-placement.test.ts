import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Container, resetCapabilitiesCache, setCapabilities, visibleWidth } from "@earendil-works/pi-tui";
import { ChatLinks } from "./chat-links.ts";
import { ImageStrip, enableTerminalImages } from "./chat-images.ts";
import { realPng, screenshotPng } from "./png-fixtures.ts";
import { ImagePlacer } from "./image-placement.ts";
import { UserBubble } from "./chat-message.ts";
import { ActivityCard } from "./transcript.ts";
import { toolResultImages } from "./tool-summary.ts";
import { createComposer } from "./composer.ts";
import { ShellSidebar } from "./sidebar.ts";
import { ShellStatusBar } from "./status-bar.ts";
import { IndependentScrollView, chatScreen, workspaceLayout } from "./workspace.ts";
import { getCatalog } from "../../i18n/index.ts";

/**
 * U2-r4 and U2-r5. In Orca (xterm.js and its image addon) an image lives only while it is shown: any character written on a cell it covers erases that piece (spaces and the erase of a line, `ESC[2K`, included), its data are
 * deleted with any `a=d` (even `d=a`, «keep the data»), and a placement with no data draws nothing. pi-tui draws the image and then writes the rows under it, and sends only `a=p` once an image is uploaded. These tests play
 * the bytes the screen writes on a small model of such a terminal and ask the one thing that matters: at the end of every frame, is every image that was placed still whole?
 */

/** A PNG with only the part pi-tui reads (signature and size): enough to be drawn as a thumbnail. `extra` bytes of filler make it as heavy as a real capture. */
const png = (width: number, height: number, extra = 0) => {
  const bytes = Buffer.alloc(33 + extra, 7);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8); bytes.write("IHDR", 12); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes;
};

let dir = "";
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "forge614-placement-")); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); resetCapabilitiesCache(); });
beforeEach(() => { resetCapabilitiesCache(); setCapabilities({ images: null, trueColor: true, hyperlinks: false }); });
afterEach(() => { enableTerminalImages({}); resetCapabilitiesCache(); });

const file = (name: string, content: Buffer) => { const path = join(dir, name); writeFileSync(path, content); return path; };

interface Placed { id: number; row: number; col: number; columns: number; rows: number; covered: Set<string> }
interface Violation { frame: number; kind: "erased" | "swept" | "no-data" | "bad-format"; id: number; row: number; col: number }

/**
 * Plays `output` on a terminal that behaves like Orca's (read in its renderer, `addon-image-CObGlVRp.js`, Orca 1.4.224):
 * 1. `_handleDelete`: `case "a": case "A": … deleteAll()` — `a=d` with `d=a` or `d=A` deletes the images' data and their placements; `d=i`/`d=I` deletes one image's.
 * 2. `_handlePlacement`: `a=p` looks the data up (`getImage(id)`); with none it answers `ENOENT:image not found` (silent with `q=2`) and draws nothing.
 * 3. `addImage`: when text covers every cell of a placed image (`tileCount < 1`) the next `addImage` of any image sweeps it and `onImageDeleted` deletes its data; only the image being placed is spared.
 * 4. `_createBitmap`: `e.mime!=="image/png"` throws a `RangeError`: data sent with `f=100` that do not start with a PNG's signature (`89 50 4E 47`, `iVBORw0KGgo` in base64) draw nothing, and say nothing.
 * Besides, a character (or the erase of a line) over a cell of an image erases that piece. At each end of a synchronized frame (`ESC[?2026l`) it notes the violations: an image placed but erased, one swept and not placed
 * again, and (as they happen) a placement with no data.
 */
function emulate(output: string) {
  const live = new Map<string, Placed>();
  const data = new Set<number>();
  const swept = new Set<string>();
  const violations: Violation[] = [];
  const written: { frame: number; row: number; col: number; id: number }[] = [];
  const frameBytes: number[] = [];
  let pending: { action: string; id: number; controls: Map<string, string>; payload: string } | undefined;
  let row = 0; let col = 0; let saved = { row: 0, col: 0 }; let frame = 0; let placements = 0; let frameStart = 0;
  const cover = (r: number, from: number, to: number, record: boolean) => {
    for (const placed of live.values()) {
      if (r < placed.row || r >= placed.row + placed.rows) continue;
      for (let c = Math.max(from, placed.col); c < Math.min(to, placed.col + placed.columns); c++) {
        if (record && placed.covered.size === 0) written.push({ frame, row: r, col: c, id: placed.id });
        placed.covered.add(`${r},${c}`);
      }
    }
  };
  const place = (id: number, controls: Map<string, string>) => {
    if (!data.has(id)) { violations.push({ frame, kind: "no-data", id, row, col }); return; }
    // Rule 3: any other image whose every cell is covered is swept, and its data go with it.
    for (const [key, other] of [...live]) if (other.id !== id && other.covered.size >= other.columns * other.rows) { live.delete(key); data.delete(other.id); swept.add(key); }
    placements++;
    const key = `${id}:${row}:${col}`;
    swept.delete(key);
    live.set(key, { id, row, col, columns: Number(controls.get("c") ?? 1), rows: Number(controls.get("r") ?? 1), covered: new Set() });
  };
  let i = 0;
  while (i < output.length) {
    const ch = output[i]!;
    if (ch === "\x1b") {
      const next = output[i + 1];
      if (next === "[") {
        const match = /^\x1b\[([?0-9;:<>]*)([\x20-\x2f]*)([\x40-\x7e])/.exec(output.slice(i, i + 64));
        if (!match) { i += 2; continue; }
        const [whole, params, , final] = match;
        const numbers = params!.split(";").map(part => Number(part) || 0);
        if (final === "H") { row = Math.max(1, numbers[0] || 1) - 1; col = Math.max(1, numbers[1] || 1) - 1; }
        else if (final === "K") { if (numbers[0] === 2) cover(row, 0, 1e6, true); else cover(row, col, 1e6, true); }
        else if (final === "J" && numbers[0] === 2) for (let r = 0; r < 500; r++) cover(r, 0, 1e6, false);
        else if (final === "l" && params === "?2026") {
          frame++;
          for (const placed of live.values()) if (placed.covered.size > 0) violations.push({ frame, kind: "erased", id: placed.id, row: placed.row, col: placed.col });
          for (const key of swept) { const [id, r, c] = key.split(":").map(Number); violations.push({ frame, kind: "swept", id: id!, row: r!, col: c! }); }
          frameBytes.push(i + whole!.length - frameStart); frameStart = i + whole!.length;
        }
        else if (final === "C") col += numbers[0] || 1;
        else if (final === "D") col = Math.max(0, col - (numbers[0] || 1));
        else if (final === "A") row = Math.max(0, row - (numbers[0] || 1));
        else if (final === "B") row += numbers[0] || 1;
        i += whole!.length; continue;
      }
      if (next === "]") { const end = /\x07|\x1b\\/.exec(output.slice(i + 2)); i += end ? 2 + end.index + end[0].length : output.length; continue; }
      if (next === "_") {
        const end = output.indexOf("\x1b\\", i + 2);
        const body = output.slice(i + 3, end);
        const controls = new Map(body.split(";")[0]!.split(",").map(item => [item.split("=")[0]!, item.split("=")[1] ?? ""] as const));
        const more = controls.get("m") === "1";
        const payload = body.includes(";") ? body.slice(body.indexOf(";") + 1) : "";
        // Rule 4 (`_createBitmap`): a transmission with `f=100` whose data do not start with a PNG's signature is refused (it throws a `RangeError`) and nothing is drawn.
        const complete = (action: string, id: number, first: Map<string, string>, data64: string) => {
          if (first.get("f") === "100" && !data64.startsWith("iVBORw0KGgo")) { violations.push({ frame, kind: "bad-format", id, row, col }); return; }
          data.add(id);
          if (action === "T") place(id, first);
        };
        if (pending && !controls.has("a")) {
          // A later chunk of a transmission in pieces: the last one (`m=0`) completes it.
          pending.payload += payload;
          if (!more) { complete(pending.action, pending.id, pending.controls, pending.payload); pending = undefined; }
        } else {
          const action = controls.get("a");
          const id = Number(controls.get("i") ?? 0);
          if (action === "t" || action === "T") {
            if (more) pending = { action, id, controls, payload };
            else complete(action, id, controls, payload);
          } else if (action === "p") place(id, controls);
          else if (action === "d") {
            const mode = controls.get("d");
            if (mode === "a" || mode === "A") { live.clear(); data.clear(); swept.clear(); }
            else if (mode === "i" || mode === "I") { for (const key of [...live.keys()]) if (live.get(key)!.id === id) live.delete(key); data.delete(id); }
          }
        }
        i = end + 2; continue;
      }
      if (next === "7") { saved = { row, col }; i += 2; continue; }
      if (next === "8") { row = saved.row; col = saved.col; i += 2; continue; }
      i += 2; continue;
    }
    if (ch === "\r" || ch === "\n" || ch === "\x07") { i++; continue; }
    // A run of printable text: each grapheme takes as many cells as it is wide.
    let end = i; while (end < output.length && output[end] !== "\x1b" && output[end] !== "\r" && output[end] !== "\n" && output[end] !== "\x07") end++;
    for (const { segment } of new Intl.Segmenter().segment(output.slice(i, end))) { const width = Math.max(1, visibleWidth(segment)); cover(row, col, col + width, true); col += width; }
    i = end;
  }
  return { violations, written, placements, frames: frame, live, frameBytes };
}

/** Draws `children` in the real layout (sidebar, status bar, writing box) as the app does, in Orca (kitty images on, the way `enableTerminalImages` turns them on there). */
async function scene(children: (container: Container) => void, options: { columns?: number; rows?: number } = {}) {
  setCapabilities({ images: null, trueColor: true, hyperlinks: false });
  enableTerminalImages({ TERM_PROGRAM: "Orca", TERM: "xterm-256color" });
  let output = "";
  const terminal = { columns: options.columns ?? 120, rows: options.rows ?? 50, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {}, write(data: string) { output += data; }, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {} };
  const { surface, tui } = chatScreen(terminal as never, new ChatLinks({ cwd: process.cwd() }), undefined, { copySelection: async () => true });
  const transcript = new Container();
  children(transcript);
  const scroll = new IndependentScrollView(transcript, { follow: "none", primary: true, scrollbar: "hidden" });
  // The sidebar reads this each frame: «Weekly 74%» and the context change as a turn goes on.
  const state = { used: 1, percent: 74 };
  const snapshot = () => ({ account: "connected" as const, provider: "Claude Code", model: "claude-opus", reasoning: "High", context: { used: state.used, window: 100 }, usage: [{ label: "Weekly", usedPercent: state.percent }] });
  const { input } = createComposer(tui);
  tui.setLayoutRoot(workspaceLayout(scroll, input, new ShellSidebar(snapshot), new ShellStatusBar(snapshot), surface));
  tui.setFocus(input); tui.start();
  const settle = () => new Promise(resolve => setTimeout(resolve, 60));
  await settle();
  return { scroll, tui, state, composer: input, settle, all: () => output, stop: () => tui.stop({ preserveScreen: true }) };
}

const report = (result: ReturnType<typeof emulate>) => JSON.stringify({ frames: result.frames, placements: result.placements, violations: result.violations.slice(0, 3), firstWrites: result.written.slice(0, 2) });
const filler = (lines: number) => Array.from({ length: lines }, (_, i) => `línea ${i + 1} de relleno`).join("\n");

// ── The model itself ───────────────────────────────────────────────────────────────────────

test("el modelo de Orca: escribir encima borra, d=a borra los datos, a=p sin datos no dibuja y una imagen tapada por completo se barre", () => {
  const frame = (body: string) => `\x1b[?2026h${body}\x1b[?2026l`;
  const send = (id: number, c = 10, r = 3) => `\x1b_Ga=T,f=100,q=2,C=1,c=${c},r=${r},i=${id};iVBORw0KGgoAAAA\x1b\\`;
  const place = (id: number, c = 10, r = 3) => `\x1b_Ga=p,q=2,C=1,c=${c},r=${r},i=${id}\x1b\\`;
  const erased = (output: string) => emulate(output).violations.filter(violation => violation.kind === "erased");
  // Escribir sobre la imagen la borra; colocarla después la deja entera.
  expect(erased(frame(`\x1b[2;3H${send(5)}\x1b[3;1H\x1b[2K sidebar`))).toHaveLength(1);
  expect(erased(frame(`\x1b[2;3H${send(5)}\x1b[3;5H texto`))).toHaveLength(1);
  expect(erased(frame(`\x1b[2;3H${send(5)}\x1b[3;20H texto`))).toHaveLength(0);
  expect(emulate(frame(`\x1b[3;1H\x1b[2K sidebar\x1b7\x1b[2;3H${send(5)}\x1b8`)).violations).toHaveLength(0);
  // Regla 1: d=a (también) borra los datos; una colocación sola, después, no dibuja nada.
  const gone = emulate(frame(`\x1b[2;3H${send(5)}`) + frame(`\x1b_Ga=d,d=a,q=2\x1b\\\x1b[2;3H${place(5)}`));
  expect(gone.violations.map(violation => violation.kind)).toEqual(["no-data"]);
  // Regla 2: sin datos no hay dibujo; con ellos en el mismo cuadro sí.
  expect(emulate(frame(`\x1b[2;3H${place(9)}`)).violations.map(violation => violation.kind)).toEqual(["no-data"]);
  expect(emulate(frame(`\x1b_Ga=d,d=a,q=2\x1b\\\x1b[2;3H${send(5)}`)).violations).toEqual([]);
  // Regla 3: con dos imágenes, si el texto tapa toda la segunda, colocar la primera la barre (y pierde sus datos).
  const cover = (row: number) => `\x1b[${row};1H${" ".repeat(10)}`;
  const swept = emulate(frame(`\x1b[1;1H${send(1)}\x1b[5;1H${send(2)}`) + frame(`${cover(5)}${cover(6)}${cover(7)}\x1b[1;1H${place(1)}`));
  expect(swept.violations.map(violation => violation.kind)).toContain("swept");
  // Regla 4: f=100 con datos que no son un PNG (un JPEG empieza con /9j/, ffd8) no se dibuja, ni lo avisa.
  const jpeg = emulate(frame(`\x1b[2;3H\x1b_Ga=T,f=100,q=2,C=1,c=10,r=3,i=5;/9j/4AAQSkZJRg\x1b\\`));
  expect(jpeg.violations.map(violation => violation.kind)).toEqual(["bad-format"]);
  expect(jpeg.live.size).toBe(0);
  // También en trozos: la firma se mira en los datos completos.
  expect(emulate(frame(`\x1b[2;3H\x1b_Ga=T,f=100,q=2,C=1,c=10,r=3,i=5,m=1;iVBORw0KGgo\x1b\\\x1b_Gm=0;AAAA\x1b\\`)).violations).toEqual([]);
  expect(emulate(frame(`\x1b[2;3H\x1b_Ga=T,f=100,q=2,C=1,c=10,r=3,i=5,m=1;/9j/4AAQ\x1b\\\x1b_Gm=0;AAAA\x1b\\`)).violations.map(violation => violation.kind)).toEqual(["bad-format"]);
  // Y mandando los datos de la segunda en el mismo cuadro, después, las dos quedan.
  const both = emulate(frame(`\x1b[1;1H${send(1)}\x1b[5;1H${send(2)}`) + frame(`${cover(5)}${cover(6)}${cover(7)}\x1b[1;1H${send(1)}\x1b[5;1H${send(2)}`));
  expect(both.violations).toEqual([]);
});

// ── The bytes of ImagePlacer ───────────────────────────────────────────────────────────────

test("ImagePlacer reescribe un cuadro con los bytes exactos: los datos y la colocación van juntos al final, y el cursor se devuelve", () => {
  const begin = "\x1b[?2026h"; const end = "\x1b[?2026l";
  const placer = new ImagePlacer();
  const chunks = (controls: string) => `\x1b_Ga=T,${controls},m=1;AAAA\x1b\\\x1b_Gm=0;BBBB\x1b\\`;
  // Cuadro completo: la imagen llega como la manda pi-tui (a=T, en dos trozos) tras 2 columnas de margen, y las filas de abajo escriben sobre ella.
  const first = `${begin}\x1b[1;1H\x1b[2K  ${chunks("f=100,q=2,C=1,c=30,r=3,i=77")}\x1b[2;1H\x1b[2K side\x1b[3;1H\x1b[2K\x1b[5;4H\x1b[?25h${end}`;
  expect(placer.frame(first)).toBe(
    `${begin}\x1b[1;1H\x1b[2K  \x1b[2;1H\x1b[2K side\x1b[3;1H\x1b[2K\x1b[5;4H\x1b[?25h`
    + `\x1b7\x1b[1;3H${chunks("C=1,c=30,r=3,f=100,q=2,i=77")}\x1b8${end}`);
  // Un cuadro que solo reescribe la fila 2 (la barra lateral): la imagen cubre esa fila, así que se manda de nuevo con sus datos y su colocación.
  expect(placer.frame(`${begin}\x1b[2;1H\x1b[2K side 2\x1b[5;4H\x1b[?25l${end}`)).toBe(
    `${begin}\x1b[2;1H\x1b[2K side 2\x1b[5;4H\x1b[?25l\x1b7\x1b[1;3H${chunks("C=1,c=30,r=3,f=100,q=2,i=77")}\x1b8${end}`);
  // Una fila que la imagen no cubre: el cuadro llega tal cual, sin datos de imagen.
  const far = `${begin}\x1b[9;1H\x1b[2K otra cosa\x1b[5;4H\x1b[?25l${end}`;
  expect(placer.frame(far)).toBe(far);
  // pi-tui, con la imagen ya subida, manda solo la colocación (con recorte): los datos guardados salen con ella.
  const again = `${begin}\x1b[1;1H\x1b[2K  \x1b_Ga=p,q=2,C=1,c=30,i=77,x=0,y=10,w=20,h=30,r=2\x1b\\\x1b[2;1H\x1b[2K side${end}`;
  expect(placer.frame(again)).toBe(`${begin}\x1b[1;1H\x1b[2K  \x1b[2;1H\x1b[2K side\x1b7\x1b[1;3H${chunks("C=1,c=30,x=0,y=10,w=20,h=30,r=2,f=100,q=2,i=77")}\x1b8${end}`);
  // Lo que no es un cuadro de filas (un aviso del puntero) pasa tal cual.
  expect(placer.frame("\x1b]22;pointer\x1b\\")).toBe("\x1b]22;pointer\x1b\\");
  // Una colocación de una imagen de la que no hay copia (nunca se vio con datos) no se manda: sin datos Orca no la dibuja, y así tampoco se cuela un a=p suelto.
  const unknown = new ImagePlacer().frame(`${begin}\x1b[1;1H\x1b[2K \x1b_Ga=p,q=2,C=1,c=30,i=99,r=2\x1b\\${end}`);
  expect(unknown).toBe(`${begin}\x1b[1;1H\x1b[2K ${end}`);
  // d=A (y salir de la pantalla alterna) suelta las copias; d=a (solo colocaciones) y d=i de otra imagen no.
  const keeper = new ImagePlacer();
  keeper.frame(`${begin}\x1b[1;1H\x1b[2K${chunks("f=100,q=2,C=1,c=30,r=3,i=77")}${end}`);
  expect(keeper.frame(`${begin}\x1b_Ga=d,d=a,q=2\x1b\\\x1b[1;1H\x1b[2K\x1b_Ga=p,q=2,C=1,c=30,r=3,i=77\x1b\\${end}`)).toContain("m=0;BBBB");
  keeper.frame(`${begin}\x1b_Ga=d,d=I,i=77,q=2\x1b\\${end}`);
  expect(keeper.frame(`${begin}\x1b[1;1H\x1b[2K\x1b_Ga=p,q=2,C=1,c=30,r=3,i=77\x1b\\${end}`)).not.toContain("a=T");
});

// ── The screen, in Orca ────────────────────────────────────────────────────────────────────

test("una imagen bajo un mensaje no se borra: ningún carácter se escribe sobre ella después de su última colocación en el cuadro", async () => {
  // La fila donde empieza la imagen se barre sobre 8 posiciones: en alguna la barra lateral tiene texto a la altura de la miniatura.
  for (let lead = 0; lead < 8; lead++) {
    const path = file(`mensaje-${lead}.png`, png(1600, 1400, 4000));
    const s = await scene(container => container.addChild(new UserBubble(`${"\n".repeat(lead)}mira ${path}`, { locale: "es", at: null })));
    const result = emulate(s.all());
    expect(result.placements, `con ${lead} líneas antes, hay imagen colocada`).toBeGreaterThan(0);
    expect(result.violations, `con ${lead} líneas antes: ${report(result)}`).toEqual([]);
    s.stop();
  }
});

test("U2-r5: tras colocar una imagen, un cuadro con a=d,d=a y reescritura completa (desplazar) la deja visible", async () => {
  const path = file("desplazada.png", png(1600, 1400, 4000));
  const s = await scene(container => { container.addChild(new UserBubble(filler(20), { locale: "es", at: null })); container.addChild(new UserBubble(`mira ${path}`, { locale: "es", at: null })); container.addChild(new UserBubble(filler(60), { locale: "es", at: null })); });
  const before = s.all().length;
  s.scroll.scrollTo(6); s.tui.requestRender(); await s.settle();
  // El cuadro de desplazar lleva el borrado de pi-tui y reescribe toda la pantalla; la imagen se ve al final.
  const frame = s.all().slice(before);
  expect(frame).toContain("\x1b_Ga=d,d=a");
  const result = emulate(s.all());
  expect(result.live.size, report(result)).toBeGreaterThan(0);
  expect(result.violations, report(result)).toEqual([]);
  s.stop();
});

test("U2-r5: dos imágenes visibles con sus filas reescritas en el mismo cuadro se ven las dos", async () => {
  const one = file("una.png", png(1600, 1400, 4000));
  const two = file("dos.png", png(1500, 1000, 4000));
  const s = await scene(container => { container.addChild(new UserBubble(`primera ${one}`, { locale: "es", at: null })); container.addChild(new UserBubble(`segunda ${two}`, { locale: "es", at: null })); container.addChild(new UserBubble(filler(30), { locale: "es", at: null })); }, { rows: 60 });
  for (const top of [0, 3, 0, 5, 2]) { s.scroll.scrollTo(top); s.tui.requestRender(); await s.settle(); }
  const result = emulate(s.all());
  expect(new Set([...result.live.values()].map(placed => placed.id)).size, report(result)).toBe(2);
  expect(result.violations, report(result)).toEqual([]);
  s.stop();
});

test("U2-r5: una imagen en una tarjeta Read se ve después de varios desplazamientos seguidos", async () => {
  const data = png(1200, 900, 4000).toString("base64");
  const images = toolResultImages([{ type: "image", source: { type: "base64", media_type: "image/png", data } }], getCatalog("es"));
  const s = await scene(container => {
    container.addChild(new UserBubble(filler(12), { locale: "es", at: null }));
    const card = new ActivityCard("Read · captura.png", "Completado · 0s", "imagen PNG · 1200×900");
    card.setImages(new ImageStrip(images, { locale: "es", indent: 6 }));
    container.addChild(card);
    container.addChild(new UserBubble(filler(40), { locale: "es", at: null }));
  });
  for (const top of [0, 4, 8, 12, 16, 20, 24, 20, 16, 12, 8, 4, 0]) { s.scroll.scrollTo(top); s.tui.requestRender(); await s.settle(); }
  const result = emulate(s.all());
  expect(result.placements).toBeGreaterThan(5);
  expect(result.live.size, report(result)).toBeGreaterThan(0);
  expect(result.violations, report(result)).toEqual([]);
  s.stop();
});

test("al desplazar el chat, la imagen entera o recortada sigue entera en cada cuadro", async () => {
  const path = file("desplazar.png", png(1600, 1400, 4000));
  const s = await scene(container => { container.addChild(new UserBubble(filler(70), { locale: "es", at: null })); container.addChild(new UserBubble(`mira ${path}`, { locale: "es", at: null })); container.addChild(new UserBubble(filler(70), { locale: "es", at: null })); });
  for (const top of [0, 10, 20, 28, 32, 36, 40, 44, 48, 52, 56, 60, 70, 40, 20]) { s.scroll.scrollTo(top); s.tui.requestRender(); await s.settle(); }
  const result = emulate(s.all());
  expect(result.frames).toBeGreaterThan(10);
  expect(result.placements).toBeGreaterThan(3);
  expect(result.violations, report(result)).toEqual([]);
  s.stop();
});

test("cuando cambia la barra lateral (un valor que se reescribe cada segundo), la imagen sigue entera", async () => {
  const path = file("contador.png", png(1600, 1400, 4000));
  for (const lead of [0, 2, 5]) {
    const s = await scene(container => container.addChild(new UserBubble(`${"\n".repeat(lead)}mira ${path}`, { locale: "es", at: null })));
    for (let tick = 0; tick < 6; tick++) { s.state.used += 7; s.state.percent += 1; s.tui.requestRender(); await s.settle(); }
    const result = emulate(s.all());
    expect(result.frames).toBeGreaterThan(5);
    expect(result.violations, `con ${lead} líneas antes: ${report(result)}`).toEqual([]);
    s.stop();
  }
});

test("U2-r5: en este modo ningún a=p llega sin sus datos en el mismo cuadro, y un cuadro que solo cambia «Trabajando · Ns» no manda datos de imagen", async () => {
  const path = file("datos.png", png(1600, 1400, 9000));
  const s = await scene(container => container.addChild(new UserBubble(`mira ${path}`, { locale: "es", at: null })));
  s.scroll.scrollTo(0);
  // Los cuadros que solo cambian el contador de la barra de estado (abajo, lejos de la imagen): sin colocaciones ni datos de imagen.
  for (let seconds = 1; seconds <= 4; seconds++) {
    const from = s.all().length;
    s.composer.setStatus(`${getCatalog("es").chat.statusWorking} · ${seconds}s`);
    s.tui.requestRender(); await s.settle();
    const frame = s.all().slice(from);
    expect(frame.length, `el contador de ${seconds}s se escribió`).toBeGreaterThan(0);
    expect(frame, `contador ${seconds}s`).not.toMatch(/\x1b_Ga=[Tpt]/);
  }
  // Cada colocación del cuadro va con datos (a=T, ningún a=p suelto) y con C=1.
  const all = s.all();
  expect(all).not.toMatch(/\x1b_Ga=p/);
  expect(all).not.toMatch(/\x1b_Ga=t/);
  for (const first of all.match(/\x1b_Ga=T,[^;\x1b]*/g)!) expect(first).toMatch(/,C=1,/);
  expect(all).toContain("\x1b7");
  expect(all).toContain("\x1b8");
  // Una vez al hacer el cambio de barra lateral (la imagen tiene una fila escrita): vuelve con sus datos.
  const from = all.length;
  s.state.used += 3; s.tui.requestRender(); await s.settle();
  const emulated = emulate(s.all());
  expect(emulated.violations).toEqual([]);
  expect(s.all().slice(from)).toMatch(/\x1b_Ga=T/);
  s.stop();
});

test("U2-r5: costo de un cuadro de desplazamiento con 4 miniaturas visibles (miniaturas de unos 150 KB)", async () => {
  // Cada miniatura pesa ~133 000 caracteres en base64, justo bajo el tope de la miniatura (140 000): se dibuja tal cual, sin reducir.
  const paths = [1, 2, 3, 4].map(n => file(`costo-${n}.png`, png(1600 + n, 1000, 100_000)));
  const s = await scene(container => { paths.forEach(path => container.addChild(new UserBubble(`foto ${path}`, { locale: "es", at: null }))); container.addChild(new UserBubble(filler(40), { locale: "es", at: null })); }, { rows: 100 });
  for (const top of [0, 2, 0, 3, 1]) { s.scroll.scrollTo(top); s.tui.requestRender(); await s.settle(); }
  const result = emulate(s.all());
  expect(result.violations, report(result)).toEqual([]);
  expect(new Set([...result.live.values()].map(placed => placed.id)).size).toBe(4);
  const heaviest = Math.max(...result.frameBytes);
  console.log(`U2-r5 bytes por cuadro con 4 miniaturas: máximo ${heaviest}, cuadros ${JSON.stringify(result.frameBytes.slice(-6))}`);
  expect(heaviest).toBeLessThan(650_000);
  s.stop();
});

// ── The format of what is sent (U2-r6) ─────────────────────────────────────────────────────

/** A test that reduces real screenshots with Photon: slower than the default 5 s on a slow machine (windows-latest). */
const slowTest = (name: string, body: () => Promise<void>) => test(name, body, { timeout: 30_000 });

/** Waits until the emulated screen has placed at least `images` different images, and gives what it shows. */
async function untilShown(s: Awaited<ReturnType<typeof scene>>, images: number) {
  const end = Date.now() + 20_000;
  while (new Set([...emulate(s.all()).live.values()].map(placed => placed.id)).size < images && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 40));
  await s.settle();
  return emulate(s.all());
}
/** Every transmission with `f=100` in `output` carries a PNG: its data, joined, start with the signature (what kitty's protocol asks, and Orca refuses to draw without a word). */
function transmissions(output: string) {
  const starts = [...output.matchAll(/\x1b_Ga=[Tt],[^;\x1b]*;([^\x1b]*)\x1b\\/g)];
  return starts.map(match => match[1]!);
}

slowTest("U2-r6: una captura grande (más de 140 000 en base64 al reducirla) se manda como PNG de verdad, no como JPEG con f=100", async () => {
  const path = file("grande-real.png", realPng(1683, 1047));
  const s = await scene(container => container.addChild(new UserBubble(`mira ${path}`, { locale: "es", at: null })));
  const result = await untilShown(s, 1);
  expect(result.live.size, report(result)).toBeGreaterThan(0);
  expect(result.violations.filter(violation => violation.kind === "bad-format"), report(result)).toEqual([]);
  expect(result.violations, report(result)).toEqual([]);
  for (const data of transmissions(s.all())) expect(data.startsWith("iVBORw0KGgo")).toBe(true);
  expect(transmissions(s.all()).length).toBeGreaterThan(0);
  s.stop();
});

slowTest("U2-r6: dos capturas en un mensaje se ven las dos, en una sola imagen PNG", async () => {
  const paths = [1, 2].map(n => file(`par-${n}.png`, screenshotPng(1683, 1047, n)));
  const s = await scene(container => container.addChild(new UserBubble(`Que diferencia vez? ${paths.join(" ")}`, { locale: "es", at: null })));
  const result = await untilShown(s, 1);
  expect(result.live.size, report(result)).toBe(1); // una sola imagen kitty: la tira con las dos miniaturas
  expect(result.violations, report(result)).toEqual([]);
  for (const data of transmissions(s.all())) expect(data.startsWith("iVBORw0KGgo")).toBe(true);
  s.stop();
});

slowTest("U2-r6: cuatro capturas en un mensaje van en una tira PNG, cada línea con una sola imagen kitty, y la tira pesa menos de 600 KB por cuadro", async () => {
  const paths = [1, 2, 3, 4].map(n => file(`cuatro-${n}.png`, screenshotPng(1683, 1047, n)));
  // Una terminal ancha: con la barra lateral el chat mide ~36 columnas menos, y en una de 120 caben 3 por renglón (otra prueba mira las ventanas angostas).
  const s = await scene(container => container.addChild(new UserBubble(`mira ${paths.join(" ")}`, { locale: "es", at: null })), { rows: 60, columns: 160 });
  const result = await untilShown(s, 1);
  expect(result.live.size, report(result)).toBe(1);
  expect(result.violations, report(result)).toEqual([]);
  for (const data of transmissions(s.all())) expect(data.startsWith("iVBORw0KGgo")).toBe(true);
  // Cada línea que escribe la pantalla lleva a lo más una imagen kitty (pi-tui solo trata la primera de cada línea).
  for (const line of s.all().split(/\x1b\[\d+;1H/)) expect((line.match(/\x1b_Ga=T,/g) ?? []).length).toBeLessThanOrEqual(1);
  // Cuadros de desplazamiento con la tira visible.
  for (const top of [0, 2, 0, 3]) { s.scroll.scrollTo(top); s.tui.requestRender(); await s.settle(); }
  const final = emulate(s.all());
  expect(final.violations, report(final)).toEqual([]);
  const heaviest = Math.max(...final.frameBytes);
  console.log(`U2-r6 bytes por cuadro con la tira de 4 capturas de 1683×1047: máximo ${heaviest}, cuadros ${JSON.stringify(final.frameBytes.slice(-6))}`);
  expect(heaviest).toBeLessThan(600_000);
  s.stop();
});

slowTest("U2-r6: un .jpg pegado, aunque pese poco, se manda como PNG", async () => {
  const { resizeImage } = await import("@earendil-works/pi-coding-agent");
  // Un JPEG ligero de verdad: `resizeImage` lo prefiere al PNG cuando el tope es chico.
  const made = await resizeImage(realPng(800, 500, 3), "image/png", { maxWidth: 800, maxHeight: 500, maxBytes: 80_000 });
  expect(made?.mimeType).toBe("image/jpeg");
  const jpeg = Buffer.from(made!.data, "base64");
  expect(jpeg.length).toBeLessThan(80_000);
  const path = file("pegada.jpg", jpeg);
  const s = await scene(container => container.addChild(new UserBubble(`mira ${path}`, { locale: "es", at: null })));
  const result = await untilShown(s, 1);
  expect(result.live.size, report(result)).toBeGreaterThan(0);
  expect(result.violations, report(result)).toEqual([]);
  for (const data of transmissions(s.all())) expect(data.startsWith("iVBORw0KGgo")).toBe(true);
  s.stop();
});

slowTest("U2-r6: la tarjeta Read manda PNG, venga el bloque como PNG pesado o como JPEG ligero", async () => {
  const { resizeImage } = await import("@earendil-works/pi-coding-agent");
  const heavy = screenshotPng(1683, 1047, 9).toString("base64");
  const light = (await resizeImage(realPng(600, 400, 5), "image/png", { maxWidth: 600, maxHeight: 400, maxBytes: 60_000 }))!;
  expect(light.mimeType).toBe("image/jpeg");
  for (const block of [{ media_type: "image/jpeg", data: light.data }, { media_type: "image/png", data: heavy }]) {
    const images = toolResultImages([{ type: "image", source: { type: "base64", ...block } }], getCatalog("es"));
    const s = await scene(container => {
      container.addChild(new UserBubble("relleno", { locale: "es", at: null }));
      const card = new ActivityCard("Read · captura", "Completado · 0s", "imagen");
      card.setImages(new ImageStrip(images, { locale: "es", indent: 6 }));
      container.addChild(card);
    });
    const result = await untilShown(s, 1);
    expect(result.live.size, `${block.media_type}: ${report(result)}`).toBeGreaterThan(0);
    expect(result.violations, `${block.media_type}: ${report(result)}`).toEqual([]);
    for (const data of transmissions(s.all())) expect(data.startsWith("iVBORw0KGgo")).toBe(true);
    s.stop();
  }
});

slowTest("U2-r6: medición al salir la imagen por arriba y por abajo del chat con la caja de 7 filas (no fija el comportamiento: lo anota)", async () => {
  const path = file("salida.png", screenshotPng(900, 560, 4));
  const s = await scene(container => { container.addChild(new UserBubble(filler(25), { locale: "es", at: null })); container.addChild(new UserBubble(`mira ${path}`, { locale: "es", at: null })); container.addChild(new UserBubble(filler(90), { locale: "es", at: null })); });
  await untilShown(s, 1);
  const seen: string[] = [];
  for (let top = 8; top <= 44; top++) {
    s.scroll.scrollTo(top); s.tui.requestRender(); await s.settle();
    const live = [...emulate(s.all()).live.values()];
    seen.push(`${top}:${live.length ? live.map(placed => `${placed.rows}@${placed.row}`).join("+") : "-"}`);
  }
  const final = emulate(s.all());
  expect(final.violations, report(final)).toEqual([]);
  console.log(`U2-r6 imagen (filas visibles@fila de pantalla) según el desplazamiento: ${seen.join(" ")}`);
  s.stop();
});

test("fuera de Orca el cuadro de pi-tui llega tal cual, sin guardar ni restaurar el cursor", async () => {
  setCapabilities({ images: "kitty", trueColor: true, hyperlinks: false });
  const path = file("kitty.png", png(1600, 1400, 4000));
  let output = "";
  const terminal = { columns: 120, rows: 50, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {}, write(data: string) { output += data; }, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {} };
  enableTerminalImages({});
  const { surface, tui } = chatScreen(terminal as never, new ChatLinks({ cwd: process.cwd() }), undefined, { copySelection: async () => true });
  const transcript = new Container();
  transcript.addChild(new UserBubble(`mira ${path}`, { locale: "es", at: null }));
  const scroll = new IndependentScrollView(transcript, { follow: "none", primary: true, scrollbar: "hidden" });
  const snapshot = () => ({ account: "connected" as const, provider: "Claude Code", model: "claude-opus", reasoning: "High", context: { used: 1, window: 100 }, usage: [{ label: "Weekly", usedPercent: 74 }] });
  const { input } = createComposer(tui);
  tui.setLayoutRoot(workspaceLayout(scroll, input, new ShellSidebar(snapshot), new ShellStatusBar(snapshot), surface));
  tui.setFocus(input); tui.start();
  await new Promise(resolve => setTimeout(resolve, 80));
  expect(output).toContain("\x1b_Ga=T");
  expect(output).not.toContain("\x1b7");
  tui.stop({ preserveScreen: true });
});
