/**
 * Claude Code's own commands that Shell knows by name and has not connected. With Claude Code every `/command` without a
 * prefix is Claude Code's: the ones Claude Code reports in its command list (`supportedCommands`, the SDK's `SlashCommand[]`)
 * are forwarded to it, the ones Shell implements itself with Claude Code's meaning (`/model`, `/effort`, `/resume`, `/new`,
 * `/login`, `/logout`, `/exit` and its alias `/quit`) are handled in `src/ui/basic/claude.ts`, and these two are official
 * commands that need Claude Code's own screen (a settings panel, the help view), so Shell answers them honestly instead of
 * calling them unknown. Their old Shell meaning moved to `/f614:status` (Shell's session telemetry) and `/f614:help` (Shell's menu).
 *
 * Source: the commands reference of Claude Code 2.1.274 — the version the installed SDK (`@anthropic-ai/claude-agent-sdk`
 * 0.3.274, `manifest.json`) bundles — https://code.claude.com/docs/en/commands: «`/status` Open the Settings interface on the
 * Status tab, showing version, model, account, and connectivity» and «`/help` Show help and available commands».
 */
export const CLAUDE_UNCONNECTED_COMMANDS: readonly string[] = ["help", "status"];

/** Whether a typed name (with its slash) is one of Claude Code's own commands that Shell has not connected. */
export function isUnconnectedClaudeCommand(name: string | undefined): boolean {
  return name !== undefined && CLAUDE_UNCONNECTED_COMMANDS.some(item => `/${item}` === name);
}
