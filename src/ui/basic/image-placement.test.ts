import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Container, resetCapabilitiesCache, setCapabilities, visibleWidth } from "@earendil-works/pi-tui";
import { ChatLinks } from "./chat-links.ts";
import { ImageStrip, enableTerminalImages } from "./chat-images.ts";
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
 * U2-r4. In Orca (xterm.js and its image addon) any character written on a cell an image covers erases that piece of the image — spaces and the erase of a line (`ESC[2K`) included. pi-tui draws the image and then
 * writes the rows under it (the whole screen on a redraw, only the rows that changed otherwise), so the image was gone in the same frame. These tests play the bytes the screen writes on a small model of such a terminal
 * and ask the one thing that matters: at the end of every frame, is every image that was placed still whole?
 */

/** A PNG with only the part pi-tui reads (signature and size): enough to be drawn as a thumbnail. */
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

interface Placed { id: number; row: number; col: number; columns: number; rows: number; erased: boolean }
interface Violation { frame: number; id: number; row: number; col: number }

/**
 * Plays `output` on a terminal that behaves like xterm.js with its image addon: a kitty placement (`a=T` or `a=p`) puts an image of `c` × `r` cells at the cursor; any character written on one of those cells, or the
 * erase of a line or of the screen over them, erases that piece; `a=d` takes images away. At each end of a synchronized frame (`ESC[?2026l`) it notes the images that are placed but erased: those are the violations.
 */
function emulate(output: string) {
  const live = new Map<string, Placed>();
  const violations: Violation[] = [];
  const written: { frame: number; row: number; col: number; id: number; afterPlacement: boolean }[] = [];
  let row = 0; let col = 0; let saved = { row: 0, col: 0 }; let frame = 0; let placements = 0;
  const hit = (r: number, from: number, to: number, why?: string) => {
    for (const placed of live.values()) if (r >= placed.row && r < placed.row + placed.rows && to > placed.col && from < placed.col + placed.columns) {
      if (why && !placed.erased) written.push({ frame, row: r, col: from, id: placed.id, afterPlacement: true });
      placed.erased = true;
    }
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
        else if (final === "K") { if (numbers[0] === 2) hit(row, 0, 1e6, "erase"); else hit(row, col, 1e6, "erase"); }
        else if (final === "J" && numbers[0] === 2) for (const placed of live.values()) placed.erased = true;
        else if (final === "l" && params === "?2026") { frame++; for (const placed of live.values()) if (placed.erased) violations.push({ frame, id: placed.id, row: placed.row, col: placed.col }); }
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
        const action = controls.get("a");
        const id = Number(controls.get("i") ?? 0);
        if (action === "T" || action === "p") {
          placements++;
          const placed: Placed = { id, row, col, columns: Number(controls.get("c") ?? 1), rows: Number(controls.get("r") ?? 1), erased: false };
          live.set(`${id}:${row}:${col}`, placed);
        } else if (action === "d") {
          const mode = controls.get("d");
          if (mode === "a" || mode === "A") live.clear();
          else if (mode === "i" || mode === "I") for (const key of [...live.keys()]) if (live.get(key)!.id === id) live.delete(key);
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
    for (const { segment } of new Intl.Segmenter().segment(output.slice(i, end))) { const width = Math.max(1, visibleWidth(segment)); hit(row, col, col + width, "text"); col += width; }
    i = end;
  }
  return { violations, written, placements, frames: frame, live };
}

/** Draws `children` in the real layout (sidebar, status bar, writing box) as the app does, in Orca (kitty images on, the way `enableTerminalImages` turns them on there). */
async function scene(children: (container: Container) => void, options: { orca?: boolean; columns?: number; rows?: number } = {}) {
  setCapabilities({ images: null, trueColor: true, hyperlinks: false });
  enableTerminalImages(options.orca === false ? { FORGE614_SHELL_IMAGES: "kitty" } : { TERM_PROGRAM: "Orca", TERM: "xterm-256color" });
  let output = "";
  const terminal = { columns: options.columns ?? 120, rows: options.rows ?? 50, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {}, write(data: string) { output += data; }, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {} };
  const { surface, tui } = chatScreen(terminal as never, new ChatLinks({ cwd: process.cwd() }), undefined, { copySelection: async () => true });
  const transcript = new Container();
  children(transcript);
  const scroll = new IndependentScrollView(transcript, { follow: "none", primary: true, scrollbar: "hidden" });
  // The sidebar reads this each frame: «Weekly 74%» and the context change as a turn goes on, like the «Trabajando · 40s» counter.
  const state = { used: 1, percent: 74 };
  const snapshot = () => ({ account: "connected" as const, provider: "Claude Code", model: "claude-opus", reasoning: "High", context: { used: state.used, window: 100 }, usage: [{ label: "Weekly", usedPercent: state.percent }] });
  const { input } = createComposer(tui);
  tui.setLayoutRoot(workspaceLayout(scroll, input, new ShellSidebar(snapshot), new ShellStatusBar(snapshot), surface));
  tui.setFocus(input); tui.start();
  const settle = () => new Promise(resolve => setTimeout(resolve, 60));
  await settle();
  return { scroll, tui, state, settle, all: () => output, stop: () => tui.stop({ preserveScreen: true }) };
}

const report = (result: ReturnType<typeof emulate>) => JSON.stringify({ frames: result.frames, placements: result.placements, violations: result.violations.slice(0, 3), firstWrites: result.written.slice(0, 3) });

test("la terminal modelo borra una imagen cuando se escribe encima, y no cuando se coloca después", () => {
  const place = "\x1b_Ga=p,q=2,i=5,C=1,c=10,r=3\x1b\\";
  const frame = (body: string) => `\x1b[?2026h${body}\x1b[?2026l`;
  expect(emulate(frame(`\x1b[2;3H${place}\x1b[3;1H\x1b[2K sidebar`)).violations).toHaveLength(1);
  expect(emulate(frame(`\x1b[2;3H${place}\x1b[3;5H texto`)).violations).toHaveLength(1);
  expect(emulate(frame(`\x1b[2;3H${place}\x1b[3;20H texto`)).violations).toHaveLength(0);
  expect(emulate(frame(`\x1b[3;1H\x1b[2K sidebar\x1b7\x1b[2;3H${place}\x1b8`)).violations).toHaveLength(0);
});

test("ImagePlacer reescribe un cuadro con los bytes exactos: transmite sin colocar, coloca al final y devuelve el cursor", () => {
  const begin = "\x1b[?2026h"; const end = "\x1b[?2026l";
  const placer = new ImagePlacer();
  // Cuadro completo: la imagen llega como la manda pi-tui (a=T, en dos trozos) tras 2 columnas de margen, y las filas de abajo escriben sobre ella.
  const first = `${begin}\x1b[1;1H\x1b[2K  \x1b_Ga=T,f=100,q=2,C=1,c=30,r=3,i=77,m=1;AAAA\x1b\\\x1b_Gm=0;BBBB\x1b\\\x1b[2;1H\x1b[2K side\x1b[3;1H\x1b[2K\x1b[5;4H\x1b[?25h${end}`;
  expect(placer.frame(first)).toBe(
    `${begin}\x1b[1;1H\x1b[2K  \x1b_Ga=t,f=100,q=2,i=77,m=1;AAAA\x1b\\\x1b_Gm=0;BBBB\x1b\\\x1b[2;1H\x1b[2K side\x1b[3;1H\x1b[2K\x1b[5;4H\x1b[?25h`
    + `\x1b7\x1b[1;3H\x1b_Ga=p,q=2,C=1,c=30,r=3,i=77\x1b\\\x1b8${end}`);
  // Un cuadro que solo reescribe la fila 2 (la barra lateral): la imagen cubre esa fila, así que se coloca de nuevo, sin datos.
  expect(placer.frame(`${begin}\x1b[2;1H\x1b[2K side 2\x1b[5;4H\x1b[?25l${end}`)).toBe(
    `${begin}\x1b[2;1H\x1b[2K side 2\x1b[5;4H\x1b[?25l\x1b7\x1b[1;3H\x1b_Ga=p,q=2,C=1,c=30,r=3,i=77\x1b\\\x1b8${end}`);
  // Una fila que la imagen no cubre: el cuadro llega tal cual.
  const far = `${begin}\x1b[9;1H\x1b[2K otra cosa\x1b[5;4H\x1b[?25l${end}`;
  expect(placer.frame(far)).toBe(far);
  // pi-tui, con las imágenes ya subidas, manda solo la colocación (con recorte): se mueve al final igual.
  const again = `${begin}\x1b[1;1H\x1b[2K  \x1b_Ga=p,q=2,C=1,c=30,i=77,x=0,y=10,w=20,h=30,r=2\x1b\\\x1b[2;1H\x1b[2K side${end}`;
  expect(placer.frame(again)).toBe(`${begin}\x1b[1;1H\x1b[2K  \x1b[2;1H\x1b[2K side\x1b7\x1b[1;3H\x1b_Ga=p,q=2,C=1,c=30,i=77,x=0,y=10,w=20,h=30,r=2\x1b\\\x1b8${end}`);
  // Lo que no es un cuadro de filas (un borrado, un aviso del puntero) pasa tal cual.
  expect(placer.frame("\x1b]22;pointer\x1b\\")).toBe("\x1b]22;pointer\x1b\\");
});

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

test("una imagen en una tarjeta Read no se borra", async () => {
  const data = png(1200, 900, 4000).toString("base64");
  const images = toolResultImages([{ type: "image", source: { type: "base64", media_type: "image/png", data } }], getCatalog("es"));
  const s = await scene(container => {
    for (let i = 0; i < 3; i++) container.addChild(new UserBubble(`relleno ${i}`, { locale: "es", at: null }));
    const card = new ActivityCard("Read · captura.png", "Completado · 0s", "imagen PNG · 1200×900");
    card.setImages(new ImageStrip(images, { locale: "es", indent: 6 }));
    container.addChild(card);
  });
  const result = emulate(s.all());
  expect(result.placements).toBeGreaterThan(0);
  expect(result.violations, report(result)).toEqual([]);
  s.stop();
});

test("al desplazar el chat, la imagen entera o recortada sigue entera en cada cuadro", async () => {
  const path = file("desplazar.png", png(1600, 1400, 4000));
  const filler = Array.from({ length: 70 }, (_, i) => `línea ${i + 1} de relleno`).join("\n");
  const s = await scene(container => { container.addChild(new UserBubble(filler, { locale: "es", at: null })); container.addChild(new UserBubble(`mira ${path}`, { locale: "es", at: null })); container.addChild(new UserBubble(filler, { locale: "es", at: null })); });
  for (const top of [0, 10, 20, 28, 32, 36, 40, 44, 48, 52, 56, 60, 70, 40, 20]) { s.scroll.scrollTo(top); s.tui.requestRender(); await s.settle(); }
  const result = emulate(s.all());
  expect(result.frames).toBeGreaterThan(10);
  expect(result.placements).toBeGreaterThan(3);
  expect(result.violations, report(result)).toEqual([]);
  s.stop();
});

test("cuando cambia la barra lateral (un contador que se reescribe cada segundo), la imagen sigue entera", async () => {
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

test("los datos de la imagen se transmiten una sola vez (a=t) y cada cuadro solo la coloca de nuevo (a=p)", async () => {
  const path = file("una-vez.png", png(1600, 1400, 9000));
  const s = await scene(container => container.addChild(new UserBubble(`mira ${path}`, { locale: "es", at: null })));
  for (let tick = 0; tick < 4; tick++) { s.state.used += 7; s.tui.requestRender(); await s.settle(); }
  const all = s.all();
  // Una transmisión (el primer trozo lleva a=t y los datos), nunca a=T (transmitir y colocar a la vez), y colocaciones sueltas.
  expect(all.match(/\x1b_Ga=t,/g) ?? []).toHaveLength(1);
  expect(all).not.toContain("\x1b_Ga=T");
  expect((all.match(/\x1b_Ga=p,/g) ?? []).length).toBeGreaterThanOrEqual(4);
  // Cada colocación va con el cursor puesto sobre la imagen y el cursor se devuelve (guardar y restaurar), sin mover el cursor al colocar.
  for (const placement of all.match(/\x1b_Ga=p,[^\x1b]*\x1b\\/g)!) expect(placement).toMatch(/,C=1,|,C=1$/);
  expect(all).toContain("\x1b7");
  expect(all).toContain("\x1b8");
  s.stop();
});

test("fuera de Orca (sin imágenes que se borren) el cuadro de pi-tui llega tal cual, sin guardar ni restaurar el cursor", async () => {
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
