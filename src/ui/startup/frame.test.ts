import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import type { Terminal } from "@earendil-works/pi-tui";
import { startupFrame } from "./frame.ts";

const emptyComponent = { invalidate() {}, render: () => [] as string[] };
const fakeTerminal = { rows: 30, columns: 100, write() {} } as unknown as Terminal;

function renderFrame(version?: string): string {
  const tui = startupFrame(fakeTerminal, "Choose your AI engine", emptyComponent, undefined, undefined, version);
  const lines = (tui as unknown as { children: { render(width: number): string[] }[] }).children[0]!.render(100);
  return lines.map(stripVTControlCharacters).join("\n");
}

test("the startup header reads FORGE614 / SHELL in bold, so it doesn't blend into a plain command list", () => {
  const tui = startupFrame(fakeTerminal, "Choose your AI engine", emptyComponent);
  const raw = (tui as unknown as { children: { render(width: number): string[] }[] }).children[0]!.render(100)[1]!;
  expect(raw).toContain("\x1b[1m"); // bold escape present
  expect(stripVTControlCharacters(raw).trim()).toBe("FORGE614 / SHELL");
});

test("the version shows on the nav line when provided, and the frame renders cleanly without one", () => {
  expect(renderFrame("1.5.0")).toContain("v1.5.0");
  expect(renderFrame(undefined)).not.toContain("v1.5.0");
  expect(renderFrame(undefined)).toContain("↑/↓ navigate");
});
