export type NativeId = "codex";
export interface NativeModel { id: string; name: string; efforts?: string[]; defaultEffort?: string }
/**
 * How a work mode is drawn (color and help line), chosen by the adapter that lists it. It is a coarse
 * class, not a mode name: the composer knows tones, never the ids or names of any assistant's modes.
 */
export type WorkModeTone = "manual" | "readOnly" | "acceptEdits" | "plan" | "strict" | "auto" | "danger";
/**
 * A work mode as the assistant itself names and behaves. `id` is the value the adapter sends back to the
 * assistant; `label` is the name the assistant shows for it. Each adapter builds its list from its own
 * assistant (SDK type or app-server protocol) — Shell never keeps a hand-written list of another one's modes.
 */
export interface NativeWorkMode { id: string; label: string; tone?: WorkModeTone }
/**
 * What happened to a work-mode change: `applied` took effect at once (or nothing was running, so the next
 * turn simply uses it); `next-turn` was accepted while a turn ran but the assistant only reads the mode
 * when a turn starts, so the person is told it applies from the next one.
 */
export type WorkModeChange = "applied" | "next-turn";
export type NativeVisualState = {
  user?: string;
  account: "connected" | "disconnected";
  provider: string;
  model?: string;
  reasoning?: string;
  context?: { used: number; window: number };
  usage?: { label: string; usedPercent: number; reset?: string }[];
};
export type BackgroundActivityKind = "agent" | "process";
export type BackgroundActivityState = "running" | "done" | "failed";
export interface BackgroundActivity {
  id: string;
  kind: BackgroundActivityKind;
  label: string;
  state: BackgroundActivityState;
  startedAt: number;
  endedAt?: number;
  detail?: string;
}
/**
 * One saved conversation as the assistant reports it, for the `/resume` selector. Every field but `id`
 * is optional because Shell shows only what the assistant delivers and never makes up the rest.
 * `updatedAt` is in milliseconds since the epoch; `firstMessage` is the conversation's first user message.
 */
export interface NativeSessionInfo { id: string; title?: string; firstMessage?: string; folder?: string; updatedAt?: number }
export interface NativeEvent { type: "text" | "delta" | "status" | "reset"; text: string; id?: string }
export type Emit = (event: NativeEvent) => void;
export type Approve = (description: string, signal: AbortSignal) => Promise<boolean>;
export interface NativeSession {
  resumeNotice?: string;
  busy: boolean;
  sessionId?: string;
  models: NativeModel[];
  initialize(): Promise<void>;
  login(): Promise<void>;
  logout?(): Promise<void>;
  send(text: string): Promise<void>;
  cancel(): Promise<void>;
  reset(): void;
  resume(id: string): Promise<void>;
  listSessions(): Promise<NativeSessionInfo[]>;
  setModel(id: string): Promise<void>;
  setEffort(effort: string): Promise<void>;
  workModes?(): NativeWorkMode[];
  workMode?(): string | undefined;
  /** Changes the work mode at any moment — also mid-turn or with a permission pending — and says whether it applies now or from the next turn. */
  setWorkMode?(id: string): Promise<WorkModeChange>;
  /** Asks the assistant's own engine to compact the conversation and resolves when it is done. Absent when the assistant has no such request. */
  compact?(): Promise<void>;
  backgroundActivity?(): BackgroundActivity[];
  /** A short phrase of what the engine is doing right now (the command it is running), for the «Working» indicator; undefined when nothing specific runs. */
  currentActivity?(): string | undefined;
  status(): string[];
  visual?(): NativeVisualState;
  refreshUsage?(): Promise<void>;
  close(): void;
}
