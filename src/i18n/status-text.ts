import { getCatalog } from "./index.ts";
import type { Locale } from "./index.ts";

/**
 * A moment in the person's local time and in Shell's language, the way `/status` and `/f614:status` show when a limit resets:
 * `Oct 3, 5:22 PM` in English, `el 3 oct, 5:22 p.m.` in Spanish — never the machine's ISO date. Written by hand from the local
 * date parts (like `formatCount`) because `Intl` changes its words and spaces between versions, and the text has to be the same everywhere.
 */
export function formatMoment(milliseconds: number, locale: Locale = "en"): string {
  const t = getCatalog(locale).moments;
  const date = new Date(milliseconds);
  const hours = date.getHours();
  const time = `${hours % 12 || 12}:${String(date.getMinutes()).padStart(2, "0")} ${hours < 12 ? t.am : t.pm}`;
  return t.dateTime({ month: t.months[date.getMonth()]!, day: String(date.getDate()), time });
}

/**
 * The plain name of a plan limit, the one the sidebar shows («5-hour limit», «Weekly limit»), for a provider key such as `five_hour`
 * or `seven_day`. A key Shell does not know is spelled out in words with the provider suffix instead of showing the raw key.
 */
export function limitName(key: string, locale: Locale = "en"): string {
  const t = getCatalog(locale).metrics;
  const names: Record<string, string> = {
    five_hour: t.usageFiveHourLimit, seven_day: t.usageWeeklyLimit, seven_day_opus: t.usageWeeklyOpus, seven_day_sonnet: t.usageWeeklySonnet,
    seven_day_oauth_apps: t.usageWeeklyConnectedApps, seven_day_overage_included: t.usageWeeklyOverageIncluded,
    extra_usage: t.usageExtraUsage, overage: t.usageExtraUsage, unspecified: t.usageOtherLimit,
  };
  return names[key] ?? (key.includes("_") ? key.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase()) + t.usageProviderSuffix : key);
}

/**
 * A limit's status in plain words. The SDK sends `allowed`, `allowed_warning` or `rejected` (`SDKRateLimitInfo.status`); a value it may
 * add later shows with its underscores as spaces, and a missing one says it was not reported.
 */
export function quotaStatusText(status: string | undefined, locale: Locale = "en"): string {
  const t = getCatalog(locale).telemetry;
  if (status === undefined) return t.notReported;
  const words: Record<string, string> = { allowed: t.statusAllowed, allowed_warning: t.statusAllowedWarning, rejected: t.statusRejected };
  return words[status] ?? status.replaceAll("_", " ");
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
