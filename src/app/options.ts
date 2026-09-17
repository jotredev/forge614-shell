export function parseEngine(args: string[]): { engine: "claude" | "codex" | "antigravity" | "pi" | undefined; args: string[] } {
  const remaining = [...args];
  const index = remaining.indexOf("--engine");
  if (index === -1) return { engine: undefined, args: remaining };
  const engine = remaining[index + 1];
  if (engine === "gemini") throw new Error("Gemini CLI personal-account access was retired. Use Antigravity (--engine antigravity).");
  if (engine !== "claude" && engine !== "codex" && engine !== "antigravity" && engine !== "pi") throw new Error("--engine must be claude, codex, antigravity or pi.");
  remaining.splice(index, 2);
  if (remaining.includes("--engine")) throw new Error("Specify --engine only once.");
  return { engine, args: remaining };
}
