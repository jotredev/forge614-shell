import { decodeKittyPrintable, matchesKey } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";

export interface MaskedInputOptions {
  placeholder?: string;
}

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

/** Single-line input that accepts typed or pasted text but never renders it. Used only for secrets. */
export class MaskedInput implements Component {
  private value = "";
  private pasteBuffer = "";
  private isInPaste = false;
  private readonly placeholder: string;
  onSubmit?: (value: string) => void;
  onEscape?: () => void;

  constructor(options: MaskedInputOptions = {}) {
    this.placeholder = options.placeholder ?? "";
  }

  getValue(): string {
    return this.value;
  }

  handleInput(data: string): void {
    // Bracketed paste framing: \x1b[200~<content>\x1b[201~, possibly split across chunks.
    // Paste content is arbitrary text, so it bypasses the key checks below entirely.
    if (data.includes(PASTE_START)) {
      this.isInPaste = true;
      this.pasteBuffer = "";
      data = data.replace(PASTE_START, "");
    }
    if (this.isInPaste) {
      this.pasteBuffer += data;
      const endIndex = this.pasteBuffer.indexOf(PASTE_END);
      if (endIndex !== -1) {
        this.value += this.pasteBuffer.slice(0, endIndex);
        this.isInPaste = false;
        const remaining = this.pasteBuffer.slice(endIndex + PASTE_END.length);
        this.pasteBuffer = "";
        if (remaining) this.handleInput(remaining);
      }
      return;
    }
    if (matchesKey(data, "enter") || matchesKey(data, "return")) { this.onSubmit?.(this.value); return; }
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) { this.onEscape?.(); return; }
    if (matchesKey(data, "backspace") || matchesKey(data, "delete") || data === "\x7f") { this.value = this.value.slice(0, -1); return; }
    // Typed text: keep every printable character, including non-ASCII, and drop only control bytes.
    if (!data.includes("\x1b")) {
      const typed = data.replace(/\p{Cc}/gu, "");
      if (typed) this.value += typed;
      return;
    }
    // Escape-prefixed chunks are key sequences, not text; only Kitty printable keys carry a character.
    const printable = decodeKittyPrintable(data);
    if (printable) this.value += printable;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const masked = this.value.length ? "•".repeat(this.value.length) : this.placeholder;
    return [masked.slice(0, Math.max(0, width))];
  }
}
