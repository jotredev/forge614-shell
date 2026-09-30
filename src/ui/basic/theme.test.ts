import { expect, test } from "bun:test";
import { ChatText, PanelText, danger, foreground } from "./theme.ts";

test("ChatText defaults to the normal chat color, but takes an override so an error reads red instead of blending in", () => {
  const normal = new ChatText("Something happened").render(40).join("\n");
  const error = new ChatText("Something happened", danger).render(40).join("\n");

  expect(normal).toContain(foreground("Something happened"));
  expect(error).toContain(danger("Something happened"));
  expect(error).not.toBe(normal);
});

/**
 * A panel asks its rows for the width the text really has — the width it is drawn at minus the four columns of side margin — every time it is drawn, keeps a blank line above and
 * below like `ChatText`, and keeps the row's own spaces (the indent under a column). It exists so `/help` and `/status` can break a long row at the real width.
 */
test("PanelText asks its rows for the width the text has and keeps their indent", () => {
  const asked: number[] = [];
  const panel = new PanelText(width => { asked.push(width); return ["name  first part", "      second part"]; });
  expect(panel.render(40)).toEqual(["", `  ${foreground("name  first part")}`, `  ${foreground("      second part")}`, ""]);
  panel.render(24);
  expect(asked).toEqual([36, 20]);
});

/** A row that still does not fit (one word wider than the whole width) is broken instead of overflowing the box, so it can never push the layout. */
test("PanelText never draws a row wider than the box", () => {
  const rows = new PanelText(() => ["x".repeat(50)]).render(24);
  for (const row of rows) expect(row.replace(/\x1b\[[0-9;]*m/g, "").length).toBeLessThanOrEqual(24);
});
