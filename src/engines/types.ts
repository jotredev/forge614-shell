export type NativeId = "codex" | "gemini" | "antigravity";
export interface NativeModel { id: string; name: string; efforts?: string[]; defaultEffort?: string }
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
  status(): string[];
  close(): void;
}
