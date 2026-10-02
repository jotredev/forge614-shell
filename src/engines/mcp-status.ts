/**
 * The state of one MCP server as Shell shows it, the same for Claude Code and Codex: the six words of the bottom bar's panel. Each assistant reports its own
 * words (`claudeMcpState`, `codexMcpState` translate them); a server whose state is not known has none.
 */
export type McpState = "connected" | "starting" | "needs-sign-in" | "failed" | "cancelled" | "disabled";

/** One MCP server for the bottom bar: its name and, when the assistant said one, its state. */
export interface McpServerState { name: string; state?: McpState }

/**
 * Claude Code's word for a server in the `init` message (`McpServerStatus`, `sdk.d.ts`): `connected`, `pending`, `needs-auth`, `failed` or `disabled`. A word the SDK may add later
 * is not guessed: it has no state, so the panel shows the server with no word instead of a wrong one.
 */
export function claudeMcpState(status: string): McpState | undefined {
  switch (status) {
    case "connected": return "connected";
    case "pending": return "starting";
    case "needs-auth": return "needs-sign-in";
    case "failed": return "failed";
    case "disabled": return "disabled";
    default: return undefined;
  }
}

/**
 * Codex's word for a server: its `runtimeStatus` (`mcpServerStatus/list`: `connected`, `notStarted`, `starting`, `authenticationRequired`, `failed`, `cancelled`, `disabled`) or the `status` of a
 * `mcpServer/startupStatus/updated` notice (`starting`, `ready`, `failed`, `cancelled`; `ready` is «connected»). A null `runtimeStatus` (the server has none) and a word Codex may add later have no state.
 */
export function codexMcpState(status: string | null | undefined): McpState | undefined {
  switch (status) {
    case "connected": case "ready": return "connected";
    case "notStarted": case "starting": return "starting";
    case "authenticationRequired": return "needs-sign-in";
    case "failed": return "failed";
    case "cancelled": return "cancelled";
    case "disabled": return "disabled";
    default: return undefined;
  }
}

/** The number in «⇌ N MCP»: the servers that are connected, and nothing else. */
export function connectedCount(servers: readonly McpServerState[]): number {
  return servers.filter(server => server.state === "connected").length;
}
