import type { Terminal } from "@earendil-works/pi-tui";
import { runEngramInitFlow } from "../ui/startup/engram-init.ts";
import { applyEngramInit, type RunEngram } from "../infrastructure/forge614-engram.ts";

const SUPPORTED_PRODUCTS = ["engram"] as const;

/** Validates `forge614-shell init --product <name>` arguments; throws a clear error otherwise. */
export function requireEngramProduct(args: string[]): void {
  const remaining = [...args];
  // Both `--product <name>` and `--product=<name>` are accepted.
  const equalsIndex = remaining.findIndex(arg => arg.startsWith("--product="));
  const spaceIndex = remaining.indexOf("--product");
  let product = "";
  if (equalsIndex !== -1) {
    product = remaining[equalsIndex]!.slice("--product=".length);
    remaining.splice(equalsIndex, 1);
  } else if (spaceIndex !== -1 && remaining[spaceIndex + 1]) {
    product = remaining[spaceIndex + 1]!;
    remaining.splice(spaceIndex, 2);
  }
  if (!product) {
    throw new Error("forge614-shell init requires --product <name>.");
  }
  if (remaining.length) {
    throw new Error(`forge614-shell init does not accept: ${remaining.join(" ")}`);
  }
  if (!SUPPORTED_PRODUCTS.includes(product as (typeof SUPPORTED_PRODUCTS)[number])) {
    throw new Error(`forge614-shell init --product ${product} is not supported. Only "engram" is supported today.`);
  }
}

export interface RunInitOptions {
  readonly terminal?: Terminal;
  /** Overrides the real TTY check; the sole source of truth for the interactivity gate when given. */
  readonly interactive?: boolean;
  readonly run?: RunEngram;
  readonly home?: string;
  readonly env?: NodeJS.ProcessEnv;
}

/** Entry point for `forge614-shell init --product engram`. Makes no Engram call before confirmation. */
export async function runInitCommand(args: string[], options: RunInitOptions = {}): Promise<void> {
  requireEngramProduct(args);
  // Explicit `interactive` wins; an injected terminal implies interactive; otherwise the real TTYs decide.
  const interactive = options.interactive ?? (options.terminal ? true : Boolean(process.stdin.isTTY && process.stdout.isTTY));
  if (!interactive) {
    throw new Error("forge614-shell init requires an interactive terminal.");
  }
  const flow = await runEngramInitFlow(options.terminal);
  if (!flow.confirmed) {
    process.exitCode = 130;
    console.log("Cancelled. No changes were made.");
    return;
  }
  await applyEngramInit(flow.decisions, { run: options.run, home: options.home, env: options.env });
  console.log("Forge614 Engram memory initialization is complete.");
}
