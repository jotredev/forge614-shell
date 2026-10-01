import { afterAll, beforeAll, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { resetCapabilitiesCache, setCapabilityOverrides, visibleWidth } from "@earendil-works/pi-tui";
import type { TUI } from "@earendil-works/pi-tui";
import { ForgeComposer, SPINNER_FRAMES } from "./composer.ts";
import type { ComposerClock } from "./composer.ts";
import { getCatalog } from "../../i18n/index.ts";

/** Estos tests leen los códigos RGB exactos que emite la pantalla, así que fijan el modo de color en vez de tomar el de la terminal que corra la suite. */
beforeAll(() => setCapabilityOverrides({ trueColor: true }));
afterAll(() => resetCapabilitiesCache());

const MODE = { id: "m", label: "Default", tone: "manual" } as const;
const plain = (rows: string[]) => rows.map(stripVTControlCharacters);
/** El renglón de estado y modo: el penúltimo del bloque (el último es la fila vacía de cierre). */
const statusRow = (rows: string[]) => rows[rows.length - 2]!;
/** Una letra pintada en un RGB exacto, como la emite la pantalla: color de texto, la letra y el regreso al color de la terminal. */
const painted = (rgb: string, text: string) => `\x1b[38;2;${rgb}m${text}\x1b[39m`;

/**
 * Un reloj y un temporizador falsos que el test mueve a mano: `set` cambia la hora, `fire` hace sonar cada temporizador vivo y `active` cuenta los que quedan
 * corriendo. Existe para fijar colores y animaciones en instantes exactos y para comprobar que sin nada animado no queda ningún temporizador.
 */
function fakeClock(start = 0) {
  let now = start;
  const timers = new Map<() => void, number>();
  const clock: ComposerClock = { now: () => now, every: (ms, tick) => { timers.set(tick, ms); return () => { timers.delete(tick); }; } };
  return {
    clock,
    set: (ms: number) => { now = ms; },
    now: () => now,
    fire: () => { for (const tick of [...timers.keys()]) tick(); },
    get active() { return timers.size; },
    get intervals() { return [...timers.values()]; },
  };
}
function composerWith(clock: ComposerClock, locale: "en" | "es" = "en") {
  let renders = 0;
  const tui = { requestRender() { renders++; }, terminal: { rows: 40, columns: 100 } } as unknown as TUI;
  const composer = new ForgeComposer(tui, locale, clock);
  return { composer, renders: () => renders };
}

/**
 * El cuadro ya no abre con el estado: son seis filas (la separadora, una vacía, el editor, una vacía, el renglón de estado y modo, una vacía de cierre), una menos que
 * antes, y el estado vive a la izquierda del renglón del modo con los atajos a la derecha. Existe porque el propietario aprobó esta forma «Directo».
 */
test("the box has one row less, no status above the editor, and «✓ Ready · mode» on the mode row with the shortcuts on the right", () => {
  const fake = fakeClock();
  const { composer } = composerWith(fake.clock);
  composer.setWorkModeHint(MODE);
  const rows = composer.render(100);
  const lines = plain(rows);
  expect(lines).toHaveLength(6);
  for (const index of [0, 1, 2, 3, 5]) expect(lines[index]!.trim()).toBe("");
  expect(lines[4]!.trim()).toStartWith("✓ Ready · Ⅱ Default");
  expect(lines[4]!.trimEnd()).toEndWith("Shift+Tab to cycle");
  expect(lines.join("\n")).not.toContain("●");
  // «✓ Ready» in success, the separator in faint, and the mode text as it was before.
  expect(statusRow(rows)).toContain(painted("107;238;201", "✓ Ready"));
  expect(statusRow(rows)).toContain(painted("63;63;70", " · "));
});

/** La misma forma en español, con el texto de hoy de «Listo»: los textos no cambian, solo el lugar. */
test("in Spanish the mode row starts with «✓ Listo · » and the same mode text", () => {
  const fake = fakeClock();
  const { composer } = composerWith(fake.clock, "es");
  composer.setWorkModeHint(MODE);
  const lines = plain(composer.render(100));
  expect(lines).toHaveLength(6);
  expect(lines[4]!.trim()).toStartWith("✓ Listo · Ⅱ Default");
});

/**
 * A un ancho que no alcanza se pierde primero lo que menos dice: los atajos; luego la parte del medio del estado (el comando que corre), y nunca el tiempo, que es lo que
 * muestra que no se congeló; solo al final se recorta. Sin esto, un cuadro angosto escondería el tiempo o saldría de la pantalla.
 */
test("on a narrow screen the shortcuts go first, then the middle of the status — never the time — and only then is the row clipped", () => {
  const fake = fakeClock();
  const { composer } = composerWith(fake.clock);
  composer.setWorkModeHint(MODE);
  composer.setStatus("Working · reading hola.sh · 12s");
  const at = (width: number) => plain(composer.render(width)).map(row => row.trim()).filter(Boolean)[0]!;
  expect(at(120)).toContain("Shift+Tab");
  expect(at(120)).toContain("reading hola.sh · 12s");
  expect(at(68)).not.toContain("Shift+Tab");
  expect(at(68)).toBe("⠋ Working · reading hola.sh · 12s · Ⅱ Default");
  expect(at(48)).toBe("⠋ Working · 12s · Ⅱ Default");
  const clipped = plain(composer.render(28)).find(row => row.includes("Working"))!;
  expect(clipped.trim()).toStartWith("⠋ Working");
  for (const width of [12, 20, 28, 48, 68, 120]) for (const row of composer.render(width)) expect(visibleWidth(row)).toBeLessThanOrEqual(width);
});

/**
 * Trabajando: el giro braille de siempre en warning, la primera palabra con la franja de luz y el resto («· leyendo hola.sh · 12 s») en muted. El giro sale del reloj
 * inyectado (cuadro = hora / 120 ms), no de la hora real, para fijar el cuadro exacto.
 */
test("working draws the spinner in warning and the rest of the status in muted", () => {
  const fake = fakeClock(800);
  const { composer } = composerWith(fake.clock);
  composer.setStatus("Working · reading hola.sh · 12s");
  const row = statusRow(composer.render(100));
  expect(SPINNER_FRAMES[Math.floor(800 / 120) % SPINNER_FRAMES.length]).toBe("⠦");
  expect(row).toContain(painted("237;183;88", "⠦"));
  expect(row).toContain(painted("161;161;170", " · reading hola.sh · 12s"));
  fake.set(0);
  expect(statusRow(composer.render(100))).toContain(painted("237;183;88", SPINNER_FRAMES[0]!));
});

/**
 * La franja de luz: cada letra de la palabra mezcla entre un tono apagado (148;119;68) y uno brillante (247;223;180) según su distancia a una posición que avanza 7,5 letras
 * por segundo; a 0,8 s está sobre la «k» (letra 3), que queda brillante exacta, y las letras a 3 o más de distancia («W» y «g») quedan apagadas exactas. Es lo que distingue
 * «trabajando» de un texto fijo; si la palabra fuera de un solo color esta prueba falla.
 */
test("working: the letter under the light band is exactly bright and a far letter exactly dim", () => {
  const fake = fakeClock(800);
  const { composer } = composerWith(fake.clock);
  composer.setStatus("Working · reading hola.sh · 12s");
  const row = statusRow(composer.render(100));
  expect(row).toContain(painted("247;223;180", "k"));
  expect(row).toContain(painted("148;119;68", "W"));
  expect(row).toContain(painted("148;119;68", "g"));
  // One letter away the mix is two thirds of the way to bright: 148→214, 119→188, 68→143.
  expect(row).toContain(painted("214;188;143", "r"));
  expect(row).toContain(painted("214;188;143", "i"));
  // The band moves on: at 1 s it is at letter 4.5, so the «k» is no longer fully bright.
  fake.set(1000);
  expect(statusRow(composer.render(100))).not.toContain(painted("247;223;180", "k"));
});

/** La franja recorre de 3 letras antes del inicio a 3 después del final y vuelve a empezar: con «Working» (7 letras) el ciclo dura 13 letras, o 13 / 7,5 s. */
test("the light band starts again after crossing the word", () => {
  const fake = fakeClock(0);
  const { composer } = composerWith(fake.clock);
  composer.setStatus("Working");
  const cycle = 13 / 7.5 * 1000;
  const withoutSpinner = (row: string) => row.replace(painted("237;183;88", SPINNER_FRAMES[Math.floor(fake.now() / 120) % SPINNER_FRAMES.length]!), "");
  const first = withoutSpinner(statusRow(composer.render(100)));
  fake.set(cycle);
  expect(withoutSpinner(statusRow(composer.render(100)))).toBe(first);
  fake.set(cycle + 800);
  expect(statusRow(composer.render(100))).toContain(painted("247;223;180", "k"));
});

/**
 * Esperando tu respuesta: el texto fijo en danger y el «●» que late entre danger y danger mezclado hacia la superficie, una vuelta cada 1,6 s. En t=0 es danger exacto y a
 * 0,4 s es otro color exacto; sin el latido los dos instantes darían el mismo color.
 */
test("waiting for the answer: the text is danger and the dot pulses between two exact colors", () => {
  const fake = fakeClock(0);
  const { composer } = composerWith(fake.clock);
  void composer.choose("Resume", [{ value: "a", label: "first" }]);
  const at = (ms: number) => { fake.set(ms); return statusRow(composer.render(100)); };
  expect(at(0)).toContain(painted("255;102;136", "●"));
  expect(at(400)).toContain(painted("197;83;109", "●"));
  expect(at(800)).toContain(painted("140;63;82", "●"));
  expect(at(1600)).toContain(painted("255;102;136", "●"));
  expect(at(400)).toContain(painted("255;102;136", "Waiting for your answer"));
  expect(plain([at(0)])[0]!.trim()).toStartWith("● Waiting for your answer");
});

/** Los demás estados (Verificando cuenta, Conecta con /login) llevan «●» fijo y el color que ya tenían, sin animarse. */
test("other statuses keep a fixed dot in the color they already had", () => {
  const fake = fakeClock(0);
  const { composer } = composerWith(fake.clock);
  const connect = getCatalog("en").chat.statusConnectWithLogin({ command: "/login" });
  composer.setStatus(connect);
  const first = statusRow(composer.render(100));
  fake.set(400);
  expect(statusRow(composer.render(100))).toBe(first);
  expect(first).toContain(painted("237;183;88", `● ${connect}`));
  composer.setStatus(getCatalog("en").claudeChat.statusCheckingAccount);
  expect(statusRow(composer.render(100))).toContain(painted("161;161;170", `● ${getCatalog("en").claudeChat.statusCheckingAccount}`));
  expect(fake.active).toBe(0);
});

/**
 * Destello: al pasar de trabajando a Listo, «✓ Listo» arranca mezclado 60 % hacia blanco (196;248;233) y vuelve a success (107;238;201) en 0,6 s. Un Listo que no viene de
 * trabajar (el de al abrir) no destella.
 */
test("the flash: right after Working turns into Ready the text is 60 % toward white and after 0.6 s it is success again", () => {
  const fake = fakeClock(5000);
  const { composer } = composerWith(fake.clock);
  expect(statusRow(composer.render(100))).toContain(painted("107;238;201", "✓ Ready")); // the opening Ready does not flash
  composer.setStatus("Working · 3s");
  composer.setStatus("Ready");
  expect(statusRow(composer.render(100))).toContain(painted("196;248;233", "✓ Ready"));
  fake.set(5300);
  expect(statusRow(composer.render(100))).toContain(painted("151;243;217", "✓ Ready")); // halfway: 30 % toward white
  fake.set(5600);
  expect(statusRow(composer.render(100))).toContain(painted("107;238;201", "✓ Ready"));
  composer.setStatus("Ready"); // the same status set again by the refresh does not start another flash
  expect(statusRow(composer.render(100))).toContain(painted("107;238;201", "✓ Ready"));
});

/**
 * Repintado: mientras haya algo animado (trabajando, esperando o el destello) la pantalla se repinta cada 100 ms, y cuando no hay nada animado no queda ningún
 * temporizador corriendo. Sin esto una terminal en reposo gastaría CPU, o una animación se quedaría quieta.
 */
test("repaints every 100 ms only while something animates, and no timer is left when nothing does", () => {
  const fake = fakeClock(0);
  const { composer, renders } = composerWith(fake.clock);
  composer.render(100);
  expect(fake.active).toBe(0); // Ready at rest: nothing animates

  composer.setStatus("Working · 1s");
  composer.render(100);
  expect(fake.intervals).toEqual([100]);
  composer.render(100);
  expect(fake.active).toBe(1); // drawing again does not start a second timer
  const before = renders();
  fake.fire();
  expect(renders()).toBe(before + 1);

  fake.set(1000);
  composer.setStatus("Ready");
  composer.render(100);
  fake.fire();
  expect(fake.active).toBe(1); // the flash still animates
  fake.set(1600);
  fake.fire();
  expect(fake.active).toBe(0); // the flash is over: the timer stops itself
  const idle = renders();
  fake.fire();
  expect(renders()).toBe(idle);

  const chosen = composer.choose("Resume", [{ value: "a", label: "first" }]);
  composer.render(100);
  expect(fake.active).toBe(1); // waiting for an answer animates the dot
  composer.cancelChoice();
  composer.render(100);
  fake.fire();
  expect(fake.active).toBe(0);
  void chosen;
});
