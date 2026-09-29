import { expect, test } from "bun:test";
import { memorySourceLine } from "./memory-source.ts";

/**
 * Why this exists: since the memory arrives once (from the assistant's startup hook, or pasted by Shell as a fallback), the person must be able
 * to check which one is in force from `/f614:status` (Claude Code) and `/status` (Codex) without asking the model. The exact words, in both languages.
 */
test("the memory line says, in plain words and in both languages, who delivers the memory", () => {
  expect(memorySourceLine(true, "en")).toBe("Memory: the assistant delivers it at startup");
  expect(memorySourceLine(false, "en")).toBe("Memory: Shell pastes it");
  expect(memorySourceLine(true, "es")).toBe("Memoria: la entrega el asistente al arrancar");
  expect(memorySourceLine(false, "es")).toBe("Memoria: la pega Shell");
});
