export function parseEngine(args: string[]): { engine: "claude" | "codex" | "pi" | undefined; args: string[] } {
  const remaining = [...args];
  const index = remaining.indexOf("--engine");
  if (index === -1) return { engine: undefined, args: remaining };
  const engine = remaining[index + 1];
  if (engine !== "claude" && engine !== "codex" && engine !== "pi") throw new Error("--engine must be claude, codex or pi.");
  remaining.splice(index, 2);
  if (remaining.includes("--engine")) throw new Error("Specify --engine only once.");
  return { engine, args: remaining };
}
