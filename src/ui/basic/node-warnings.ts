import { truncateToWidth } from "@earendil-works/pi-tui";
import { PanelText, muted } from "./theme.ts";

/**
 * The `code` of the warning the Claude SDK raises (`process.emitWarning`) when a query opens with `canUseTool` set in a mode that approves every tool call
 * («Bypass Permissions»): «canUseTool will not be invoked». It is expected and Shell ignores it without showing anything: Shell passes `canUseTool` on purpose, on every query,
 * because the work mode can change live to one that does ask for permission (that is also why the query opens with `allowDangerouslySkipPermissions`),
 * so leaving `canUseTool` out would break leaving «Bypass Permissions» in the middle of a chat.
 */
export const EXPECTED_NODE_WARNING_CODE = "CLAUDE_SDK_CAN_USE_TOOL_SHADOWED";

/**
 * The chat entry for one Node warning: a single row of muted text, cut with «…» when it does not fit the width (a warning's message can be long and must not take several
 * rows of the chat), with the blank line above and below every notice has. `text` is already the catalog's full sentence and already clean of control characters.
 */
export function nodeWarningRow(text: string): PanelText {
  return new PanelText(width => [muted(truncateToWidth(text, width, "…"))]);
}

/** Name of the listener Node (and Bun) install on `process` to print every warning raw on stderr. */
const NODE_PRINTER_NAME = "onWarning";

/**
 * While a Shell screen occupies the terminal no Node process warning may be written raw on it: Node prints each `process.emitWarning` on stderr, and that output lands on top of
 * the alternate screen the interface draws (it cut across the writing box). So this takes the warnings for as long as the screen is open: Node's own printer (the `warning`
 * listener named `onWarning`) is taken out and a listener of Shell's goes in its place. The warning with code {@link EXPECTED_NODE_WARNING_CODE} is ignored without a word; any other
 * goes to `show` with its message on one line (no «(node:<pid>)», no stack), for the screen to put in the chat.
 *
 * Returns the function that gives everything back: Shell's listener leaves and Node's printer returns to the place it had, so the `warning` listeners are again the same ones
 * (same number, same functions, same order) as before. Calling it twice does nothing the second time. Use it in a `finally`, so a screen that fails still gives the printer back.
 */
export function takeNodeWarnings(show: (message: string) => void): () => void {
  const taken = process.listeners("warning").flatMap((listener, index) => listener.name === NODE_PRINTER_NAME ? [{ listener, index }] : []);
  for (const { listener } of taken) process.removeListener("warning", listener);
  const ours = (warning: Error & { code?: string }) => {
    if (warning?.code === EXPECTED_NODE_WARNING_CODE) return;
    const message = String(warning?.message ?? warning).replace(/\s+/g, " ").trim();
    if (message) show(message);
  };
  process.on("warning", ours);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const rest = process.listeners("warning").filter(listener => listener !== ours);
    for (const { listener, index } of taken) rest.splice(Math.min(index, rest.length), 0, listener);
    process.removeAllListeners("warning");
    for (const listener of rest) process.on("warning", listener);
  };
}
