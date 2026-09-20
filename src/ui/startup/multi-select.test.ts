import { expect, test } from "bun:test";
import { MultiSelectList } from "./multi-select.ts";

const theme = { cursor: (t: string) => t, checked: (t: string) => t, plain: (t: string) => t };

test("renders every item unchecked with the cursor on the first row", () => {
  const list = new MultiSelectList([{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }], theme);
  expect(list.render(80)).toEqual(["> [ ] Alpha", "  [ ] Beta"]);
});

test("space toggles the item under the cursor", () => {
  const list = new MultiSelectList([{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }], theme);
  list.handleInput(" ");
  expect(list.render(80)[0]).toBe("> [x] Alpha");
  list.handleInput(" ");
  expect(list.render(80)[0]).toBe("> [ ] Alpha");
});

test("down moves the cursor and does not affect the checked set", () => {
  const list = new MultiSelectList([{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }], theme);
  list.handleInput(" ");
  list.handleInput("\x1b[B");
  expect(list.render(80)).toEqual(["  [x] Alpha", "> [ ] Beta"]);
});

test("the cursor does not move past the last item", () => {
  const list = new MultiSelectList([{ value: "a", label: "Alpha" }], theme);
  list.handleInput("\x1b[B");
  list.handleInput("\x1b[B");
  expect(list.render(80)).toEqual(["> [ ] Alpha"]);
});

test("enter submits exactly the checked values, in item order", () => {
  const list = new MultiSelectList([{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }, { value: "c", label: "Gamma" }], theme);
  list.handleInput("\x1b[B"); list.handleInput(" "); // check Beta
  list.handleInput("\x1b[B"); list.handleInput(" "); // check Gamma
  let submitted: string[] | undefined;
  list.onSubmit = values => { submitted = values; };
  list.handleInput("\r");
  expect(submitted).toEqual(["b", "c"]);
});

test("enter with nothing checked submits an empty array, not a cancellation", () => {
  const list = new MultiSelectList([{ value: "a", label: "Alpha" }], theme);
  let submitted: string[] | undefined;
  let cancelled = false;
  list.onSubmit = values => { submitted = values; };
  list.onCancel = () => { cancelled = true; };
  list.handleInput("\r");
  expect(submitted).toEqual([]);
  expect(cancelled).toBe(false);
});

test("escape cancels without submitting", () => {
  const list = new MultiSelectList([{ value: "a", label: "Alpha" }], theme);
  let cancelled = false;
  let submitted: string[] | undefined;
  list.onCancel = () => { cancelled = true; };
  list.onSubmit = values => { submitted = values; };
  list.handleInput("\x1b");
  expect(cancelled).toBe(true);
  expect(submitted).toBeUndefined();
});
