import { afterAll, beforeAll, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { Container, resetCapabilitiesCache, setCapabilityOverrides } from "@earendil-works/pi-tui";
import type { TuiMouseEvent } from "@earendil-works/pi-tui";
import { AssistantMessage, UserBubble, MAX_READING_WIDTH } from "./chat-message.ts";

/** Estas pruebas leen códigos RGB exactos (el fondo de superficie), así que fijan el color verdadero en vez de depender de la terminal que corre la suite. */
beforeAll(() => setCapabilityOverrides({ trueColor: true }));
afterAll(() => resetCapabilitiesCache());

const SURFACE = "\x1b[48;2;24;24;27m";
const plain = (rows: string[]) => rows.map(row => stripVTControlCharacters(row));
const LONG = "Esta es una frase bastante larga que el propietario escribió para comprobar que el texto se parte dentro de la burbuja y no se sale de ella.";

const click = (y: number, x = 2): TuiMouseEvent => ({ type: "click", button: "left", x, y, screenX: x, screenY: y, width: 80, height: 1000, shift: false, alt: false, ctrl: false, clickCount: 1 });

/** Reparte un clic como lo hace la pantalla: por un contenedor, con coordenadas locales del último dibujo. */
function clickOn(message: AssistantMessage, y: number, x = 2) {
  const container = new Container();
  container.addChild(message);
  container.render(80);
  return container.handleMouse(click(y, x));
}

function assistant(text: string, options: { copy?: (text: string) => Promise<boolean>; done?: boolean } = {}) {
  let renders = 0;
  const message = new AssistantMessage({ agent: "Claude", locale: "es", at: null, copy: options.copy ?? (async () => true), onChange: () => { renders++; } });
  message.setText(text);
  if (options.done ?? true) message.complete();
  return { message, renders: () => renders };
}

for (const width of [60, 100, 160]) {
  test(`la burbuja del propietario va a la derecha, con fondo y sin pasarse de dos tercios (ancho ${width})`, () => {
    const rows = new UserBubble(LONG, { at: null }).render(width);
    const text = plain(rows);
    const bubble = text.filter(row => row.trim() !== "");
    expect(bubble.length).toBeGreaterThan(0);
    const maxBubble = Math.floor((width * 2) / 3);
    for (const row of text) expect(row.length).toBeLessThanOrEqual(width);
    for (const row of bubble) {
      // La burbuja (con su relleno de 1 espacio a cada lado) termina a 2 columnas del borde derecho y no pasa de dos tercios.
      expect(row.length).toBe(width);
      const bubbleStart = row.length - row.trimStart().length - 1; // el espacio de relleno es parte de la burbuja
      expect(width - 2 - bubbleStart).toBeLessThanOrEqual(maxBubble);
      expect(bubbleStart).toBeGreaterThan(0);
    }
    expect(text.join(" ").replace(/\s+/g, " ")).toContain("Esta es una frase bastante larga");
    expect(text.join("\n")).not.toContain("##");
    expect(text.join("\n")).not.toContain("TÚ");
    expect(rows.filter(row => row.includes(SURFACE)).length).toBe(bubble.length);
  });
}

test("un mensaje corto queda pegado al margen derecho, a 2 columnas del borde", () => {
  const row = plain(new UserBubble("hola", { at: null }).render(100)).find(line => line.includes("hola"))!;
  expect(row.length).toBe(100);
  expect(row.endsWith(" hola   ")).toBe(true); // relleno de la burbuja + 2 de margen
});

test("el texto de la burbuja se parte dentro de ella: toda fila con texto lleva fondo y el mismo ancho", () => {
  const rows = new UserBubble(LONG, { at: null }).render(60).filter(row => stripVTControlCharacters(row).trim() !== "");
  expect(rows.length).toBeGreaterThan(1);
  const widths = new Set(rows.map(row => stripVTControlCharacters(row).trimStart().length));
  expect(widths.size).toBe(1);
  for (const row of rows) expect(row).toContain(SURFACE);
});

test("la hora de la burbuja va pequeña y en gris bajo ella; sin hora (conversación retomada) no hay fila de hora", () => {
  const at = new Date(2026, 9, 14, 11, 52).getTime();
  const withTime = plain(new UserBubble("hola", { at }).render(60));
  expect(withTime.at(-1)!.trim()).toBe(new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  const without = plain(new UserBubble("hola", { at: null }).render(60));
  expect(without.filter(row => row.trim() !== "")).toEqual([expect.stringContaining("hola")]);
});

test("la respuesta del agente va a la izquierda, con margen de 2 columnas y un ancho de lectura máximo", () => {
  const { message } = assistant(LONG.repeat(6));
  const rows = plain(message.render(200));
  const body = rows.filter(row => row.trim() !== "" && !row.includes("Claude"));
  expect(body.length).toBeGreaterThan(1);
  for (const row of body) {
    expect(row.startsWith("  ")).toBe(true);
    expect(row.trimEnd().length).toBeLessThanOrEqual(MAX_READING_WIDTH + 4);
  }
  // Sin burbuja: ninguna fila lleva el fondo de superficie.
  expect(message.render(200).join("")).not.toContain(SURFACE);
});

test("la línea del agente es discreta: nombre y hora, sin título ##", () => {
  const at = new Date(2026, 9, 14, 12, 55).getTime();
  const message = new AssistantMessage({ agent: "Codex", locale: "es", at, copy: async () => true, onChange: () => {} });
  message.setText("listo");
  const rows = plain(message.render(80));
  const header = rows.find(row => row.includes("Codex"))!;
  expect(header.trim()).toBe(`Codex · ${new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
  expect(rows.join("\n")).not.toContain("##");
});

test("un bloque de código con una línea larga: toda fila lleva sangría y fondo, y no queda la etiqueta suelta", () => {
  const long = "const resultado = calcularAlgoMuyLargo(primerArgumento, segundoArgumento, tercerArgumento, cuartoArgumento);";
  const { message } = assistant(`Antes\n\n\`\`\`text\n${long}\nok\n\`\`\`\n\nDespués`);
  const raw = message.render(60);
  const rows = plain(raw);
  const start = rows.findIndex(row => row.includes("const resultado"));
  const end = rows.findIndex(row => row.includes("ok"));
  expect(start).toBeGreaterThan(0);
  const block = raw.slice(start - 1, end + 2);
  expect(block.length).toBeGreaterThan(4); // la línea larga ocupó más de una fila
  const widths = new Set<number>();
  for (const row of block) {
    expect(row).toContain(SURFACE);
    const visible = stripVTControlCharacters(row);
    expect(visible.startsWith("   ")).toBe(true); // margen de 2 + 1 de relleno del bloque
    widths.add(visible.length);
  }
  expect(widths.size).toBe(1); // el fondo cubre un ancho parejo
  expect(rows.some(row => row.trim() === "text")).toBe(false);
  expect(rows.some(row => row.includes("```"))).toBe(false);
});

test("un bloque de código dentro de una lista lleva la sangría de la lista en todas sus filas y no se parte de nuevo", () => {
  const long = "const x = unaLineaMuyLargaDentroDeUnaLista(conArgumentos, quePasan, delAnchoDisponible, enLaLista, anidada);";
  const { message } = assistant(`- paso uno:\n\n  \`\`\`ts\n  ${long}\n  \`\`\`\n\n- paso dos`);
  for (const width of [60, 100]) {
    const raw = message.render(width);
    const block = raw.filter(row => row.includes(SURFACE));
    expect(block.length).toBeGreaterThan(3);
    for (const row of block) {
      const visible = stripVTControlCharacters(row);
      expect(visible.length).toBeLessThanOrEqual(width);
      expect(visible.startsWith("     ")).toBe(true); // margen 2 + sangría de la lista 2 + relleno 1
    }
    expect(new Set(block.map(row => stripVTControlCharacters(row).length)).size).toBe(1);
    // Lo escrito se conserva, aunque se parta en varias filas.
    expect(plain(block).map(row => row.trim()).join(" ")).toContain("const x = unaLinea");
  }
});

const BOX = /[┌┐└┘├┤┬┴┼│─]/;
const TABLE = "| Columna | Detalle | Nota |\n|---|---|---|\n| **uno** | `código` en la celda | corta |\n| dos | una celda larga larga larga larga larga larga larga larga larga larga larga | ok |\n";

test("una tabla se dibuja sin ningún carácter de línea, con el encabezado en negrita sobre el fondo de superficie y las columnas alineadas", () => {
  const { message } = assistant(`Antes\n\n${TABLE}\nDespués`);
  const raw = message.render(80);
  const rows = plain(raw);
  expect(rows.some(row => BOX.test(row))).toBe(false);
  const header = raw.findIndex(row => stripVTControlCharacters(row).includes("Columna"));
  expect(header).toBeGreaterThan(0);
  expect(raw[header]).toContain(SURFACE);
  expect(raw[header]).toContain("\x1b[1m");
  expect(stripVTControlCharacters(raw[header]!).trimEnd().length).toBeGreaterThan(20);
  // Las filas del cuerpo no llevan fondo.
  const body = raw.findIndex(row => stripVTControlCharacters(row).includes("una celda"));
  expect(raw[body]).not.toContain(SURFACE);
  // Alineadas: "Detalle", "código" y "una celda" empiezan en la misma columna; "Nota", "corta" y "ok" también.
  const col = (text: string) => rows.find(row => row.includes(text))!.indexOf(text);
  expect(col("código")).toBe(col("Detalle"));
  expect(col("una celda")).toBe(col("Detalle"));
  expect(col("corta")).toBe(col("Nota"));
  expect(col("ok")).toBe(col("Nota"));
  // El formato en línea se conserva: la negrita no deja asteriscos.
  expect(rows.join("\n")).not.toContain("**");
  expect(rows.join("\n")).not.toContain("`");
});

test("una celda larga se parte dentro de su columna, sin pasar del ancho y sin cortar palabras", () => {
  const { message } = assistant(TABLE);
  const rows = plain(message.render(60));
  for (const row of rows) expect(row.length).toBeLessThanOrEqual(60);
  const start = rows.findIndex(row => row.includes("una celda"));
  const col = rows[start]!.indexOf("una celda");
  expect(rows[start + 1]!.slice(0, col).trim()).toBe("");
  expect(rows[start + 1]!.slice(col).trim().length).toBeGreaterThan(0);
  const words = rows.slice(start, start + 4).map(row => row.slice(col).trim()).join(" ");
  expect(words.replace(/\s+/g, " ")).toContain("larga larga");
});

test("una tabla más ancha que el ancho de lectura se reparte en el ancho de lectura, sin líneas", () => {
  const wide = `| ${Array.from({ length: 6 }, (_, i) => `Encabezado${i}`).join(" | ")} |\n|${"---|".repeat(6)}\n| ${Array.from({ length: 6 }, () => "palabra palabra palabra palabra").join(" | ")} |\n`;
  const { message } = assistant(wide);
  const rows = plain(message.render(200));
  for (const row of rows) expect(row.trimEnd().length).toBeLessThanOrEqual(MAX_READING_WIDTH + 4);
  expect(rows.some(row => BOX.test(row))).toBe(false);
  expect(rows.join(" ")).toContain("Encabezado5");
});

test("una línea de código se parte por el último espacio que cabe, con la sangría y 2 espacios más en la continuación", () => {
  const { message } = assistant("```\n    uno dos tres cuatro cinco seis siete ocho nueve diez once doce\n```");
  const rows = plain(message.render(40)).filter(row => /\S/.test(row) && !row.includes("Claude") && !row.includes("Copiar"));
  expect(rows.length).toBeGreaterThan(1);
  const text = rows.map(row => row.replace(/^ {3}/, "").trimEnd());
  expect(text[0]!.startsWith("    uno")).toBe(true);
  expect(text[1]!.startsWith("      ")).toBe(true); // sangría 4 + 2
  expect(text[1]!.trim()[0]).not.toBe(" ");
  for (const piece of text) for (const word of piece.trim().split(/\s+/)) expect(["uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce"]).toContain(word);
});

test("una palabra más larga que el bloque sí se corta a la fuerza", () => {
  const word = "x".repeat(70);
  const { message } = assistant(`\`\`\`\n${word}\n\`\`\``);
  const rows = plain(message.render(40)).filter(row => /\S/.test(row) && !row.includes("Claude") && !row.includes("Copiar"));
  expect(rows.length).toBeGreaterThan(1);
  expect(rows.map(row => row.trim()).join("")).toBe(word);
});

test("el lenguaje del bloque, si se conserva, va en gris dentro de la primera fila con fondo", () => {
  const { message } = assistant("```ts\nconst a = 1;\n```");
  const raw = message.render(60);
  const first = raw.findIndex(row => stripVTControlCharacters(row).includes("ts"));
  expect(first).toBeGreaterThan(-1);
  expect(raw[first]).toContain(SURFACE);
  expect(raw[first]).toContain("\x1b[38;2;161;161;170m");
});

test("una lista con un elemento largo parte con sangría colgante: el texto cae bajo el texto, no bajo la viñeta", () => {
  const { message } = assistant(`- ${LONG}\n- corto`);
  const rows = plain(message.render(60)).filter(row => row.trim() !== "" && !row.includes("Claude"));
  const first = rows[0]!;
  const textStart = first.indexOf("Esta");
  expect(textStart).toBeGreaterThan(first.indexOf("-"));
  expect(rows[1]!.length - rows[1]!.trimStart().length).toBe(textStart);
});

test("el `código en línea` lleva el fondo de superficie", () => {
  const { message } = assistant("usa `bun test` ahora");
  expect(message.render(80).join("\n")).toContain(SURFACE);
});

test("los títulos van en negrita y sin los # ", () => {
  const { message } = assistant("## Resumen\n\ntexto");
  const raw = message.render(80).find(row => row.includes("Resumen"))!;
  expect(raw).toContain("\x1b[1m");
  expect(stripVTControlCharacters(raw)).not.toContain("#");
});

test("el botón Copiar solo aparece cuando la respuesta terminó", () => {
  const writing = assistant("a medias", { done: false });
  expect(plain(writing.message.render(60)).join("\n")).not.toContain("Copiar");
  const finished = assistant("completa");
  expect(plain(finished.message.render(60)).join("\n")).toContain("Copiar");
});

test("un mensaje vacío no muestra Copiar", () => {
  const { message } = assistant("");
  expect(plain(message.render(60)).join("\n")).not.toContain("Copiar");
});

test("el clic en Copiar copia exactamente el Markdown original y el botón dice Copiado unos 2 segundos", async () => {
  const markdown = "## Título\n\n- uno\n- dos\n\n```ts\nconst a = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
  const copied: string[] = [];
  const { message, renders } = assistant(markdown, { copy: async text => { copied.push(text); return true; } });
  const rows = plain(message.render(80));
  const button = rows.findIndex(row => row.includes("Copiar"));
  expect(button).toBeGreaterThan(-1);
  // Un clic fuera del botón no copia nada.
  clickOn(message, 0);
  expect(copied).toEqual([]);
  expect(clickOn(message, button)?.handled).toBe(true);
  await Bun.sleep(0);
  expect(copied).toEqual([markdown]);
  expect(copied[0]).not.toContain("\x1b");
  expect(copied[0]).not.toContain("Claude");
  expect(plain(message.render(80)).join("\n")).toContain("Copiado");
  expect(renders()).toBeGreaterThan(0);
  await Bun.sleep(2100);
  expect(plain(message.render(80)).join("\n")).toContain("Copiar");
  expect(plain(message.render(80)).join("\n")).not.toContain("Copiado");
});

test("si no hay portapapeles, el clic avisa y no dice Copiado", async () => {
  let unavailable = 0;
  const message = new AssistantMessage({ agent: "Claude", locale: "es", at: null, copy: async () => false, onChange: () => {}, onCopyFailed: () => { unavailable++; } });
  message.setText("hola");
  message.complete();
  const button = plain(message.render(80)).findIndex(row => row.includes("Copiar"));
  clickOn(message, button);
  await Bun.sleep(0);
  expect(unavailable).toBe(1);
  expect(plain(message.render(80)).join("\n")).not.toContain("Copiado");
});
