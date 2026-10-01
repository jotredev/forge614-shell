import type { Component } from "@earendil-works/pi-tui";
import { background, bold, foreground, mix, muted, palette } from "./theme.ts";

type Letter = readonly [string, string, string];
type Half = "muted" | "foreground";

/** The three half-block rows of every character in Shell's OpenCode-shaped FORGE614 sign. */
const letters: Readonly<Record<string, Letter>> = {
  F: ["█▀▀▀", "█▀▀ ", "▀   "], O: ["█▀▀█", "█__█", "▀▀▀▀"], R: ["█▀▀▄", "█▄▄▀", "▀  ▀"], G: ["█▀▀▀", "█_▀█", "▀▀▀▀"], E: ["█▀▀▀", "█▀▀ ", "▀▀▀▀"],
  6: ["█▀▀▀", "█▀▀█", "▀▀▀▀"], 1: ["▀█ ", " █ ", "▀▀▀"], 4: ["█__█", "▀▀▀█", "   ▀"],
};

/** Renders one sign half, replacing `_` markers with their 25%-mixed empty shadow cells. */
function renderHalf(text: string, half: Half, color: boolean): string {
  if (!color) return text.replaceAll("_", " ");
  const painter = half === "muted" ? muted : foreground;
  const shadow = background(mix(palette.background, half === "muted" ? palette.muted : palette.foreground, 0.25));
  const drawn = text.split("_").map(cell => painter(cell)).join(shadow(" "));
  return half === "foreground" ? bold(drawn) : drawn;
}

/** Joins named letters with their one-column gaps for one row of a sign half. */
function row(text: string, index: number, half: Half, color: boolean): string {
  return text.split("").map(letter => renderHalf(letters[letter]![index]!, half, color)).join(" ");
}

/** Renders the responsive sign: wide at 43, stacked at 26, F614 at 18, and absent when it cannot fit. */
export function renderLogo(columns: number, rows: number, color = true): string[] {
  if (columns < 18 || rows < 12) return [];
  const forge = [0, 1, 2].map(index => row("FORGE", index, "muted", color));
  const digits = [0, 1, 2].map(index => row("614", index, "foreground", color));
  if (columns >= 43) return forge.map((line, index) => `${line}  ${digits[index]!}`);
  if (columns >= 26) return [...forge, "", ...digits];
  const f = letters["F"]!;
  return [0, 1, 2].map(index => `${renderHalf(f[index]!, "muted", color)} ${digits[index]!}`);
}

/** The CLI gets a colored responsive sign on a TTY and stable uncolored wide rows for a pipe. */
export function helpLogo(output: { isTTY?: boolean; columns?: number }): string[] {
  return output.isTTY ? renderLogo(output.columns ?? 0, Number.POSITIVE_INFINITY) : renderLogo(43, Number.POSITIVE_INFINITY, false);
}

/** The first transcript item: three breathing rows before the sign, then permanently collapsed after a person sends a message. */
export class ChatLogo implements Component {
  private visible = true;
  private readonly terminalRows: () => number;
  constructor(terminalRows: () => number = () => Number.POSITIVE_INFINITY) { this.terminalRows = terminalRows; }
  /** Permanently hides this opening-only sign for the current Shell session. */
  dismiss(): void { this.visible = false; }
  invalidate(): void {}
  render(width: number): string[] { return this.visible ? ["", "", "", ...renderLogo(width, this.terminalRows())] : []; }
}
