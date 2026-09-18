import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { ShellState } from "./shell-state.ts";
import { ShellSidebar } from "./sidebar.ts";

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
  expect(output).toContain("USAGE"); expect(output).toContain("Measurement unavailable");
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
