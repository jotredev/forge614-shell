/**
 * Codex's own slash commands, as its terminal app defines them. Shell keeps the list so that, with Codex,
 * every `/command` without a prefix means what it means in Codex's normal terminal, in Codex's own order and
 * words — and so that a command Shell has not connected yet is recognized as Codex's (an honest answer)
 * instead of being taken for an unknown one.
 *
 * Source: `enum SlashCommand` in
 * https://raw.githubusercontent.com/openai/codex/rust-v0.159.0/codex-rs/tui/src/slash_command.rs — name (with
 * the `serialize`/`to_string` overrides), `description()`, `available_during_task()` and `is_visible()` on
 * macOS. The enum's own comment says its order is the popup's presentation order. Refresh this table from a
 * fresh download when Codex changes; never edit it from memory.
 */
export interface CodexCommand {
  /** The name typed after the slash (Codex's `command()`), e.g. `stop`. */
  readonly name: string;
  /** Extra spellings Codex's parser accepts for the same command (`/cwd`, `/clean`, `/pet`). */
  readonly aliases: readonly string[];
  /** Codex's own description, in its own words; Shell shows it as is in every language. */
  readonly description: string;
  /** `available_during_task()`: whether Codex lets the command run while a turn is in progress. */
  readonly availableDuringTask: boolean;
  /** `is_visible()` on macOS: `/rollout` and `/test-approval` exist only in debug builds of Codex. */
  readonly visible: boolean;
}

const command = (name: string, description: string, availableDuringTask: boolean, options: { aliases?: string[]; visible?: boolean } = {}): CodexCommand =>
  ({ name, description, availableDuringTask, aliases: options.aliases ?? [], visible: options.visible ?? true });

/** Codex 0.159.0's commands in the enum's order. */
export const CODEX_COMMANDS: readonly CodexCommand[] = [
  command("model", "choose what model and reasoning effort to use", true),
  command("ide", "include current selection, open files, and other context from your IDE", true),
  command("permissions", "choose what Codex is allowed to do", true),
  command("keymap", "remap TUI shortcuts", false),
  command("vim", "toggle Vim mode for the composer", false),
  command("setup-default-sandbox", "set up elevated agent sandbox", false),
  command("experimental", "toggle experimental features", false),
  command("approve", "approve one retry of a recent auto-review denial", true),
  command("memories", "configure memory use and generation", false),
  command("skills", "use skills to improve how Codex performs specific tasks", true),
  command("import", "import setup, this project, and recent chats from Claude Code", false),
  command("hooks", "view and manage lifecycle hooks", true),
  command("review", "review my current changes and find issues", false),
  command("rename", "rename the current thread", true),
  command("new", "start a new chat during a conversation", false),
  command("archive", "archive this session", false),
  command("delete", "permanently delete this session", false),
  command("resume", "resume a saved chat", true),
  command("fork", "fork the current chat", false),
  command("worktree", "start or continue a conversation in a new worktree", false),
  command("app", "continue this session in the Desktop app", true),
  command("init", "create an AGENTS.md file with instructions for Codex", false),
  command("compact", "summarize conversation to prevent hitting the context limit", false),
  command("recap", "summarize the current conversation now", false),
  command("plan", "switch to Plan mode", false),
  command("voice", "start or stop voice; use /voice settings to choose a voice", true),
  command("goal", "set or view the goal for a long-running task", true),
  command("agents", "open the agent command center", true),
  command("side", "start a side conversation in an ephemeral fork", true),
  command("btw", "start a side conversation in an ephemeral fork", true),
  command("copy", "copy the last response or part of it", true),
  command("export", "export the conversation as markdown", false),
  command("raw", "toggle raw scrollback mode for copy-friendly terminal selection", true),
  command("tui", "choose the TUI mode for the next launch", false),
  command("diff", "show git diff (including untracked files)", true),
  command("mention", "mention a file", true),
  command("status", "show current session configuration and token usage", true),
  command("daemon", "Manage the local background server", true),
  command("warnings", "view retained warnings and diagnostic details", true),
  command("cd", "change the current working directory", false),
  command("pwd", "show the current working directory", true, { aliases: ["cwd"] }),
  command("usage", "view account usage or use a usage limit reset", true),
  command("debug-config", "show config layers and requirement sources for debugging", true),
  command("title", "configure which items appear in the terminal title", true),
  command("statusline", "configure which items appear in the status line", true),
  command("theme", "choose a syntax highlighting theme", false),
  command("pets", "choose or hide the terminal pet", false, { aliases: ["pet"] }),
  command("mcp", "list configured MCP tools; use /mcp verbose for details", true),
  command("apps", "manage apps", true),
  command("plugins", "browse plugins", true),
  command("logout", "log out of Codex", false),
  command("quit", "exit Codex", true),
  command("exit", "exit Codex", true),
  command("feedback", "send logs to maintainers", true),
  command("rollout", "print the rollout file path", true, { visible: false }),
  command("ps", "list background terminals", true),
  command("stop", "stop all background terminals", true, { aliases: ["clean"] }),
  command("clear", "clear the terminal and start a new chat", false),
  command("test-approval", "test approval request", true, { visible: false }),
  command("subagents", "switch between this session's subagents", true),
  command("debug-m-drop", "DO NOT USE", false),
  command("debug-m-update", "DO NOT USE", false),
];

/** The command a typed name (without the slash) refers to — by its name or one of Codex's accepted spellings — or nothing when it is not a Codex command. */
export function findCodexCommand(name: string): CodexCommand | undefined {
  return CODEX_COMMANDS.find(item => item.name === name || item.aliases.includes(name));
}

/**
 * What Codex's own menu offers on macOS: the `is_visible()` ones, minus what
 * `bottom_pane/command_popup.rs` filters out of the popup (`/apps`, and every command whose name starts with
 * «debug»). A command left out of the menu still works when typed.
 */
export function codexMenuCommands(): { value: string; label: string }[] {
  return CODEX_COMMANDS
    .filter(item => item.visible && item.name !== "apps" && !item.name.startsWith("debug"))
    .map(item => ({ value: `/${item.name}`, label: item.description }));
}
