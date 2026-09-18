import { expect, test } from "bun:test";
import { usageTitle, resetLabel, progressBar, contextRing, isDisplayableUsage } from "./metrics.ts";
import { stripVTControlCharacters } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";

test("usage labels and reset dates become human-readable without inventing provider meanings", () => {
  expect(usageTitle("five_hour")).toBe("5-hour limit");
  expect(usageTitle("seven_day")).toBe("Weekly limit");
  expect(usageTitle("nimbus_quill")).toBe("Nimbus Quill (provider)");
  expect(resetLabel("2026-09-20T02:00:00Z", Date.parse("2026-09-18T00:00:00Z"))).toBe("Resets in 2d 2h");
  expect(resetLabel("bad date")).toBe("Reset time unavailable");
});
test("graphs show measured percentages and remain bounded", () => {
  expect(stripVTControlCharacters(progressBar(75, 20))).toBe("█".repeat(15) + "░".repeat(5));
  const ring = contextRing(14);
  expect(ring.map(stripVTControlCharacters).join("\n")).toContain("14%");
  expect(ring.every(line => visibleWidth(line) === 12)).toBe(true);
});
test("internal Nimbus Quill usage is never exposed as a user quota", () => {
  expect(isDisplayableUsage("nimbus_quill")).toBe(false);
  expect(isDisplayableUsage("five_hour")).toBe(true);
  expect(isDisplayableUsage("seven_day")).toBe(true);
  expect(isDisplayableUsage("extra_usage")).toBe(true);
});
