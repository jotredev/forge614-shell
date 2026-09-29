import type { BackgroundActivity } from "../../engines/types.ts";

export type AccountState = "connected" | "disconnected" | "checking" | "unknown";

export type ContextUsage = { used: number; window: number };
export type ProviderUsage = { label: string; usedPercent: number; reset?: string };
export type ResourceUsage = { shellRssBytes: number; engineRssBytes?: number };
export type ConnectedDetails = {
  inputTokens?: number;
  outputTokens?: number;
  estimateUSD?: number;
  user?: string;
  sessionId?: string;
  model?: string;
  reasoning?: string;
  context?: ContextUsage;
  usage?: ProviderUsage[];
  resources?: ResourceUsage;
  backgroundActivity?: BackgroundActivity[];
  backgroundActivitySupported?: boolean;
};

export type ShellSnapshot = {
  inputTokens?: number;
  outputTokens?: number;
  estimateUSD?: number;
  user?: string;
  sessionId?: string;
  startedAt?: number;
  account: AccountState;
  provider: string;
  /** The command that connects the account with this assistant (Claude Code: its own `/login`; Codex has none, so Shell's `/f614:login`); the screens name it when the account is not connected. */
  loginCommand?: string;
  model?: string;
  reasoning?: string;
  context?: ContextUsage;
  usage?: ProviderUsage[];
  resources?: ResourceUsage;
  backgroundActivity?: BackgroundActivity[];
  backgroundActivitySupported?: boolean;
};

export class ShellState {
  private readonly startedAt = Date.now();
  private account: AccountState = "disconnected";
  private details: ConnectedDetails = {};

  /** `loginCommand` is the command that reconnects with this assistant, shown wherever Shell says the account is not connected. */
  constructor(private readonly provider: string, private readonly loginCommand = "/login") {}

  checking(): void { this.account = "checking"; this.details = {}; }
  unknown(): void { this.account = "unknown"; this.details = {}; }

  connect(details: ConnectedDetails = {}): void {
    this.account = "connected";
    this.details = details;
  }

  disconnect(): void {
    this.account = "disconnected";
    this.details = {};
  }

  update(details: ConnectedDetails): void {
    if (this.account !== "connected") return;
    this.details = { ...this.details, ...details };
  }

  snapshot(): ShellSnapshot {
    if (this.account === "disconnected") return { account: this.account, provider: this.provider, loginCommand: this.loginCommand };
    return {
      account: this.account,
      provider: this.provider,
      loginCommand: this.loginCommand,
      ...this.details,
      ...(this.account === "connected" ? { startedAt: this.startedAt } : {}),
    };
  }
}
