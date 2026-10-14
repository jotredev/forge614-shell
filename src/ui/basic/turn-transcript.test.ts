import { afterAll, beforeAll, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { resetCapabilitiesCache, setCapabilityOverrides } from "@earendil-works/pi-tui";
import { TurnTranscript } from "./turn-transcript.ts";
import { AssistantMessage, UserBubble } from "./chat-message.ts";
import { ActivityCard } from "./transcript.ts";
import { ChatText } from "./theme.ts";

beforeAll(() => setCapabilityOverrides({ trueColor: true }));
afterAll(() => resetCapabilitiesCache());

const FAINT = "\x1b[38;2;63;63;70m";
const answer = (text: string) => { const m = new AssistantMessage({ agent: "Claude", locale: "es", at: null, copy: async () => true, onChange: () => {} }); m.setText(text); m.complete(); return m; };
const user = (text: string) => new UserBubble(text, { locale: "es", at: null });
/** La línea del separador: punteada (`┈`), en el color tenue, con espacios a los lados. */
const isRule = (row: string) => row.includes(FAINT) && /^ +┈+$/.test(stripVTControlCharacters(row));
const separators = (t: TurnTranscript, width = 60) => t.render(width).filter(isRule).length;

test("hay un separador al pasar del propietario al agente y del agente al propietario", () => {
  const t = new TurnTranscript();
  t.addChild(user("hola")); t.addChild(answer("buenas")); t.addChild(user("otra")); t.addChild(answer("sí"));
  expect(separators(t)).toBe(3);
});

for (const [width, dots] of [[60, 36], [100, 60], [160, 72]] as const) {
  test(`el separador es una línea punteada, tenue y centrada de ~60 % del ancho (máximo 72), sin tocar las orillas, con una fila en blanco arriba y otra abajo (ancho ${width})`, () => {
    const t = new TurnTranscript();
    t.addChild(user("hola")); t.addChild(answer("buenas"));
    const raw = t.render(width);
    const rows = raw.map(row => stripVTControlCharacters(row));
    const at = rows.findIndex((_, y) => isRule(raw[y]!));
    expect(at).toBeGreaterThan(0);
    const rule = rows[at]!;
    expect(rule.trimStart().length).toBe(dots);
    expect(rule).not.toContain("─");
    // Centrada: la misma holgura a los dos lados (±1) y ninguna en las orillas.
    const left = rule.length - rule.trimStart().length;
    const right = width - rule.length;
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
    expect(rows[at - 1]).toBe("");
    expect(rows[at + 1]).toBe(""); // la fila en blanco con la que empieza el mensaje siguiente
  });
}

test("no hay separador antes del primer mensaje, ni entre herramientas del mismo turno, ni entre mensajes del mismo lado", () => {
  const t = new TurnTranscript();
  t.addChild(new ChatText("aviso de arranque"));
  t.addChild(user("hola"));
  expect(separators(t)).toBe(0);
  t.addChild(new ActivityCard("Read", "ok")); t.addChild(new ActivityCard("Bash", "ok")); t.addChild(new ActivityCard("Permiso", "", "x", true));
  expect(separators(t)).toBe(1); // una sola, entre el propietario y las herramientas del agente
  t.addChild(new ChatText("un aviso durante la respuesta")); t.addChild(answer("listo")); t.addChild(answer("y más"));
  expect(separators(t)).toBe(1);
  t.addChild(user("gracias"));
  expect(separators(t)).toBe(2);
});

test("al volver a agregar los mismos hijos (volver de una conversación aparte) no se duplican los separadores", () => {
  const t = new TurnTranscript();
  t.addChild(user("hola")); t.addChild(answer("buenas")); t.addChild(user("otra"));
  const children = [...t.children];
  t.clear();
  for (const child of children) t.addChild(child);
  expect(separators(t)).toBe(2);
});

test("limpiar la conversación olvida quién habló último", () => {
  const t = new TurnTranscript();
  t.addChild(user("hola")); t.clear(); t.addChild(answer("buenas"));
  expect(separators(t)).toBe(0);
});
