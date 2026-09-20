const ENGRAM_SERVER = "forge614-engram";

/** Friendly label for an Engram MCP tool call (e.g. "🧠 memory search"), or undefined for any other server. */
export function engramToolLabel(server: string, tool: string): string | undefined {
  return server === ENGRAM_SERVER ? `🧠 ${tool.replace(/_/g, " ")}` : undefined;
}

/** Splits a Claude Agent SDK MCP tool name (`mcp__<server>__<tool>`) into its server and tool parts. */
export function parseClaudeMcpToolName(name: string): { server: string; tool: string } | undefined {
  if (!name.startsWith("mcp__")) return undefined;
  const rest = name.slice("mcp__".length);
  const separator = rest.indexOf("__");
  if (separator === -1) return undefined;
  return { server: rest.slice(0, separator), tool: rest.slice(separator + 2) };
}
