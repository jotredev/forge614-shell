import { expect, test } from "bun:test";
import { openLoginBrowser } from "./browser.ts";

test("browser launch passes the OAuth URL as one argument without shell interpolation", async () => {
  const url = "https://auth.openai.com/oauth/authorize?state=a&code_challenge=b";
  for (const [platform, command, args] of [
    ["darwin", "/usr/bin/open", [url]],
    ["linux", "xdg-open", [url]],
    ["win32", "rundll32.exe", ["url.dll,FileProtocolHandler", url]],
  ] as const) {
    const calls: unknown[] = [];
    expect(await openLoginBrowser(url, platform, async (file, argv) => { calls.push([file, argv]); })).toBe(true);
    expect(calls).toEqual([[command, [...args]]]);
  }
});

test("unsafe URLs and launcher failures leave the manual login path available", async () => {
  let calls = 0;
  for (const url of ["file:///tmp/example", "http://auth.openai.com/oauth/authorize", "https://auth.openai.com.evil.invalid/oauth/authorize", "https://user@auth.openai.com/oauth/authorize", "https://auth.openai.com:444/oauth/authorize"]) {
    expect(await openLoginBrowser(url, "darwin", async () => { calls++; })).toBe(false);
  }
  expect(calls).toBe(0);
  expect(await openLoginBrowser("https://auth.openai.com/oauth/authorize", "linux", async () => { throw new Error("no desktop browser"); })).toBe(false);
});

test("Google login is allowed only on its official OAuth endpoint", async () => {
  const calls: string[][] = [];
  const run = async (_command: string, args: string[]) => { calls.push(args); };
  const url = "https://accounts.google.com/o/oauth2/v2/auth?state=example&client_id=test";
  expect(await openLoginBrowser(url, "darwin", run)).toBe(true);
  for (const invalid of ["https://accounts.google.com.evil.invalid/o/oauth2/v2/auth", "https://accounts.google.com/other", "https://user@accounts.google.com/o/oauth2/v2/auth", "http://accounts.google.com/o/oauth2/v2/auth"]) {
    expect(await openLoginBrowser(invalid, "darwin", run)).toBe(false);
  }
  expect(calls).toEqual([[url]]);
});
