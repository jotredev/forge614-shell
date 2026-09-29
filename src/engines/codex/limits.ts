import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";

/** Whether `minutes` is within 5% of `expected`, as Codex's `is_approximate_window` decides it. */
const near = (minutes: number, expected: number): boolean => minutes >= expected * 0.95 && minutes <= expected * 1.05;

/**
 * The plain name of a Codex usage limit, taken from how long its window is (`windowDurationMins`, `v2/RateLimitWindow.ts`) and not from
 * Codex's own «primary» and «secondary», which say nothing to the person. It follows `get_limits_duration` in Codex's own `/status`: 5 hours,
 * daily, weekly, monthly (30 days) and annual, each within 5%. Any other length is said in days (a whole number of them), hours or minutes,
 * and a window with no length is a «usage limit» — «additional usage limit» for the second one, so two limits never read the same.
 */
export function limitLabel(minutes: number | null | undefined, secondary: boolean, locale: Locale): string {
  const t = getCatalog(locale).metrics;
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return secondary ? t.usageAdditionalLimit : t.usageGenericLimit;
  if (near(minutes, 5 * 60)) return t.usageFiveHourLimit;
  if (near(minutes, 24 * 60)) return t.usageDailyLimit;
  if (near(minutes, 7 * 24 * 60)) return t.usageWeeklyLimit;
  if (near(minutes, 30 * 24 * 60)) return t.usageMonthlyLimit;
  if (near(minutes, 365 * 24 * 60)) return t.usageAnnualLimit;
  if (minutes % (24 * 60) === 0) return t.usageDaysLimit({ count: minutes / (24 * 60) });
  if (minutes % 60 === 0) return t.usageHoursLimit({ count: minutes / 60 });
  return t.usageMinutesLimit({ count: Math.round(minutes) });
}
