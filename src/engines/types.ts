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
export interface NativeWorkMode {
  id: string; label: string; tone?: WorkModeTone;
  /** The assistant's own one-line description, when its picker shows one. */
  description?: string;
  /** The assistant asks before applying this mode (Codex's «Enable full access?»). */
  confirm?: boolean;
}
/**
 * A collaboration mode as the assistant names it (Codex: Default and Plan, from `collaborationMode/list`). It is
 * separate from the permission modes: the assistant decides what Shift+Tab switches. `indicator` is what the
 * assistant's own footer shows while the mode is on (Codex: «Plan mode»); a mode without one shows nothing.
 */
export interface NativeCollaborationMode { id: string; label: string; indicator?: string }
/** A review target exactly as Codex's protocol names it (`v2/ReviewTarget.ts`). */
export type NativeReviewTarget =
  | { type: "uncommittedChanges" }
  | { type: "baseBranch"; branch: string }
  | { type: "commit"; sha: string; title: string | null }
  | { type: "custom"; instructions: string };
/** An app or connector the assistant lists (`/apps`), reduced to what its list shows; a description or link it does not send is left out. */
export interface NativeApp { id: string; name: string; description?: string; installUrl?: string; installed: boolean; enabled: boolean }
/** One experimental feature as the assistant lists it: its config key, stage, name and description when it is in beta, and whether it is on. */
export interface NativeFeature { name: string; stage: string; displayName?: string; description?: string; enabled: boolean; defaultEnabled: boolean }
/** The memory settings the assistant uses: whether the feature is on, and its two switches. */
export interface NativeMemorySettings { featureEnabled: boolean; useMemories: boolean; generateMemories: boolean }
/** How a config write went: `okOverridden` means it was saved but a higher-priority setting still wins (`message` says which, when reported). */
export interface NativeConfigWrite { status: "ok" | "okOverridden"; message?: string }
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
/** A category of `/feedback`, named as Codex's own `FeedbackUploadParams.classification` names it. */
export type NativeFeedbackCategory = "bug" | "bad_result" | "good_result" | "safety_check" | "other";
/** An action the assistant's automatic review denied recently (`/approve`): its one-line summary and the reviewer's reason, when it gave one. */
export interface NativeAutoReviewDenial { id: string; summary: string; rationale?: string }
/**
 * One thing the assistant found to import from another tool (`/import`): its `type` as the assistant names it, its own `description` (the
 * paths it will copy), the project folder it belongs to (`null` = the home folder), how many objects it holds and their names. `raw` is what
 * the assistant listed, kept to hand back exactly as it came when the person chooses to import it.
 */
export interface NativeImportItem { type: string; description: string; cwd: string | null; count: number; names: string[]; raw: unknown }
/** A tool the assistant can import from, with what it found there. */
export interface NativeImportSource { id: string; label: string; items: NativeImportItem[] }
/** The result of looking for importable setup: the sources that had something, and the errors of the ones that could not be checked. */
export interface NativeImportDetection { sources: NativeImportSource[]; errors: string[] }
/** A plugin the assistant lists (`/plugins`), reduced to what its list and its actions need; `key` names it for the calls that follow. */
export interface NativePlugin {
  key: string; name: string; displayName: string; description?: string; marketplace: string;
  installed: boolean; enabled: boolean;
  installPolicy: "notAvailable" | "available" | "installedByDefault";
  availability: "available" | "disabledByAdmin";
  /** Whether the assistant told where the plugin lives, which installing needs. */
  canInstall: boolean;
  /** Whether the assistant told how to uninstall it. */
  canUninstall: boolean;
}
/** Where a plugin comes from, as the assistant reports it. */
export type NativePluginSource =
  | { kind: "local" } | { kind: "git"; url: string; ref?: string } | { kind: "npm"; package: string; version?: string } | { kind: "remote"; marketplace: string };
/** What a plugin holds and how it is set up (`plugin/read`); `hooks` is the ready-made summary («PreToolUse (1), Stop (2)»), empty when there are none. */
export interface NativePluginDetail {
  description?: string; source: NativePluginSource; authPolicy: "onInstall" | "onUse"; version?: string;
  skills: string[]; hooks: string; apps: string[]; mcpServers: string[];
}
/**
 * How `/recap` ended: `ok` with the summary and, when the assistant found one, the next action; `empty` — there is nothing to summarize yet; `busy` — another
 * recap is being generated; `failed` — the assistant could not produce one (any reason: the request, the time limit or an answer that was not a recap).
 */
export type NativeRecapResult = { status: "ok"; summary: string; nextAction?: string } | { status: "empty" | "busy" | "failed" };
/**
 * How `/side` began: `started` — the side conversation is open (the screen was told with a `detourStart` event); `no-conversation` — the main conversation has no
 * message yet, so there is nothing to branch from; `already-open` — one side conversation is open already; `reviewing` — a code review is running;
 * `failed` — the assistant refused it, `stage` says whether at creating the branch or at preparing it, and `error` is the assistant's own text.
 */
export type NativeSideStart =
  | { status: "started" } | { status: "no-conversation" } | { status: "already-open" } | { status: "reviewing" }
  | { status: "failed"; stage: "start" | "prepare"; error: string };
/**
 * A conversation the screen shows apart from the main one while it lasts: a side conversation (`side`, where what the person writes goes) or a subagent they are
 * watching (`agent`, read only). `name` is what the screen calls it; `readOnly` means nothing the person writes reaches it; `mainNeedsApproval` is set while the main
 * conversation waits for a permission answer that is held until the person returns.
 */
export interface NativeDetour { kind: "side" | "agent"; name?: string; readOnly: boolean; mainNeedsApproval?: boolean }
/**
 * One row of the subagent picker: the main conversation or a subagent spawned from it, with its state (`running`, `idle` or `closed`) and whether it is the one on screen.
 * `name` is the assistant's name for it (empty when it has none, and for the main conversation, which the screen names itself); `preview` is its first message when known.
 */
export interface NativeSubagent { id: string; name: string; preview?: string; main: boolean; state: "running" | "idle" | "closed"; current: boolean }
/** The subagents of the open conversation, and whether the assistant's subagents feature is on (when it is off and there are none, the screen offers to turn it on). */
export interface NativeSubagentList { enabled: boolean; agents: NativeSubagent[] }
/**
 * `planReady`: a turn finished in plan mode with a proposed plan (its Markdown is `text`), so the screen can offer to implement it.
 * `detourStart` / `detourEnd`: the assistant switches the view to a conversation apart from the main one (its name is `text`) and back; the screen keeps the main
 * view aside meanwhile, and whatever the main conversation says in the meantime arrives after `detourEnd`, in order.
 */
export interface NativeEvent {
  type: "text" | "delta" | "status" | "reset" | "planReady" | "detourStart" | "detourEnd"; text: string; id?: string;
  /**
   * The time of a message replayed from a saved conversation, in milliseconds since the epoch; `null` when the assistant did not
   * give one (the screen then shows no time). Left out for a live message, which takes the time of now.
   */
  at?: number | null;
}
/**
 * How a stop request ended: `requested` — the assistant took it and the turn ends when it says so; `no-active-turn` — the assistant
 * said no turn was running; `no-answer` — the assistant did not answer in time. In the last two Shell ended the turn on its own side
 * and told the person once.
 */
export type CancelOutcome = "requested" | "no-active-turn" | "no-answer";
export type Emit = (event: NativeEvent) => void;
export type Approve = (description: string, signal: AbortSignal) => Promise<boolean>;
/** A Yes/No question of Shell's own (disconnect, delete, stop, install, send data out): `no` comes first and is the marked row, `body` is what the question is about. */
export interface ShellQuestion { title: string; no: string; yes: string; body?: string }
/**
 * Asks a `ShellQuestion` and resolves `true` only for «Yes» (Enter alone, Esc and `signal` aborting are «No»). It is not `Approve`: that one is the assistant's permission
 * question, with «Yes» marked, and a question of Shell's own must never look like it.
 */
export type Confirm = (question: ShellQuestion, signal: AbortSignal) => Promise<boolean>;
export interface NativeSession {
  resumeNotice?: string;
  busy: boolean;
  sessionId?: string;
  models: NativeModel[];
  initialize(): Promise<void>;
  login(): Promise<void>;
  /** Disconnects Shell from the account (never the native one) after `confirm` says yes. */
  logout?(confirm: Confirm): Promise<void>;
  send(text: string): Promise<void>;
  /** Stops the turn in progress; always leaves the session free (see `CancelOutcome`). A session that has nothing to report may resolve with nothing. */
  cancel(): Promise<CancelOutcome | void>;
  reset(): void;
  resume(id: string): Promise<void>;
  listSessions(): Promise<NativeSessionInfo[]>;
  setModel(id: string): Promise<void>;
  setEffort(effort: string): Promise<void>;
  workModes?(): NativeWorkMode[];
  workMode?(): string | undefined;
  /** Changes the work mode at any moment — also mid-turn or with a permission pending — and says whether it applies now or from the next turn. */
  setWorkMode?(id: string): Promise<WorkModeChange>;
  /** The mode that stands in for a remembered one the assistant no longer offers. */
  fallbackWorkMode?(): string | undefined;
  /** The assistant's collaboration modes, in its own order (empty when it lists none). */
  collaborationModes?(): NativeCollaborationMode[];
  collaborationMode?(): string | undefined;
  /** Changes the collaboration mode at any moment and says whether it applies now or from the next turn. */
  setCollaborationMode?(id: string): Promise<WorkModeChange>;
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
  /** The last answer the assistant completed, as Markdown; undefined before the first one. */
  lastResponse?(): string | undefined;
  /** Runs the assistant's own code review on `target` as a turn, resolving when it ends. */
  startReview?(target: NativeReviewTarget): Promise<void>;
  /** Copies the conversation into a new one (named `name` when given) and continues in the copy. */
  forkThread?(name?: string): Promise<void>;
  /** Summarizes the conversation for someone coming back to it, with a temporary conversation of the assistant's that is never shown or saved. */
  recap?(): Promise<NativeRecapResult>;
  /** Opens a side conversation: a temporary branch of this one, where the next messages go until `leaveDetour`. */
  startSide?(): Promise<NativeSideStart>;
  /** The conversation on screen when it is not the main one (a side conversation or a watched subagent); undefined otherwise. */
  detour?(): NativeDetour | undefined;
  /** Goes back to the main conversation: a side conversation is interrupted and discarded, a watched subagent is left running. Nothing is lost from the main one. */
  leaveDetour?(): Promise<void>;
  /** Whether the main conversation is working (a turn or a command) even while a side conversation is on screen, which is what `busy` then tells about. */
  mainBusy?(): boolean;
  /** The main conversation and its subagents (spawned from it at any depth, running or finished). */
  subagents?(): Promise<NativeSubagentList>;
  /** Turns the assistant's subagents feature on for new conversations (this one is unchanged). */
  enableSubagents?(): Promise<NativeConfigWrite>;
  /** Shows a subagent's conversation and follows it live, read only; the main conversation goes on in the background. */
  watchSubagent?(id: string): Promise<void>;
  apps?(): Promise<NativeApp[]>;
  experimentalFeatures?(): Promise<NativeFeature[]>;
  /** Saves one feature switch and reads the list back; `overridden` when what is configured now differs from the choice. */
  setExperimentalFeature?(name: string, enabled: boolean): Promise<{ features: NativeFeature[]; overridden: boolean }>;
  memorySettings?(): Promise<NativeMemorySettings>;
  saveMemorySettings?(useMemories: boolean, generateMemories: boolean): Promise<NativeConfigWrite>;
  /** Turns the memory feature on for new conversations. */
  enableMemories?(): Promise<NativeConfigWrite>;
  /** Deletes the assistant's local memories for good; the screen asks first. */
  resetMemories?(): Promise<void>;
  /** The actions the automatic review denied recently in this conversation, newest first, for `/approve`. */
  autoReviewDenials?(): NativeAutoReviewDenial[];
  /** Approves one retry of a denied action; false when it is no longer on the list. */
  approveAutoReviewDenial?(id: string): Promise<boolean>;
  /** Sends feedback to the assistant's maker (`/feedback`), with the conversation's logs only when `includeLogs`; resolves with the conversation id it was recorded under. */
  uploadFeedback?(input: { category: NativeFeedbackCategory; includeLogs: boolean; note?: string }): Promise<{ threadId: string }>;
  /** Looks for setup to import from the other tools the assistant knows (`/import`). Copies nothing. */
  detectExternalSetup?(): Promise<NativeImportDetection>;
  /** Copies the chosen items into the assistant's own folder. Resolves when the assistant took the request; its end is reported as a message. */
  importExternalSetup?(source: string, items: NativeImportItem[]): Promise<void>;
  /** The plugins of the available marketplaces (`/plugins`), installed ones first. */
  plugins?(): Promise<NativePlugin[]>;
  pluginDetail?(key: string): Promise<NativePluginDetail>;
  /** Installs a plugin (downloads code from a third party); resolves with the names of the apps that still need to be connected. */
  installPlugin?(key: string): Promise<{ appsNeedingAuth: string[] }>;
  uninstallPlugin?(key: string): Promise<void>;
  /** The whole conversation in the assistant's own Markdown export format. */
  exportTranscript?(): Promise<string>;
  /** Files in the session folder matching `query`, as paths relative to it. */
  searchFiles?(query: string): Promise<string[]>;
  backgroundActivity?(): BackgroundActivity[];
  /** A short phrase of what the engine is doing right now (the command it is running), for the «Working» indicator; undefined when nothing specific runs. */
  currentActivity?(): string | undefined;
  status(): string[];
  /** Whether the assistant already receives Engram's memory from its own startup hook (so Shell does not paste it); `/status` says which. Absent when the session has no such check. */
  memoryDeliveredByAssistant?(): Promise<boolean>;
  visual?(): NativeVisualState;
  refreshUsage?(): Promise<void>;
  close(): void;
}
