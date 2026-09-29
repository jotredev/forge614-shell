export type NativeId = "codex";
export interface NativeModel { id: string; name: string; efforts?: string[]; defaultEffort?: string }
/** A work mode reported by a native engine. Forge614 never synthesizes these. */
export interface NativeWorkMode { id: string; label: string }
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
  setWorkMode?(id: string): Promise<void>;
  backgroundActivity?(): BackgroundActivity[];
  /** A short phrase of what the engine is doing right now (the command it is running), for the «Working» indicator; undefined when nothing specific runs. */
  currentActivity?(): string | undefined;
  status(): string[];
  visual?(): NativeVisualState;
  refreshUsage?(): Promise<void>;
  close(): void;
}
