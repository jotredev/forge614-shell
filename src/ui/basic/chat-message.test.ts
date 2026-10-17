import { afterAll, beforeAll, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { Container, resetCapabilitiesCache, setCapabilityOverrides } from "@earendil-works/pi-tui";
import type { TuiMouseEvent } from "@earendil-works/pi-tui";
import { AssistantMessage, UserBubble } from "./chat-message.ts";
import { ChatLinks } from "./chat-links.ts";

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

const human = (text: string, at: number | null = null, locale: "es" | "en" = "es") => new UserBubble(text, { at, locale });
const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

for (const width of [60, 80, 100, 160, 180]) {
  test(`el mensaje del propietario va a la izquierda, sin fondo, con margen de 2 y el mismo ancho que el del agente, con «Humano · hora» arriba (ancho ${width})`, () => {
    const at = new Date(2026, 9, 14, 13, 43).getTime();
    const long = Array(5).fill(LONG).join(" ");
    const rows = human(long, at).render(width);
    const text = plain(rows);
    const lines = text.filter(row => row.trim() !== "");
    for (const row of text) expect(row.length).toBeLessThanOrEqual(width);
    // La primera fila con texto es la línea «Humano · hora», en la columna 2, a la izquierda.
    expect(lines[0]).toBe(`  Humano · ${clock(at)}`);
    // El texto empieza en la columna 2 y usa todo el ancho disponible, con 2 columnas de margen a cada lado.
    const body = lines.slice(1);
    expect(body.length).toBeGreaterThan(1);
    for (const row of body) {
      expect(row.startsWith("  ")).toBe(true);
      expect(row[2]).not.toBe(" ");
      expect(row.length - 2).toBeLessThanOrEqual(width - 4);
    }
    expect(Math.max(...body.map(row => row.length - 2))).toBeGreaterThan(width - 29); // aprovecha el ancho, no un tercio
    // Mismo ancho que el del agente: el texto parte donde parte el del agente.
    const agent = assistant(long).message.render(width).map(row => stripVTControlCharacters(row)).filter(row => row.trim() !== "" && !row.includes("Claude"));
    expect(body.map(row => row.trimEnd())).toEqual(agent.map(row => row.trimEnd()));
    expect(text.join("\n")).not.toContain("##");
    // Sin fondo: ningún código de fondo en ninguna fila, y la hora de abajo ya no existe.
    expect(rows.join("")).not.toMatch(/\x1b\[48;/);
    expect(text.at(-1)!.trim()).not.toBe(clock(at));
  });
}

test("un mensaje corto queda en la columna 2, pegado al margen izquierdo", () => {
  const row = plain(human("hola").render(100)).find(line => line.includes("hola"))!;
  expect(row).toBe("  hola");
});

test("un mensaje largo (30 líneas con renglones largos) se ve completo, sin recortes, con sus saltos de línea y sus líneas en blanco", () => {
  const lines = Array.from({ length: 30 }, (_, i) => i % 5 === 4 ? "" : `Línea ${i + 1}: ${"palabra ".repeat(25)}fin${i + 1}`);
  const source = lines.join("\n");
  for (const width of [60, 100, 160]) {
    const text = plain(human(source).render(width));
    for (const row of text) expect(row.length).toBeLessThanOrEqual(width);
    // Todo lo escrito está: cada línea, partida o no, conserva todas sus palabras y su final.
    const joined = text.map(row => row.trim()).join(" ").replace(/\s+/g, " ");
    for (let i = 0; i < 30; i++) if (lines[i] !== "") expect(joined).toContain(`fin${i + 1}`);
    expect((joined.match(/palabra/g) ?? []).length).toBe(lines.filter(line => line !== "").length * 25);
    // Las líneas en blanco del texto siguen siendo filas en blanco, entre las del texto (6 en las 30 líneas).
    const body = text.slice(2); // sin la fila de aire ni la línea «Humano»
    expect(body.filter(row => row === "").length).toBe(6);
    expect(body.findIndex(row => row.includes("Línea 4:"))).toBeGreaterThan(-1);
  }
});

test("el texto del propietario es texto simple: un # o un - suyo no cambia de forma, y la sangría y los espacios de lo pegado se conservan", () => {
  const text = plain(human("# no es un título\n- ni una viñeta\n**ni negrita**\n    sangrado con 4 espacios\n`ni código`").render(80));
  expect(text.slice(2)).toEqual(["  # no es un título", "  - ni una viñeta", "  **ni negrita**", "      sangrado con 4 espacios", "  `ni código`"]);
});

test("«Humano» en español y «Human» en inglés; sin hora conocida (conversación retomada) queda solo la palabra", () => {
  const at = new Date(2026, 9, 14, 13, 43).getTime();
  expect(plain(human("hola", at, "en").render(60)).find(row => row.includes("Human"))!).toBe(`  Human · ${clock(at)}`);
  expect(plain(human("hola", null, "es").render(60)).find(row => row.includes("Humano"))!).toBe("  Humano");
});

test("en la línea del propietario la palabra «Humano» va en el color de acento y la hora en gris; la del agente sigue toda en gris", () => {
  const ACCENT = "\x1b[38;2;70;222;224m"; const MUTED = "\x1b[38;2;161;161;170m";
  const user = human("hola", Date.now()).render(80).find(row => row.includes("Humano"))!;
  expect(user).toContain(`${ACCENT}Humano`);
  expect(user.indexOf(ACCENT)).toBeLessThan(user.indexOf("Humano"));
  const time = clock(Date.now());
  expect(user.slice(user.indexOf("Humano") + "Humano".length)).toContain(`${MUTED} · ${time}`);
  expect(user.slice(user.indexOf("·"))).not.toContain(ACCENT);
  // Sin hora (conversación retomada): solo la palabra, en acento.
  expect(human("hola", null).render(80).find(row => row.includes("Humano"))).toContain(`${ACCENT}Humano`);
  // La línea del agente, igual que antes: nombre y hora en gris, sin acento.
  const agent = new AssistantMessage({ agent: "Claude", locale: "es", copy: async () => true, onChange: () => {} });
  agent.setText("ok");
  const line = agent.render(80).find(row => row.includes("Claude"))!;
  expect(line).toContain(`${MUTED}Claude`);
  expect(line).not.toContain(ACCENT);
  // Las dos líneas empiezan en la misma columna (2).
  expect(stripVTControlCharacters(line).indexOf("Claude")).toBe(stripVTControlCharacters(user).indexOf("Humano"));
});

test("la respuesta del agente va a la izquierda, con margen de 2 columnas y todo el ancho disponible", () => {
  const { message } = assistant(LONG.repeat(6));
  const rows = plain(message.render(200));
  const body = rows.filter(row => row.trim() !== "" && !row.includes("Claude"));
  expect(body.length).toBeGreaterThan(1);
  for (const row of body) {
    expect(row.startsWith("  ")).toBe(true);
    expect(row.trimEnd().length).toBeLessThanOrEqual(200);
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

test("una tabla más ancha que el chat se reparte en el ancho disponible, sin líneas", () => {
  const wide = `| ${Array.from({ length: 6 }, (_, i) => `Encabezado${i}`).join(" | ")} |\n|${"---|".repeat(6)}\n| ${Array.from({ length: 6 }, () => "palabra palabra palabra palabra").join(" | ")} |\n`;
  const { message } = assistant(wide);
  const rows = plain(message.render(200));
  for (const row of rows) expect(row.trimEnd().length).toBeLessThanOrEqual(200);
  expect(rows.some(row => BOX.test(row))).toBe(false);
  expect(rows.join(" ")).toContain("Encabezado5");
});

test("una línea de código se parte por el último espacio que cabe, con la sangría y 2 espacios más en la continuación", () => {
  const { message } = assistant("```\n    uno dos tres cuatro cinco seis siete ocho nueve diez once doce\n```");
  const rows = plain(message.render(40)).filter(row => /\S/.test(row) && !row.includes("Claude") && !row.includes("Copiar"));
  expect(rows.length).toBeGreaterThan(1);
  const text = rows.map(row => row.replace(/^ {4}/, "").trimEnd()); // margen de 2 + relleno del bloque de 2
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

const LONG_CODE = "const resultado = calcularAlgoMuyLargo(primerArgumento, segundoArgumento, tercerArgumento, cuartoArgumento, quintoArgumento);";
const TWO_BLOCKS = `Antes\n\n\`\`\`text\nuno\n  dos con sangría\n\n   tres\n\`\`\`\n\nEn medio con \`código en línea\`.\n\n\`\`\`ts\n${LONG_CODE}\n\`\`\`\n\nDespués.`;
/** Los botones dibujados: su fila y la columna donde empieza la píldora (con su espacio de relleno). */
const PILL = / [⧉✓] (?:Copiar|Copiado) /;
const buttonsOf = (message: AssistantMessage, width = 80) => plain(message.render(width)).flatMap((row, y) => PILL.test(row) ? [{ y, x: row.search(PILL), row }] : []);
const ELEVATED = "\x1b[48;2;39;39;42m";
const ACCENT_BG = "\x1b[48;2;70;222;224m";

test("una respuesta sin bloques de código no tiene ningún Copiar, ni al final ni en ningún lado", () => {
  const { message } = assistant("Una respuesta con `código en línea`, una lista:\n\n- uno\n- dos\n\ny una tabla:\n\n| a | b |\n|---|---|\n| 1 | 2 |\n");
  expect(plain(message.render(80)).join("\n")).not.toContain("Copiar");
  expect(plain(assistant("").message.render(60)).join("\n")).not.toContain("Copiar");
});

test("cada bloque de código cercado lleva su Copiar como botón: una píldora con icono sobre un fondo más claro que el del bloque, en su propia fila, con 2 columnas al borde derecho", () => {
  const { message } = assistant(TWO_BLOCKS);
  const raw = message.render(80);
  const rows = plain(raw);
  const buttons = buttonsOf(message);
  expect(buttons).toHaveLength(2);
  for (const button of buttons) {
    const row = raw[button.y]!;
    expect(row).toContain(SURFACE); // la fila es del bloque…
    expect(row).toContain(ELEVATED); // …y la píldora tiene su propio fondo, más claro
    expect(row.indexOf(ELEVATED)).toBeGreaterThan(row.indexOf(SURFACE));
    expect(row).toContain("\x1b[38;2;228;228;231m ⧉ Copiar "); // texto normal (no gris tenue), con icono y 1 espacio de relleno a cada lado
    expect(rows[button.y]!.slice(button.x, button.x + 10)).toBe(" ⧉ Copiar ");
    // El bloque ocupa las columnas 2 a 78 de 80; la píldora termina 2 columnas antes del borde derecho del bloque.
    expect(button.x + " ⧉ Copiar ".length).toBe(80 - 2 - 2);
  }
  // El segundo bloque tiene idioma: «ts» en gris a la izquierda de la misma fila y la píldora a la derecha.
  const second = rows[buttons[1]!.y]!;
  expect(second.indexOf("ts")).toBeLessThan(second.indexOf("Copiar"));
  expect(raw[buttons[1]!.y]).toContain("\x1b[38;2;161;161;170mts");
  // El código en línea del medio no lleva botón.
  expect(plain(raw).filter(row => row.includes("código en línea") || row.includes("Copiar")).filter(row => row.includes("código en línea") && row.includes("Copiar"))).toHaveLength(0);
});

test("el clic en cada botón copia exactamente el contenido original de su bloque, sin cercas ni idioma ni cortes de Shell", async () => {
  const copied: string[] = [];
  const { message } = assistant(TWO_BLOCKS, { copy: async text => { copied.push(text); return true; } });
  const [first, second] = buttonsOf(message);
  // Un clic fuera de los botones no copia nada.
  clickOn(message, 0); clickOn(message, first!.y, 0); clickOn(message, first!.y + 1, first!.x);
  expect(copied).toEqual([]);
  expect(clickOn(message, first!.y, first!.x)?.handled).toBe(true);
  await Bun.sleep(0);
  expect(copied).toEqual(["uno\n  dos con sangría\n\n   tres"]);
  // La línea larga, que Shell parte en varias filas a 60 columnas, se copia entera y en una sola línea.
  const narrow = buttonsOf(message, 60);
  expect(plain(message.render(60)).filter(row => row.includes("resultado") || row.includes("cuartoArgumento")).length).toBeGreaterThan(0);
  const container = new Container(); container.addChild(message); container.render(60);
  container.handleMouse({ ...click(narrow[1]!.y, narrow[1]!.x), width: 60 });
  await Bun.sleep(0);
  expect(copied[1]).toBe(LONG_CODE);
  expect(copied.join("")).not.toContain("```");
  expect(copied.join("")).not.toContain("\x1b");
  void second;
});

test("AssistantMessage entrega al mismo ChatText el clic de Copiar y el puntero sobre un enlace", async () => {
  setCapabilityOverrides({ trueColor: true, hyperlinks: true });
  try {
    const copied: string[] = [];
    const links = new ChatLinks({ cwd: process.cwd(), tools: { openWeb: async () => true, openPath: async () => true }, nonce: "message-events" });
    const message = new AssistantMessage({ agent: "Claude", locale: "es", links, copy: async text => { copied.push(text); return true; }, onChange: () => {} });
    message.setText("[enlace](https://example.com)\n\n```sh\nbun test\n```");
    message.complete();
    const root = new Container();
    root.addChild(message);
    const rows = plain(root.render(80));
    const linkRow = rows.findIndex(row => row.includes("enlace"));
    const button = buttonsOf(message)[0]!;
    const move: TuiMouseEvent = { ...click(linkRow, rows[linkRow]!.indexOf("enlace")), type: "move", button: "none" };
    root.handleMouse(move);
    expect(message.render(80)[linkRow]).toContain("\x1b[38;2;150;245;247m");
    expect(root.handleMouse(click(button.y, button.x))?.handled).toBe(true);
    await Bun.sleep(0);
    expect(copied).toEqual(["bun test"]);
  } finally { resetCapabilitiesCache(); }
});

test("entre la fila del botón y el contenido hay una fila en blanco con el fondo del bloque, y el contenido lleva 2 columnas de relleno a cada lado", () => {
  const { message } = assistant(TWO_BLOCKS);
  const raw = message.render(80);
  const rows = plain(raw);
  const [first, second] = buttonsOf(message);
  // Primer bloque: botón, fila en blanco del bloque, y recién después «uno» (con 2 de margen + 2 de relleno).
  expect(rows[first!.y + 1]!.trim()).toBe("");
  expect(raw[first!.y + 1]).toContain(SURFACE);
  expect(rows[first!.y + 2]!.indexOf("uno")).toBe(4);
  expect(raw[first!.y + 2]).toContain("  \x1b[39m\x1b[49m"); // y 2 columnas de relleno a la derecha, aún con el fondo
  // Al final del bloque, una fila en blanco con el fondo del bloque, como antes.
  const last = rows.findIndex(row => row.includes("tres"));
  expect(rows[last + 1]!.trim()).toBe("");
  expect(raw[last + 1]).toContain(SURFACE);
  // Segundo bloque: igual.
  expect(rows[second!.y + 1]!.trim()).toBe("");
  expect(raw[second!.y + 1]).toContain(SURFACE);
  expect(rows[second!.y + 2]!.indexOf("const resultado")).toBe(4);
});

test("la zona de clic cubre toda la píldora: cualquier columna suya copia, y las de al lado no", async () => {
  for (const [dx, copies] of [[0, true], [1, true], [4, true], [9, true], [-1, false], [10, false], [30, false]] as const) {
    const copied: string[] = [];
    const { message } = assistant("```sh\nbun test\n```", { copy: async text => { copied.push(text); return true; } });
    const [button] = buttonsOf(message);
    clickOn(message, button!.y, button!.x + dx);
    await Bun.sleep(0);
    expect(copied, `columna ${dx} de la píldora`).toEqual(copies ? ["bun test"] : []);
  }
});

test("después de copiar el botón dice «✓ Copiado» en el color de éxito, sobre el mismo fondo, y vuelve a «⧉ Copiar»", async () => {
  const { message } = assistant("```sh\nbun test\n```");
  const [button] = buttonsOf(message);
  const before = message.render(80)[button!.y]!;
  clickOn(message, button!.y, button!.x);
  await Bun.sleep(0);
  const row = message.render(80)[button!.y]!;
  expect(stripVTControlCharacters(row)).toContain(" ✓ Copiado ");
  expect(row).toContain("\x1b[38;2;107;238;201m ✓ Copiado ");
  expect(row).toContain(ELEVATED);
  expect(row).not.toContain(ACCENT_BG);
  expect(row).not.toBe(before);
  // La píldora sigue pegada a 2 columnas del borde, así que al ser una columna más ancha empieza una antes; la zona de clic es la nueva.
  expect(plain([row])[0]!.slice(button!.x - 1, button!.x + 10)).toBe(" ✓ Copiado ");
  expect(buttonsOf(message)[0]!.x).toBe(button!.x - 1);
  await Bun.sleep(2100);
  expect(stripVTControlCharacters(message.render(80)[button!.y]!)).toContain(" ⧉ Copiar ");
});

test("al pasar el mouse por la píldora cambia al acento con texto oscuro y en negrita, solo la de ese bloque; al irse el puntero vuelve", async () => {
  const links = new ChatLinks({ cwd: process.cwd(), home: process.env.HOME });
  let redraws = 0;
  links.bind({ requestRender: () => { redraws++; }, write: () => {} });
  const message = new AssistantMessage({ agent: "Claude", locale: "es", at: null, links, copy: async () => true, onChange: () => {} });
  message.setText(TWO_BLOCKS); message.complete();
  const container = new Container(); container.addChild(message); container.render(80);
  const [first, second] = buttonsOf(message);
  const move = (y: number, x: number): TuiMouseEvent => ({ ...click(y, x), type: "move", button: "none" });
  expect(message.render(80).join("")).not.toContain(ACCENT_BG);
  // El puntero pasa por la primera píldora: cada evento de ratón pasa antes por `observe`, como en la pantalla real.
  links.observe("\x1b[<35;10;5M");
  container.handleMouse(move(first!.y, first!.x + 3));
  const rows = message.render(80);
  expect(rows[first!.y]).toContain(ACCENT_BG);
  expect(rows[first!.y]).toContain("\x1b[1m"); // negrita
  expect(rows[first!.y]).toContain("\x1b[38;2;10;10;11m ⧉ Copiar "); // texto oscuro del fondo de la pantalla
  expect(rows[second!.y]).not.toContain(ACCENT_BG);
  await Bun.sleep(0);
  expect(redraws).toBeGreaterThan(0);
  const afterHover = redraws;
  // El puntero se va a otra parte (un evento de ratón que ningún botón recibe): se apaga y se pide redibujar.
  links.observe("\x1b[<35;60;30M");
  await Bun.sleep(0);
  expect(message.render(80).join("")).not.toContain(ACCENT_BG);
  expect(redraws).toBeGreaterThan(afterHover);
  // El texto de la píldora no cambia con el realce: el clic sigue en el mismo lugar.
  expect(buttonsOf(message)[0]!.x).toBe(first!.x);
});

test("un bloque dentro de una lista lleva su botón, alineado al borde derecho del bloque, y copia solo ese bloque", async () => {
  const copied: string[] = [];
  const { message } = assistant("- paso uno:\n\n  ```sh\n  bun test --watch\n  ```\n\n- paso dos", { copy: async text => { copied.push(text); return true; } });
  const [button] = buttonsOf(message);
  expect(button).toBeDefined();
  const raw = message.render(80);
  const row = plain(raw)[button!.y]!;
  // La fila del botón tiene el fondo del bloque, empieza con el margen más la sangría de la lista, y el botón queda cerca del borde derecho del bloque (a 1 columna de su relleno), no pegado al texto.
  expect(raw[button!.y]).toContain(SURFACE);
  expect(row.startsWith("     ")).toBe(true);
  expect(raw[button!.y]).toContain("Copiar \x1b[39m\x1b[49m");
  expect(button!.x).toBeGreaterThan(40);
  expect(row.trimEnd().length).toBeLessThanOrEqual(80 - 2);
  clickOn(message, button!.y, button!.x);
  await Bun.sleep(0);
  expect(copied).toEqual(["bun test --watch"]);
});

test("un bloque que todavía se está escribiendo no tiene botón; aparece cuando el bloque se cierra o cuando la respuesta termina", () => {
  const open = assistant("Mira:\n\n```ts\nconst a = 1;", { done: false });
  expect(buttonsOf(open.message)).toHaveLength(0);
  open.message.setText("Mira:\n\n```ts\nconst a = 1;\n```\n\nY luego\n\n```sh\nbun te");
  expect(buttonsOf(open.message)).toHaveLength(1); // el primero cerró, el segundo sigue abierto
  open.message.setText("Mira:\n\n```ts\nconst a = 1;\n```\n\nY luego\n\n```sh\nbun test\n```");
  expect(buttonsOf(open.message)).toHaveLength(2);
  const unclosed = assistant("```sh\nbun te", { done: false });
  expect(buttonsOf(unclosed.message)).toHaveLength(0);
  unclosed.message.complete();
  expect(buttonsOf(unclosed.message)).toHaveLength(1);
});

test("tras copiar, solo el botón pulsado dice Copiado unos 2 segundos y luego vuelve a Copiar", async () => {
  const { message, renders } = assistant(TWO_BLOCKS);
  const [first] = buttonsOf(message);
  clickOn(message, first!.y, first!.x);
  await Bun.sleep(0);
  const now = buttonsOf(message);
  expect(now.map(button => /Copiado/.test(button.row))).toEqual([true, false]);
  expect(renders()).toBeGreaterThan(0);
  await Bun.sleep(2100);
  expect(buttonsOf(message).map(button => /Copiar/.test(button.row))).toEqual([true, true]);
  expect(plain(message.render(80)).join("\n")).not.toContain("Copiado");
});

test("si no hay portapapeles, el clic avisa y no dice Copiado", async () => {
  let unavailable = 0;
  const message = new AssistantMessage({ agent: "Claude", locale: "es", at: null, copy: async () => false, onChange: () => {}, onCopyFailed: () => { unavailable++; } });
  message.setText("```sh\nbun test\n```");
  message.complete();
  const [button] = buttonsOf(message);
  clickOn(message, button!.y, button!.x);
  await Bun.sleep(0);
  expect(unavailable).toBe(1);
  expect(plain(message.render(80)).join("\n")).not.toContain("Copiado");
});

test("si la copia solo se envió a la terminal, avisa eso y no dice Copiado", async () => {
  let fallback = 0;
  const message = new AssistantMessage({ agent: "Claude", locale: "es", at: null, copy: async () => "terminal", onChange: () => {}, onCopyTerminalFallback: () => { fallback++; } });
  message.setText("```sh\nbun test\n```");
  message.complete();
  const [button] = buttonsOf(message);
  clickOn(message, button!.y, button!.x);
  await Bun.sleep(0);
  expect(fallback).toBe(1);
  expect(plain(message.render(80)).join("\n")).not.toContain("Copiado");
});
