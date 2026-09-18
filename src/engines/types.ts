export type NativeId = "codex" | "gemini" | "antigravity";
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
  listSessions(): Promise<{ id: string; title: string }[]>;
  setModel(id: string): Promise<void>;
  setEffort(effort: string): Promise<void>;
  workModes?(): NativeWorkMode[];
  workMode?(): string | undefined;
  setWorkMode?(id: string): Promise<void>;
  status(): string[];
  visual?(): NativeVisualState;
  refreshUsage?(): Promise<void>;
  close(): void;
}
