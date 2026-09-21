export type DiffLine = { kind: "context" | "add" | "remove"; text: string; lineNumber: number };

// Above this, an LCS matrix would cost too much memory/time for a chat transcript; fall back to a
// coarse remove-then-add view instead of hanging the UI on a huge Write.
const MAX_LCS_CELLS = 250_000;

/** Line-level diff via the standard LCS backtrack. Good enough for the small edits a chat turn makes. */
export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText.length ? oldText.split("\n") : [];
  const b = newText.length ? newText.split("\n") : [];
  const n = a.length, m = b.length;
  if (n * m > MAX_LCS_CELLS) {
    return [
      ...a.map((text, i): DiffLine => ({ kind: "remove", text, lineNumber: i + 1 })),
      ...b.map((text, i): DiffLine => ({ kind: "add", text, lineNumber: i + 1 })),
    ];
  }
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { lines.push({ kind: "context", text: a[i]!, lineNumber: j + 1 }); i++; j++; }
    else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) { lines.push({ kind: "remove", text: a[i]!, lineNumber: i + 1 }); i++; }
    else { lines.push({ kind: "add", text: b[j]!, lineNumber: j + 1 }); j++; }
  }
  while (i < n) { lines.push({ kind: "remove", text: a[i]!, lineNumber: i + 1 }); i++; }
  while (j < m) { lines.push({ kind: "add", text: b[j]!, lineNumber: j + 1 }); j++; }
  return lines;
}
