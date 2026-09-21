import { expect, test } from "bun:test";
import { lineDiff } from "./diff.ts";

test("identical text produces only context lines", () => {
  const diff = lineDiff("a\nb\nc", "a\nb\nc");
  expect(diff.map(line => line.kind)).toEqual(["context", "context", "context"]);
});

test("a changed line is reported as a removal followed by an addition", () => {
  const diff = lineDiff("const x = 1;", "const x = 2;");
  expect(diff).toEqual([
    { kind: "remove", text: "const x = 1;", lineNumber: 1 },
    { kind: "add", text: "const x = 2;", lineNumber: 1 },
  ]);
});

test("keeps unrelated context around an inserted line", () => {
  const diff = lineDiff("a\nc", "a\nb\nc");
  expect(diff).toEqual([
    { kind: "context", text: "a", lineNumber: 1 },
    { kind: "add", text: "b", lineNumber: 2 },
    { kind: "context", text: "c", lineNumber: 3 },
  ]);
});

test("keeps unrelated context around a removed line", () => {
  const diff = lineDiff("a\nb\nc", "a\nc");
  expect(diff).toEqual([
    { kind: "context", text: "a", lineNumber: 1 },
    { kind: "remove", text: "b", lineNumber: 2 },
    { kind: "context", text: "c", lineNumber: 2 },
  ]);
});

test("empty old text (a Write with no prior content) renders as pure additions", () => {
  const diff = lineDiff("", "one\ntwo");
  expect(diff).toEqual([
    { kind: "add", text: "one", lineNumber: 1 },
    { kind: "add", text: "two", lineNumber: 2 },
  ]);
});
