import { afterAll, beforeAll, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { Container, resetCapabilitiesCache, setCapabilityOverrides } from "@earendil-works/pi-tui";
import type { Component, Terminal } from "@earendil-works/pi-tui";
import { renderLayoutFrame } from "../../../node_modules/@earendil-works/pi-tui/dist/layout.js";
import { ChatLinks } from "./chat-links.ts";
import { AssistantMessage } from "./chat-message.ts";
import { IndependentScrollView, chatScreen, workspaceLayout } from "./workspace.ts";
import { SidebarLayout } from "./sidebar-layout.ts";
import { ShellSidebar } from "./sidebar.ts";

beforeAll(() => setCapabilityOverrides({ trueColor: true, hyperlinks: true }));
afterAll(() => resetCapabilitiesCache());

const tick = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms));
const CODE = "echo hola\nls -la";

class TestTerminal implements Terminal {
  kittyProtocolActive = false;
  output = "";
  input: (data: string) => void = () => {};
  constructor(public columns: number, public rows: number) {}
  start(input: (data: string) => void) { this.input = input; }
  stop() {}
  async drainInput() {}
  write(data: string) { this.output += data; }
  moveBy() {}
  hideCursor() {}
  showCursor() {}
  clearLine() {}
  clearFromCursor() {}
  clearScreen() {}
  setTitle() {}
  setProgress() {}
}

const composer: Component = {
  invalidate() {},
  handleMouse: event => event.button === "left" && ["press", "drag", "release"].includes(event.type) ? { handled: true } : undefined,
  render: width => ["Write", "", ""].map(line => line.padEnd(width)),
};
const footer: Component = { invalidate() {}, render: width => [" ".repeat(width), " ".repeat(width)] };

function setup(options: { filler?: number; columns?: number; rows?: number; hidden?: boolean; copy?: (text: string, copies: string[]) => Promise<boolean> } = {}) {
  const terminal = new TestTerminal(options.columns ?? 120, options.rows ?? 30);
  const copies: string[] = [];
  const failures: string[] = [];
  const copySelection = async (text: string) => { copies.push(text); return options.copy ? options.copy(text, copies) : true; };
  const links = new ChatLinks({ cwd: process.cwd(), home: process.cwd(), tools: { openWeb: async () => true, openPath: async () => true }, onFailure: () => {}, nonce: "test" });
  const { surface, tui, copy } = chatScreen(terminal, links, undefined, { copySelection, locale: "es" });
  const layout = new SidebarLayout({ terminal: surface, hidden: options.hidden });
  const transcript = new Container();
  const scroll = new IndependentScrollView(transcript, { follow: "end", primary: true, scrollbar: "hidden" });
  const root = workspaceLayout(scroll, composer, new ShellSidebar(() => ({ account: "connected", provider: "Claude Code" })), footer, surface, layout);
  tui.setLayoutRoot(root);
  tui.start();
  const message = new AssistantMessage({ agent: "Claude", locale: "es", at: null, links, copy, onChange: () => tui.requestRender(), onCopyFailed: () => failures.push("falló") });
  const body = (extra = "") => `Intro\n\n\`\`\`bash\n${CODE}\n\`\`\`\n\n${Array.from({ length: options.filler ?? 0 }, (_, index) => `línea ${index}`).join("\n\n")}${extra}`;
  message.setText(body());
  message.complete();
  transcript.addChild(message);
  tui.requestRender();
  const plain = () => renderLayoutFrame(root, terminal.columns, terminal.rows, () => {}).lines.map(stripVTControlCharacters);
  const button = () => {
    const lines = plain();
    const y = lines.findIndex(line => line.includes("Copiar"));
    if (y < 0) throw new Error(`No se encontró Copiar:\n${lines.join("\n")}`);
    return { x: lines[y]!.indexOf("Copiar") + 1, y };
  };
  const send = async (type: "press" | "release" | "drag", x: number, y: number, ms = 25) => {
    const buttonCode = { press: 0, release: 0, drag: 32 }[type];
    terminal.input(`\x1b[<${buttonCode};${x + 1};${y + 1}${type === "release" ? "m" : "M"}`);
    await tick(ms);
  };
  return { terminal, tui, scroll, message, copies, failures, body, plain, button, send, stop: () => tui.stop({ preserveScreen: true }) };
}

async function click(screen: ReturnType<typeof setup>, deltaX = 0) {
  const at = screen.button();
  await screen.send("press", at.x, at.y);
  if (deltaX) await screen.send("drag", at.x + deltaX, at.y);
  await screen.send("release", at.x + deltaX, at.y);
}

test("el clic normal del botón copia exactamente el código", async () => {
  const screen = setup();
  try {
    await tick();
    await click(screen);
    expect(screen.copies).toEqual([CODE]);
    expect(screen.failures).toEqual([]);
    expect(screen.plain().join("\n")).toContain("Copiado");
  } finally { screen.stop(); }
});

test("un temblor de una celda después de apretar no copia texto seleccionado", async () => {
  const screen = setup();
  try {
    await tick();
    await click(screen, 1);
    expect(screen.copies).toEqual([CODE]);
    expect(screen.failures).toEqual([]);
  } finally { screen.stop(); }
});

test("arrastrar una celda desde el botón no inicia selección de texto", async () => {
  const screen = setup();
  try {
    await tick();
    const at = screen.button();
    await screen.send("press", at.x, at.y);
    await screen.send("drag", at.x + 1, at.y);
    await screen.send("release", at.x + 1, at.y);
    expect(screen.copies).toEqual([CODE]);
    expect(screen.failures).toEqual([]);
  } finally { screen.stop(); }
});

test("un doble clic rápido copia solo el bloque en ambos apretones", async () => {
  const screen = setup();
  try {
    await tick();
    const at = screen.button();
    for (let index = 0; index < 2; index++) {
      await screen.send("press", at.x, at.y, 10);
      await screen.send("release", at.x, at.y, 10);
    }
    expect(screen.copies).toEqual([CODE, CODE]);
    expect(screen.failures).toEqual([]);
  } finally { screen.stop(); }
});

test("el código copiado se fija al apretar aunque el mensaje crezca antes de soltar", async () => {
  const screen = setup();
  try {
    await tick();
    const at = screen.button();
    await screen.send("press", at.x, at.y);
    screen.message.setText(screen.body("línea nueva"));
    screen.tui.requestRender();
    await tick();
    await screen.send("release", at.x, at.y);
    expect(screen.copies).toEqual([CODE]);
    expect(screen.failures).toEqual([]);
  } finally { screen.stop(); }
});

test("el scroll del chat entre apretar y soltar no convierte el gesto en selección", async () => {
  const screen = setup({ filler: 60 });
  try {
    await tick();
    screen.scroll.scrollTo(0);
    screen.tui.requestRender();
    await tick(80);
    const at = screen.button();
    await screen.send("press", at.x, at.y);
    screen.scroll.scrollBy(1);
    screen.tui.requestRender();
    await tick();
    await screen.send("release", at.x, at.y);
    expect(screen.copies).toEqual([CODE]);
    expect(screen.failures).toEqual([]);
  } finally { screen.stop(); }
});

test("un reintento rápido tras un fallo vuelve a intentar solo el código", async () => {
  const screen = setup({ copy: async (_text, copies) => copies.length > 1 });
  try {
    await tick();
    const at = screen.button();
    for (let index = 0; index < 2; index++) {
      await screen.send("press", at.x, at.y, 10);
      await screen.send("release", at.x, at.y, 10);
    }
    expect(screen.copies).toEqual([CODE, CODE]);
    expect(screen.failures).toEqual(["falló"]);
    expect(screen.plain().join("\n")).toContain("Copiado");
  } finally { screen.stop(); }
});

test("el botón copia el mismo bloque con la barra lateral oculta", async () => {
  const screen = setup({ hidden: true });
  try {
    await tick();
    await click(screen);
    expect(screen.copies).toEqual([CODE]);
    expect(screen.failures).toEqual([]);
  } finally { screen.stop(); }
});

test("el botón se recalcula tras redimensionar la terminal", async () => {
  const screen = setup();
  try {
    await tick();
    screen.terminal.columns = 70;
    screen.tui.requestRender();
    await tick(80);
    await click(screen);
    expect(screen.copies).toEqual([CODE]);
    expect(screen.failures).toEqual([]);
  } finally { screen.stop(); }
});

test("la primera y última celda del botón copian el bloque", async () => {
  const screen = setup();
  try {
    await tick();
    const at = screen.button();
    const row = screen.plain()[at.y]!;
    const first = row.indexOf("⧉");
    const last = row.indexOf("Copiar") + "Copiar".length - 1;
    for (const x of [first, last]) {
      const count = screen.copies.length;
      await screen.send("press", x, at.y, 10);
      await screen.send("release", x, at.y, 10);
      expect(screen.copies.slice(count)).toEqual([CODE]);
    }
  } finally { screen.stop(); }
});

test("seleccionar texto manualmente fuera del botón sigue copiando la selección", async () => {
  const screen = setup();
  try {
    await tick();
    const lines = screen.plain();
    const y = lines.findIndex(line => line.includes("Intro"));
    const x = lines[y]!.indexOf("Intro");
    await screen.send("press", x, y);
    await screen.send("drag", x + 4, y);
    await screen.send("release", x + 4, y);
    expect(screen.copies).toEqual(["Intro"]);
  } finally { screen.stop(); }
});
