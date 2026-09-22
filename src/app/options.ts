import { getCatalog } from "../i18n/index.ts";
import type { Locale } from "../i18n/index.ts";

export function parseEngine(args: string[], locale: Locale = "en"): { engine: "claude" | "codex" | "pi" | undefined; args: string[] } {
  const t = getCatalog(locale).options;
  const remaining = [...args];
  const index = remaining.indexOf("--engine");
  if (index === -1) return { engine: undefined, args: remaining };
  const engine = remaining[index + 1];
  if (engine !== "claude" && engine !== "codex" && engine !== "pi") throw new Error(t.engineInvalidValue);
  remaining.splice(index, 2);
  if (remaining.includes("--engine")) throw new Error(t.engineSpecifiedTwice);
  return { engine, args: remaining };
}
