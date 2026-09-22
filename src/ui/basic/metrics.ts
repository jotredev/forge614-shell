import { accent, border, danger, fit, warning } from "./theme.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";

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

export function usageTitle(label: string, locale: Locale = "en"): string {
  const t = getCatalog(locale).metrics;
  const names: Record<string, string> = { five_hour: t.usageFiveHourLimit, seven_day: t.usageWeeklyLimit, seven_day_opus: t.usageWeeklyOpus, seven_day_sonnet: t.usageWeeklySonnet, seven_day_oauth_apps: t.usageWeeklyConnectedApps, extra_usage: t.usageExtraUsage };
  return names[label] ?? (label.includes("_") ? label.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase()) + t.usageProviderSuffix : label);
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

/** Braille cells make a portable terminal ring without image-protocol support. */
export function contextRing(percent: number): string[] {
  const bits = [[1, 8], [2, 16], [4, 32], [64, 128]];
  const color = usageColor(percent);
  return Array.from({ length: 6 }, (_, row) => {
    const cells: string[] = [];
    for (let col = 0; col < 12; col++) {
      let mask = 0, filled = 0;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) {
        const dx = (col * 2 + x - 11.5) / 11, dy = (row * 4 + y - 11.5) / 11;
        const radius = Math.hypot(dx, dy);
        if (radius < 0.72 || radius > 1) continue;
        mask |= bits[y]![x]!;
        const angle = (Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2);
        if (angle / (Math.PI * 2) < Math.max(0, Math.min(100, percent)) / 100) filled++;
      }
      cells.push((filled ? color : border)(String.fromCharCode(0x2800 + mask)));
    }
    if (row === 2) {
      // Capped at 100% so the label never grows past the ring's fixed width, even if a report is briefly over.
      const label = `${Math.min(100, Math.round(percent))}%`;
      cells.splice(3, 6, fit(" ".repeat(Math.max(0, Math.floor((6 - label.length) / 2))) + color(label), 6));
    }
    return cells.join("");
  });
}
