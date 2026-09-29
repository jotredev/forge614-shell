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
/** A skill the assistant offers (`$name` in a message): what the person reads (`name`, `description`) and the `path` the assistant needs to load it. */
export interface NativeSkill { name: string; description: string; path: string }
/** One MCP server as the assistant reports it: connection and login state, and its tools (with their descriptions when reported). */
export interface NativeMcpServer {
  name: string; status: string; auth: string; tools: { name: string; description?: string }[];
  toolsError?: string; version?: string; origin?: string; resources: number;
}
/** A lifecycle hook the assistant runs (view only): the event, how it runs (`handler`, with `detail` the command or tool), and whether it is on and trusted. */
export interface NativeHook { event: string; handler: string; detail?: string; matcher?: string; enabled: boolean; trust: string; source: string }
/** Account-wide token usage as the assistant reports it; a figure it does not send is left out. */
export interface NativeAccountUsage { lifetimeTokens?: string; peakDailyTokens?: string; longestTurnSeconds?: string; currentStreakDays?: string; longestStreakDays?: string }
/** A command still running on its own for the conversation (a «background terminal»). */
export interface NativeBackgroundTerminal { command: string; cwd: string; pid?: number }
/** The goal set for a long task: its `status` is the assistant's own word for it. */
export interface NativeGoal { objective: string; status: string; tokenBudget?: number; tokensUsed: number; timeUsedSeconds: number }
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
  // The assistant's own commands that act on the conversation or on the account. Each one is present only
  // when the assistant has a request for it, so the screen never offers what the assistant cannot do.
  // The ones that need an open conversation throw a `ShellError` when there is none.
  /** Starts a new conversation at once and drops the current one (kept if the new one cannot start). */
  clearThread?(): Promise<void>;
  renameThread?(name: string): Promise<void>;
  /** Archives the conversation and leaves the session with none open. */
  archiveThread?(): Promise<void>;
  /** Deletes the conversation for good and leaves the session with none open. */
  deleteThread?(): Promise<void>;
  /** The goal set for this conversation; `null` when there is none. */
  getGoal?(): Promise<NativeGoal | null>;
  /** Sets the goal, opening the conversation first when none exists yet. */
  setGoal?(objective: string): Promise<NativeGoal>;
  /** Clears the goal; false when there was nothing to clear. */
  clearGoal?(): Promise<boolean>;
  mcpServers?(verbose: boolean): Promise<NativeMcpServer[]>;
  hooks?(): Promise<NativeHook[]>;
  accountUsage?(): Promise<NativeAccountUsage>;
  backgroundTerminals?(): Promise<NativeBackgroundTerminal[]>;
  /** Stops every background terminal; false when there is no conversation and so nothing to stop. */
  stopBackgroundTerminals?(): Promise<boolean>;
  /** The skills available in this folder, as the assistant lists them. */
  skills?(): Promise<NativeSkill[]>;
  backgroundActivity?(): BackgroundActivity[];
  /** A short phrase of what the engine is doing right now (the command it is running), for the «Working» indicator; undefined when nothing specific runs. */
  currentActivity?(): string | undefined;
  status(): string[];
  visual?(): NativeVisualState;
  refreshUsage?(): Promise<void>;
  close(): void;
}
