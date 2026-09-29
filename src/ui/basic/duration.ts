/** Longest activity phrase (in characters) shown next to «Working»: enough for a sentence, short enough that the status line never wraps. */
const MAX_ACTIVITY_WIDTH = 60;

/**
 * The one formatter for every visible time counter (the «Working» indicator, each tool, the sidebar),
 * the same in every language: `45s`, `1m 27s`, `8m 23s`, and from an hour on `1h 02m` (minutes on two
 * digits, no seconds). Fractions are floored and negatives read as `0s`, so a counter never shows
 * decimals or a time that runs backwards.
 */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return `${total}s`;
  const two = (value: number) => String(value).padStart(2, "0");
  if (total < 3600) return `${Math.floor(total / 60)}m ${two(total % 60)}s`;
  return `${Math.floor(total / 3600)}h ${two(Math.floor((total % 3600) / 60))}m`;
}

/**
 * The status-line text while a turn runs: `Working · <what it is doing> · <time>`, or only
 * `Working · <time>` when nothing specific is running. The activity is squeezed to one line and cut
 * at a reasonable length, because engines may hand over a multi-line or very long command.
 */
export function workingStatus(label: string, activity: string | undefined, elapsedSeconds: number): string {
  const line = (activity ?? "").replace(/\s+/g, " ").trim();
  const letters = Array.from(line);
  const shown = letters.length > MAX_ACTIVITY_WIDTH ? `${letters.slice(0, MAX_ACTIVITY_WIDTH - 1).join("").trimEnd()}…` : line;
  return [label, ...(shown ? [shown] : []), formatDuration(elapsedSeconds)].join(" · ");
}
