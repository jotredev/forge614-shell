import { Loader, Text } from "@earendil-works/pi-tui";
import { accent, muted } from "../basic/theme.ts";
import { EngramFlowScreen } from "./frame.ts";

/** Runs one async step while showing an animated "working" line in the same continuous alt-screen. */
export async function showWorking<T>(screen: EngramFlowScreen, title: string, message: string, task: () => Promise<T>): Promise<T> {
  const loader = new Loader(screen.tui, accent, muted, message);
  screen.setScreen(title, loader);
  loader.start();
  try {
    return await task();
  } finally {
    loader.stop();
  }
}

const noopComponent = { render: () => [] as string[], invalidate: () => {} };

/**
 * Final, non-interactive result screen. Replaces every end-of-run `console.log` in
 * `init-engram.ts`. Renders once and returns immediately — this is the flow's single exit back to
 * the normal terminal, not one more question, so nothing here waits for a keypress. The caller
 * must stop the alt-screen WITHOUT `preserveScreen: true` right after: only that path reprints
 * this text into the normal terminal buffer before exiting, which is what keeps it visible.
 */
export function showResult(screen: EngramFlowScreen, title: string, lines: string[]): void {
  const body = new Text(lines.join("\n"));
  screen.setScreen(title, noopComponent, { body });
  screen.tui.renderNow(true);
}
