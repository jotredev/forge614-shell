import { accent, border, danger, warning } from "./theme.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";
import { compactNumber, formatCount, limitName } from "../../i18n/status-text.ts";

// The number formats live with the status texts (an engine cannot import from the UI); the sidebar reads them from here.
export { compactNumber, formatCount };

/** A usage meter's own color escalates as it fills — muted at first, amber near the limit, red at or over it — instead of always looking the same regardless of how close you are to running out. */
export function usageColor(percent: number): (text: string) => string {
  if (percent >= 100) return danger;
  if (percent >= 85) return warning;
  return accent;
}

/** The engine's own default — Shell never resolves this to a concrete level. Kept short: it also has to fit the sidebar's narrow column. English-only constant kept for callers that cannot pass a locale; prefer `getCatalog(locale).metrics.reasoningDefaultLabel` wherever a locale is known. */
export const REASONING_DEFAULT_LABEL = "Default (auto)";

export function effortLabel(level?: string | null, locale: Locale = "en"): string {
  return level ? level.charAt(0).toUpperCase() + level.slice(1) : getCatalog(locale).metrics.reasoningDefaultLabel;
}

function effortDescriptions(locale: Locale): Record<string, string> {
  const t = getCatalog(locale).metrics;
  return { low: t.effortLow, medium: t.effortMedium, high: t.effortHigh, xhigh: t.effortXhigh, max: t.effortMax };
}

export function effortDescription(level: string, locale: Locale = "en"): string {
  return effortDescriptions(locale)[level] ?? "";
}

/** Dollar amount with two decimals and the language's decimal mark: "$0,67" in Spanish, "$0.67" in English. */
export function formatUsd(value: number, locale: Locale = "en"): string {
  const fixed = value.toFixed(2);
  return `$${locale === "es" ? fixed.replace(".", ",") : fixed}`;
}

/** The name the sidebar and `/f614:status` give a plan limit; it lives in `limitName` so both say the same words. */
export function usageTitle(label: string, locale: Locale = "en"): string {
  return limitName(label, locale);
}

/** Provider-internal buckets are not stable user-facing plan limits. */
export function isDisplayableUsage(label: string): boolean {
  return label !== "nimbus_quill";
}
export function resetLabel(reset?: string, now = Date.now(), locale: Locale = "en"): string {
  const t = getCatalog(locale).metrics;
  if (!reset) return t.resetTimeUnavailable;
  if (/^\d+[dhm](\s+\d+[dhm])*$/.test(reset)) return t.resetsIn({ time: reset });
  const timestamp = Date.parse(reset);
  if (!Number.isFinite(timestamp)) return t.resetTimeUnavailable;
  const minutes = Math.ceil((timestamp - now) / 60000);
  if (minutes <= 0) return t.awaitingUpdatedLimit;
  if (minutes >= 1440) return t.resetsIn({ time: `${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h` });
  if (minutes >= 60) return t.resetsIn({ time: `${Math.floor(minutes / 60)}h ${minutes % 60}m` });
  return t.resetsIn({ time: `${minutes}m` });
}
export function progressBar(percent: number, width: number): string {
  const cells = Math.max(1, Math.floor(width));
  const used = Math.max(0, Math.min(cells, Math.round(percent / 100 * cells)));
  return usageColor(percent)("█".repeat(used)) + border("░".repeat(cells - used));
}

/** Cells the context ring is wide and rows it is tall. Both are odd on purpose: its center falls on the middle cell of the middle row, which is where the number is written. */
const RING_COLS = 13;
const RING_ROWS = 7;

/**
 * The ring's number as normal text, e.g. «8%»: whole, between 0 and 100 (a report over 100% is capped, so a broken label is never drawn).
 * Blocks drawn as digits could not be read (the «8» looked like a padlock).
 */
function ringLabel(percent: number): string {
  return `${Math.max(0, Math.min(100, Math.round(percent)))}%`;
}

/**
 * Braille cells make a portable terminal ring without image-protocol support. Its number is plain text on the middle row, centered on the middle
 * cell of the 13: when the text is an even number of cells wide («8%», «100%») it can only sit half a cell to the left. The ring is a circle of
 * 12 dots of radius around the center of its 26×28-dot grid, so its hole is empty on that row where the text goes.
 */
export function contextRing(percent: number): string[] {
  const bits = [[1, 8], [2, 16], [4, 32], [64, 128]];
  const color = usageColor(percent);
  const label = ringLabel(percent);
  const middleRow = Math.floor(RING_ROWS / 2);
  const labelFrom = Math.floor((RING_COLS - label.length) / 2);
  return Array.from({ length: RING_ROWS }, (_, row) => {
    const cells: string[] = [];
    for (let col = 0; col < RING_COLS; col++) {
      if (row === middleRow && col >= labelFrom && col < labelFrom + label.length) {
        cells.push(color(label[col - labelFrom]!));
        continue;
      }
      let mask = 0, filled = 0;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) {
        const dx = (col * 2 + x - 12.5) / 12, dy = (row * 4 + y - 13.5) / 12;
        const radius = Math.hypot(dx, dy);
        if (radius < 0.72 || radius > 1) continue;
        mask |= bits[y]![x]!;
        const angle = (Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2);
        if (angle / (Math.PI * 2) < Math.max(0, Math.min(100, percent)) / 100) filled++;
      }
      cells.push((filled ? color : border)(String.fromCharCode(0x2800 + mask)));
    }
    return cells.join("");
  });
}
