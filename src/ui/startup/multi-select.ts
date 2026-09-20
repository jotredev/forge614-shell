import { matchesKey } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";

export interface MultiSelectItem {
  readonly value: string;
  readonly label: string;
}

export interface MultiSelectTheme {
  cursor: (text: string) => string;
  checked: (text: string) => string;
  plain: (text: string) => string;
}

/** Checkbox list: arrows move, Space toggles, Enter submits every checked value, Esc cancels. */
export class MultiSelectList implements Component {
  private cursor = 0;
  private readonly checkedValues = new Set<string>();
  onSubmit?: (values: string[]) => void;
  onCancel?: () => void;

  constructor(private readonly items: readonly MultiSelectItem[], private readonly theme: MultiSelectTheme) {}

  invalidate(): void {}

  render(_width: number): string[] {
    return this.items.map((item, index) => {
      const box = this.checkedValues.has(item.value) ? this.theme.checked("[x]") : "[ ]";
      const pointer = index === this.cursor ? "> " : "  ";
      const line = `${pointer}${box} ${item.label}`;
      return index === this.cursor ? this.theme.cursor(line) : this.theme.plain(line);
    });
  }

  handleInput(data: string): void {
    if (matchesKey(data, "up")) { this.cursor = Math.max(0, this.cursor - 1); return; }
    if (matchesKey(data, "down")) { this.cursor = Math.min(this.items.length - 1, this.cursor + 1); return; }
    if (matchesKey(data, "space")) {
      const value = this.items[this.cursor]?.value;
      if (!value) return;
      if (this.checkedValues.has(value)) this.checkedValues.delete(value);
      else this.checkedValues.add(value);
      return;
    }
    if (matchesKey(data, "enter") || matchesKey(data, "return")) {
      this.onSubmit?.(this.items.filter(item => this.checkedValues.has(item.value)).map(item => item.value));
      return;
    }
    if (matchesKey(data, "escape")) { this.onCancel?.(); return; }
  }
}
