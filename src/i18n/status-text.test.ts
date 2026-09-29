import { expect, test } from "bun:test";
import { formatMoment, limitName, quotaStatusText } from "./status-text.ts";

/**
 * The reset moments of `/status` and `/f614:status` read in local time and in Shell's language, never as a machine date
 * («2026-10-03T23:22:22.000Z»): in the real-account test of 1.12.0 the owner saw that date in Codex's `/status`. The dates
 * are built with the local constructor, so the result does not depend on the time zone of whoever runs the test.
 */
test("formatMoment shows the local date and 12-hour time in each language, never an ISO date", () => {
  const evening = new Date(2026, 9, 3, 17, 22, 22).getTime();
  expect(formatMoment(evening, "en")).toBe("Oct 3, 5:22 PM");
  expect(formatMoment(evening, "es")).toBe("el 3 oct, 5:22 p.m.");
  const midnight = new Date(2027, 0, 15, 0, 5, 0).getTime();
  expect(formatMoment(midnight, "en")).toBe("Jan 15, 12:05 AM");
  expect(formatMoment(midnight, "es")).toBe("el 15 ene, 12:05 a.m.");
  const noon = new Date(2026, 11, 31, 12, 0, 0).getTime();
  expect(formatMoment(noon, "en")).toBe("Dec 31, 12:00 PM");
  expect(formatMoment(noon, "es")).toBe("el 31 dic, 12:00 p.m.");
  for (const locale of ["en", "es"] as const) expect(formatMoment(evening, locale)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
});

/** `/f614:status` uses the same limit names as the sidebar («five_hour» is what showed untranslated in the real-account test of 1.12.0). */
test("limitName gives the sidebar's names in both languages and never a raw provider key", () => {
  expect(limitName("five_hour", "en")).toBe("5-hour limit");
  expect(limitName("five_hour", "es")).toBe("Límite de 5 horas");
  expect(limitName("seven_day", "en")).toBe("Weekly limit");
  expect(limitName("seven_day", "es")).toBe("Límite semanal");
  expect(limitName("seven_day_opus", "es")).toBe("Semanal · Opus");
  expect(limitName("seven_day_sonnet", "en")).toBe("Weekly · Sonnet");
  // The other `rateLimitType` values of the SDK (`SDKRateLimitInfo`) and Shell's own «unspecified» bucket.
  expect(limitName("seven_day_overage_included", "en")).toBe("Weekly · extra usage included");
  expect(limitName("seven_day_overage_included", "es")).toBe("Semanal · uso adicional incluido");
  expect(limitName("overage", "en")).toBe("Extra usage");
  expect(limitName("overage", "es")).toBe("Uso adicional");
  expect(limitName("unspecified", "en")).toBe("Other limit");
  expect(limitName("unspecified", "es")).toBe("Otro límite");
});

/** The three statuses the SDK can send (`SDKRateLimitInfo.status`) are said in plain words; an unknown one does not show its internal key. */
test("quotaStatusText translates every status the SDK sends", () => {
  expect(quotaStatusText("allowed", "en")).toBe("allowed");
  expect(quotaStatusText("allowed", "es")).toBe("permitido");
  expect(quotaStatusText("allowed_warning", "en")).toBe("allowed, near the limit");
  expect(quotaStatusText("allowed_warning", "es")).toBe("permitido, cerca del límite");
  expect(quotaStatusText("rejected", "en")).toBe("blocked");
  expect(quotaStatusText("rejected", "es")).toBe("bloqueado");
  expect(quotaStatusText("something_new", "en")).toBe("something new");
  expect(quotaStatusText("something_new", "es")).toBe("something new");
  expect(quotaStatusText(undefined, "en")).toBe("not reported");
  expect(quotaStatusText(undefined, "es")).toBe("no reportado");
});
