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

// Plain multi-character input (no terminal paste framing) — a different code path from a real
// bracketed paste, which arrives wrapped in \x1b[200~ … \x1b[201~ and is covered separately below.
test("a multi-character chunk is accepted in one call", () => {
  const input = new MaskedInput();
  input.handleInput("postgres://user:pw@host/db");
  expect(input.getValue()).toBe("postgres://user:pw@host/db");
  expect(input.render(60).join("\n")).not.toContain("postgres");
});

test("a real bracketed paste delivered in one chunk is kept in full", () => {
  const input = new MaskedInput();
  input.handleInput("\x1b[200~postgres://user:pw@host:5432/db\x1b[201~");
  expect(input.getValue()).toBe("postgres://user:pw@host:5432/db");
  expect(input.render(60).join("\n")).not.toContain("postgres");
});

test("a bracketed paste split across two chunks is reassembled", () => {
  const input = new MaskedInput();
  input.handleInput("\x1b[200~postgres://user:pw@");
  expect(input.getValue()).toBe("");
  input.handleInput("host:5432/db\x1b[201~");
  expect(input.getValue()).toBe("postgres://user:pw@host:5432/db");
});

test("paste content is appended verbatim instead of being read as keys", () => {
  const input = new MaskedInput();
  let submitted = 0;
  let cancelled = 0;
  input.onSubmit = () => { submitted++; };
  input.onEscape = () => { cancelled++; };
  input.handleInput("\x1b[200~a\rb\x1b[201~");
  expect(input.getValue()).toBe("a\rb");
  expect(submitted).toBe(0);
  expect(cancelled).toBe(0);
});

test("a typed non-ASCII character is retained, not silently dropped", () => {
  const input = new MaskedInput();
  for (const char of "Contraseña1") input.handleInput(char);
  expect(input.getValue()).toBe("Contraseña1");
  expect(input.render(40).join("\n")).not.toContain("Contra");
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
