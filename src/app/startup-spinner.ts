import { accent, muted } from "../ui/basic/theme.ts";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Prints a live "doing X" indicator for startup work that happens before any TUI exists yet
 * (detecting installed engines). Without this, the terminal sits blank for however long that
 * takes and the person has no way to tell Shell apart from a hang. Returns a `stop` function;
 * callers must call it exactly once, in a `finally`, so the line always gets cleared or finalized.
 */
export function startTerminalSpinner(message: string, stream: NodeJS.WriteStream = process.stdout, intervalMs = 80): () => void {
  if (!stream.isTTY) {
    stream.write(`${message}\n`);
    return () => {};
  }
  let frame = 0;
  const render = () => { stream.write(`\r${accent(FRAMES[frame % FRAMES.length]!)} ${muted(message)}`); frame++; };
  render();
  const timer = setInterval(render, intervalMs);
  timer.unref?.();
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    stream.write(`\r${" ".repeat(message.length + 2)}\r`);
  };
}
