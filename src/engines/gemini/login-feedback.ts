import { stripVTControlCharacters } from "node:util";
import { openLoginBrowser } from "../../infrastructure/browser.ts";

// Gemini owns OAuth and normally launches the browser itself. Only expose known
// login feedback; never forward arbitrary stderr or read its credential files.
export class GeminiLoginFeedback {
  private buffer = "";
  private awaitingUrl = false;
  private url?: string;
  private retried = false;
  private waiting = false;
  private launchFailed = false;
  constructor(private report: (text: string) => void, private open = openLoginBrowser) {}
  write(chunk: string): void {
    this.buffer += chunk;
    let end: number;
    while ((end = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      if (line.length <= 16384) this.line(stripVTControlCharacters(line).trim());
    }
    if (this.buffer.length > 16384) this.buffer = "";
  }
  private line(line: string): void {
    if (line === "Attempting to open authentication page in your browser.") {
      this.awaitingUrl = true; this.url = undefined; this.retried = false;
      this.waiting = false; this.launchFailed = false;
      this.report("Gemini is opening your browser for Google account login.");
    } else if (this.awaitingUrl && line.startsWith("https://")) {
      this.awaitingUrl = false;
      try {
        const url = new URL(line);
        if (url.origin !== "https://accounts.google.com" || url.username || url.password || url.pathname !== "/o/oauth2/v2/auth") return;
        this.url = line;
        this.report(`If the browser did not open, continue the official Google login here:\n${line}`);
      } catch { /* Not an official login URL. */ }
    } else if (line.startsWith("Failed to open browser")) {
      this.launchFailed = true;
      this.report("Gemini could not open the browser. If authentication stops, check the native Gemini login and retry /login.");
      this.retryBrowser();
    } else if (line === "Waiting for authentication...") {
      this.waiting = true;
      this.report("Waiting for Google login in your browser...");
      this.retryBrowser();
    } else if (line === "Authentication succeeded") {
      this.waiting = false; this.url = undefined;
    }
  }
  private retryBrowser(): void {
    // A synchronous upstream opener failure rejects authenticate immediately.
    // Only its nonfatal child-error path keeps the OAuth request waiting.
    if (!this.waiting || !this.launchFailed || !this.url || this.retried) return;
    this.retried = true;
    this.report("Trying the system browser while Gemini waits for authentication.");
    void this.open(this.url).then(opened => {
      if (!opened) this.report("Automatic browser opening is unavailable. Open the Google login link manually.");
    }).catch(() => this.report("Open the Google login link manually."));
  }
}
