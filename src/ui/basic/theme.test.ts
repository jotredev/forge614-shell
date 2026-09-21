import { expect, test } from "bun:test";
import { ChatText, danger, foreground } from "./theme.ts";

test("ChatText defaults to the normal chat color, but takes an override so an error reads red instead of blending in", () => {
  const normal = new ChatText("Something happened").render(40).join("\n");
  const error = new ChatText("Something happened", danger).render(40).join("\n");

  expect(normal).toContain(foreground("Something happened"));
  expect(error).toContain(danger("Something happened"));
  expect(error).not.toBe(normal);
});
