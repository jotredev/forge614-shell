import { afterAll, expect, test } from "bun:test";
import { Container, TuiAltScreen, resetCapabilitiesCache, setCapabilityOverrides } from "@earendil-works/pi-tui";
import { createComposer } from "./composer.ts";
import { ShellSidebar } from "./sidebar.ts";
import { ShellStatusBar } from "./status-bar.ts";
import { AssistantMessage } from "./chat-message.ts";
import { ChatLinks } from "./chat-links.ts";
import { nearestAnsi256, palette } from "./theme.ts";
import { IndependentScrollView, workspaceLayout, workspaceTerminal } from "./workspace.ts";

afterAll(() => resetCapabilitiesCache());

/** One screen cell: its character and the background it is painted with (`"default"` is the terminal's own, which is not Shell's panel color). */
interface Cell { ch: string; bg: string }

/**
 * The screen as the terminal would show it, cell by cell, from what Shell wrote: the frame is cut at each cursor move (`ESC[row;1H`) and each row is read with a small SGR state machine — `0` and `49` go back to the
 * terminal's default background, `48;2;r;g;b` and `48;5;n` set one. The background at the start of a row is the one the previous row left, as in a real terminal.
 */
function screenCells(output: string): Map<number, Cell[]> {
  const rows = new Map<number, Cell[]>();
  const parts = output.split(/(\x1b\[\d+;1H)/);
  let bg = "default";
  for (let i = 1; i < parts.length; i += 2) {
    const y = Number(/\[(\d+);/.exec(parts[i]!)![1]);
    const row: Cell[] = [];
    for (const match of parts[i + 1]!.matchAll(/\x1b\[([0-9;]*)m|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[A-Za-z]|([^\x1b])/gu)) {
      if (match[2] !== undefined) { row.push({ ch: match[2], bg }); continue; }
      if (match[1] === undefined) continue;
      const p = match[1].split(";").map(Number);
      for (let k = 0; k < p.length; k++) {
        const code = p[k] ?? 0;
        if (code === 0 || code === 49) bg = "default";
        else if (code === 48 && p[k + 1] === 2) { bg = `${p[k + 2]},${p[k + 3]},${p[k + 4]}`; k += 4; }
        else if (code === 48 && p[k + 1] === 5) { bg = `idx${p[k + 2]}`; k += 2; }
        else if (code === 38 && p[k + 1] === 2) k += 4;
        else if (code === 38 && p[k + 1] === 5) k += 2;
      }
    }
    rows.set(y, row);
  }
  return rows;
}

/** Draws `text` as an answer in the real screen layout (sidebar, status bar, writing box) at `columns` columns and returns the chat's cells (the sidebar's columns left out) and the two backgrounds. */
async function chatCells(text: string, columns: number, options: { trueColor: boolean; links: boolean }) {
  setCapabilityOverrides({ trueColor: options.trueColor, hyperlinks: options.links });
  let output = "";
  const terminal = { columns, rows: 40, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {}, write(data: string) { output += data; }, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {} };
  const surface = workspaceTerminal(terminal as never);
  const tui = new TuiAltScreen(surface);
  const transcript = new Container();
  const links = options.links ? new ChatLinks({ cwd: process.cwd(), home: process.env.HOME }) : undefined;
  const message = new AssistantMessage({ agent: "Claude", locale: "es", ...(links ? { links } : {}), copy: async () => true, onChange: () => {} });
  message.setText(text); message.complete();
  transcript.addChild(message);
  const scroll = new IndependentScrollView(transcript, { follow: "end", primary: true, scrollbar: "hidden" });
  const snapshot = () => ({ account: "connected" as const, provider: "Claude Code", model: "m", reasoning: "medium", context: { used: 1, window: 100 }, usage: [] });
  const { input } = createComposer(tui);
  tui.setLayoutRoot(workspaceLayout(scroll, input, new ShellSidebar(snapshot), new ShellStatusBar(snapshot), surface));
  tui.setFocus(input); tui.start();
  await new Promise(resolve => setTimeout(resolve, 50));
  tui.stop();
  const panel = options.trueColor ? "10,10,11" : `idx${nearestAnsi256(palette.background)}`;
  const code = options.trueColor ? "24,24,27" : `idx${nearestAnsi256(palette.surface)}`;
  const pill = options.trueColor ? "39,39,42" : `idx${nearestAnsi256(palette.elevated)}`;
  const rows =[...screenCells(output)].filter(([y]) => y > 3 && y < 30).map(([, row]) => row.slice(0, columns - 42)); // the sidebar's 36 columns and the gap are not the chat
  return { rows, panel, code, pill };
}

const PARAGRAPH = "Una sesión quedó abierta. La sesión `forge614-ai-2026-10-07-t41` quedó abierta; su última nota habla de otra cosa y sigue con texto normal para que el renglón se parta en varios renglones más.";
const LIST = "1. Pasar la documentación de Shell a Notion (resumen de la sesión t41, `21088ae7`, y más texto normal para que se parta en renglones distintos aquí)\n2. otra cosa `dos` y `tres` con texto normal después de ambos códigos";
const TWO = "(`4de159aa`, proyecto, 2026-10-07; `5a8c04e5`, proyecto, 2026-10-08) y luego bastante texto normal para que el renglón se parta en varios renglones de ancho distinto.";
const SPLIT = "Texto antes y luego `un código con varios espacios que no cabe en un solo renglón y tiene que partirse en dos` y texto normal al final del párrafo para seguir.";

const surfaceText = (rows: Cell[][], bg: string) => rows.map(row => row.filter(cell => cell.bg === bg).map(cell => cell.ch).join("")).join("").replace(/\s+/g, " ").trim();

for (const [trueColor, links] of [[true, true], [false, false]] as const) {
  for (const columns of [100, 118, 160]) {
    const mode = `${trueColor ? "color verdadero" : "256 colores"}, ${links ? "con enlaces" : "sin enlaces"}, ${columns} columnas`;

    test(`el fondo del código en línea cubre solo el código y el resto del renglón conserva el fondo del panel (${mode})`, async () => {
      for (const [text, codes] of [[PARAGRAPH, "forge614-ai-2026-10-07-t41"], [LIST, "21088ae7dostres"], [TWO, "4de159aa5a8c04e5"]] as const) {
        const { rows, panel, code } = await chatCells(text, columns, { trueColor, links });
        // Ninguna celda del chat tiene otro fondo que el del panel o el del código (antes: el de la terminal, desde el código hasta el borde).
        const foreign = rows.flatMap(row => row.filter(cell => cell.bg !== panel && cell.bg !== code));
        expect(foreign).toHaveLength(0);
        expect(surfaceText(rows, code)).toBe(codes);
      }
    });
  }
}

test("un código en línea partido entre dos renglones: el fondo cubre las dos partes y ningún espacio de relleno", async () => {
  for (const columns of [100, 118]) {
    const { rows, panel, code } = await chatCells(SPLIT, columns, { trueColor: true, links: true });
    expect(rows.flatMap(row => row.filter(cell => cell.bg !== panel && cell.bg !== code))).toHaveLength(0);
    // El espacio donde se parte el renglón no se dibuja, así que se comparan sin espacios.
    expect(surfaceText(rows, code).replace(/\s/g, "")).toBe("un código con varios espacios que no cabe en un solo renglón y tiene que partirse en dos".replace(/\s/g, ""));
    // El fondo del código no llega a las celdas vacías del final de un renglón.
    for (const row of rows) {
      const last = row.map(cell => cell.ch).join("").trimEnd().length;
      expect(row.slice(last).filter(cell => cell.bg === code)).toHaveLength(0);
    }
  }
});

test("el encabezado de una tabla y los bloques de código cubren su ancho y no se derraman a lo que sigue", async () => {
  const text = "Antes\n\n| Plazo | Qué cambia |\n|---|---|\n| corto | `código` y texto normal |\n\n```ts\nconst a = 1;\n```\n\nDespués con `código` y más texto normal al final.";
  const columns = 200; // chat ancho, para que haya celdas a la derecha del bloque
  const { rows, panel, code, pill } = await chatCells(text, columns, { trueColor: true, links: true });
  // El único otro fondo permitido es el de la píldora de «Copiar» del bloque, y solo en sus celdas.
  expect(rows.flatMap(row => row.filter(cell => cell.bg !== panel && cell.bg !== code && cell.bg !== pill))).toHaveLength(0);
  expect(rows.flatMap(row => row.filter(cell => cell.bg === pill).map(cell => cell.ch)).join("")).toBe(" ⧉ Copiar ");
  const header =rows.find(row => row.map(cell => cell.ch).join("").includes("Plazo"))!;
  const painted = header.filter(cell => cell.bg === code).length;
  expect(painted).toBeGreaterThan("Plazo  Qué cambia".length);
  // Después del ancho de la tabla el renglón vuelve al fondo del panel.
  expect(header.at(-1)!.bg).toBe(panel);
  const block = rows.find(row => row.map(cell => cell.ch).join("").includes("const a = 1;"))!;
  expect(block.filter(cell => cell.bg === code).length).toBeGreaterThan("const a = 1;".length);
  expect(block.at(-1)!.bg).toBe(code); // el bloque ahora cubre el ancho completo del chat
  // El renglón de después: solo el código lleva fondo, hasta el borde el resto es del panel.
  const after = rows.find(row => row.map(cell => cell.ch).join("").includes("Después"))!;
  expect(after.filter(cell => cell.bg === code).map(cell => cell.ch).join("")).toBe("código");
});
