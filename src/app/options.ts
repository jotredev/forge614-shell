import { getCatalog } from "../i18n/index.ts";
import type { Locale } from "../i18n/index.ts";
import { ShellError } from "../shell-error.ts";

/** Parses the explicit chat adapter; every other id fails closed before CLI startup creates a terminal or writes preferences. */
export function parseEngine(args: string[], locale: Locale = "en"): { engine: "claude" | "codex" | undefined; args: string[] } {
  const t = getCatalog(locale).options;
  const remaining = [...args];
  const index = remaining.indexOf("--engine");
  if (index === -1) return { engine: undefined, args: remaining };
  const engine = remaining[index + 1];
  if (!engine) throw new Error(t.engineInvalidValue);
  if (engine !== "claude" && engine !== "codex") throw new ShellError("engine-not-fully-supported", { engine: engine ?? "" });
  remaining.splice(index, 2);
  if (remaining.includes("--engine")) throw new Error(t.engineSpecifiedTwice);
  return { engine, args: remaining };
}
