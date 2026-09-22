import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { ShellState } from "./shell-state.ts";
import { ShellSidebar } from "./sidebar.ts";
import { REASONING_DEFAULT_LABEL } from "./metrics.ts";

test("the default-reasoning fallback text fits the sidebar's narrow column without getting cut off", () => {
  const state = new ShellState("Claude Code");
  state.connect({ model: "Opus 5 with 1M context" }); // no reasoning reported — the fallback path
  const output = stripVTControlCharacters(new ShellSidebar(() => state.snapshot()).render(36).join("\n"));
  expect(output).toContain(REASONING_DEFAULT_LABEL);
  expect(output).not.toContain("…");
});

test("token/cost figures sit right under plan usage, not down by RAM, and the cost wording explains itself without getting cut off", () => {
  const state = new ShellState("Claude Code");
  state.connect({ inputTokens: 908, outputTokens: 1263, estimateUSD: 0.6645, resources: { shellRssBytes: 1_000_000 } });
  const output = stripVTControlCharacters(new ShellSidebar(() => state.snapshot()).render(36).join("\n"));

  expect(output).not.toContain("…");
  expect(output).toContain("908 in");
  expect(output).toContain("1263 out");
  expect(output).toContain("$0.6645");
  expect(output).toContain("Reference only, not billed");
  const planUsageAt = output.indexOf("PLAN USAGE");
  const resourcesAt = output.indexOf("RESOURCES");
  const tokensAt = output.indexOf("908 in");
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
