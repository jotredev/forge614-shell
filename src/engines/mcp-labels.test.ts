import { expect, test } from "bun:test";
import { engramToolLabel, parseClaudeMcpToolName } from "./mcp-labels.ts";

test("engramToolLabel labels a forge614-engram tool call with a brain and a humanized name", () => {
  expect(engramToolLabel("forge614-engram", "memory_search")).toBe("🧠 memory search");
  expect(engramToolLabel("forge614-engram", "memory_session_start")).toBe("🧠 memory session start");
});

test("engramToolLabel returns undefined for any other MCP server", () => {
  expect(engramToolLabel("github", "create_issue")).toBeUndefined();
  expect(engramToolLabel("", "memory_search")).toBeUndefined();
});

test("parseClaudeMcpToolName splits an mcp__<server>__<tool> name", () => {
  expect(parseClaudeMcpToolName("mcp__forge614-engram__memory_search")).toEqual({ server: "forge614-engram", tool: "memory_search" });
  expect(parseClaudeMcpToolName("mcp__github__create_issue")).toEqual({ server: "github", tool: "create_issue" });
});

test("parseClaudeMcpToolName ignores tool names with extra __ segments in the tool part", () => {
  // Only the first `__` after `mcp__<server>` separates server from tool; the tool itself may contain more.
  expect(parseClaudeMcpToolName("mcp__forge614-engram__memory__weird")).toEqual({ server: "forge614-engram", tool: "memory__weird" });
});

test("parseClaudeMcpToolName returns undefined for a non-MCP or malformed tool name", () => {
  expect(parseClaudeMcpToolName("Read")).toBeUndefined();
  expect(parseClaudeMcpToolName("mcp__onlyserver")).toBeUndefined();
  expect(parseClaudeMcpToolName("")).toBeUndefined();
});
