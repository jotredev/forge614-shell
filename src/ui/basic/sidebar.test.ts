import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { ShellState } from "./shell-state.ts";
import { ShellSidebar } from "./sidebar.ts";
import { REASONING_DEFAULT_LABEL } from "./metrics.ts";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { ShellSnapshot } from "./shell-state.ts";

test("the default-reasoning fallback text fits the sidebar's narrow column without getting cut off", () => {
  const state = new ShellState("Claude Code");
  state.connect({ model: "Opus 5 with 1M context" }); // no reasoning reported — the fallback path
  const output = stripVTControlCharacters(new ShellSidebar(() => state.snapshot()).render(36).join("\n"));
  expect(output).toContain(REASONING_DEFAULT_LABEL);
  expect(output).not.toContain("…");
});

test("token/cost figures sit right under plan usage, not down by RAM, and are explained in plain words without getting cut off", () => {
  const state = new ShellState("Claude Code");
  state.connect({ inputTokens: 2996, outputTokens: 700, estimateUSD: 0.6723, resources: { shellRssBytes: 1_000_000 } });
  const output = stripVTControlCharacters(new ShellSidebar(() => state.snapshot()).render(36).join("\n"));

  expect(output).not.toContain("…");
  expect(output).toContain("This message");
  expect(output).toContain("read 2,996 tokens");
  expect(output).toContain("wrote 700");
  expect(output).toContain("If you paid per use");
  expect(output).toContain("≈ $0.67");
  expect(output).toContain("your plan doesn't bill it");
  const planUsageAt = output.indexOf("PLAN USAGE");
  const resourcesAt = output.indexOf("RESOURCES");
  const tokensAt = output.indexOf("read 2,996 tokens");
  expect(planUsageAt).toBeGreaterThan(-1); expect(resourcesAt).toBeGreaterThan(-1);
  expect(tokensAt).toBeGreaterThan(planUsageAt);
  expect(tokensAt).toBeLessThan(resourcesAt);
});

test("usage refresh remains callable without rendering a sidebar button", async () => {
  const state = new ShellState("Codex"); state.connect();
  const sidebar = new ShellSidebar(() => state.snapshot());
  let calls = 0; let release!: () => void;
  sidebar.setRefreshAction(() => { calls++; return new Promise<void>(resolve => { release = resolve; }); }, () => {});
  const pending = sidebar.refreshUsage();
  await sidebar.refreshUsage();
  expect(calls).toBe(1);
  expect(sidebar.render(40).join("\n")).not.toContain("Refresh");
  release(); await pending;
  expect(sidebar.render(40).join("\n")).not.toContain("Usage updated");
  expect(sidebar.render(40).join("\n")).not.toContain("/refresh");
});

test("connected sidebar keeps unknown telemetry explicit and shows real session identity", () => {
  const state = new ShellState("Claude Code");
  state.connect({ user: "test@example.com", sessionId: "native-session" });
  const output = stripVTControlCharacters(new ShellSidebar(() => state.snapshot()).render(45).join("\n"));
  expect(output).toContain("test@example.com"); expect(output).toContain("native-session");
  expect(output).toContain("Shell uptime"); expect(output).toContain("CONTEXT");
  expect(output).toContain("USAGE"); expect(output).toContain("after the next message");
  expect(output).not.toContain("0%");
});

test("connected sidebar groups only session, context and provider usage", () => {
  const state = new ShellState("Claude Code");
  state.connect({ model: "claude-opus", reasoning: "medium", context: { used: 18_000, window: 128_000 }, usage: [{ label: "Weekly", usedPercent: 74, reset: "22h" }] });

  const output = stripVTControlCharacters(new ShellSidebar(() => state.snapshot()).render(38).join("\n"));

  expect(output).toContain("SESSION");
  expect(output).toContain("Account  Connected");
  expect(output).toContain("CONTEXT");
  expect(output).toContain("18k / 128k tokens");
  expect(output).toContain("14% used");
  expect(output).toContain("USAGE");
  expect(output).toContain("Weekly · 74% used");
  expect(output).toContain("Resets in 22h");
  expect(output).toContain("████");
  expect(output).toContain("Not reported\n\nModel");
  expect(output).toContain("medium\n\nSession");
  expect(output).not.toContain("WORK");
  expect(output).not.toContain("QUICK COMMANDS");
});

test("sidebar never renders the provider-internal Nimbus Quill bucket", () => {
  const state = new ShellState("Claude Code");
  state.connect({ usage: [{ label: "nimbus_quill", usedPercent: 0 }, { label: "five_hour", usedPercent: 2 }] });

  const output = stripVTControlCharacters(new ShellSidebar(() => state.snapshot()).render(45).join("\n"));

  expect(output).not.toContain("Nimbus Quill");
  expect(output).toContain("5-hour limit · 2% used");
});

test("disconnected sidebar hides all stale engine and work details", () => {
  const state = new ShellState("Codex");
  state.connect({ model: "gpt-5.6", reasoning: "medium", context: { used: 18_000, window: 128_000 } });
  state.disconnect();

  const output = stripVTControlCharacters(new ShellSidebar(() => state.snapshot()).render(38).join("\n"));

  expect(output).toContain("Account  Disconnected");
  expect(output).toContain("/login to connect an account");
  expect(output).not.toContain("Model");
  expect(output).not.toContain("CONTEXT");
  expect(output).not.toContain("COMPLETED");
});

test("sidebar shows per-window Shell RAM without repeating project identity", () => {
  const state = new ShellState("Codex");
  state.connect({ resources: { shellRssBytes: 48 * 1024 * 1024 } });
  const output = stripVTControlCharacters(new ShellSidebar(
    () => state.snapshot(),
    "/Users/forge/Desktop/project",
    "/Users/forge",
  ).render(45).join("\n"));

  expect(output).toContain("RESOURCES");
  expect(output).toContain("Shell RAM  48 MB");
  expect(output).toContain("Engine RAM  Not reported by engine");
  expect(output).not.toContain("PROJECT");
  expect(output).not.toContain("Directory");
});

test("sidebar leaves project status to the footer", async () => {
  const state = new ShellState("Codex"); state.connect();
  const sidebar = new ShellSidebar(() => state.snapshot(), "/project");
  await sidebar.refreshProject();
  const output = stripVTControlCharacters(sidebar.render(45).join("\n"));
  expect(output).not.toContain("PROJECT");
  expect(output).not.toContain("Directory");
});

test("sidebar lists running and finished background activity with elapsed time", () => {
  const now = Date.now();
  const sidebar = new ShellSidebar(() => ({
    account: "connected", provider: "Claude",
    backgroundActivitySupported: true,
    backgroundActivity: [
      { id: "t1", kind: "agent", label: "Investigar X", state: "running", startedAt: now - 12_000 },
      { id: "t2", kind: "process", label: "build.sh", state: "failed", startedAt: now - 90_000, endedAt: now - 30_000, detail: "exit 1" },
    ],
  }));
  const lines = sidebar.render(60).join("\n");
  expect(lines).toContain("Investigar X");
  expect(lines).toContain("build.sh");
});

test("sidebar tells the person plainly when the engine doesn't report background activity", () => {
  const sidebar = new ShellSidebar(() => ({ account: "connected", provider: "Codex", backgroundActivitySupported: false }));
  const lines = sidebar.render(60).join("\n");
  expect(lines).toContain("This engine doesn't report background activity.");
});

test("clicking a background activity row expands it to show the engine's own result", () => {
  const now = Date.now();
  const sidebar = new ShellSidebar(() => ({
    account: "connected", provider: "Claude",
    backgroundActivitySupported: true,
    backgroundActivity: [{ id: "t1", kind: "agent", label: "Investigar X", state: "done", startedAt: now - 5000, endedAt: now, detail: "Encontré 3 archivos" }],
  }));
  sidebar.render(60);
  const rowIndex = sidebar.render(60).findIndex(line => line.includes("Investigar X"));
  sidebar.handleMouse({ type: "click", button: "left", x: 0, y: rowIndex, width: 60, height: 1 } as any);
  const expanded = sidebar.render(60).join("\n");
  expect(expanded).toContain("Encontré 3 archivos");
});

test("clicking the visible title row of an expanded activity card collapses it again", () => {
  // ActivityCard always shows a one-line preview of the detail's first line even when
  // collapsed, so a second detail line is used here as the signal that only appears in the
  // full expanded body — a reliable way to distinguish expanded from collapsed rendering.
  const now = Date.now();
  const sidebar = new ShellSidebar(() => ({
    account: "connected", provider: "Claude",
    backgroundActivitySupported: true,
    backgroundActivity: [{
      id: "t1", kind: "agent", label: "Investigar X", state: "done", startedAt: now - 5000, endedAt: now,
      detail: "Encontré 3 archivos\nRuta: /src/foo.ts",
    }],
  }));

  // First click: expand. Must land on the collapsed card's title row.
  const collapsedRow = sidebar.render(60).findIndex(line => line.includes("Investigar X"));
  sidebar.handleMouse({ type: "click", button: "left", x: 0, y: collapsedRow, width: 60, height: 1 } as any);
  const expandedLines = sidebar.render(60);
  expect(expandedLines.join("\n")).toContain("Ruta: /src/foo.ts");

  // Second click: on the row that actually shows the title text once expanded (one row below
  // the blank padding row that used to be mis-registered) — this must collapse the card back.
  const expandedTitleRow = expandedLines.findIndex(line => line.includes("Investigar X"));
  sidebar.handleMouse({ type: "click", button: "left", x: 0, y: expandedTitleRow, width: 60, height: 1 } as any);
  const collapsed = sidebar.render(60).join("\n");
  expect(collapsed).not.toContain("Ruta: /src/foo.ts");
  expect(collapsed).toContain("Investigar X");
});

test("an activity's detail is truncated to 2000 characters, matching claude.ts's tool-argument cap", () => {
  const now = Date.now();
  const longDetail = "a".repeat(2000) + "OVERFLOW MARKER";
  const sidebar = new ShellSidebar(() => ({
    account: "connected", provider: "Claude",
    backgroundActivitySupported: true,
    backgroundActivity: [{
      id: "t1", kind: "agent", label: "Investigar X", state: "done", startedAt: now - 5000, endedAt: now,
      detail: longDetail,
    }],
  }));

  const collapsedRow = sidebar.render(60).findIndex(line => line.includes("Investigar X"));
  sidebar.handleMouse({ type: "click", button: "left", x: 0, y: collapsedRow, width: 60, height: 1 } as any);
  const expanded = sidebar.render(60).join("\n");
  expect(expanded).not.toContain("OVERFLOW MARKER");
  expect(expanded).toContain("a".repeat(20));
});

/** Rows of the CONTEXT and PLAN USAGE sections only: they are the sidebar's explanatory text, the part that used to be cut off with "…". Data values (session id, email, model) are the person's own and may legitimately be long, so they stay out of this slice. */
function explanatorySections(lines: string[]): string[] {
  const plain = lines.map(stripVTControlCharacters);
  const start = plain.findIndex(line => /CONTEXT/.test(line));
  const end = plain.findIndex(line => /RESOURCES|RECURSOS/.test(line));
  return plain.slice(start, end === -1 ? undefined : end);
}

const snapshotStates: Record<string, () => ShellSnapshot> = {
  "new session, nothing measured": () => ({ account: "connected", provider: "Claude Code" }),
  "resumed session, nothing measured": () => ({ account: "connected", provider: "Claude Code", sessionId: "resumed-1" }),
  "with measured data": () => ({
    account: "connected", provider: "Claude Code", sessionId: "s-1",
    context: { used: 170_600, window: 1_000_000 },
    usage: [{ label: "seven_day", usedPercent: 74, reset: "22h" }],
    inputTokens: 2996, outputTokens: 700, estimateUSD: 0.6723,
  }),
};

/** Guards the owner's complaint that «Disponible después de la prime…» and the cost note were cut off: at every width the sidebar can really have (32–42 columns of pane minus 5 of chrome), in both languages, with and without data, no context or plan-usage row overflows or ends in "…". */
test("context and plan-usage rows never overflow or end in an ellipsis at any real sidebar width, in both languages, with and without data", () => {
  for (const locale of ["en", "es"] as const) {
    for (const [name, make] of Object.entries(snapshotStates)) {
      for (let width = 27; width <= 37; width++) {
        const rows = explanatorySections(new ShellSidebar(make, undefined, undefined, locale).render(width));
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
          expect({ locale, name, width, row, fits: visibleWidth(row) <= width }).toEqual({ locale, name, width, row, fits: true });
          expect({ locale, name, width, row, ellipsis: row.includes("…") }).toEqual({ locale, name, width, row, ellipsis: false });
        }
      }
    }
  }
});

/** The owner asked for a short reason instead of «Medición no disponible» when there is no context figure yet: a new conversation says when it will appear; a resumed one without a measurement says the same in its own words. */
test("without a context figure the sidebar says when it will appear, differently for a new and a resumed session", () => {
  const text = (locale: "en" | "es", name: string) => explanatorySections(new ShellSidebar(snapshotStates[name]!, undefined, undefined, locale).render(36)).join("\n");
  expect(text("es", "new session, nothing measured")).toContain("tras el 1.er mensaje");
  expect(text("en", "new session, nothing measured")).toContain("after 1st message");
  expect(text("es", "resumed session, nothing measured")).toContain("tras el próximo mensaje");
  expect(text("en", "resumed session, nothing measured")).toContain("after the next message");
  expect(text("es", "new session, nothing measured")).not.toContain("Medición no disponible");
});

/** Plan usage explains the last message and the pay-per-use estimate in everyday words, split over short rows, with each language's own number and currency format (2 996 / $0,67 in Spanish, 2,996 / $0.67 in English). */
test("last-message tokens and the pay-per-use estimate read as plain sentences in Spanish and English", () => {
  const es = explanatorySections(new ShellSidebar(snapshotStates["with measured data"]!, undefined, undefined, "es").render(36)).join("\n");
  expect(es).toContain("Este mensaje\nleyó 2 996 tokens\nescribió 700");
  expect(es).toContain("Si pagaras por uso\n≈ $0,67\ntu plan no lo cobra");
  const en = explanatorySections(new ShellSidebar(snapshotStates["with measured data"]!, undefined, undefined, "en").render(36)).join("\n");
  expect(en).toContain("This message\nread 2,996 tokens\nwrote 700");
  expect(en).toContain("If you paid per use\n≈ $0.67\nyour plan doesn't bill it");
});

/** A cost under one cent must not read as a false «$0.00»: it says it is under a cent instead. */
test("a tiny estimated cost says it is under one cent instead of showing zero", () => {
  const snapshot = () => ({ account: "connected" as const, provider: "Claude Code", estimateUSD: 0.002 });
  expect(explanatorySections(new ShellSidebar(snapshot, undefined, undefined, "en").render(36)).join("\n")).toContain("under $0.01");
  expect(explanatorySections(new ShellSidebar(snapshot, undefined, undefined, "es").render(36)).join("\n")).toContain("menos de $0,01");
});

/** Drag-selecting inside the chat used to highlight the sidebar too, because the sidebar let press/drag/release fall through to the screen-level selection. Like the composer, it now consumes those three left-button gestures. */
test("the sidebar consumes press, drag and release of the left button so a chat selection cannot spill into it", () => {
  const sidebar = new ShellSidebar(() => ({ account: "connected", provider: "Claude Code" }));
  sidebar.render(36);
  for (const type of ["press", "drag", "release"] as const) {
    expect(sidebar.handleMouse({ type, button: "left", x: 4, y: 3, width: 36, height: 30 } as any)).toMatchObject({ handled: true });
  }
});

/** The mouse patch must stay narrow: a click on a background-activity row still expands it, and the sidebar's own background rows keep their bullet at column 0 (the chat-only indent must not leak into this narrow column). */
test("background-activity rows keep their bullet at the left edge of the sidebar", () => {
  const sidebar = new ShellSidebar(() => ({
    account: "connected", provider: "Claude",
    backgroundActivitySupported: true,
    backgroundActivity: [{ id: "t1", kind: "agent", label: "Investigar X", state: "running", startedAt: Date.now() - 5000 }],
  }));
  const row = sidebar.render(36).map(stripVTControlCharacters).find(line => line.includes("Investigar X"));
  expect(row).toStartWith("• Investigar X");
});

/** Mejora 14: cada tarea de fondo ocupa UN renglón con título, estado y tiempo legible; ya no repite el título en una segunda línea `└` cuando el detalle (la descripción del motor) dice lo mismo. El detalle sigue viéndose al hacer clic. */
test("a background task is one row with its state and readable time, without repeating its title", () => {
  const title = "Apply the patch and run verification";
  const sidebar = new ShellSidebar(() => ({
    account: "connected", provider: "Claude",
    backgroundActivitySupported: true,
    backgroundActivity: [{ id: "t1", kind: "process", label: title, state: "running", startedAt: Date.now() - 503_000, detail: `${title}\nsecond line` }],
  }));
  const rows = sidebar.render(60).map(stripVTControlCharacters);
  const at = rows.findIndex(row => row.includes(title));
  expect(rows[at]!.trimEnd()).toBe(`• ${title} · running · 8m 23s`);
  expect(rows.filter(row => row.includes(title))).toHaveLength(1);
  expect(rows.some(row => row.includes("└"))).toBe(false);
});

/** En la columna angosta el título largo se recorta con «…» para que el estado y el tiempo (lo que importa a la vista) sigan visibles en el mismo renglón; nunca salta a dos renglones. */
test("in a narrow sidebar the title is cut, not the state or the time", () => {
  const sidebar = new ShellSidebar(() => ({
    account: "connected", provider: "Claude",
    backgroundActivitySupported: true,
    backgroundActivity: [{ id: "t1", kind: "agent", label: "Apply the patch and run the whole verification suite", state: "done", startedAt: Date.now() - 3_720_000, endedAt: Date.now() }],
  }));
  const rows = sidebar.render(34).map(stripVTControlCharacters);
  const row = rows.find(line => line.startsWith("• Apply"))!;
  expect(row.trimEnd()).toMatch(/… · done · 1h 02m$/);
  expect(visibleWidth(row)).toBeLessThanOrEqual(34);
  expect(rows.filter(line => line.includes("verification"))).toHaveLength(0);
});
