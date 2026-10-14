import { visibleWidth } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";

/**
 * The fake language `tableFences` gives to the code block it puts in place of a table. pi-tui's Markdown draws every table with box lines (`renderTable` is private and its borders are fixed), so Shell never lets it
 * see one: the table travels as a fenced block with this language, and the theme draws it itself (`renderTable` below) when `highlightCode` is called with it.
 */
export const TABLE_LANG = "f614-table";

/** Columns between two columns of a table. */
const COLUMN_GAP = 2;
/** Columns of space on each side of a table; the header's background covers them. */
const TABLE_PADDING = 1;
/** The longest word a column is kept wide enough for; a longer one is cut where it has to be. */
const MAX_UNBROKEN_WORD = 30;

/** The fence of a code block, with the indent and quote marks in front of it. */
const FENCE = /^((?:[ >]|[-+*] |\d{1,9}[.)] )*)(`{3,}|~{3,})(.*)$/;
/** Whatever a line starts with that is not its text: spaces and quote marks. */
const LEADING = /^[ >]*/;
/** A table's second row: cells of dashes with optional colons. */
const DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

/** The cells of a table row: the pipes at the ends do not count, `\|` is a pipe inside a cell, and each cell is trimmed. */
export function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  return text.split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, "|"));
}

/**
 * `markdown` with every GFM table (outside code blocks) replaced by a fenced block of language `TABLE_LANG` holding the table's own lines. A table is a row with pipes, followed by a delimiter row with the same number of
 * cells, followed by the rows with pipes up to a blank line. A table that starts after a list marker («- | a | b |») is left as it is and pi-tui draws it.
 */
export function tableFences(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let open: { char: string; length: number } | undefined;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const fence = FENCE.exec(line);
    if (open) {
      if (fence && fence[2]![0] === open.char && fence[2]!.length >= open.length && fence[3]!.trim() === "") open = undefined;
      out.push(line);
      continue;
    }
    if (fence && !(fence[2]![0] === "`" && fence[3]!.includes("`"))) { open = { char: fence[2]![0]!, length: fence[2]!.length }; out.push(line); continue; }
    const prefix = LEADING.exec(line)![0];
    const header = line.slice(prefix.length);
    const delimiter = lines[index + 1]?.replace(LEADING, "");
    if (header.includes("|") && delimiter !== undefined && DELIMITER.test(delimiter) && splitRow(delimiter).length === splitRow(header).length && (splitRow(header).length > 1 || delimiter.includes("|"))) {
      let end = index + 2;
      while (end < lines.length && lines[end]!.replace(LEADING, "").includes("|")) end++;
      out.push(`${prefix}\`\`\`${TABLE_LANG}`, ...lines.slice(index, end), `${prefix}\`\`\``);
      index = end - 1;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** How a cell's Markdown is drawn: its rows (with the inline format) for a column `width` wide. The theme gives it, so the cell has the same bold, `code` and links as the rest of the text. */
export type CellRenderer = (text: string, width: number) => string[];

/** The widest and the longest-word width of a cell's rows, as the column needs them. */
function measure(cell: CellRenderer, text: string): { natural: number; word: number } {
  const rows = cell(text, 10_000).map(row => row.replace(/ +$/, ""));
  const natural = Math.max(0, ...rows.map(row => visibleWidth(row)));
  const word = Math.max(1, ...rows.flatMap(row => stripVTControlCharacters(row).split(/\s+/)).map(piece => Math.min(visibleWidth(piece), MAX_UNBROKEN_WORD)));
  return { natural, word };
}

/**
 * The widths of the columns so the table fits `available` columns: each at its natural width when everything fits; otherwise each at least as wide as its longest word, and the room left is shared in proportion to how
 * much each column wants to grow. When even the longest words do not fit, the columns are scaled down together (a word then breaks where the column ends).
 */
export function columnWidths(natural: number[], words: number[], available: number): number[] {
  const count = natural.length;
  const room = Math.max(count, available - COLUMN_GAP * (count - 1));
  if (natural.reduce((sum, width) => sum + width, 0) <= room) return natural.map(width => Math.max(1, width));
  const minimum = words.map((word, i) => Math.min(word, natural[i]!));
  const minimumTotal = minimum.reduce((sum, width) => sum + width, 0);
  if (minimumTotal >= room) {
    const widths = minimum.map(width => Math.max(1, Math.floor((width * room) / minimumTotal)));
    for (let i = 0; widths.reduce((sum, width) => sum + width, 0) < room; i = (i + 1) % count) widths[i]!++;
    return widths;
  }
  const growth = natural.map((width, i) => width - minimum[i]!);
  const growthTotal = growth.reduce((sum, value) => sum + value, 0);
  const extra = room - minimumTotal;
  const widths = minimum.map((width, i) => width + Math.floor((growth[i]! * extra) / growthTotal));
  for (let i = 0; widths.reduce((sum, width) => sum + width, 0) < room && growthTotal > 0; i = (i + 1) % count) if (widths[i]! < natural[i]!) widths[i]!++;
  return widths;
}

/**
 * The rows of a table with no lines: the header on the surface background, in bold, from edge to edge of the table; the rows below it with no background; the columns `COLUMN_GAP` apart and aligned, a long cell broken
 * inside its column. `source` is the table's Markdown lines, `width` the most the table may take, `cell` draws one cell and `paintHeader` puts the header's bold and background on a full row.
 */
export function renderTable(source: string, width: number, cell: CellRenderer, paintHeader: (row: string) => string): string[] {
  const lines = source.split("\n").filter(line => line.trim() !== "");
  if (lines.length < 2) return [];
  const header = splitRow(lines[0]!.replace(LEADING, ""));
  const body = lines.slice(2).map(line => splitRow(line.replace(LEADING, "")));
  const count = header.length;
  const grid = [header, ...body].map(row => Array.from({ length: count }, (_, i) => row[i] ?? ""));
  const measures = Array.from({ length: count }, (_, i) => {
    const each = grid.map(row => measure(cell, row[i]!));
    return { natural: Math.max(...each.map(item => item.natural)), word: Math.max(...each.map(item => item.word)) };
  });
  const widths = columnWidths(measures.map(item => item.natural), measures.map(item => item.word), width - TABLE_PADDING * 2);
  const total = widths.reduce((sum, value) => sum + value, 0) + COLUMN_GAP * (count - 1) + TABLE_PADDING * 2;
  const pad = " ".repeat(TABLE_PADDING);
  const rowsOf = (cells: string[]): string[] => {
    const drawn = cells.map((text, i) => {
      const rows = cell(text, widths[i]!);
      return (rows.length ? rows : [""]).map(row => row + " ".repeat(Math.max(0, widths[i]! - visibleWidth(row))));
    });
    const height = Math.max(...drawn.map(rows => rows.length));
    return Array.from({ length: height }, (_, line) => pad + drawn.map((rows, i) => rows[line] ?? " ".repeat(widths[i]!)).join(" ".repeat(COLUMN_GAP)) + pad);
  };
  return [...rowsOf(grid[0]!).map(row => paintHeader(row + " ".repeat(Math.max(0, total - visibleWidth(row))))), ...grid.slice(1).flatMap(rowsOf)];
}
