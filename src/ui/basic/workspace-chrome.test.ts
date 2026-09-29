import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { createComposer, workModePresentation, spinnerFrame } from "./composer.ts";
import { ShellStatusBar } from "./status-bar.ts";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderLayoutFrame } from "../../../node_modules/@earendil-works/pi-tui/dist/layout.js";
import { ChatText, accent, muted, warning } from "./theme.ts";
import { workspaceLayout, IndependentScrollView, attachJumpToLatest } from "./workspace.ts";
import { ShellSidebar } from "./sidebar.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Component, TUI, Terminal, TuiMouseEvent } from "@earendil-works/pi-tui";

const plain = (lines: string[]) => lines.map(stripVTControlCharacters);

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
  input.handleInput("/"); input.handleInput("m");
  expect(plain(input.render(72)).join("\n")).toContain("Select model");
  input.handleInput("\r");
  expect(submitted).toBe("/model");
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
  expect(after).toMatch(/›\s+3\. Haiku/);
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

test("the status dot changes color so Working reads as busy instead of blending into Ready", () => {
  const { component, input } = createComposer();
  const readyLine = component.render(72)[1]!;
  input.setStatus("Working");
  const workingLine = component.render(72)[1]!;
  input.setStatus("Awaiting permission");
  const awaitingLine = component.render(72)[1]!;

  expect(readyLine).not.toBe(workingLine);
  expect(readyLine).not.toBe(awaitingLine);
  expect(workingLine).not.toBe(awaitingLine);
  expect(stripVTControlCharacters(workingLine)).toContain("Working");
  expect(stripVTControlCharacters(awaitingLine)).toContain("Awaiting permission");
});

test("a running elapsed-time counter still reads as the busy color, and the dot itself is a spinner frame instead of the static bullet", () => {
  const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const { component, input } = createComposer();
  input.setStatus("Ready");
  const readyLine = stripVTControlCharacters(component.render(72)[1]!);
  const readyDot = readyLine.match(/╭─\s+(\S)/)?.[1];
  input.setStatus("Working · 12s");
  const workingLine = component.render(72)[1]!;
  const workingDot = stripVTControlCharacters(workingLine).match(/╭─\s+(\S)/)?.[1];

  expect(readyDot).toBe("●");
  expect(SPINNER_FRAMES).toContain(workingDot!);
  expect(stripVTControlCharacters(workingLine)).toContain("Working · 12s");
  expect(workingLine).toContain("237;183;88"); // same warning color as plain "Working"
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
