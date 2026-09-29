import { expect, test } from "bun:test";
import { CODEX_COMMANDS, codexMenuCommands, findCodexCommand } from "./commands.ts";

/**
 * Every command name in `enum SlashCommand`, in the enum's own order (its comment says «Enum order is
 * presentation order in the popup»). Taken from
 * https://raw.githubusercontent.com/openai/codex/rust-v0.159.0/codex-rs/tui/src/slash_command.rs
 * (`#[strum(serialize_all = "kebab-case")]` plus the per-variant `serialize`/`to_string` overrides).
 * If Codex changes its list, refresh this copy from a fresh download, never from memory.
 */
const OFFICIAL_ORDER = [
  "model", "ide", "permissions", "keymap", "vim", "setup-default-sandbox", "experimental", "approve", "memories", "skills",
  "import", "hooks", "review", "rename", "new", "archive", "delete", "resume", "fork", "worktree", "app", "init", "compact",
  "recap", "plan", "voice", "goal", "agents", "side", "btw", "copy", "export", "raw", "tui", "diff", "mention", "status",
  "daemon", "warnings", "cd", "pwd", "usage", "debug-config", "title", "statusline", "theme", "pets", "mcp", "apps", "plugins",
  "logout", "quit", "exit", "feedback", "rollout", "ps", "stop", "clear", "test-approval", "subagents", "debug-m-drop", "debug-m-update",
];

/** The list is Codex's, name by name and in Codex's order: a command added, dropped or reordered by hand here would make Shell disagree with the assistant. */
test("the command table is the official Codex 0.159.0 list, in Codex's order", () => {
  expect(CODEX_COMMANDS.map(command => command.name)).toEqual(OFFICIAL_ORDER);
});

/** The person reads Codex's own words for each command (in both languages), so a few are checked verbatim against `SlashCommand::description`. */
test("descriptions are Codex's own, verbatim", () => {
  const description = (name: string) => findCodexCommand(name)?.description;
  expect(description("stop")).toBe("stop all background terminals");
  expect(description("ps")).toBe("list background terminals");
  expect(description("mcp")).toBe("list configured MCP tools; use /mcp verbose for details");
  expect(description("goal")).toBe("set or view the goal for a long-running task");
  expect(description("usage")).toBe("view account usage or use a usage limit reset");
  expect(description("rename")).toBe("rename the current thread");
  expect(description("delete")).toBe("permanently delete this session");
  expect(description("archive")).toBe("archive this session");
  expect(description("clear")).toBe("clear the terminal and start a new chat");
  expect(description("skills")).toBe("use skills to improve how Codex performs specific tasks");
  expect(description("hooks")).toBe("view and manage lifecycle hooks");
  expect(description("pwd")).toBe("show the current working directory");
  expect(CODEX_COMMANDS.every(command => command.description.length > 0)).toBe(true);
});

/** Codex accepts a few extra spellings (`/cwd`, `/clean`, `/pet`); typing them must reach the same command, and only those. */
test("aliases resolve to their command and unknown names resolve to nothing", () => {
  expect(findCodexCommand("cwd")?.name).toBe("pwd");
  expect(findCodexCommand("clean")?.name).toBe("stop");
  expect(findCodexCommand("pet")?.name).toBe("pets");
  expect(findCodexCommand("stop")?.name).toBe("stop");
  expect(findCodexCommand("nope")).toBeUndefined();
});

/** `available_during_task` from the same file: what Codex lets run while it works decides what Shell lets run while a turn is open. */
test("availability during a task follows Codex", () => {
  for (const name of ["rename", "goal", "mcp", "hooks", "usage", "pwd", "ps", "stop", "skills", "status"]) expect(findCodexCommand(name)?.availableDuringTask).toBe(true);
  for (const name of ["clear", "new", "archive", "delete", "compact", "review", "plan"]) expect(findCodexCommand(name)?.availableDuringTask).toBe(false);
});

/**
 * The menu shows what Codex's own popup shows on macOS: `is_visible` (debug-build-only `/rollout` and
 * `/test-approval` are out) and `bottom_pane/command_popup.rs`, which also hides `/apps` and every command whose
 * name starts with «debug» (`/debug-config`, `/debug-m-drop`, `/debug-m-update`). Hidden commands still exist
 * when typed; they just are not offered.
 */
test("the menu lists only what Codex shows on macOS, in Codex's order, with Codex's descriptions", () => {
  const menu = codexMenuCommands();
  const names = menu.map(item => item.value);
  expect(names).toEqual(OFFICIAL_ORDER.filter(name => !["rollout", "test-approval", "apps", "debug-config", "debug-m-drop", "debug-m-update"].includes(name)).map(name => `/${name}`));
  expect(menu.find(item => item.value === "/stop")?.label).toBe("stop all background terminals");
  expect(findCodexCommand("rollout")?.visible).toBe(false);
  expect(findCodexCommand("app")?.visible).toBe(true);
});
