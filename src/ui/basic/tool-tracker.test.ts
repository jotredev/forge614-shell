import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { ToolTracker } from "./tool-tracker.ts";
import { ActivityCard } from "./transcript.ts";
import { getCatalog } from "../../i18n/index.ts";

const tc = getCatalog("en").claudeChat;
const render = (card: ActivityCard) => stripVTControlCharacters(card.render(100).join("\n"));

/** Caso del owner (mejora 12): un comando largo emite un aviso de avance cada ~30 s con un id que Shell nunca vio como herramienta pedida. Antes cada aviso escribía una tarjeta nueva; ahora todos actualizan la misma y el tiempo corre ahí. */
test("several progress notices for the same unknown tool id leave one card with the latest time", () => {
  const cards: ActivityCard[] = [];
  const tracker = new ToolTracker(card => cards.push(card), tc);
  for (const seconds of [30, 60, 90, 450]) tracker.progress("call_1", "Bash", seconds);
  expect(cards).toHaveLength(1);
  const text = render(cards[0]!);
  expect(text).toContain("Bash");
  expect(text).toContain("Running · 7m 30s");
  expect(text).not.toContain("450s");
});

/** El renglón único también debe cerrarse: al llegar el resultado, la misma tarjeta queda fija con su resultado y su tiempo legible, sin abrir otra. */
test("the result of a tool first seen through progress settles that same card", () => {
  const cards: ActivityCard[] = [];
  const tracker = new ToolTracker(card => cards.push(card), tc);
  tracker.progress("call_1", "Bash", 30);
  tracker.finished("call_1", false, "all checks passed");
  expect(cards).toHaveLength(1);
  const text = render(cards[0]!);
  expect(text).toContain("Completed ·");
  expect(text).toContain("all checks passed");
  expect(text).not.toContain("Running");
});

/** Un aviso de avance de una herramienta ya pedida actualiza su tarjeta (no crea otra), y el aviso posterior de «pedida» del mismo id no duplica la tarjeta creada por el avance. */
test("progress updates a requested tool's card and a late request for the same id adds nothing", () => {
  const cards: ActivityCard[] = [];
  const tracker = new ToolTracker(card => cards.push(card), tc);
  const requested = new ActivityCard("Bash", tc.toolRequested, "{}");
  expect(tracker.request("call_1", requested, { isEdit: false, activity: "Waiting for the PR checks" })).toBe(true);
  tracker.progress("call_1", "Bash", 87);
  expect(render(requested)).toContain("Running · 1m 27s");
  tracker.progress("call_2", "Read", 5);
  expect(tracker.request("call_2", new ActivityCard("Read", tc.toolRequested), { isEdit: false })).toBe(false);
  expect(cards).toHaveLength(1);
});

/** Lo que Shell dice junto a «Trabajando»: la descripción de la herramienta en curso (la más reciente sin resultado) y nada cuando ya no hay ninguna. Sin descripción, cae al título de la herramienta. */
test("currentActivity is the newest unfinished tool's description, falling back to its title", () => {
  const tracker = new ToolTracker(() => {}, tc);
  expect(tracker.currentActivity()).toBeUndefined();
  tracker.request("a", new ActivityCard("Bash", ""), { isEdit: false, activity: "Waiting for the PR checks" });
  tracker.request("b", new ActivityCard("Read · file.ts", ""), { isEdit: false, title: "Read · file.ts" });
  expect(tracker.currentActivity()).toBe("Read · file.ts");
  tracker.finished("b", false, "ok");
  expect(tracker.currentActivity()).toBe("Waiting for the PR checks");
  tracker.finished("a", true, "boom");
  expect(tracker.currentActivity()).toBeUndefined();
});
