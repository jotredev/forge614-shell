import { afterAll, beforeAll, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { createComposer, workModePresentation, spinnerFrame } from "./composer.ts";
import { ShellStatusBar } from "./status-bar.ts";
import { Container, resetCapabilitiesCache, setCapabilityOverrides, visibleWidth } from "@earendil-works/pi-tui";
import { renderLayoutFrame } from "../../../node_modules/@earendil-works/pi-tui/dist/layout.js";
import { ChatText, accent, muted, warning } from "./theme.ts";
import { workspaceLayout, sidebarRail, IndependentScrollView, attachJumpToLatest } from "./workspace.ts";
import { ShellSidebar } from "./sidebar.ts";
import { ShellState } from "./shell-state.ts";
import { ChatLogo } from "./logo.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Component, TUI, Terminal, TuiMouseEvent } from "@earendil-works/pi-tui";

const plain = (lines: string[]) => lines.map(stripVTControlCharacters);

/** These tests read the exact RGB codes the screen emits, so they pin the color mode instead of taking whatever terminal runs the suite. */
beforeAll(() => setCapabilityOverrides({ trueColor: true }));
afterAll(() => resetCapabilitiesCache());

const BACKGROUND = "48;2;10;10;11";
const SURFACE = "48;2;24;24;27";
const ELEVATED = "48;2;39;39;42";

/**
 * The background each visible column of a row is drawn on, read from its escape codes: `48;…` sets it and `49`, `0` or an empty code clears it
 * (`null` means the terminal's own background, i.e. the general one). Every character in these screens is one column wide; pi-tui's hyperlink
 * sequences (`ESC ] 8 ; ; BEL`), which take no column, are left out first.
 */
function backgrounds(row: string): (string | null)[] {
  const columns: (string | null)[] = [];
  let current: string | null = null;
  for (const part of row.replace(/\x1b\]8;;[^\x07]*\x07/g, "").split(/(\x1b\[[0-9;]*m)/)) {
    const code = /^\x1b\[([0-9;]*)m$/.exec(part)?.[1];
    if (code === undefined) { for (const _ of Array.from(part)) columns.push(current); continue; }
    if (code.startsWith("48;")) current = code;
    else if (code === "" || code === "0" || code === "49") current = null;
  }
  return columns;
}

/** The text of the rows above the writing block: the block is the first row painted with the surface background, so what comes before it is the menu. */
function aboveBox(rows: string[]): string {
  return plain(rows.slice(0, rows.findIndex(row => row.includes(`\x1b[${SURFACE}m`)))).join("\n");
}

/** A connected sidebar with every section on screen: session, context ring, plan-usage bars and background activity. */
function fullSidebar(): ShellSidebar {
  return new ShellSidebar(() => ({
    account: "connected", provider: "Claude Code", model: "claude-opus", reasoning: "medium",
    context: { used: 18_000, window: 128_000 }, usage: [{ label: "Weekly", usedPercent: 74, reset: "22h" }],
    backgroundActivitySupported: true, backgroundActivity: [{ id: "t1", kind: "agent", label: "Research X", state: "running", startedAt: Date.now() - 5000 }],
  }));
}

test("both workspace panes keep scrollbars hidden even after scrolling", () => {
  const content = { render: () => Array(100).fill("line") as string[], invalidate() {} };
  const transcriptScroll = new IndependentScrollView(content, { follow: "end", primary: true, scrollbar: "hidden" });
  const root = workspaceLayout(transcriptScroll, content, content, content, { rows: 40 } as Terminal, "/project");
  const frame = renderLayoutFrame(root, 140, 40, () => {});
  const panes: IndependentScrollView[] = [];
  const visit = (box: typeof frame.root): void => {
    if (box.scrollView instanceof IndependentScrollView) panes.push(box.scrollView);
    box.children.forEach(visit);
  };
  visit(frame.root);
  expect(panes).toHaveLength(2);
  for (const pane of panes) {
    pane.scrollBy(5);
    expect(pane.scrollbar).toBe("hidden");
    expect(pane.isScrollbarVisible).toBe(false);
  }
});

/** A resized transcript needs one new frame so ChatLogo reads the height just assigned by pi-tui, but unchanged height must not loop renders. */
test("IndependentScrollView requests a repaint only when its viewport height changes", () => {
  const pane = new IndependentScrollView({ render: () => [], invalidate() {} });
  let repaints = 0;
  const repaint = () => { repaints++; };
  pane.updateLayout(20, 8, repaint);
  expect(repaints).toBe(1);
  pane.updateLayout(20, 8, repaint);
  expect(repaints).toBe(1);
  pane.updateLayout(20, 11, repaint);
  expect(repaints).toBe(2);
});

/** The Codex-shaped workspace re-renders its opening sign in the center on its first visible frame and again immediately after a row resize. */
test("workspace centers the opening sign from the current chat height after opening and resizing", () => {
  const terminalState = { rows: 30 };
  const terminal = terminalState as Terminal;
  const transcript = new Container();
  let scroll!: IndependentScrollView;
  const logo = new ChatLogo(() => scroll.viewportRows, () => terminal.rows);
  transcript.addChild(logo);
  scroll = new IndependentScrollView(transcript, { follow: "end", primary: true, scrollbar: "hidden" });
  const empty = { invalidate() {}, render: () => [] as string[] };
  const root = workspaceLayout(scroll, empty, empty, empty, terminal, "/project");
  const first = renderLayoutFrame(root, 100, terminal.rows, () => {});
  const firstVisible = renderLayoutFrame(root, 100, terminal.rows, () => {}).lines.map(stripVTControlCharacters);
  const top = (rows: string[]) => rows.findIndex(row => row.includes("█▀▀▀"));
  const chatBox = (() => {
    const boxes = [first.root];
    while (boxes.length) {
      const box = boxes.pop()!;
      if (box.scrollView === scroll) return box;
      boxes.push(...box.children);
    }
    throw new Error("chat scroll view missing from workspace");
  })();
  const chatTop = chatBox.rect.y;
  expect(top(firstVisible) - chatTop).toBe(Math.floor((scroll.viewportRows - 3) / 2));
  terminalState.rows = 38;
  const resized = renderLayoutFrame(root, 100, terminalState.rows, () => {}).lines.map(stripVTControlCharacters);
  const resizedVisible = renderLayoutFrame(root, 100, terminalState.rows, () => {}).lines.map(stripVTControlCharacters);
  expect(top(resizedVisible) - chatTop).toBe(Math.floor((scroll.viewportRows - 3) / 2));
  expect(top(resized)).not.toBe(-1);
});

test("editor owns click gestures without starting screen selection", () => {
  const { input } = createComposer();
  input.render(90);
  for (const type of ["press", "drag", "release"] as const) {
    expect(input.handleMouse({ type, button: "left", x: 8, y: 3, width: 90 } as TuiMouseEvent)).toMatchObject({ handled: true, focus: true });
  }
  expect(input.getText()).toBe("");
});

test("wheel bursts animate within one pane and direct navigation cancels queued motion", async () => {
  const pane = new IndependentScrollView({ render: () => [], invalidate() {} });
  pane.updateLayout(100, 20, () => {});
  pane.handleMouse({ type: "wheel", wheelDelta: 20 } as TuiMouseEvent);
  expect(pane.scrollTop).toBeGreaterThan(0);
  expect(pane.scrollTop).toBeLessThan(20);
  await new Promise(resolve => setTimeout(resolve, 180));
  expect(pane.scrollTop).toBe(20);
  pane.handleMouse({ type: "wheel", wheelDelta: 30 } as TuiMouseEvent);
  pane.scrollToStart();
  await new Promise(resolve => setTimeout(resolve, 80));
  expect(pane.scrollTop).toBe(0);
});

test("jump-to-latest pill only shows once scrolled away from the newest message, and a click returns to it", () => {
  const content = { render: () => Array(50).fill("line") as string[], invalidate() {} };
  const scroll = new IndependentScrollView(content, { follow: "end", primary: true, scrollbar: "hidden" });
  scroll.updateLayout(50, 10, () => {});
  scroll.scrollToEnd();

  let shown: { component: Component; options?: { visible?: () => boolean } } | undefined;
  const fakeTui = {
    showOverlay: (component: Component, options?: { visible?: () => boolean }) => {
      shown = { component, options };
      return { hide() {}, setHidden() {}, isHidden: () => false, focus() {}, unfocus() {}, isFocused: () => false, getBounds: () => undefined };
    },
  } as unknown as TUI;

  attachJumpToLatest(fakeTui, scroll);
  expect(shown?.options?.visible?.()).toBe(false);

  scroll.scrollToStart();
  expect(scroll.isFollowingEnd).toBe(false);
  expect(shown?.options?.visible?.()).toBe(true);

  const result = shown!.component.handleMouse!({ type: "click", button: "left", x: 1, y: 1, width: 40 } as TuiMouseEvent);
  expect(result).toMatchObject({ handled: true });
  expect(scroll.isFollowingEnd).toBe(true);
  expect(shown?.options?.visible?.()).toBe(false);
});

test("sidebar consumes wheel movement at both edges instead of chaining to chat", () => {
  const view = new IndependentScrollView({ render: () => [], invalidate() {} });
  view.updateLayout(100, 20, () => {});
  expect(view.scrollBy(-10)).toBe(0);
  expect(view.scrollTop).toBe(0);
  expect(view.scrollBy(200)).toBe(0);
  expect(view.scrollTop).toBe(80);
  expect(view.scrollBy(10)).toBe(0);
  expect(view.scrollTop).toBe(80);
});

test("command menu describes commands and returns the keyboard selection", async () => {
  const { input } = createComposer();
  const selection = input.chooseCommand();
  const menu = plain(input.render(90)).join("\n");
  expect(menu).toContain("Refresh plan usage (supported engines)");
  expect(menu).toContain("/f614:stop");
  expect(menu).toContain("Commands · 1–3 of 3");
  input.handleInput("\r");
  expect(await selection).toBe("/f614:refresh");
  expect(plain(input.render(90)).join("\n")).toContain("/f614:help or /f614:commands");
});

/**
 * Before an assistant hands over its own list, the composer's menu is Shell's own group and nothing else: every command in it
 * carries `/f614:`, with the names and labels 1.12.0 gives them. It exists because the default list used to mix the
 * assistants' commands (`/model`, `/login`, `/status`…) under the FORGE614 title.
 */
test("the default command menu is only Shell's own /f614: commands", () => {
  const { input } = createComposer();
  void input.chooseCommand();
  const menu = aboveBox(input.render(100)); // the rows above the input box, not the hint line inside it
  expect(menu.match(/\/f614:[a-z]+/g)).toEqual(["/f614:refresh", "/f614:stop", "/f614:quit"]);
  for (const old of ["/model", "/effort", "/resume", "/new", "/login", "/logout", "/status", "/help", "/commands", "/quit"]) expect(menu, old).not.toMatch(new RegExp(`${old}(?![\\w:])`));
  input.cancelChoice();
  const typed = createComposer().input;
  for (const key of "/f614:") typed.handleInput(key);
  expect(aboveBox(typed.render(100)).match(/\/f614:[a-z]+/g)).toEqual(["/f614:refresh", "/f614:stop", "/f614:help", "/f614:commands", "/f614:quit"]);
});

test("command menu visibly groups provider commands before Forge614 controls", () => {
  const { input } = createComposer();
  input.setCommandGroups([
    { title: "CLAUDE CODE", items: [{ value: "/commit", label: "Create a commit" }, { value: "/review", label: "Review changes" }] },
    { title: "FORGE614", items: [{ value: "/refresh", label: "Refresh usage" }] },
  ]);
  void input.chooseCommand();

  const menu = plain(input.render(90)).join("\n");
  expect(menu.indexOf("CLAUDE CODE")).toBeLessThan(menu.indexOf("FORGE614"));
  expect(menu).toMatch(/\/commit\s+Create a commit/);
  expect(menu).toMatch(/\/refresh\s+Refresh usage/);
});

test("dollar input lists Codex skills separately from slash commands", () => {
  const { input } = createComposer();
  input.setSkillChoices([{ value: "$review", label: "Review a pull request" }]);
  input.handleInput("$");
  const menu = plain(input.render(90)).join("\n");
  expect(menu).toContain("CODEX SKILLS");
  expect(menu).toContain("$review  Review a pull request");
});

test("permission picker also accepts slash commands without selecting an option", async () => {
  const { input } = createComposer();
  let submitted = "";
  input.onSubmit = value => { submitted = value; input.cancelChoice(); };
  const pending = input.choose("Allow?", [{ value: "/no", label: "Deny" }, { value: "/yes", label: "Allow once" }]);
  for (const key of "/stop") input.handleInput(key);
  input.handleInput("\r");
  expect(submitted).toBe("/stop");
  expect(await pending).toBeUndefined();
});

test("slash suggestions filter, navigate and submit a command without a model message", () => {
  const { input } = createComposer();
  let submitted = "";
  input.onSubmit = value => { submitted = value; };
  for (const key of "/f614:s") input.handleInput(key);
  expect(plain(input.render(72)).join("\n")).toContain("Cancel current operation; keep Shell open");
  input.handleInput("\r");
  expect(submitted).toBe("/f614:stop");
});

test("choice picker numbers rows and marks the active value with a checkmark, even after the cursor moves away", async () => {
  const { input } = createComposer();
  const items = [
    { value: "opus", display: "Opus", label: "Best for everyday, complex tasks" },
    { value: "sonnet", display: "Sonnet", label: "Efficient for routine tasks" },
    { value: "haiku", display: "Haiku", label: "Fastest for quick answers" },
  ];
  void input.choose("Select model", items, "sonnet");
  const before = plain(input.render(90)).join("\n");
  expect(before).toContain("2. Sonnet ✓");
  expect(before).not.toContain("1. Opus ✓");
  expect(before).not.toContain("3. Haiku ✓");

  input.handleInput("\x1b[B"); // cursor moves to Haiku, active value stays on Sonnet
  const after = plain(input.render(90)).join("\n");
  expect(after).toContain("2. Sonnet ✓");
  expect(after).toMatch(/▎\s+3\. Haiku/);
  expect(after).not.toContain("›");
});

/**
 * In a menu of the composer the row under the cursor is the only one with a background (the elevated gray, across the whole row) and starts with the accent bar «▎»
 * where the old «›» was; the other rows have no background. It exists because the selection used to be told apart by color and a «›» alone; now the contrast does it.
 */
test("the cursor row of a menu is an elevated block with a bar, and the other rows have no background", () => {
  const { input } = createComposer();
  void input.choose("Select model", [{ value: "opus", label: "Best" }, { value: "sonnet", label: "Efficient" }, { value: "haiku", label: "Fastest" }], "sonnet");
  input.handleInput("\x1b[B"); // the cursor goes to Haiku
  const rows = input.render(90);
  const cursor = rows.find(row => stripVTControlCharacters(row).includes("▎"))!;
  expect(stripVTControlCharacters(cursor)).toMatch(/^ {2}▎ 3\. haiku {5}Fastest/); // no `display`, so the row shows the value
  expect(cursor).toContain(`\x1b[${ELEVATED}m`);
  expect(cursor).toContain("\x1b[38;2;70;222;224m▎"); // the bar in the accent
  const colored = backgrounds(cursor);
  expect(colored.slice(0, 2)).toEqual([null, null]); // the outer margin stays on the general background
  expect(colored.slice(2, 88).every(background => background === ELEVATED)).toBe(true);
  for (const name of ["1. opus", "2. sonnet"]) {
    const other = rows.find(row => stripVTControlCharacters(row).includes(name))!;
    expect(other).not.toContain("48;");
    expect(stripVTControlCharacters(other)).not.toContain("▎");
  }
});

test("choice picker navigates and cancels without changing a model", async () => {
  const { input } = createComposer();
  const items = [{ value: "a", label: "Model A" }, { value: "b", label: "Model B" }];
  const selected = input.choose("Select model", items);
  input.handleInput("\x1b[B"); input.handleInput("\r");
  expect(await selected).toBe("b");
  const cancelled = input.choose("Select model", items);
  input.handleInput("\x1b");
  expect(await cancelled).toBeUndefined();
  expect(input.getText()).toBe("");
});

test("chat header and session heading occupy the same row", () => {
  const terminal = { rows: 36 } as Terminal;
  const empty = { invalidate() {}, render: () => [] as string[] };
  const sidebar = new ShellSidebar(() => ({ account: "connected", provider: "Claude Code" }));
  const root = workspaceLayout(empty, empty, sidebar, empty, terminal, "/project");
  const lines = plain(renderLayoutFrame(root, 133, 36, () => {}).lines);
  const header = lines.findIndex(line => line.includes("FORGE614"));
  const session = lines.findIndex(line => line.includes("SESSION"));
  expect(header).toBeGreaterThan(0);
  expect(header).toBe(session);
});

/**
 * The whole screen, put together as it is at 133×36 (header, chat area, composer, sidebar with every section, footer), draws none of the box characters
 * ╭ ╮ ╰ ╯ │ ─: zones are told apart by background and space, not by lines. The chat's own text is not in this frame, so it is not what is checked.
 * It exists so a border that sneaks back into the header, the sidebar's rail, a heading, the composer or a pill fails here.
 */
test("the assembled screen draws no box-drawing lines anywhere", () => {
  const terminal = { rows: 36 } as Terminal;
  const empty = { invalidate() {}, render: () => [] as string[] };
  const footer = new ShellStatusBar(() => ({ account: "connected", provider: "Claude Code" }), "/Users/forge/project", () => ({ path: "/p", git: true, branch: "main", changedFiles: 1 }), "/Users/forge");
  const root = workspaceLayout(empty, createComposer().component, fullSidebar(), footer, terminal, "/project");
  const frame = renderLayoutFrame(root, 133, 36, () => {});
  const lines = plain(frame.lines);
  expect(lines).toHaveLength(36);
  expect(lines.join("\n")).toContain("SESSION");
  expect(lines.join("\n")).not.toMatch(/[╭╮╰╯│─]/);
  expect(lines[2]!.slice(0, 95).trim()).toBe(""); // the header keeps its third row, now blank
});

/**
 * The sidebar column is one block of the surface gray from the top row to the bottom row of the screen's body, and the two columns of gap between the chat
 * and it keep the general background (that is where the contrast comes from). Read from the escape codes of every row at 133 columns: the rail starts at column
 * 97 (133 − 36), the gap is columns 95–96.
 */
test("the sidebar column is the surface background on every row and the gap before it is the general one", () => {
  const terminal = { rows: 36 } as Terminal;
  const empty = { invalidate() {}, render: () => [] as string[] };
  const root = workspaceLayout(empty, empty, fullSidebar(), empty, terminal, "/project");
  const rows = renderLayoutFrame(root, 133, 36, () => {}).lines;
  for (const [index, row] of rows.slice(0, 34).entries()) {
    const colored = backgrounds(row);
    expect({ index, rail: colored.slice(97, 133).every(background => background === SURFACE) }).toEqual({ index, rail: true });
    expect({ index, gap: colored.slice(95, 97) }).toEqual({ index, gap: [null, null] });
  }
  expect(BACKGROUND).not.toBe(SURFACE); // the general background is the terminal's own (workspaceTerminal paints it), so the gap carries no code of its own
});

/**
 * A click on a row of the sidebar still reaches it after the rail lost its bar: the rail now starts its content two columns in (it was three) and one row
 * down, so a click on the first column of an activity row, in the rail's own coordinates, lands on that row and expands it, while a click on the padding
 * column before it (x = 1) reaches nothing. Without the new offset the click would land one column to the left of the content.
 */
test("a click on a background-activity row in the rail still expands it, and one on the padding does not", () => {
  const terminal = { rows: 36 } as Terminal;
  const sidebar = new ShellSidebar(() => ({
    account: "connected", provider: "Claude", backgroundActivitySupported: true,
    backgroundActivity: [{ id: "t1", kind: "agent", label: "Research X", state: "done", startedAt: Date.now() - 5000, endedAt: Date.now(), detail: "first\nsecond line of the result" }],
  }));
  const rail = sidebarRail(sidebar, terminal);
  const rowY = plain(rail.render(36)).findIndex(line => line.includes("Research X"));
  expect(rowY).toBeGreaterThan(0);
  const click = (x: number) => rail.handleMouse!({ type: "click", button: "left", x, y: rowY, width: 36, height: 34 } as TuiMouseEvent);
  expect(click(1)).toBeUndefined();
  expect(plain(rail.render(36)).join("\n")).not.toContain("second line of the result");
  expect(click(2)).toMatchObject({ handled: true });
  expect(plain(rail.render(36)).join("\n")).toContain("second line of the result");
});

/** The rail is the sidebar with a block of the surface gray behind it: two columns of padding each side, one blank row above, and gray down to the bottom of the screen even where the content ends. */
test("the rail pads the sidebar by two columns and fills the whole height with the surface background", () => {
  const terminal = { rows: 36 } as Terminal;
  const rows = sidebarRail(fullSidebar(), terminal).render(36);
  expect(rows.length).toBeGreaterThanOrEqual(35);
  for (const row of rows) {
    expect(visibleWidth(row)).toBe(36);
    expect(backgrounds(row).every(background => background === SURFACE)).toBe(true);
  }
  expect(stripVTControlCharacters(rows[0]!).trim()).toBe("");
  expect(stripVTControlCharacters(rows[1]!)).toStartWith("  // SESSION");
  expect(stripVTControlCharacters(rows[1]!)).toContain("SESSION");
});

/** The «jump to latest» pill is one row of the elevated gray with its label, not a three-row box of lines. */
test("the jump-to-latest pill is a single elevated row without a box", () => {
  const content = { render: () => Array(50).fill("line") as string[], invalidate() {} };
  const scroll = new IndependentScrollView(content, { follow: "end", primary: true, scrollbar: "hidden" });
  let pill: Component | undefined;
  const fakeTui = { showOverlay: (component: Component) => { pill = component; return { hide() {}, setHidden() {}, isHidden: () => false, focus() {}, unfocus() {}, isFocused: () => false, getBounds: () => undefined }; } } as unknown as TUI;
  attachJumpToLatest(fakeTui, scroll, "en");
  const rows = pill!.render(40);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toContain(`\x1b[${ELEVATED}m`);
  expect(stripVTControlCharacters(rows[0]!)).toBe(getCatalog("en").jumpToLatest.label);
  expect(stripVTControlCharacters(rows[0]!)).not.toMatch(/[╭╮╰╯│─]/);
});

/** A screen and a clock that never move or tick, so these tests read static colors and leave no repaint timer behind. */
const quietTui = { requestRender() {}, terminal: { rows: 40, columns: 100 } } as unknown as TUI;
const stillClock = { now: () => 0, every: () => () => {} };

/**
 * The writing box is a block of the surface gray with no line drawn around it: six rows (a blank one, a padding row, the editor, a padding row, the status-and-mode row,
 * a closing padding row), each as wide as the screen minus a two-column margin on each side, where the general background shows. The status is no longer a row of its own
 * above the editor: it sits at the left of the mode row. It exists because the owner asked for contrast and space to separate the zones instead of boxes of lines,
 * and then asked for the status to move to the mode row.
 */
test("Forge composer is a borderless block of the surface background, with its status on the mode row and nothing above the editor", () => {
  const { component } = createComposer(quietTui, "en", stillClock);
  const rows = component.render(100);
  const lines = plain(rows);

  expect(lines).toHaveLength(6);
  expect(lines[0]!.trim()).toBe("");
  expect(rows[0]).not.toContain("48;"); // the separator row above the block has no background
  for (const index of [1, 2, 3, 5]) expect(lines[index]!.trim()).toBe(""); // padding, the empty editor, padding, closing padding: no row opens with the status
  expect(lines[4]!.trim()).toStartWith("✓ Ready · /f614:help or /f614:commands");
  expect(lines[4]!.trimEnd()).toEndWith("Shift+Enter newline");
  expect(lines[4]).toStartWith("    ✓ Ready"); // two columns of margin, two of padding, then the status
  expect(lines.join("\n")).not.toMatch(/[╭╮╰╯│─]/);
  expect(lines.join("\n")).not.toContain("Ask anything");
  for (const row of rows.slice(1)) {
    expect(visibleWidth(row)).toBeLessThanOrEqual(100);
    const colored = backgrounds(row);
    expect(colored.slice(0, 2)).toEqual([null, null]);
    expect(colored.slice(2, 98).every(background => background === SURFACE)).toBe(true);
  }
});

/** Each state reads differently on the mode row, so Working never blends into Ready: the icon and the color of the text are each state's own. */
test("the status on the mode row changes icon and color so Working reads as busy instead of blending into Ready", () => {
  const { component, input } = createComposer(quietTui, "en", stillClock);
  const modeRow = () => component.render(100).at(-2)!;
  const readyRow = modeRow();
  input.setStatus("Working");
  const workingRow = modeRow();
  input.setStatus("Awaiting permission");
  const awaitingRow = modeRow();

  expect(readyRow).not.toBe(workingRow);
  expect(readyRow).not.toBe(awaitingRow);
  expect(workingRow).not.toBe(awaitingRow);
  expect(stripVTControlCharacters(readyRow)).toContain("✓ Ready");
  expect(stripVTControlCharacters(workingRow)).toContain("Working");
  expect(stripVTControlCharacters(awaitingRow)).toContain("● Awaiting permission");
});

/** A running elapsed-time counter keeps its place on the mode row, the icon is a spinner frame instead of the static bullet, and Ready has none of it. */
test("a running elapsed-time counter stays on the mode row, and the icon is a spinner frame instead of the static bullet", () => {
  const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const { component, input } = createComposer(quietTui, "en", stillClock);
  input.setStatus("Ready");
  const readyLine = stripVTControlCharacters(component.render(100).at(-2)!);
  input.setStatus("Working · 12s");
  const workingLine = component.render(100).at(-2)!;
  const workingIcon = stripVTControlCharacters(workingLine).match(/^\s*(\S)/)?.[1]; // the mode row opens with the icon

  expect(readyLine.trim()).toStartWith("✓");
  expect(SPINNER_FRAMES).toContain(workingIcon!);
  expect(stripVTControlCharacters(workingLine)).toContain("Working · 12s");
  expect(workingLine).toContain("237;183;88"); // the spinner is the warning color
  expect(readyLine).not.toContain("12s");
});

/**
 * Idea 26: the composer draws whatever mode the adapter hands it (its own native name, colored by the
 * adapter's tone) and knows no mode ids; a brand-new assistant's mode needs no change here.
 */
test("the composer shows the adapter's own mode name colored by its tone, and knows no mode ids", () => {
  const strip = (mode: Parameters<typeof workModePresentation>[0]) => stripVTControlCharacters(workModePresentation(mode).text);
  expect(strip({ id: "x1", label: "Bypass permissions", tone: "danger" })).toContain("Bypass permissions");
  expect(workModePresentation({ id: "x1", label: "Bypass permissions", tone: "danger" }).text).toContain("255;102;136");
  expect(strip({ id: "x2", label: "Auto mode", tone: "auto" })).toContain("Auto mode");
  expect(workModePresentation({ id: "x2", label: "Auto mode", tone: "auto" }).text).toContain("237;183;88");
  expect(strip({ id: "x3", label: "Default", tone: "manual" })).toContain("Default");
  expect(strip({ id: "x4", label: "Accept edits", tone: "acceptEdits" })).toContain("Accept edits");
  expect(strip({ id: "x5", label: "Plan mode", tone: "plan" })).toContain("Plan mode");
  expect(strip({ id: "x6", label: "Read Only", tone: "readOnly" })).toContain("Read Only");
  const unknown = workModePresentation({ id: "some-future-id", label: "Brand new mode" });
  expect(stripVTControlCharacters(unknown.text)).toContain("Brand new mode");
  expect(stripVTControlCharacters(unknown.text + unknown.help)).not.toContain("some-future-id");
  expect(stripVTControlCharacters(workModePresentation({ id: "x1", label: "Default", tone: "manual" }, "es").help)).toContain("Shift+Tab");
  expect(stripVTControlCharacters(workModePresentation(undefined).text)).toContain("engine mode");
});

/**
 * With an assistant whose Shift+Tab switches collaboration modes (Codex: Plan ↔ Default), the indicator keeps the
 * permission and adds the active mode's own indicator («Plan mode», as Codex's footer shows it, nothing in
 * Default), and the help names what Shift+Tab does now instead of «cycle».
 */
test("with collaboration modes the indicator keeps the permission, adds Plan mode and the help names the switch", () => {
  const modes = [{ id: "plan", label: "Plan", indicator: "Plan mode" }, { id: "default", label: "Default" }];
  for (const locale of ["en", "es"] as const) {
    const plan = workModePresentation({ id: "x", label: "Full Access", tone: "danger" }, locale, { modes, active: "plan" });
    expect(stripVTControlCharacters(plan.text)).toBe("▶▶ Full Access · Plan mode");
    expect(stripVTControlCharacters(plan.help)).toBe(getCatalog(locale).workMode.shiftTabCollaboration({ modes: "Plan ↔ Default" }));
    const plain = workModePresentation({ id: "x", label: "Full Access", tone: "danger" }, locale, { modes, active: "default" });
    expect(stripVTControlCharacters(plain.text)).toBe("▶▶ Full Access");
  }
  // Short on purpose, so it fits next to the permission: the key and the assistant's own mode names, the same in both languages.
  expect(getCatalog("en").workMode.shiftTabCollaboration({ modes: "Plan ↔ Default" })).toBe("Shift+Tab: Plan ↔ Default");
  expect(getCatalog("es").workMode.shiftTabCollaboration({ modes: "Plan ↔ Default" })).toBe("Shift+Tab: Plan ↔ Default");
});

test("composer preserves pasted newlines and fits narrow and wide viewports", () => {
  const { input } = createComposer();
  input.handleInput("\x1b[200~first line\nsecond line\x1b[201~");
  expect(input.getText()).toBe("first line\nsecond line");
  for (const width of [20, 45, 80, 120]) {
    const lines = input.render(width);
    expect(lines.every(line => visibleWidth(line) <= width)).toBe(true);
  }
});

test("chat renders markdown rather than displaying raw emphasis markers", () => {
  const lines = plain(new ChatText("**Verified** and `session.ts`").render(60)).join("\n");
  expect(lines).toContain("Verified");
  expect(lines).not.toContain("**Verified**");
  expect(lines).not.toContain("`session.ts`");
});

/** The bottom bar must not repeat what the sidebar already shows (owner's points 11 and 20): agent, model, reasoning level and «ctx N%» are gone, and what does not repeat (folder, branch, Git state, background count) stays. */
test("status bar shows no agent, model, reasoning or context figure — only folder, branch, Git state and background work", () => {
  const running = [{ id: "t1", kind: "agent" as const, label: "x", state: "running" as const, startedAt: Date.now() }];
  const bar = new ShellStatusBar(() => ({
    account: "connected",
    provider: "Claude Code",
    model: "claude-opus-5",
    reasoning: "medium",
    context: { used: 18_000, window: 128_000 },
    backgroundActivity: running,
  }), "/Users/forge/project", () => ({ path: "/Users/forge/project", git: true, branch: "main", changedFiles: 0 }), "/Users/forge");

  const lines = plain(bar.render(100));
  expect(lines).toHaveLength(2);
  expect(lines[0]).toStartWith("  ");
  expect(lines[1]).toBe("");
  expect(lines[0]).toContain("F614");
  for (const repeated of ["Claude Code", "claude-opus-5", "medium", "ctx", "14%"]) expect(lines[0]).not.toContain(repeated);
  for (const kept of ["1 background", "~/project", "main", "Clean"]) expect(lines[0]).toContain(kept);
});

test("status bar shows compact project identity below the chat", () => {
  const bar = new ShellStatusBar(
    () => ({ account: "connected", provider: "Claude Code" }),
    "/Users/forge/Desktop/forge614-shell",
    () => ({ path: "/Users/forge/Desktop/forge614-shell", git: true, branch: "main", changedFiles: 7 }),
    "/Users/forge",
  );

  const output = plain(bar.render(120)).join("\n");
  expect(output).toContain("~/Desktop/forge614-shell");
  expect(output).toContain("main");
  expect(output).toContain("7 changes");
});

test("status bar gives path, branch and changes distinct semantic colors", () => {
  const bar = new ShellStatusBar(
    () => ({ account: "connected", provider: "Claude Code" }),
    "/Users/forge/Desktop/forge614-shell",
    () => ({ path: "/Users/forge/Desktop/forge614-shell", git: true, branch: "main", changedFiles: 7 }),
    "/Users/forge",
  );
  const line = bar.render(120)[0]!;

  expect(line).toContain(muted("~/Desktop/forge614-shell"));
  expect(line).toContain(accent("main"));
  expect(line).toContain(warning("7 changes"));
});

test("status bar pins the Shell version to the footer's right edge", () => {
  const bar = new ShellStatusBar(
    () => ({ account: "connected", provider: "Claude Code", model: "claude-opus-5" }),
    "/Users/forge/project",
    undefined,
    "/Users/forge",
    "1.0.0",
  );

  const line = plain(bar.render(100))[0]!;
  expect(line).toEndWith("v1.0.0");
  expect(line).toContain("~/project");
});

test("spinnerFrame exposes the same animated dot the composer status uses", () => {
  expect(spinnerFrame(false)).toBe("●");
  const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  expect(SPINNER_FRAMES).toContain(spinnerFrame(true));
});

test("status bar shows a running-count segment with the animated dot only while something is running", () => {
  const running = [{ id: "t1", kind: "agent" as const, label: "x", state: "running" as const, startedAt: Date.now() }];
  const bar = new ShellStatusBar(() => ({ account: "connected", provider: "Claude", backgroundActivity: running }), "/proj");
  expect(bar.render(80).join("\n")).toContain("1 background");

  const idle = new ShellStatusBar(() => ({ account: "connected", provider: "Claude", backgroundActivity: [] }), "/proj");
  expect(idle.render(80).join("\n")).not.toContain("background");
});

/** A disconnected account is a warning, not a repeat of sidebar data: it must still reach a person whose terminal is too narrow for the sidebar. */
test("status bar still tells the person when the account is disconnected", () => {
  const bar = new ShellStatusBar(() => ({ account: "disconnected", provider: "Claude Code" }));
  expect(plain(bar.render(80))[0]).toContain("Disconnected");
  expect(plain(bar.render(80))[0]).toContain("/login");
});

/**
 * The command that reconnects depends on the assistant: Claude Code's own `/login`, and with Codex (which has no `/login`)
 * Shell's `/f614:login`. The screen hands its command to the state, and the status bar and the sidebar both name that one.
 */
test("status bar and sidebar name the login command the assistant's screen gave them", () => {
  const codex = new ShellState("Codex", "/f614:login");
  expect(plain(new ShellStatusBar(() => codex.snapshot()).render(80))[0]).toContain("/f614:login");
  expect(stripVTControlCharacters(new ShellSidebar(() => codex.snapshot()).render(38).join("\n"))).toContain("/f614:login to connect an account");
  expect(getCatalog("en").sidebar.connectFirst({ command: codex.snapshot().loginCommand! })).toBe("Connect with /f614:login first.");
  const claude = new ShellState("Claude Code");
  expect(plain(new ShellStatusBar(() => claude.snapshot()).render(80))[0]).toContain("/login");
  expect(plain(new ShellStatusBar(() => claude.snapshot()).render(80))[0]).not.toContain("/f614:login");
  expect(getCatalog("es").sidebar.loginToConnect({ command: "/f614:login" })).toBe("/f614:login para conectar una cuenta");
});
