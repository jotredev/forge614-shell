import { expect, test } from "bun:test";
import { summarizeToolText, toolResultPreview } from "./tool-summary.ts";
import { getCatalog } from "../../i18n/index.ts";

const es = getCatalog("es");
const en = getCatalog("en");

/** Lo que Claude Code entrega de un `memory_search` de Engram: un arreglo con un bloque `text` cuyo texto es el JSON. */
const search = [{ type: "text", text: JSON.stringify({ results: [
  { id: "a1", title: "Regla del propietario: soporte de Windows", scope: "board", score: 0.91 },
  { id: "a2", title: "Forge614 Shell release procedure", scope: "project", score: 0.8 },
  { id: "a3", memory: { title: "Plain language in chat" }, scope: "project" },
], count: 3 }) }];

test("un memory_search de Engram se resume en una línea con los títulos, no como JSON crudo", () => {
  const line = toolResultPreview(search, es);
  expect(line).toBe("3 resultados: Regla del propietario: soporte de Windows, Forge614 Shell release procedure, Plain language in chat");
  expect(line).not.toContain("{");
  expect(line).not.toContain('\\"');
  expect(toolResultPreview(search, en)).toStartWith("3 results: ");
});

test("con muchos resultados solo se nombran los primeros y se marca que hay más", () => {
  const many = JSON.stringify({ results: Array.from({ length: 6 }, (_, i) => ({ title: `T${i}` })) });
  expect(summarizeToolText(many, es)).toBe("6 resultados: T0, T1, T2…");
  expect(summarizeToolText(JSON.stringify({ results: [] }), es)).toBe("0 resultados");
  expect(summarizeToolText(JSON.stringify({ results: [{ title: "Uno" }] }), en)).toBe("1 result: Uno");
});

test("un memory_session_start muestra la sesión", () => {
  const start = [{ type: "text", text: JSON.stringify({ sessionId: "forge614-ai-2026-10-14-t42", projectId: "forge614-ai", previous: null }) }];
  expect(toolResultPreview(start, es)).toBe("sesión forge614-ai-2026-10-14-t42");
  expect(toolResultPreview(start, en)).toBe("session forge614-ai-2026-10-14-t42");
});

test("una memoria con título muestra el título", () => {
  expect(summarizeToolText(JSON.stringify({ memory: { id: "x", title: "Mi memoria", body: "largo" } }), es)).toBe("Mi memoria");
});

test("cualquier otro objeto muestra hasta 3 pares clave: valor simples", () => {
  expect(summarizeToolText(JSON.stringify({ saved: true, id: "m-1", scope: "project", extra: "cuarto", nested: { a: 1 } }), es)).toBe("saved: true · id: m-1 · scope: project");
  expect(summarizeToolText(JSON.stringify({ nested: { a: 1 }, list: [1, 2] }), es)).toBe('{"nested":{"a":1},"list":[1,2]}');
});

test("un texto que no es JSON se deja tal cual", () => {
  expect(toolResultPreview([{ type: "text", text: "Compilado en 3 s" }], es)).toBe("Compilado en 3 s");
  expect(toolResultPreview("texto simple { no json", es)).toBe("texto simple { no json");
});

test("un bloque de imagen sigue resumido, sin los bytes, junto al texto de su misma línea", () => {
  const data = "IMAGE_BASE64_" + "A/".repeat(500);
  const line = toolResultPreview([{ type: "text", text: "vista" }, { type: "image", source: { type: "base64", media_type: "image/png", data } }], es);
  expect(line).toContain("vista");
  expect(line).toContain("image/png");
  expect(line).not.toContain("IMAGE_BASE64_");
  expect(line).not.toContain("\n");
});

test("los códigos de control se quitan y el largo se limita", () => {
  expect(toolResultPreview("\x1b[31mrojo\x1b[0m\x07", es)).toBe("rojo");
  expect(toolResultPreview("x".repeat(5000), es).length).toBe(3000);
});
