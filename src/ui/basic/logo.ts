import { visibleWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import { bold, foreground, muted } from "./theme.ts";

type Letter = readonly [string, string, string];
type Half = "muted" | "foreground";

/** The three half-block rows of every character in Shell's OpenCode-shaped FORGE614 sign. */
const letters: Readonly<Record<string, Letter>> = {
  F: ["█▀▀▀", "█▀▀ ", "▀   "], O: ["█▀▀█", "█__█", "▀▀▀▀"], R: ["█▀▀▄", "█▄▄▀", "▀  ▀"], G: ["█▀▀▀", "█_▀█", "▀▀▀▀"], E: ["█▀▀▀", "█▀▀ ", "▀▀▀▀"],
  6: ["█▀▀▀", "█▀▀█", "▀▀▀▀"], 1: ["▀█ ", " █ ", "▀▀▀"], 4: ["█__█", "▀▀▀█", "   ▀"],
};

/** Renders one sign half, treating hollow-cell markers as ordinary spaces with no background color. */
function renderHalf(text: string, half: Half, color: boolean): string {
  text = text.replaceAll("_", " ");
  if (!color) return text;
  const painter = half === "muted" ? muted : foreground;
  const drawn = painter(text);
  return half === "foreground" ? bold(drawn) : drawn;
}

/** Joins named letters with their one-column gaps for one row of a sign half. */
function row(text: string, index: number, half: Half, color: boolean): string {
  return text.split("").map(letter => renderHalf(letters[letter]![index]!, half, color)).join(" ");
}

/** Doubles a half-block row into its upper and lower full-block rows for the 82-column sign. */
function doubleRow(text: string): readonly [string, string] {
  const upper = text.split("").map(cell => cell === "█" || cell === "▀" ? "██" : "  ").join("");
  const lower = text.split("").map(cell => cell === "█" || cell === "▄" ? "██" : "  ").join("");
  return [upper, lower];
}

/** Renders the responsive sign: double-size at 82, wide at 43, stacked at 26, F614 at 18, and absent when it cannot fit. */
export function renderLogo(columns: number, rows: number, color = true): string[] {
  if (columns < 18 || rows < 12) return [];
  const plainForge = [0, 1, 2].map(index => row("FORGE", index, "muted", false));
  const plainDigits = [0, 1, 2].map(index => row("614", index, "foreground", false));
  const forge = [0, 1, 2].map(index => row("FORGE", index, "muted", color));
  const digits = [0, 1, 2].map(index => row("614", index, "foreground", color));
  if (columns >= 82) {
    const forgeWidth = plainForge[0]!.length * 2;
    const large = plainForge.flatMap((line, index) => {
      const [forgeTop, forgeBottom] = doubleRow(line);
      const [digitsTop, digitsBottom] = doubleRow(plainDigits[index]!);
      return [`${forgeTop}    ${digitsTop}`, `${forgeBottom}    ${digitsBottom}`];
    }).slice(0, -1);
    return color ? large.map(line => `${muted(line.slice(0, forgeWidth))}    ${bold(foreground(line.slice(forgeWidth + 4)))}`) : large;
  }
  if (columns >= 43) return forge.map((line, index) => `${line}  ${digits[index]!}`);
  if (columns >= 26) return [...forge, "", ...digits];
  const f = letters["F"]!;
  return [0, 1, 2].map(index => `${renderHalf(f[index]!, "muted", color)} ${digits[index]!}`);
}

/** The CLI gets a normal-size colored responsive sign on a TTY and stable uncolored wide rows for a pipe. */
export function helpLogo(output: { isTTY?: boolean; columns?: number }): string[] {
  return output.isTTY ? renderLogo(Math.min(output.columns ?? 0, 81), Number.POSITIVE_INFINITY) : renderLogo(43, Number.POSITIVE_INFINITY, false);
}

/** Assembles the complete `--help` rows so every output mode keeps one separator only when a sign exists. */
export function helpLines(output: { isTTY?: boolean; columns?: number }, help: string): string[] {
  const logo = helpLogo(output);
  return [...logo, ...(logo.length ? [""] : []), help];
}

/** The first transcript item: centered in the visible chat area, then permanently collapsed after a person sends a message. */
export class ChatLogo implements Component {
  private visible = true;
  private readonly visibleRows: (width: number) => number;
  private readonly terminalRows: () => number;
  constructor(visibleRows: (width: number) => number = () => Number.POSITIVE_INFINITY, terminalRows: () => number = () => Number.POSITIVE_INFINITY) {
    this.visibleRows = visibleRows; this.terminalRows = terminalRows;
  }
  /** Permanently hides this opening-only sign for the current Shell session. */
  dismiss(): void { this.visible = false; }
  invalidate(): void {}
  render(width: number): string[] {
    if (!this.visible) return [];
    const rows = renderLogo(width, this.terminalRows());
    const top = Math.max(0, Math.floor((this.visibleRows(width) - rows.length) / 2));
    return [...Array(top).fill(""), ...rows.map(line => " ".repeat(Math.max(0, Math.floor((width - visibleWidth(line)) / 2))) + line)];
  }
}
