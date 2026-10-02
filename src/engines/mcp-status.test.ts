import { expect, test } from "bun:test";
import { claudeMcpState, codexMcpState, connectedCount } from "./mcp-status.ts";

/**
 * Claude Code's `init` message reports each MCP server with one of five words (`McpServerStatus`, `sdk.d.ts`): the panel
 * groups them into Shell's own states. A word the SDK may add later is not guessed: it has no state, so the panel shows the
 * server with no word instead of a wrong one.
 */
test("Claude's MCP statuses map to the panel's states and an unknown word has none", () => {
  expect(claudeMcpState("connected")).toBe("connected");
  expect(claudeMcpState("pending")).toBe("starting");
  expect(claudeMcpState("needs-auth")).toBe("needs-sign-in");
  expect(claudeMcpState("failed")).toBe("failed");
  expect(claudeMcpState("disabled")).toBe("disabled");
  expect(claudeMcpState("something-new")).toBeUndefined();
});

/**
 * Codex reports `runtimeStatus` (`mcpServerStatus/list`) and, as it starts a server, `mcpServer/startupStatus/updated` with its own four words:
 * `ready` is «connected» (the notice's word for it). A `runtimeStatus` of null is a server with no state: not «unknown», not guessed.
 */
test("Codex's MCP runtime statuses and startup notices map to the panel's states, and null has none", () => {
  expect(codexMcpState("connected")).toBe("connected");
  expect(codexMcpState("ready")).toBe("connected");
  expect(codexMcpState("notStarted")).toBe("starting");
  expect(codexMcpState("starting")).toBe("starting");
  expect(codexMcpState("authenticationRequired")).toBe("needs-sign-in");
  expect(codexMcpState("failed")).toBe("failed");
  expect(codexMcpState("cancelled")).toBe("cancelled");
  expect(codexMcpState("disabled")).toBe("disabled");
  expect(codexMcpState(null)).toBeUndefined();
  expect(codexMcpState(undefined)).toBeUndefined();
  expect(codexMcpState("something-new")).toBeUndefined();
});

/** The number shown in «⇌ N MCP» counts the servers that are connected and nothing else: not the starting, the failed, the ones that need a sign-in, the cancelled, the disabled or the ones with no state. */
test("the MCP count has only the connected servers", () => {
  expect(connectedCount([
    { name: "a", state: "connected" }, { name: "b", state: "connected" }, { name: "c", state: "starting" }, { name: "d", state: "needs-sign-in" },
    { name: "e", state: "failed" }, { name: "f", state: "cancelled" }, { name: "g", state: "disabled" }, { name: "h" },
  ])).toBe(2);
  expect(connectedCount([])).toBe(0);
});
