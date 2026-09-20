import { expect, test } from "bun:test";
import { MaskedInput } from "./masked-input.ts";

test("typed characters are held in value but never rendered", () => {
  const input = new MaskedInput();
  for (const char of "secret") input.handleInput(char);
  expect(input.getValue()).toBe("secret");
  const rendered = input.render(40).join("\n");
  expect(rendered).not.toContain("secret");
  expect(rendered).toContain("••••••");
});

test("a pasted or multi-character chunk is accepted in one call", () => {
  const input = new MaskedInput();
  input.handleInput("postgres://user:pw@host/db");
  expect(input.getValue()).toBe("postgres://user:pw@host/db");
  expect(input.render(60).join("\n")).not.toContain("postgres");
});

test("backspace removes the last character", () => {
  const input = new MaskedInput();
  input.handleInput("ab");
  input.handleInput("\x7f");
  expect(input.getValue()).toBe("a");
});

test("Enter submits the real value", () => {
  const input = new MaskedInput();
  let submitted: string | undefined;
  input.onSubmit = value => { submitted = value; };
  input.handleInput("secret");
  input.handleInput("\r");
  expect(submitted).toBe("secret");
});

test("Escape and Ctrl+C cancel without submitting", () => {
  let cancelled = 0;
  const escaped = new MaskedInput();
  escaped.onEscape = () => { cancelled++; };
  escaped.handleInput("x");
  escaped.handleInput("\x1b");
  expect(cancelled).toBe(1);

  const interrupted = new MaskedInput();
  interrupted.onEscape = () => { cancelled++; };
  interrupted.handleInput("\x03");
  expect(cancelled).toBe(2);
});

test("shows the placeholder while empty", () => {
  const input = new MaskedInput({ placeholder: "postgres://user:password@host:5432/database" });
  expect(input.render(60)).toEqual(["postgres://user:password@host:5432/database"]);
});
