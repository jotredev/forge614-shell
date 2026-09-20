import { decodeKittyPrintable, matchesKey } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";

export interface MaskedInputOptions {
  placeholder?: string;
}

/** Single-line input that accepts typed or pasted text but never renders it. Used only for secrets. */
export class MaskedInput implements Component {
  private value = "";
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
    if (matchesKey(data, "enter") || matchesKey(data, "return")) { this.onSubmit?.(this.value); return; }
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) { this.onEscape?.(); return; }
    if (matchesKey(data, "backspace") || matchesKey(data, "delete") || data === "\x7f") { this.value = this.value.slice(0, -1); return; }
    if (data.length > 0 && /^[\x20-\x7e]*$/.test(data)) { this.value += data; return; }
    const printable = decodeKittyPrintable(data);
    if (printable) this.value += printable;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const masked = this.value.length ? "•".repeat(this.value.length) : this.placeholder;
    return [masked.slice(0, Math.max(0, width))];
  }
}
