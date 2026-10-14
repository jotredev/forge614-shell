import { Container } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import { AssistantMessage, UserBubble } from "./chat-message.ts";
import { faint } from "./theme.ts";
import { ActivityCard } from "./transcript.ts";

/**
 * The line between one turn and the next: a faint rule across the whole width, with a blank row above it (and the next message brings its own blank row below). A rule of `─` was chosen over a band of the
 * surface background because a band reads as one more block, like the table's header or a code block, while a thin faint line only says «the turn ended here» and disappears when the eyes are on the text.
 */
export class TurnSeparator implements Component {
  invalidate(): void {}
  render(width: number): string[] {
    return ["", faint("─".repeat(Math.max(1, width)))];
  }
}

/** Which side of the conversation a component belongs to: the person's message, or the agent's (its answers and the tool, permission and notice cards of its turn); anything else belongs to no side. */
function sideOf(component: Component): "person" | "agent" | undefined {
  if (component instanceof UserBubble) return "person";
  if (component instanceof AssistantMessage || component instanceof ActivityCard) return "agent";
  return undefined;
}

/**
 * The chat's list of messages, for Claude Code and for Codex alike: it puts a `TurnSeparator` in front of a component when the side that speaks is not the one that spoke last. So the person's message, then the
 * agent's tools and answer, then the person's next message are told apart, while the tools and answers inside one turn have no line between them, nothing is drawn before the conversation's first message and a notice
 * or an error belongs to no side. Adding again a list of children that already has its separators (coming back from a side conversation) does not double them.
 */
export class TurnTranscript extends Container {
  private last?: "person" | "agent";

  override addChild(component: Component): void {
    const side = sideOf(component);
    if (side) {
      const previous = this.children.at(-1);
      if (this.last && side !== this.last && !(previous instanceof TurnSeparator)) super.addChild(new TurnSeparator());
      this.last = side;
    }
    super.addChild(component);
  }

  override clear(): void {
    super.clear();
    this.last = undefined;
  }
}
