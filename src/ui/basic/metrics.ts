import { accent, border, danger, warning } from "./theme.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";
import { limitName } from "../../i18n/status-text.ts";

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

/** "1M", not "1000k" — and keeps one decimal (e.g. "1.5k") when rounding to a whole unit would lose real precision. */
export function compactNumber(value: number): string {
  const unit = (divisor: number, suffix: string) => {
    const scaled = value / divisor;
    const rounded = Math.round(scaled * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}${suffix}`;
  };
  if (value >= 1_000_000) return unit(1_000_000, "M");
  if (value >= 1_000) return unit(1_000, "k");
  return String(value);
}

/** Whole number with the language's thousands separator: "2 996" in Spanish, "2,996" in English. Written by hand because `Intl` skips the separator on four-digit numbers in Spanish. */
export function formatCount(value: number, locale: Locale = "en"): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, locale === "es" ? " " : ",");
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

/** Cells the context ring is wide (one more than it used to be, so its middle cell has a whole hole either side), and the cells of its hole in the two rows in the middle: the ones no ring dot touches, where the number is drawn. */
const RING_COLS = 13;
const RING_HOLE = { from: 3, width: 7 };

/**
 * Digits for the number in the middle of the context ring, like a digital clock: two text rows tall, in the solid blocks «█», «▀» and «▄»,
 * each as its [top row, bottom row]. All are three cells wide except the «1», a one-cell bar; with a cell of space between digits
 * every number is an odd width, so it sits exactly on the ring's middle cell.
 */
const RING_DIGITS: Record<string, [string, string]> = {
  "0": ["█▀█", "█▄█"], "1": ["█", "█"], "2": ["▀▀█", "█▄▄"], "3": ["▀▀█", "▄▄█"], "4": ["█▄█", "  █"],
  "5": ["█▀▀", "▄▄█"], "6": ["█▀▀", "█▄█"], "7": ["▀▀█", "  █"], "8": ["█▀█", "███"], "9": ["█▀█", "▀▀█"],
};

/**
 * The two rows of the ring's number, `RING_HOLE.width` cells wide and centered in it. The number is capped at 100 and written without «%»:
 * «N% used» is beside the ring, and a «%» would not fit next to two digits. Only «100» is too wide for the hole with a cell between
 * its digits, so its two zeros share the column where they meet.
 */
function ringNumberRows(percent: number): [string, string] {
  const glyphs = Array.from(String(Math.max(0, Math.min(100, Math.round(percent))))).map(digit => RING_DIGITS[digit]!);
  const draw = (share: boolean): [string, string] => {
    let top = "", bottom = "", previous = 0;
    glyphs.forEach(([glyphTop, glyphBottom], index) => {
      const shares = share && previous === 3 && glyphTop.length === 3;
      top += (index === 0 || shares ? "" : " ") + (shares ? glyphTop.slice(1) : glyphTop);
      bottom += (index === 0 || shares ? "" : " ") + (shares ? glyphBottom.slice(1) : glyphBottom);
      previous = glyphTop.length;
    });
    return [top, bottom];
  };
  const [top, bottom] = draw(false)[0].length > RING_HOLE.width ? draw(true) : draw(false);
  const left = " ".repeat(Math.floor((RING_HOLE.width - top.length) / 2));
  const fill = (row: string) => (left + row).padEnd(RING_HOLE.width);
  return [fill(top), fill(bottom)];
}

/** Braille cells make a portable terminal ring without image-protocol support; the number in its hole is drawn with solid blocks (see `ringNumberRows`). */
export function contextRing(percent: number): string[] {
  const bits = [[1, 8], [2, 16], [4, 32], [64, 128]];
  const color = usageColor(percent);
  const number = ringNumberRows(percent);
  return Array.from({ length: 6 }, (_, row) => {
    const cells: string[] = [];
    for (let col = 0; col < RING_COLS; col++) {
      const digitRow = number[row - 2];
      if (digitRow !== undefined && col >= RING_HOLE.from && col < RING_HOLE.from + RING_HOLE.width) {
        const char = digitRow[col - RING_HOLE.from]!;
        cells.push(char === " " ? " " : color(char));
        continue;
      }
      let mask = 0, filled = 0;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) {
        const dx = (col * 2 + x - 12.5) / 12, dy = (row * 4 + y - 11.5) / 11;
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
