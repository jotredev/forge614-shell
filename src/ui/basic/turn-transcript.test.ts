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
const separators = (t: TurnTranscript, width = 60) => t.render(width).filter(row => row.includes(FAINT) && /^─+$/.test(stripVTControlCharacters(row))).length;

test("hay un separador al pasar del propietario al agente y del agente al propietario", () => {
  const t = new TurnTranscript();
  t.addChild(user("hola")); t.addChild(answer("buenas")); t.addChild(user("otra")); t.addChild(answer("sí"));
  expect(separators(t)).toBe(3);
});

test("el separador es una línea tenue de ancho completo con una fila en blanco arriba y otra abajo", () => {
  const t = new TurnTranscript();
  t.addChild(user("hola")); t.addChild(answer("buenas"));
  const rows = t.render(60).map(row => stripVTControlCharacters(row));
  const at = rows.findIndex(row => row === "─".repeat(60));
  expect(at).toBeGreaterThan(0);
  expect(rows[at - 1]).toBe("");
  expect(rows[at + 1]).toBe(""); // la fila en blanco con la que empieza el mensaje siguiente
});

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
