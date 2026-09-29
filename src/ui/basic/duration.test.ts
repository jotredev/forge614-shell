import { expect, test } from "bun:test";
import { formatDuration, workingStatus } from "./duration.ts";

/** Todo contador visible (indicador, herramientas, barra lateral) usa este único formateador: guarda los bordes entre segundos, minutos y horas para que nadie vuelva a ver «503s». */
test("formatDuration reads seconds, minutes and hours the same way everywhere", () => {
  const cases: [number, string][] = [
    [0, "0s"], [45, "45s"], [59, "59s"], [60, "1m 00s"], [87, "1m 27s"], [503, "8m 23s"],
    [3599, "59m 59s"], [3600, "1h 00m"], [3720, "1h 02m"], [36000, "10h 00m"],
  ];
  for (const [seconds, text] of cases) expect({ seconds, text: formatDuration(seconds) }).toEqual({ seconds, text });
});

/** Un contador nunca muestra decimales ni negativos, aunque el reloj o el motor entreguen fracciones (p. ej. 3.9 s) o un valor adelantado. */
test("formatDuration floors fractions and never goes negative", () => {
  expect(formatDuration(3.9)).toBe("3s");
  expect(formatDuration(-4)).toBe("0s");
});

/** El indicador «Trabajando» debe decir en qué trabaja cuando hay una herramienta o comando en curso, y solo «Trabajando · tiempo» cuando no la hay (así se ve igual para Claude y Codex, que le pasan su frase). */
test("workingStatus names the current activity when there is one and only the time otherwise", () => {
  expect(workingStatus("Working", "Waiting for the PR checks", 503)).toBe("Working · Waiting for the PR checks · 8m 23s");
  expect(workingStatus("Working", undefined, 503)).toBe("Working · 8m 23s");
  expect(workingStatus("Working", "   ", 5)).toBe("Working · 5s");
  expect(workingStatus("Trabajando", undefined, 87)).toBe("Trabajando · 1m 27s");
});

/** Un comando de Codex puede traer varias líneas o ser larguísimo: el indicador es de un solo renglón y de largo razonable, sin saltos de línea. */
test("workingStatus keeps the activity to one short line", () => {
  const status = workingStatus("Working", `npm test\n  --watch ${"x".repeat(300)}`, 1);
  expect(status).not.toContain("\n");
  expect(status.startsWith("Working · npm test --watch x")).toBe(true);
  expect(status.endsWith("… · 1s")).toBe(true);
  expect(status.length).toBeLessThan(100);
});
