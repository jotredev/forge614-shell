import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { createComposer, workModePresentation } from "./composer.ts";
import { ShellStatusBar } from "./status-bar.ts";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderLayoutFrame } from "../../../node_modules/@earendil-works/pi-tui/dist/layout.js";
import { ChatText, accent, muted, warning } from "./theme.ts";
import { workspaceLayout, IndependentScrollView } from "./workspace.ts";
import { ShellSidebar } from "./sidebar.ts";
import type { Terminal, TuiMouseEvent } from "@earendil-works/pi-tui";

const plain = (lines: string[]) => lines.map(stripVTControlCharacters);

test("both workspace panes keep scrollbars hidden even after scrolling", () => {
  const content = { render: () => Array(100).fill("line") as string[], invalidate() {} };
  const root = workspaceLayout(content, content, content, content, { rows: 40 } as Terminal, "/project");
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
  expect(menu).toContain("Select model");
  expect(menu).toContain("/refresh");
  expect(menu).toContain("Commands · 1–5 of");
  input.handleInput("\r");
  expect(await selection).toBe("/model");
  expect(plain(input.render(90)).join("\n")).toContain("/help or /commands");
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
  expect(menu).toContain("/commit  Create a commit");
  expect(menu).toContain("/refresh  Refresh usage");
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
  input.handleInput("/"); input.handleInput("m");
  expect(plain(input.render(72)).join("\n")).toContain("Select model");
  input.handleInput("\r");
  expect(submitted).toBe("/model");
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

test("Forge composer is a framed writing surface instead of a highlighted placeholder", () => {
  const { component } = createComposer();
  const lines = plain(component.render(72));

  expect(lines).toHaveLength(7);
  expect(lines[0]!.trim()).toBe("");
  expect(lines[1]).toContain("╭─");
  expect(lines[1]).toContain("  ● Ready  ");
  expect(lines[2]!.replaceAll("│", "").trim()).toBe("");
  expect(lines[4]!.replaceAll("│", "").trim()).toBe("");
  expect(lines[5]).toContain("/help or /commands");
  expect(lines[6]).toContain("╰");
  expect(lines.join("\n")).not.toContain("Ask anything");
});

test("native work modes use clear English labels and the matching semantic colors", () => {
  expect(stripVTControlCharacters(workModePresentation("bypassPermissions").text)).toContain("bypass permissions on");
  expect(stripVTControlCharacters(workModePresentation("auto").text)).toContain("auto mode on");
  expect(stripVTControlCharacters(workModePresentation("default").text)).toContain("manual mode on");
  expect(stripVTControlCharacters(workModePresentation("acceptEdits").text)).toContain("accept edits on");
  expect(stripVTControlCharacters(workModePresentation("plan").text)).toContain("plan mode on");
  expect(workModePresentation("bypassPermissions").text).toContain("255;102;136");
  expect(workModePresentation("auto").text).toContain("237;183;88");
  expect(stripVTControlCharacters(workModePresentation("onRequest:readOnly").text)).toContain("manual mode on");
  expect(stripVTControlCharacters(workModePresentation("unlessTrusted:workspaceWrite").text)).toContain("auto mode on");
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

test("status bar condenses only known session details into one workspace line", () => {
  const bar = new ShellStatusBar(() => ({
    account: "connected",
    provider: "Claude Code",
    model: "claude-opus-5",
    reasoning: "medium",
    context: { used: 18_000, window: 128_000 },
  }));

  const lines = plain(bar.render(100));
  expect(lines).toHaveLength(2);
  expect(lines[0]).toStartWith("  ");
  expect(lines[1]).toBe("");
  expect(lines[0]).toContain("F614");
  expect(lines[0]).toContain("Claude Code");
  expect(lines[0]).toContain("claude-opus-5");
  expect(lines[0]).toContain("ctx 14%");
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
  expect(line).toContain("Claude Code");
});
