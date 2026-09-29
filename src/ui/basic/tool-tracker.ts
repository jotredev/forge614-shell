import { ActivityCard } from "./transcript.ts";
import { formatDuration } from "./duration.ts";
import type { Catalog } from "../../i18n/index.ts";

type ToolTexts = Pick<Catalog["claudeChat"], "toolRunning" | "toolCompleted" | "toolFailed">;

interface TrackedTool {
  card: ActivityCard;
  startedAt: number;
  isEdit: boolean;
  /** What the person sees for this tool: its own title, used when it has no description. */
  title: string;
  /** Short phrase of what the tool is doing (Claude's `description` of a Bash call, for instance). */
  activity?: string;
  running: boolean;
}

/**
 * Keeps ONE chat card per tool call, keyed by the engine's tool-use id, so a long command is a single
 * line that updates in place (its time runs there) and freezes with its result when it ends — never a
 * new line per progress notice. It also knows which tool is running now, for the «Working» indicator.
 *
 * A progress notice can name an id no tool request was ever seen for (the exact cause is not pinned
 * down: the SDK's progress frames also carry heartbeat and sub-agent ids). That id gets its own card
 * the first time and every later notice, and the final result, reuse it.
 */
export class ToolTracker {
  private readonly tools = new Map<string, TrackedTool>();

  /** `addCard` puts a card the tracker creates itself (from a progress notice) into the chat. */
  constructor(private readonly addCard: (card: ActivityCard) => void, private readonly t: ToolTexts) {}

  /** Registers a requested tool whose card the caller already built and placed. Returns false, and changes nothing, when the id is already tracked. */
  request(id: string, card: ActivityCard, info: { isEdit: boolean; title?: string; activity?: string }): boolean {
    if (this.tools.has(id)) return false;
    this.tools.set(id, { card, startedAt: Date.now(), isEdit: info.isEdit, title: info.title ?? "", ...(info.activity ? { activity: info.activity } : {}), running: true });
    return true;
  }

  /** A "still running" notice: updates the tool's own card, or creates it once when the id is new. */
  progress(id: string, name: string, elapsedSeconds: number): void {
    const status = this.t.toolRunning({ duration: formatDuration(elapsedSeconds) });
    const known = this.tools.get(id);
    if (known) { known.card.update(status); return; }
    const card = new ActivityCard(name, status);
    this.tools.set(id, { card, startedAt: Date.now() - elapsedSeconds * 1000, isEdit: false, title: name, running: true });
    this.addCard(card);
  }

  /** Freezes the tool's card with its outcome and total time. `detail` is the already-cleaned result text. */
  finished(id: string, isError: boolean, detail: string): void {
    const tool = this.tools.get(id);
    if (!tool) return;
    const duration = formatDuration((Date.now() - tool.startedAt) / 1000);
    const status = isError ? this.t.toolFailed({ duration }) : this.t.toolCompleted({ duration });
    if (tool.isEdit) tool.card.update(status); else tool.card.update(status, detail);
    tool.running = false;
  }

  /** The turn is over (finished or stopped): nothing counts as running anymore, so the next turn's indicator never names a tool from this one. */
  endTurn(): void {
    for (const tool of this.tools.values()) tool.running = false;
  }

  /** The newest tool still running, as a short phrase: its description, else its title; undefined when none runs. */
  currentActivity(): string | undefined {
    const running = [...this.tools.values()].filter(tool => tool.running);
    const last = running[running.length - 1];
    return last ? (last.activity || last.title || undefined) : undefined;
  }
}
