import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Component, TuiMouseEvent } from "@earendil-works/pi-tui";
import { accent as cyan, muted, fit, panelBackground } from "./theme.ts";


export function chatMessage(role: "user" | "assistant" | "system", content: string): string {
  const label = role === "user" ? "YOU" : role === "assistant" ? "ASSISTANT" : "SYSTEM";
  return `## ${label} · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}\n\n${content}`;
}

/** Lightweight activity card for real tool events emitted by an engine. */
export class ActivityCard implements Component {
  private expanded = true;
  constructor(private readonly title: string, private detail: string) {}
  update(detail: string): void { this.detail = detail; }

  handleMouse(event: TuiMouseEvent) {
    if (event.type !== "click" || event.button !== "left" || event.y !== 2) return undefined;
    this.expanded = !this.expanded;
    return { handled: true, render: true };
  }

  invalidate(): void {}

  render(width: number): string[] {
    const outer = Math.min(2, Math.max(0, width - 1));
    const cardWidth = Math.max(1, width - outer * 2);
    const innerWidth = Math.max(1, cardWidth - 4);
    const top = `${cyan("│")} ${cyan(fit(`${this.expanded ? "▾" : "▸"} ${this.title}`, innerWidth))}`;
    const body = wrapTextWithAnsi(muted(this.detail), innerWidth)
      .map(line => `${cyan("│")} ${fit(line, innerWidth)}`);
    const padding = `${cyan("│")} ${" ".repeat(innerWidth)}`;
    return ["", ...[padding, top, ...(this.expanded ? body : []), padding].map(line => " ".repeat(outer) + panelBackground(fit(line, cardWidth))), ""];
  }
}
