import { expect, test } from "bun:test";
import { usageTitle, resetLabel, progressBar, contextRing, isDisplayableUsage, effortLabel, effortDescription, REASONING_DEFAULT_LABEL, compactNumber, usageColor, formatCount, formatUsd } from "./metrics.ts";
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
  // The number is drawn with block digits since the second real-account test (see the ring tests at the end of this file), not written as text.
  expect(ring.every(line => visibleWidth(line) === 13)).toBe(true);
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
  // A report over 100% never draws a broken label: it is capped at «100» (checked with block digits in the ring tests at the end of this file).
  expect(contextRing(105).every(line => visibleWidth(line) === 13)).toBe(true);
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

/** Numbers in the sidebar follow each language's own convention: Spanish groups thousands with a space and uses a decimal comma, English uses a comma and a decimal point. */
test("token counts and dollar amounts use each language's own separators", () => {
  expect(formatCount(2996, "es")).toBe("2 996");
  expect(formatCount(2996, "en")).toBe("2,996");
  expect(formatCount(1234567, "es")).toBe("1 234 567");
  expect(formatCount(700, "es")).toBe("700");
  expect(formatUsd(0.6723, "es")).toBe("$0,67");
  expect(formatUsd(0.6723, "en")).toBe("$0.67");
});

/** The braille dots of the ring's rows as (x, y) points of its 26×24-dot grid (2×4 dots per cell, the same layout `contextRing` draws with). */
function ringDots(rows: string[]): [number, number][] {
  const bits = [[1, 8], [2, 16], [4, 32], [64, 128]];
  const points: [number, number][] = [];
  rows.map(stripVTControlCharacters).forEach((row, r) => Array.from(row).forEach((char, c) => {
    const mask = char.charCodeAt(0) - 0x2800;
    if (mask < 0 || mask > 255) return;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) if (mask & bits[y]![x]!) points.push([c * 2 + x, r * 4 + y]);
  }));
  return points;
}
/** The seven cells of the ring's hole in the two rows either side of its center (the 3rd and 4th) that hold the number, as plain text without colors. */
const numberRows = (percent: number) => contextRing(percent).slice(2, 4).map(row => stripVTControlCharacters(row).slice(3, 10));

/**
 * Came out of the second real-account test: the number in the middle of the CONTEXT ring, drawn with braille dots, read blurry. It is now
 * drawn with solid block digits like a digital clock («█», «▀», «▄»), two text rows tall, in the two rows either side of the ring's center,
 * inside the seven cells of the hole those rows have in a ring of 13 cells (one more than before, so the number sits exactly on the
 * middle cell). Only digits are drawn: «N% used» is written beside the ring, and three glyphs with a «%» would not fit the hole. The «1» is
 * one cell wide, and at «100» the two zeros share their middle column so the three digits still fit. The expected text is written
 * out digit by digit, from 0 to 9, so any change to the shapes shows up here.
 */
test("the ring's number is drawn with solid block digits, centered in the ring's hole, for every digit", () => {
  const digits: Record<string, [string, string]> = {
    "0": ["█▀█", "█▄█"], "1": ["█", "█"], "2": ["▀▀█", "█▄▄"], "3": ["▀▀█", "▄▄█"], "4": ["█▄█", "  █"],
    "5": ["█▀▀", "▄▄█"], "6": ["█▀▀", "█▄█"], "7": ["▀▀█", "  █"], "8": ["█▀█", "███"], "9": ["█▀█", "▀▀█"],
  };
  for (const [digit, [top, bottom]] of Object.entries(digits)) {
    const pad = " ".repeat((7 - top.length) / 2);
    expect(numberRows(Number(digit))).toEqual([pad + top + pad, pad + bottom + pad]);
  }
  expect(numberRows(3)).toEqual(["  ▀▀█  ", "  ▄▄█  "]);
  expect(numberRows(10)).toEqual([" █ █▀█ ", " █ █▄█ "]);
  expect(numberRows(47)).toEqual(["█▄█ ▀▀█", "  █   █"]);
  expect(numberRows(100)).toEqual(["█ █▀█▀█", "█ █▄█▄█"]);
  expect(numberRows(105)).toEqual(numberRows(100));
});

/** The ring keeps a width of 13 cells and six rows for every percentage, and none of its cells is made of braille dots where the number is: that is what looked blurry. */
test("the ring is 13 cells wide and six rows tall, and the number never uses braille", () => {
  for (const percent of [0, 3, 10, 47, 88, 100, 105]) {
    const ring = contextRing(percent);
    expect(ring).toHaveLength(6);
    expect(ring.every(line => visibleWidth(line) === 13)).toBe(true);
    for (const row of numberRows(percent)) expect(/[⠀-⣿]/.test(row.slice(3, 10))).toBe(false);
  }
});

/** Drawing the number must not touch the ring itself: its braille dots are the same for any percentage; only the digits in the hole differ. */
test("the ring keeps its own dots when the number is drawn", () => {
  expect(ringDots(contextRing(3)).length).toBeGreaterThan(100);
  expect(ringDots(contextRing(3))).toEqual(ringDots(contextRing(72)));
  expect(ringDots(contextRing(3))).toEqual(ringDots(contextRing(100)));
});
