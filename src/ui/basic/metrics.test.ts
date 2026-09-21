import { expect, test } from "bun:test";
import { usageTitle, resetLabel, progressBar, contextRing, isDisplayableUsage, effortLabel, effortDescription, REASONING_DEFAULT_LABEL, compactNumber, usageColor } from "./metrics.ts";
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
test("large counts use 1M instead of 1000k, and keep one decimal where rounding to a whole unit would lose real precision", () => {
  expect(compactNumber(999)).toBe("999");
  expect(compactNumber(1_500)).toBe("1.5k");
  expect(compactNumber(43_000)).toBe("43k");
  expect(compactNumber(500_000)).toBe("500k");
  expect(compactNumber(1_000_000)).toBe("1M");
  expect(compactNumber(1_500_000)).toBe("1.5M");
});
test("a usage meter changes color as it fills: normal, then amber near the limit, then red at or over it", () => {
  const normal = progressBar(50, 10);
  const near = progressBar(90, 10);
  const over = progressBar(100, 10);
  expect(normal).toContain("70;222;224"); // accent — plenty of room left
  expect(normal).not.toContain("237;183;88"); expect(normal).not.toContain("255;102;136");
  expect(near).toContain("237;183;88"); // warning
  expect(near).not.toContain("255;102;136");
  expect(over).toContain("255;102;136"); // danger
  const ringOver = contextRing(105).map(stripVTControlCharacters).join("\n");
  expect(ringOver).toContain("100%"); // never renders a broken >100% label
});
test("reasoning levels get a plain-language label and description instead of an unexplained raw value", () => {
  expect(effortLabel("low")).toBe("Low");
  expect(effortLabel("xhigh")).toBe("Xhigh");
  expect(effortLabel(undefined)).toBe(REASONING_DEFAULT_LABEL);
  expect(effortLabel(null)).toBe(REASONING_DEFAULT_LABEL);
  expect(effortLabel("")).toBe(REASONING_DEFAULT_LABEL);
  expect(effortDescription("low")).not.toBe("");
  expect(effortDescription("medium")).not.toBe("");
  expect(effortDescription("high")).not.toBe("");
  expect(effortDescription("xhigh")).not.toBe("");
});
test("internal Nimbus Quill usage is never exposed as a user quota", () => {
  expect(isDisplayableUsage("nimbus_quill")).toBe(false);
  expect(isDisplayableUsage("five_hour")).toBe(true);
  expect(isDisplayableUsage("seven_day")).toBe(true);
  expect(isDisplayableUsage("extra_usage")).toBe(true);
});
