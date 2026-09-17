import { expect, test } from "bun:test";
import { GeminiLoginFeedback } from "./login-feedback.ts";

const url = "https://accounts.google.com/o/oauth2/v2/auth?client_id=test&state=example";
test("Gemini exposes its login link without duplicating native browser launch", async () => {
  const messages: string[] = []; const opened: string[] = [];
  const feedback = new GeminiLoginFeedback(text => messages.push(text), async link => { opened.push(link); return true; });
  feedback.write("private unrelated diagnostic\nAttempting to open authentication page in your browser.\nOtherwise navigate to:\n");
  feedback.write(url.slice(0, 25)); feedback.write(url.slice(25) + "\nWaiting for authentication...\n");
  expect(messages.join("\n")).toContain(url);
  expect(messages.join("\n")).not.toContain("private unrelated");
  expect(opened).toEqual([]);
  feedback.write("Failed to open browser with error: private detail\n");
  await Promise.resolve();
  expect(opened).toEqual([url]);
  expect(messages.join("\n")).not.toContain("private detail");
});

test("Gemini ignores untrusted URLs and bounds diagnostics", async () => {
  const messages: string[] = []; const opened: string[] = [];
  const feedback = new GeminiLoginFeedback(text => messages.push(text), async link => { opened.push(link); return false; });
  feedback.write("https://accounts.google.com.evil.invalid/o/oauth2/v2/auth?token=secret\n");
  feedback.write("x".repeat(100000) + "\n");
  feedback.write("Failed to open browser with error: secret\n");
  await Promise.resolve();
  expect(opened).toEqual([]);
  expect(messages.join("\n")).not.toContain("secret");
});

test("a fatal native opener failure does not reopen an already rejected OAuth flow", async () => {
  const messages: string[] = []; const opened: string[] = [];
  const feedback = new GeminiLoginFeedback(text => messages.push(text), async link => { opened.push(link); return true; });
  feedback.write(`Attempting to open authentication page in your browser.\n${url}\nFailed to open browser with error: unavailable\n`);
  await Promise.resolve();
  expect(opened).toEqual([]);
  expect(messages.join("\n")).not.toContain("Trying the system browser");
});
