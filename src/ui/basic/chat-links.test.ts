import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Container, getCapabilities, resetCapabilitiesCache, setCapabilityOverrides, visibleWidth } from "@earendil-works/pi-tui";
import type { Component, Terminal } from "@earendil-works/pi-tui";
import { renderLayoutFrame } from "../../../node_modules/@earendil-works/pi-tui/dist/layout.js";
import { ChatLinks, enableTerminalLinks, terminalWantsLinks } from "./chat-links.ts";
import type { ChatLinkTools } from "./chat-links.ts";
import { ChatText, danger, warning } from "./theme.ts";
import { ActivityCard } from "./transcript.ts";
import { IndependentScrollView, chatScreen, workspaceLayout } from "./workspace.ts";
import { SidebarLayout } from "./sidebar-layout.ts";
import { ShellSidebar } from "./sidebar.ts";
import { openLocalPath } from "../../infrastructure/local-path.ts";

/** Links need the terminal to understand OSC 8, and the exact colors are read from the codes, so the tests pin both instead of taking whatever terminal runs the suite. */
beforeAll(() => setCapabilityOverrides({ trueColor: true, hyperlinks: true }));
afterAll(() => resetCapabilitiesCache());

const NONCE = "test-nonce";
const ACCENT = "38;2;70;222;224";
const BRIGHT = "38;2;150;245;247";
const POINTER = "\x1b]22;pointer\x07";
const DEFAULT_POINTER = "\x1b]22;default\x07";
const tick = () => new Promise(resolve => setTimeout(resolve, 25));

let root = "";
let home = "";
let cwd = "";
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "forge614-chat-links-")));
  home = join(root, "home"); cwd = join(root, "project");
  mkdirSync(home); mkdirSync(join(cwd, "src"), { recursive: true });
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

/** The OSC 8 links of a rendered row, in order, each as the address it points to and the text it covers (styles removed). */
function linksOf(row: string): { url: string; text: string }[] {
  return [...row.matchAll(/\x1b\]8;[^;\x07\x1b]*;([^\x07\x1b]*)\x1b\\([\s\S]*?)\x1b\]8;;\x1b\\/g)].map(match => ({ url: match[1]!, text: stripVTControlCharacters(match[2]!) }));
}

interface Cell { char: string; fg: string | null; bold: boolean; underline: boolean }
/** What each visible column of a row looks like, read from its escape codes: the character, the text color (`38;…`), bold and underline. Hyperlink sequences take no column. */
function cells(row: string): Cell[] {
  let fg: string | null = null; let bold = false; let underline = false;
  const out: Cell[] = [];
  for (const part of row.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").split(/(\x1b\[[0-9;]*m)/)) {
    const code = /^\x1b\[([0-9;]*)m$/.exec(part)?.[1];
    if (code === undefined) { for (const char of Array.from(part)) out.push({ char, fg, bold, underline }); continue; }
    const params = code === "" ? ["0"] : code.split(";");
    for (let i = 0; i < params.length; i++) {
      const param = params[i]!;
      if (param === "0") { fg = null; bold = false; underline = false; }
      else if (param === "1") bold = true; else if (param === "22") bold = false;
      else if (param === "4") underline = true; else if (param === "24") underline = false;
      else if (param === "39") fg = null;
      else if (param === "38") { fg = params.slice(i, i + 5).join(";"); i += 4; }
    }
  }
  return out;
}

const fakeTools = () => {
  const opened = { web: [] as string[], path: [] as string[] };
  const tools: ChatLinkTools = { openWeb: async url => { opened.web.push(url); return true; }, openPath: async path => { opened.path.push(path); return true; } };
  return { opened, tools };
};
const newLinks = (tools: ChatLinkTools = fakeTools().tools, onFailure: (target: string) => void = () => {}) => new ChatLinks({ cwd, home, tools, onFailure, nonce: NONCE });

class TestTerminal implements Terminal {
  kittyProtocolActive = false; output = "";
  input: (data: string) => void = () => {};
  constructor(public columns: number, public rows: number) {}
  start(input: (data: string) => void) { this.input = input; }
  stop() {} async drainInput() {} write(data: string) { this.output += data; }
  moveBy() {} hideCursor() {} showCursor() {} clearLine() {} clearFromCursor() {} clearScreen() {} setTitle() {} setProgress() {}
}

const empty: Component = { invalidate() {}, render: () => [] };

/**
 * The whole chat screen as Codex and Claude Code assemble it — the real alternate screen, the real layout, a real terminal wrapper — over a fake terminal that is given real SGR mouse
 * sequences. `frame()` draws the same layout again on its own to read the rows as they are right now, and `at(text)` finds where a piece of text is on screen.
 */
function chat(options: { columns?: number; rows?: number; tools?: ChatLinkTools; links?: ChatLinks } = {}) {
  const columns = options.columns ?? 90; const rows = options.rows ?? 30;
  const terminal = new TestTerminal(columns, rows);
  const failures: string[] = [];
  const recorded = fakeTools();
  const links = options.links ?? newLinks(options.tools ?? recorded.tools, target => failures.push(target));
  const { surface, tui } = chatScreen(terminal, links, undefined, { copySelection: async () => true });
  const layout = new SidebarLayout({ terminal: surface });
  links.pointerHeldElsewhere = () => layout.holdsPointer();
  const transcript = new Container();
  const scroll = new IndependentScrollView(transcript, { follow: "end", primary: true, scrollbar: "hidden" });
  const root = workspaceLayout(scroll, empty, new ShellSidebar(() => ({ account: "connected", provider: "Claude Code" })), empty, surface, layout);
  tui.setLayoutRoot(root);
  tui.start();
  const screen = {
    terminal, links, tui, failures, opened: recorded.opened, layout,
    add: async (...components: Component[]) => { for (const component of components) transcript.addChild(component); tui.requestRender(); await tick(); },
    frame: () => renderLayoutFrame(root, columns, rows, () => {}).lines,
    plain: () => renderLayoutFrame(root, columns, rows, () => {}).lines.map(stripVTControlCharacters),
    /** Where `text` starts on screen, as zero-based column and row; the row is the first one that has it, the column is its first character. */
    at: (text: string) => { const lines = screen.plain(); const y = lines.findIndex(line => line.includes(text)); if (y < 0) throw new Error(`"${text}" is not on screen:\n${lines.join("\n")}`); return { x: lines[y]!.indexOf(text), y }; },
    send: async (type: "move" | "press" | "release" | "drag", x: number, y: number) => {
      const button = { move: 35, press: 0, release: 0, drag: 32 }[type];
      terminal.input(`\x1b[<${button};${x + 1};${y + 1}${type === "release" ? "m" : "M"}`); await tick();
    },
    click: async (x: number, y: number) => { await screen.send("press", x, y); await screen.send("release", x, y); },
    stop: () => tui.stop({ preserveScreen: true }),
  };
  return screen;
}

/** The rows of `text` drawn by a `ChatText` that has links, as pi-tui draws them for a chat of `width` columns. */
const render = (text: string, links: ChatLinks, width = 200, color?: (text: string) => string) => new ChatText(text, color, links).render(width);

// ── Paths become links only when they exist ──────────────────────────────────────────────────

/**
 * A path written in an assistant's text becomes a link when it exists on disk at the moment it is drawn: the row keeps exactly the same visible text, and the text of the path
 * (with its `:line:column` suffix, when written) is covered by one OSC 8 link whose address names the path without the suffix. It exists because a click must open what the person sees.
 */
test("an existing path in the assistant's text becomes a link with the same visible text", () => {
  const file = join(cwd, "src", "app.ts"); writeFileSync(file, "x");
  const links = newLinks();
  const rows = render(`I changed ${file}:12:3 and it works.`, links);
  const row = rows.find(line => line.includes("\x1b]8;"))!;
  expect(linksOf(row)).toEqual([{ url: links.pathUrl(file), text: `${file}:12:3` }]);
  expect(stripVTControlCharacters(row).trimEnd()).toBe(`  I changed ${file}:12:3 and it works.`);
});

/** A path that is not on disk is plain text, with no OSC 8 anywhere in the row: nothing to click and nothing that could fail when clicked. */
test("a path that does not exist is not a link", () => {
  const rows = render(`I changed ${join(cwd, "src", "gone.ts")} and ./nothing.ts and missing/dir/file.md.`, newLinks());
  expect(rows.join("\n")).not.toContain("\x1b]8;");
});

/**
 * Every form the owner listed becomes a link when it exists: absolute, `~/`, `./`, `../` and relative to the session's folder (also a bare file name), each ending a sentence or a
 * comma without taking the punctuation into the link. The address always carries the full path, whatever way it was written.
 */
test("absolute, ~/, ./, ../ and relative paths all become links to the full path", () => {
  writeFileSync(join(cwd, "src", "a.ts"), "x"); writeFileSync(join(cwd, "b.ts"), "x"); writeFileSync(join(home, "c.ts"), "x"); writeFileSync(join(cwd, "src", "d.ts"), "x"); writeFileSync(join(cwd, "package.json"), "x");
  const links = newLinks();
  const row = render(`See ./src/a.ts, ../project/b.ts and ~/c.ts; also src/d.ts:7 and package.json.`, links).find(line => line.includes("\x1b]8;"))!;
  expect(linksOf(row)).toEqual([
    { url: links.pathUrl(join(cwd, "src", "a.ts")), text: "./src/a.ts" },
    { url: links.pathUrl(join(cwd, "b.ts")), text: "../project/b.ts" },
    { url: links.pathUrl(join(home, "c.ts")), text: "~/c.ts" },
    { url: links.pathUrl(join(cwd, "src", "d.ts")), text: "src/d.ts:7" },
    { url: links.pathUrl(join(cwd, "package.json")), text: "package.json" },
  ]);
});

/** Addresses are not paths: the `//host/page` inside a web address is left to the Markdown link, and words that happen to be folder names are not turned into links. */
test("a web address is not read as a path and a plain word that names a folder is not a link", () => {
  mkdirSync(join(cwd, "docs"));
  const rows = render("Visit https://example.com/src/app.ts or //cdn/x and read the docs.", newLinks());
  const found = rows.flatMap(linksOf);
  expect(found).toEqual([{ url: "https://example.com/src/app.ts", text: "https://example.com/src/app.ts" }]);
});

/** A path inside `inline code` is a link too, drawn in the link color instead of the code's green; the code around it keeps its own color. */
test("a path in inline code is a link, in the link color, and the rest of the code keeps its color", () => {
  const file = join(cwd, "src", "app.ts"); writeFileSync(file, "x");
  const links = newLinks();
  const row = render(`Run \`cat ${file} | wc\` now`, links).find(line => line.includes("\x1b]8;"))!;
  expect(linksOf(row)).toEqual([{ url: links.pathUrl(file), text: file }]);
  const all = cells(row);
  const start = stripVTControlCharacters(row).indexOf(file);
  expect(all.slice(start, start + file.length).every(cell => cell.fg === ACCENT)).toBe(true);
  expect(all[start - 1]!.fg).toBe("38;2;107;238;201"); // the space before the path, still inside the code span
  expect(all[start + file.length]!.fg).toBe("38;2;107;238;201");
});

/** The link covers the path only: an error text drawn in red keeps its color before and after it. */
test("a path in an error line is a link and the red text around it stays red", () => {
  const file = join(cwd, "src", "app.ts"); writeFileSync(file, "x");
  const row = render(`failed in ${file} today`, newLinks(), 200, danger).find(line => line.includes("\x1b]8;"))!;
  const all = cells(row); const start = stripVTControlCharacters(row).indexOf(file);
  expect(all[start - 2]!.fg).toBe("38;2;255;102;136");
  expect(all[start]!.fg).toBe(ACCENT);
  expect(all[start + file.length + 1]!.fg).toBe("38;2;255;102;136");
});

/** In a tool card, a path in the title, in the one-line preview of the detail, and in the body of a full card (a permission, say) is a link when it exists; a card made without links stays exactly as before. */
test("paths in tool cards are links, in the routine line, its preview and the body of a full card", () => {
  const file = join(cwd, "src", "app.ts"); writeFileSync(file, "x");
  const links = newLinks();
  const routine = new ActivityCard(`Read ${file}`, "Completed", `{ "note": "second" }`, false, undefined, 4, true, links).render(300);
  expect(routine.flatMap(linksOf)).toEqual([{ url: links.pathUrl(file), text: file }]);
  const quoted = new ActivityCard("Read", "Completed", `{ "file_path": "${file}" }\nsecond`, false, undefined, 4, true, links).render(300);
  expect(quoted.flatMap(linksOf)).toEqual([{ url: links.pathUrl(file), text: file }]);
  const preview = new ActivityCard("Read", "Completed", `${file}:12\nsecond`, false, undefined, 4, true, links).render(300);
  expect(preview.flatMap(linksOf)).toEqual([{ url: links.pathUrl(file), text: `${file}:12` }]);
  const full = new ActivityCard("Permission requested", "", `wants to write ${file} now`, true, undefined, 4, true, links).render(300);
  expect(full.flatMap(linksOf)).toEqual([{ url: links.pathUrl(file), text: file }]);
  const plain = new ActivityCard(`Read ${file}`, "Completed", `${file}`).render(300);
  expect(plain.join("\n")).not.toContain("\x1b]8;");
  expect((new ActivityCard("Read", "x") as unknown as Record<string, unknown>).handleMouse).toBeUndefined();
});

/** A very long path in a card that does not wrap is cut with «…»; the cut link stays closed, so nothing after it is part of a link. */
test("a path cut by the width of a routine line leaves no link open", () => {
  const file = join(cwd, "src", "app.ts"); writeFileSync(file, "x");
  const row = new ActivityCard(`Read ${file}`, "Completed", "", false, undefined, 4, true, newLinks()).render(30)[1]!;
  expect(visibleWidth(row)).toBe(30);
  const opens = [...row.matchAll(/\x1b\]8;[^;\x07\x1b]*;([^\x07\x1b]*)\x1b\\/g)].map(match => match[1]);
  expect(opens.at(-1)).toBe("");
});

// ── Web links ────────────────────────────────────────────────────────────────────────────────

/** Markdown links and a bare address both reach the terminal as OSC 8 links when the terminal understands them; the text of the address is untouched. */
test("a Markdown link and a bare address are OSC 8 links", () => {
  const rows = render("Read [the repo](https://github.com/jotredev/forge614-shell) or https://example.com/docs now.", newLinks());
  expect(rows.flatMap(linksOf)).toEqual([
    { url: "https://github.com/jotredev/forge614-shell", text: "the repo" },
    { url: "https://example.com/docs", text: "https://example.com/docs" },
  ]);
});

/**
 * Shell turns the terminal's hyperlinks on where pi-tui does not know the terminal does them: Terminal.app (`Apple_Terminal`) and Orca. It leaves pi-tui's own answer in tmux and screen,
 * with an unknown terminal, and when the person set `PI_HYPERLINKS=0`. It exists because without this the links of those two terminals would be printed as «text (address)» and never clickable.
 */
test("hyperlinks are enabled for Terminal.app and Orca, and left as pi-tui decides elsewhere", () => {
  const saved = { TERM_PROGRAM: process.env.TERM_PROGRAM, TMUX: process.env.TMUX, TERM: process.env.TERM, PI_HYPERLINKS: process.env.PI_HYPERLINKS };
  try {
    for (const key of ["TMUX", "PI_HYPERLINKS"] as const) delete process.env[key];
    process.env.TERM = "xterm-256color";
    for (const [program, wanted] of [["Apple_Terminal", true], ["Orca", true], ["ghostty", false], ["SomethingElse", false], [undefined, false]] as const) {
      expect({ program, wanted: terminalWantsLinks({ ...process.env, ...(program ? { TERM_PROGRAM: program } : { TERM_PROGRAM: undefined }) }) }).toEqual({ program, wanted });
    }
    expect(terminalWantsLinks({ TERM_PROGRAM: "Apple_Terminal", TMUX: "/tmp/tmux-1/default,1,0" })).toBe(false);
    expect(terminalWantsLinks({ TERM_PROGRAM: "Apple_Terminal", TERM: "screen-256color" })).toBe(false);
    expect(terminalWantsLinks({ TERM_PROGRAM: "Apple_Terminal", PI_HYPERLINKS: "0" })).toBe(false);
    for (const program of ["Apple_Terminal", "Orca"]) {
      process.env.TERM_PROGRAM = program;
      resetCapabilitiesCache(); setCapabilityOverrides({});
      expect(getCapabilities().hyperlinks).toBe(false); // pi-tui alone does not know these two
      enableTerminalLinks(process.env);
      expect(getCapabilities().hyperlinks).toBe(true);
      expect(new ChatText("[a](https://example.com/x)").render(40).flatMap(linksOf)).toEqual([{ url: "https://example.com/x", text: "a" }]);
    }
    process.env.TERM_PROGRAM = "SomethingElse";
    resetCapabilitiesCache(); setCapabilityOverrides({}); enableTerminalLinks(process.env);
    expect(getCapabilities().hyperlinks).toBe(false);
    expect(stripVTControlCharacters(new ChatText("[a](https://example.com/x)").render(40).join("\n"))).toContain("a (https://example.com/x)");
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    resetCapabilitiesCache(); setCapabilityOverrides({ trueColor: true, hyperlinks: true });
  }
});

// ── Clicking ─────────────────────────────────────────────────────────────────────────────────

/**
 * A left click — press and release on the same link, with no dragging — opens a web link with exactly the address it carries, a bare address and a Markdown link alike, and an
 * address with a port (`http://localhost:3000`) too. It exists because without `openUrl` the screen did nothing at all with a click on a link.
 */
test("a click on a web link opens exactly that address", async () => {
  const screen = chat();
  try {
    await screen.add(new ChatText("Docs: [the repo](https://github.com/jotredev/forge614-shell?a=1&b=2)\n\nServer: http://localhost:3000\n\nSite: https://example.com/page", undefined, screen.links));
    const repo = screen.at("the repo"); const server = screen.at("http://localhost:3000"); const site = screen.at("https://example.com/page");
    await screen.click(repo.x + 3, repo.y);
    await screen.click(server.x + 5, server.y);
    await screen.click(site.x + 10, site.y);
    expect(screen.opened.web).toEqual(["https://github.com/jotredev/forge614-shell?a=1&b=2", "http://localhost:3000", "https://example.com/page"]);
    expect(screen.opened.path).toEqual([]);
    expect(screen.failures).toEqual([]);
  } finally { screen.stop(); }
});

/** A click is a press and a release on the same spot: pressing on a link and letting go somewhere else, or dragging before letting go, opens nothing (it is a text selection). */
test("pressing on a link and releasing elsewhere, or dragging, does not open it", async () => {
  const screen = chat();
  try {
    await screen.add(new ChatText("Go to https://example.com/page and read", undefined, screen.links));
    const link = screen.at("https://example.com/page");
    await screen.send("press", link.x + 5, link.y); await screen.send("release", link.x + 30, link.y + 5);
    await screen.send("press", link.x + 5, link.y); await screen.send("drag", link.x + 8, link.y); await screen.send("release", link.x + 8, link.y);
    await screen.send("press", link.x + 5, link.y); await screen.send("drag", link.x + 9, link.y); await screen.send("release", link.x + 5, link.y);
    expect(screen.opened.web).toEqual([]);
    await screen.click(link.x + 5, link.y);
    expect(screen.opened.web).toEqual(["https://example.com/page"]);
  } finally { screen.stop(); }
});

/**
 * Only `http:` and `https:` are opened, with no user or password in the address. A link the assistant writes with any other scheme — `javascript:`, `file:`, `ftp:` — or with credentials
 * is drawn like any link but opens nothing, and neither does one that pretends to be Shell's own path link. It exists because the text of a link comes from a model.
 */
test("links with other schemes, with credentials or forged as Shell's own open nothing", async () => {
  const screen = chat();
  try {
    const hostile = ["javascript:void(0)", "file:///etc/hosts", "ftp://example.com/file", "https://user:secret@example.com/private", "f614-path:guessed-secret:%2Fetc%2Fhosts", "f614-path::%2Fetc%2Fhosts"];
    await screen.add(new ChatText(hostile.map((url, index) => `[link${index}](${url})`).join("\n\n"), undefined, screen.links));
    const rows = screen.frame();
    expect(rows.flatMap(linksOf).map(link => link.text)).toEqual(hostile.map((_, index) => `link${index}`)); // all drawn as links, so the test is not vacuous
    for (let index = 0; index < hostile.length; index++) { const spot = screen.at(`link${index}`); await screen.click(spot.x + 1, spot.y); }
    expect(screen.opened.web).toEqual([]);
    expect(screen.opened.path).toEqual([]);
    expect(screen.failures).toEqual([]);
  } finally { screen.stop(); }
});

/**
 * A click on a path that exists opens it with what the Mac has for it: the opener receives the path without the `:line:column` suffix, whether the path is in the text, in inline code or
 * in a tool card.
 */
test("a click on a path opens the file without its line suffix, from the text, inline code and a card", async () => {
  const file = join(cwd, "src", "app.ts"); writeFileSync(file, "x");
  const other = join(cwd, "src", "other.ts"); writeFileSync(other, "x");
  const third = join(cwd, "src", "third.ts"); writeFileSync(third, "x");
  const screen = chat({ columns: 200 });
  try {
    await screen.add(new ChatText(`Edited ${file}:12:3 here\n\nand \`${other}\` there`, undefined, screen.links), new ActivityCard("Read", "Completed", third, false, undefined, 4, true, screen.links));
    const text = screen.at(`${file}:12:3`); const code = screen.at(other); const card = screen.at(third);
    await screen.click(text.x + 4, text.y); await screen.click(code.x + 4, code.y); await screen.click(card.x + 4, card.y);
    expect(screen.opened.path).toEqual([file, other, third]);
    expect(screen.opened.web).toEqual([]);
  } finally { screen.stop(); }
});

/**
 * The same click through the real opener: a file that exists goes to `/usr/bin/open` alone, and an executable file is shown in Finder (`open -R`) instead of being opened. It proves the
 * chat is wired to the safety rule and not only to a fake.
 */
test("a click through the real path opener opens a normal file and only shows an executable one", async () => {
  const notes = join(cwd, "notes.txt"); writeFileSync(notes, "x");
  const program = join(cwd, "program"); writeFileSync(program, "x");
  if (process.platform !== "win32") chmodSync(program, 0o755);
  const calls: [string, string[]][] = [];
  // En Windows (NTFS), statSync no expone bits de ejecución POSIX 0o111. Se modela stat para preservar la regla de seguridad.
  const tools: ChatLinkTools = {
    openWeb: async () => true,
    openPath: path => openLocalPath(path, {
      platform: "darwin",
      run: async (command, args) => { calls.push([command, args]); },
      ...(process.platform === "win32" ? {
        stat: (target: string) => target === program ? { isDirectory: false, mode: 0o755 }
          : target === notes ? { isDirectory: false, mode: 0o644 } : undefined,
      } : {}),
    }),
  };
  const screen = chat({ columns: 200, tools });
  try {
    await screen.add(new ChatText(`Open ${notes}:4 and ${program} now`, undefined, screen.links));
    const first = screen.at(notes); const second = screen.at(program);
    await screen.click(first.x + 3, first.y); await screen.click(second.x + 3, second.y);
    expect(calls).toEqual([["/usr/bin/open", [notes]], ["/usr/bin/open", ["-R", program]]]);
  } finally { screen.stop(); }
});

/**
 * A Markdown link whose destination is a local path with no scheme — `[open the app](./src/app.ts:12)` — is read as a path of the text: when it exists, a click opens exactly the full
 * path without the `:line` suffix. It exists because an assistant often writes paths as Markdown links, and those used to be drawn as links that did nothing.
 */
test("a click on a Markdown link to an existing local path opens the full path without its suffix", async () => {
  const file = join(cwd, "src", "app.ts"); writeFileSync(file, "x");
  const screen = chat({ columns: 200 });
  try {
    await screen.add(new ChatText("See [open the app](./src/app.ts:12) now", undefined, screen.links));
    const link = screen.at("open the app");
    expect(screen.frame().flatMap(linksOf)).toEqual([{ url: screen.links.pathUrl(file), text: "open the app" }]);
    await screen.click(link.x + 3, link.y);
    expect(screen.opened.path).toEqual([file]);
    expect(screen.opened.web).toEqual([]);
    expect(screen.failures).toEqual([]);
  } finally { screen.stop(); }
});

/**
 * The same click through the real opener: a Markdown link to an executable file goes through the Finder rule (`open -R`) like any other path, and one to a normal file is opened. It proves
 * the Markdown link reaches the safety rule and not only a fake.
 */
test("a click through the real path opener on a Markdown link only shows an executable one", async () => {
  const notes = join(cwd, "notes.txt"); writeFileSync(notes, "x");
  const program = join(cwd, "program"); writeFileSync(program, "x");
  if (process.platform !== "win32") chmodSync(program, 0o755);
  const calls: [string, string[]][] = [];
  // En Windows (NTFS), statSync no expone bits de ejecución POSIX 0o111. Se modela stat para preservar la regla de seguridad.
  const tools: ChatLinkTools = {
    openWeb: async () => true,
    openPath: path => openLocalPath(path, {
      platform: "darwin",
      run: async (command, args) => { calls.push([command, args]); },
      ...(process.platform === "win32" ? {
        stat: (target: string) => target === program ? { isDirectory: false, mode: 0o755 }
          : target === notes ? { isDirectory: false, mode: 0o644 } : undefined,
      } : {}),
    }),
  };
  const screen = chat({ columns: 200, tools });
  try {
    await screen.add(new ChatText("Open [the tool](./program) and [the notes](./notes.txt) now", undefined, screen.links));
    const first = screen.at("the tool"); const second = screen.at("the notes");
    await screen.click(first.x + 2, first.y); await screen.click(second.x + 2, second.y);
    expect(calls).toEqual([["/usr/bin/open", ["-R", program]], ["/usr/bin/open", [notes]]]);
  } finally { screen.stop(); }
});

/**
 * A Markdown link to a path that is not on disk is drawn as it always was (pi-tui's own link, with its address as written) but is not one of Shell's: no Shell address in the row, and a
 * click opens nothing and reports nothing. It exists so a made-up path from a model is never offered as something that opens.
 */
test("a Markdown link to a path that does not exist is not a Shell link and opens nothing", async () => {
  const links = newLinks();
  const rows = render("Open [the gone file](./missing.ts) now", links);
  expect(rows.join("\n")).not.toContain("f614-path:");
  expect(rows.flatMap(linksOf)).toEqual([{ url: "./missing.ts", text: "the gone file" }]);
  const screen = chat({ columns: 200 });
  try {
    await screen.add(new ChatText("Open [the gone file](./missing.ts) now", undefined, screen.links));
    const link = screen.at("the gone file");
    await screen.click(link.x + 2, link.y);
    expect(screen.opened.path).toEqual([]);
    expect(screen.opened.web).toEqual([]);
    expect(screen.failures).toEqual([]);
  } finally { screen.stop(); }
});

/** A Markdown link to a path lights like any other link when the pointer is over it: every column of its text, also on a second row, in bold, underlined and the brighter cyan. */
test("hovering a Markdown link to a path lights all of its text", async () => {
  const file = join(cwd, "src", "app.ts"); writeFileSync(file, "x");
  const screen = chat({ columns: 40 });
  try {
    await screen.add(new ChatText("Look at [the application entry file of the project](./src/app.ts) please.", undefined, screen.links));
    const lit = (row: string) => cells(row).filter(cell => cell.fg === BRIGHT && cell.bold && cell.underline).map(cell => cell.char).join("");
    expect(screen.frame().map(lit).join("")).toBe("");
    const first = screen.at("the application");
    await screen.send("move", first.x + 1, first.y);
    const rows = screen.frame().map(lit).filter(Boolean);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.join("").replace(/ /g, "")).toBe("theapplicationentryfileoftheproject");
  } finally { screen.stop(); }
});

/** When opening fails — the opener answers false or throws, or the file was deleted after it was drawn — the chat is told the path or address, once per click, and nothing else breaks. */
test("a failed opening reports the path or address to the chat", async () => {
  const file = join(cwd, "src", "gone.ts"); writeFileSync(file, "x");
  const failing: ChatLinkTools = { openWeb: async () => false, openPath: async () => { throw new Error("no app"); } };
  const screen = chat({ columns: 200, tools: failing });
  try {
    await screen.add(new ChatText(`Site https://example.com/x and ${file}`, undefined, screen.links));
    const site = screen.at("https://example.com/x"); const path = screen.at(file);
    await screen.click(site.x + 3, site.y); await screen.click(path.x + 3, path.y);
    expect(screen.failures).toEqual(["https://example.com/x", file]);
  } finally { screen.stop(); }
  const real = chat({ columns: 200, tools: { openWeb: async () => true, openPath: path => openLocalPath(path, { platform: "darwin", run: async () => {} }) } });
  try {
    await real.add(new ChatText(`Open ${file} now`, undefined, real.links));
    const spot = real.at(file);
    rmSync(file);
    await real.click(spot.x + 3, spot.y);
    expect(real.failures).toEqual([file]);
  } finally { real.stop(); }
});

// ── Hover ────────────────────────────────────────────────────────────────────────────────────

/**
 * With the pointer over a link, the whole link — every column, also its second row when it wraps — is drawn brighter, in bold and underlined; the rest of the row is not, and when the
 * pointer goes elsewhere the link is cyan again. A path link and a web link behave the same. Nothing but the text's own style changes: no box, no background.
 */
test("hovering a link lights all of its columns, also on a second row, and leaving puts it back", async () => {
  const file = join(cwd, "src", "a-rather-long-file-name.ts"); writeFileSync(file, "x");
  const screen = chat({ columns: 40 });
  try {
    await screen.add(new ChatText(`Look at ${file} and [the long documentation page](https://example.com/docs/page) please.`, undefined, screen.links));
    const lit = (row: string) => cells(row).filter(cell => cell.fg === BRIGHT && cell.bold && cell.underline).map(cell => cell.char).join("");
    expect(screen.frame().map(lit).join("")).toBe("");
    // The path wraps over several rows: hovering its first part lights every part.
    const first = screen.at(file.slice(0, 8));
    await screen.send("move", first.x + 1, first.y);
    const pathRows = screen.frame().map(lit).filter(Boolean);
    expect(pathRows.length).toBeGreaterThan(1);
    expect(pathRows.join("")).toBe(file);
    // Moving to the blank margin beside it lights nothing; the web link lights only itself.
    await screen.send("move", 39, first.y);
    expect(screen.frame().map(lit).join("")).toBe("");
    const doc = screen.at("documentation");
    await screen.send("move", doc.x + 2, doc.y);
    expect(screen.frame().map(lit).join("").replace(/ /g, "")).toBe("thelongdocumentationpage"); // a space where the link wraps is not drawn, so it is compared without them
    expect(screen.frame().map(lit).filter(Boolean).length).toBeGreaterThan(1);
    await screen.send("move", 0, 29);
    expect(screen.frame().map(lit).join("")).toBe("");
    // At rest the path is cyan without underline, and the web link is cyan with it.
    const resting = cells(screen.frame()[first.y]!).filter(cell => cell.fg === ACCENT);
    expect(resting.length).toBeGreaterThan(0);
    expect(resting.every(cell => !cell.bold)).toBe(true);
  } finally { screen.stop(); }
});

/** The link is lit while its text wraps over two rows in the middle of a sentence, and no other link of the message lights with it. */
test("only the hovered link lights, not another link with the same address or the text around it", async () => {
  const screen = chat({ columns: 90 });
  try {
    await screen.add(new ChatText("One [first](https://example.com/same) and [second](https://example.com/same) and plain.", undefined, screen.links));
    const lit = (row: string) => cells(row).filter(cell => cell.fg === BRIGHT && cell.bold && cell.underline).map(cell => cell.char).join("");
    const first = screen.at("first");
    await screen.send("move", first.x + 1, first.y);
    expect(screen.frame().map(lit).filter(Boolean)).toEqual(["first"]);
    const second = screen.at("second");
    await screen.send("move", second.x + 1, second.y);
    expect(screen.frame().map(lit).filter(Boolean)).toEqual(["second"]);
  } finally { screen.stop(); }
});

/**
 * Over a link the terminal is asked for the hand pointer (OSC 22 `pointer`), once however far the pointer moves along the link; it is given back (`default`) when the pointer leaves, when
 * something else is pressed, when the pointer goes onto the sidebar and when the screen is closed with the pointer still on a link. A terminal that does not know OSC 22 ignores it.
 */
test("the hand pointer is asked for over a link and given back on leaving, pressing elsewhere and closing", async () => {
  const screen = chat({ columns: 120 });
  const count = (text: string) => screen.terminal.output.split(text).length - 1;
  try {
    await screen.add(new ChatText("Open https://example.com/page and https://example.com/other", undefined, screen.links));
    const link = screen.at("https://example.com/page");
    await screen.send("move", link.x + 1, link.y); await screen.send("move", link.x + 6, link.y); await screen.send("move", link.x + 9, link.y);
    expect([count(POINTER), count(DEFAULT_POINTER)]).toEqual([1, 0]);
    await screen.send("move", 3, link.y + 8);
    expect([count(POINTER), count(DEFAULT_POINTER)]).toEqual([1, 1]);
    await screen.send("move", link.x + 2, link.y);
    expect([count(POINTER), count(DEFAULT_POINTER)]).toEqual([2, 1]);
    await screen.send("press", 3, link.y + 8); await screen.send("release", 3, link.y + 8);
    expect([count(POINTER), count(DEFAULT_POINTER)]).toEqual([2, 2]);
    await screen.send("move", link.x + 2, link.y);
    await screen.send("move", 100, 10); // the sidebar
    expect([count(POINTER), count(DEFAULT_POINTER)]).toEqual([3, 3]);
    expect(screen.frame().flatMap(row => cells(row)).some(cell => cell.fg === BRIGHT)).toBe(false);
    await screen.send("move", link.x + 2, link.y);
    expect([count(POINTER), count(DEFAULT_POINTER)]).toEqual([4, 3]);
  } finally { screen.stop(); }
  expect([count(POINTER), count(DEFAULT_POINTER)]).toEqual([4, 4]);
  expect(screen.terminal.output.lastIndexOf(DEFAULT_POINTER)).toBeLessThan(screen.terminal.output.lastIndexOf("\x1b[?1049l"));
});

/** Pressing on the link keeps it lit and the hand on until the button is released, so a click does not flicker; the sidebar's own resize pointer is not taken away when the pointer goes from a link onto its grip. */
test("pressing a link keeps it lit and the grip keeps its own pointer", async () => {
  const screen = chat({ columns: 120 });
  try {
    await screen.add(new ChatText("Open https://example.com/page now", undefined, screen.links));
    const link = screen.at("https://example.com/page");
    await screen.send("move", link.x + 1, link.y);
    await screen.send("press", link.x + 1, link.y);
    expect(screen.frame().flatMap(row => cells(row)).filter(cell => cell.fg === BRIGHT && cell.bold).length).toBe("https://example.com/page".length);
    await screen.send("release", link.x + 1, link.y);
    await screen.send("move", 83, 15); // the grip: columns 82–83 of a 120-column terminal
    expect(screen.terminal.output.lastIndexOf("\x1b]22;ew-resize\x07")).toBeGreaterThan(screen.terminal.output.lastIndexOf(POINTER));
    expect(screen.terminal.output.lastIndexOf("\x1b]22;ew-resize\x07")).toBeGreaterThan(screen.terminal.output.lastIndexOf(DEFAULT_POINTER));
  } finally { screen.stop(); }
});

/** A line the chat writes to say that opening failed uses the warning color, and a path in it that no longer exists is not a link. */
test("a ChatText can be drawn in the warning color and its missing path stays plain", () => {
  const missing = join(cwd, "gone.ts");
  const row = render(`Could not open ${missing}`, newLinks(), 200, warning)[1]!;
  expect(row).not.toContain("\x1b]8;");
  expect(cells(row).find(cell => cell.char === "C")!.fg).toBe("38;2;237;183;88");
});
