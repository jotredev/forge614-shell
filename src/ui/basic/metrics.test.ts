import { afterAll, beforeAll, expect, test } from "bun:test";
import { usageTitle, resetLabel, progressBar, contextRing, isDisplayableUsage, effortLabel, effortDescription, REASONING_DEFAULT_LABEL, compactNumber, usageColor, formatCount, formatUsd } from "./metrics.ts";
import { stripVTControlCharacters } from "node:util";
import { resetCapabilitiesCache, setCapabilityOverrides, visibleWidth } from "@earendil-works/pi-tui";

/** The color tests below read exact RGB codes, so they pin true color instead of depending on the terminal that runs the suite. */
beforeAll(() => setCapabilityOverrides({ trueColor: true }));
afterAll(() => resetCapabilitiesCache());

/** The empty part of a usage bar and of the ring is drawn in the faint gray (63;63;70), not in the old blue-gray border color. */
test("the empty part of the usage bar and of the ring uses the faint gray", () => {
  expect(progressBar(50, 10)).toContain("\x1b[38;2;63;63;70m░░░░░");
  expect(contextRing(10).join("")).toContain("\x1b[38;2;63;63;70m");
  expect(progressBar(50, 10)).not.toContain("49;69;78");
});

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
  // The number is written as normal text since the third real-account test (see the ring tests at the end of this file).
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
  // A report over 100% never draws a broken label: it is capped at «100%» (checked in the ring tests at the end of this file).
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

/** The braille dots of the ring's rows as (x, y) points of its 26×28-dot grid (2×4 dots per cell, the same layout `contextRing` draws with). */
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
/** One row of the ring as plain text without colors; the empty braille cell (U+2800) is written as a space so expected rows can be read. */
const plainRow = (percent: number, row: number) => stripVTControlCharacters(contextRing(percent)[row]!).replace(/\u2800/g, " ");
/** The nine cells of the ring's hole (columns 2 to 10) on its middle row (the 4th of 7), where the number is written, as plain text. */
const numberRow = (percent: number) => plainRow(percent, 3).slice(2, 11);

/**
 * Came out of the third real-account test: the number in the middle of the CONTEXT ring, drawn with solid block digits, could not be read
 * (the «8» looked like a padlock). It is now normal text, «8%», on the ring's middle row. The ring has seven rows so that its center falls
 * in the middle of a row (with six, the center is the line between two rows and one line of text can never sit on it). The text is
 * centered on the middle cell of the 13; when its width is even («8%», «100%») it can only be half a cell to the left. The expected rows
 * are written out for one, two and three digits and the «100» cap, so any change to the placement shows up here.
 */
test("the ring's number is written as normal text with a «%», centered in the ring's hole", () => {
  expect(numberRow(8)).toBe("   8%    ");
  expect(numberRow(0)).toBe("   0%    ");
  expect(numberRow(47)).toBe("   47%   ");
  expect(numberRow(100)).toBe("  100%   ");
  expect(numberRow(105)).toBe(numberRow(100));
  expect(numberRow(7.6)).toBe("   8%    ");
});

/** Vertically the number sits on the middle row (the 4th of 7) and nowhere else, and the ring's own rows hold no text. */
test("the ring's number is on its middle row and no other row holds text", () => {
  for (const percent of [8, 47, 100]) {
    const rows = Array.from({ length: 7 }, (_, row) => plainRow(percent, row));
    rows.forEach((row, index) => expect({ percent, index, text: /[0-9%]/.test(row) }).toEqual({ percent, index, text: index === 3 }));
  }
});

/** The ring keeps a width of 13 cells and seven rows for every percentage, and no solid block glyph is left over from the old digits, which could not be read. */
test("the ring is 13 cells wide and seven rows tall, and never uses block digits", () => {
  for (const percent of [0, 3, 10, 47, 88, 100, 105]) {
    const ring = contextRing(percent);
    expect(ring).toHaveLength(7);
    expect(ring.every(line => visibleWidth(line) === 13)).toBe(true);
    expect(ring.some(line => /[█▀▄]/.test(stripVTControlCharacters(line)))).toBe(false);
  }
});

/** Writing the number must not touch the ring itself: its braille dots are the same for any percentage; only the text in the hole differs. */
test("the ring keeps its own dots when the number is written", () => {
  expect(ringDots(contextRing(3)).length).toBeGreaterThan(100);
  expect(ringDots(contextRing(3))).toEqual(ringDots(contextRing(72)));
  expect(ringDots(contextRing(3))).toEqual(ringDots(contextRing(100)));
});

/** The ring is round: its dots are symmetric left-right and top-bottom around the center of its 26×28-dot grid, so the text on the middle row really is in the middle. */
test("the ring's dots are symmetric around its center", () => {
  const dots = ringDots(contextRing(50));
  const key = ([x, y]: [number, number]) => `${x},${y}`;
  const set = new Set(dots.map(key));
  for (const [x, y] of dots) {
    expect({ x, y, mirrorX: set.has(key([25 - x, y])) }).toEqual({ x, y, mirrorX: true });
    expect({ x, y, mirrorY: set.has(key([x, 27 - y])) }).toEqual({ x, y, mirrorY: true });
  }
});
