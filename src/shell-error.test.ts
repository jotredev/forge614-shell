import { expect, test } from "bun:test";
import { ShellError, describeError } from "./shell-error.ts";
import { getCatalog } from "./i18n/index.ts";

test("a ShellError's own .message is always valid English, regardless of where it is thrown", () => {
  const error = new ShellError("codex-model-unknown");
  expect(error.message).toBe("Choose an available model from /model.");
  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe("ShellError");
});

test("describeError renders a ShellError in the requested locale, from the same code and params", () => {
  const error = new ShellError("claude-env-conflict", { keys: "ANTHROPIC_API_KEY" });
  expect(describeError(error, "en")).toBe(getCatalog("en").errors["claude-env-conflict"]({ keys: "ANTHROPIC_API_KEY" }));
  expect(describeError(error, "es")).toBe(getCatalog("es").errors["claude-env-conflict"]({ keys: "ANTHROPIC_API_KEY" }));
  expect(describeError(error, "es")).toContain("ANTHROPIC_API_KEY");
  expect(describeError(error, "es")).not.toBe(describeError(error, "en"));
});

test("describeError passes a plain Error's message through unchanged in every locale — external text is never translated or paraphrased", () => {
  const external = new Error("MCP entry already exists with different content");
  expect(describeError(external, "en")).toBe("MCP entry already exists with different content");
  expect(describeError(external, "es")).toBe("MCP entry already exists with different content");
});

test("describeError handles a non-Error throw the same way String(error) would", () => {
  expect(describeError("a raw string", "es")).toBe("a raw string");
  expect(describeError(undefined, "es")).toBe("undefined");
});

test("every ShellErrorCode's English and Spanish templates are distinct callable functions producing non-empty text", () => {
  const en = getCatalog("en").errors;
  const es = getCatalog("es").errors;
  const codes = Object.keys(en) as (keyof typeof en)[];
  expect(codes.length).toBeGreaterThan(30);
  for (const code of codes) {
    const enText = en[code]({});
    const esText = es[code]({});
    expect(typeof enText).toBe("string");
    expect(enText.length).toBeGreaterThan(0);
    expect(esText.length).toBeGreaterThan(0);
  }
});
