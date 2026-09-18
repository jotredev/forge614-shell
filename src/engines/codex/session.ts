import type { RpcConnection } from "../../infrastructure/rpc.ts";
import type { Approve, Emit, NativeModel, NativeSession, NativeVisualState, NativeWorkMode } from "../types.ts";
import { openLoginBrowser } from "../../infrastructure/browser.ts";
import { confirmedLogout } from "../logout.ts";

export class CodexSession implements NativeSession {
  busy = false;
  sessionId?: string;
  models: NativeModel[] = [];
  private model?: string;
  private effort?: string;
  private auth = "Not logged in. Use /login.";
  private quotas = "Quota: not reported";
  private tokens = "Tokens / context: not reported";
  private context?: { used: number; window: number };
  private usage: NativeVisualState["usage"] = [];
  private connected = false;
  private user?: string;
  private loaded = false;
  private disconnected = false;
  private turnId?: string;
  private loginId?: string;
  private aborted = new AbortController();
  private finishTurn?: (error?: Error) => void;
  private items = new Map<string, any>();
  private streamed = new Set<string>();
  private modes: NativeWorkMode[] = [];
  private selectedMode?: { approvalPolicy: string; sandboxPolicy: { type: string } };

  constructor(private rpc: RpcConnection, private cwd: string, private emit: Emit, private approve: Approve, private openBrowser: (url: string) => Promise<boolean> = openLoginBrowser) {
    rpc.onNotification = (method, params) => this.notification(method, params);
    rpc.onRequest = (method, params) => this.request(method, params);
    rpc.onClose = error => { this.aborted.abort(); this.loginId = undefined; this.busy = false; this.finishTurn?.(error); this.emit({ type: "text", text: error.message }); };
  }
  async initialize(): Promise<void> {
    await this.rpc.request("initialize", { clientInfo: { name: "forge614_shell", title: "Forge614-Shell", version: "0.1.0" }, capabilities: {} });
    this.rpc.notify("initialized");
    await this.readAccount();
    await this.readWorkModes();
    let cursor: string | undefined;
    do {
      const response = await this.rpc.request("model/list", { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) });
      this.models.push(...response.data.map((model: any) => ({ id: model.model, name: model.displayName, efforts: model.supportedReasoningEfforts?.map((item: any) => item.reasoningEffort), defaultEffort: model.defaultReasoningEffort })));
      const defaultModel = response.data.find((model: any) => model.isDefault);
      if (!this.model && defaultModel) { this.model = defaultModel.model; this.effort = defaultModel.defaultReasoningEffort; }
      cursor = response.nextCursor ?? undefined;
    } while (cursor);
    await this.readQuotas();
  }
  private async readWorkModes(): Promise<void> {
    try {
      const result = await this.rpc.request("configRequirements/read", {});
      const requirements = result.requirements;
      const policies: string[] = requirements?.allowedApprovalPolicies ?? ["onRequest", "unlessTrusted"];
      const sandboxes: string[] = requirements?.allowedSandboxModes ?? ["readOnly", "workspaceWrite"];
      this.modes = policies.flatMap(policy => sandboxes.map(sandbox => ({ id: `${policy}:${sandbox}`, label: `${policy} · ${sandbox}` })));
    } catch { this.modes = []; }
  }
  workModes(): NativeWorkMode[] { return this.modes; }
  workMode(): string | undefined { return this.selectedMode ? `${this.selectedMode.approvalPolicy}:${this.selectedMode.sandboxPolicy.type}` : undefined; }
  async setWorkMode(id: string): Promise<void> {
    this.idle();
    const [approvalPolicy, sandbox] = id.split(":");
    if (!approvalPolicy || !sandbox || !this.modes.some(mode => mode.id === id)) throw new Error("Choose a mode reported by Codex.");
    this.selectedMode = { approvalPolicy, sandboxPolicy: { type: sandbox } };
  }
  private async readAccount(): Promise<boolean> {
    const response = await this.rpc.request("account/read", { refreshToken: false });
    const valid = response.account?.type === "chatgpt" && response.requiresOpenaiAuth !== false;
    this.connected = valid;
    this.user = valid && typeof response.account.email === "string" ? response.account.email : undefined;
    this.auth = valid ? `ChatGPT account · ${response.account.planType ?? "plan not reported"}` : "ChatGPT login required; API-key mode is not used. Type /login.";
    return valid;
  }
  private async readQuotas(): Promise<void> {
    try { this.updateQuotas(await this.rpc.request("account/rateLimits/read")); }
    catch { this.quotas = "Quota: not reported"; }
  }
  async refreshUsage(): Promise<void> {
    if (this.disconnected || !this.connected) throw new Error("Connect with /login before refreshing usage.");
    this.updateQuotas(await this.rpc.request("account/rateLimits/read"));
    this.emit({ type: "status", text: "" });
  }
  private updateQuotas(data: any): void {
    const buckets = data.rateLimitsByLimitId ?? { codex: data.rateLimits };
    const lines: string[] = [];
    const usage: NonNullable<NativeVisualState["usage"]> = [];
    for (const [label, bucket] of Object.entries(buckets) as [string, any][]) {
      for (const name of ["primary", "secondary"]) {
        const window = bucket?.[name];
        if (typeof window?.usedPercent === "number") {
          const reset = typeof window.resetsAt === "number" ? new Date(window.resetsAt * 1000).toISOString() : "not reported";
          lines.push(`${label} ${name}: ${window.usedPercent}% used · resets ${reset} (last report)`);
          usage.push({ label: `${label} ${name}`, usedPercent: window.usedPercent, ...(typeof window.resetsAt === "number" ? { reset } : {}) });
        }
      }
    }
    this.quotas = lines.join("\n") || "Quota: not reported";
    this.usage = usage;
  }
  async login(): Promise<void> {
    this.idle();
    this.busy = true; this.aborted = new AbortController();
    try {
      if (await this.readAccount()) {
        if (this.aborted.signal.aborted) { this.busy = false; return; }
        this.disconnected = false;
        this.busy = false;
        this.emit({ type: "text", text: "Connected to Codex in Shell using your existing ChatGPT account. No new login is needed." });
        return;
      }
      if (this.aborted.signal.aborted) { this.busy = false; return; }
      const result = await this.rpc.request("account/login/start", { type: "chatgpt" });
      if (result.type !== "chatgpt" || !result.loginId || !result.authUrl) throw new Error("Codex did not return a managed ChatGPT login.");
      this.loginId = result.loginId;
      if (this.aborted.signal.aborted) { await this.cancel(); return; }
      this.emit({ type: "text", text: `Opening the official ChatGPT login in your default browser…\nIf it does not open, use this link:\n${result.authUrl}\nCredentials remain managed by Codex. /stop cancels this login.` });
      const opened = await this.openBrowser(result.authUrl).catch(() => false);
      if (this.loginId === result.loginId && !this.aborted.signal.aborted) {
        this.emit({ type: "text", text: opened
          ? "Browser launch requested. Complete login there; Shell is waiting for Codex confirmation."
          : "Could not open your browser automatically. Open the link above manually, or use /stop to cancel." });
      }
    } catch (error) { this.busy = false; this.loginId = undefined; throw error; }
  }
  async logout(): Promise<void> {
    this.idle(); this.busy = true; this.aborted = new AbortController();
    try {
      const done = await confirmedLogout("Codex", this.approve, this.aborted.signal, async () => {
        this.disconnected = true;
        this.quotas = "Quota: not reported";
        this.context = undefined; this.usage = [];
      });
      if (!done) { this.emit({ type: "text", text: "Logout cancelled. No account changes were requested." }); return; }
      this.auth = "Disconnected locally · use /login to reconnect Shell";
      this.sessionId = undefined; this.loaded = false; this.tokens = "Tokens / context: not reported"; this.context = undefined;
      this.items.clear(); this.streamed.clear();
      this.emit({ type: "text", text: "Disconnected locally from Codex in this Shell session. Your native account and other applications are unchanged. Use /login to reconnect." });
    } finally { this.busy = false; this.emit({ type: "status", text: "" }); }
  }
  private idle(): void { if (this.busy) throw new Error("Finish or /stop the active turn first."); }
  status(): string[] {
    if (this.disconnected) return ["Disconnected locally · use /login to reconnect Shell. Native account unchanged."];
    return [this.auth, `Model: ${this.model ?? "engine default"} · effort: ${this.effort ?? "engine default"}`, this.tokens, this.quotas, "Cost: not reported by the engine; plan billing remains with OpenAI."];
  }
  visual(): NativeVisualState {
    if (this.disconnected || !this.connected) return { account: "disconnected", provider: "Codex" };
    return {
      account: "connected",
      provider: "Codex",
      user: this.user,
      ...(this.model ? { model: this.model } : {}),
      ...(this.effort ? { reasoning: this.effort } : {}),
      ...(this.context ? { context: this.context } : {}),
      ...(this.usage?.length ? { usage: this.usage } : {}),
    };
  }
  async setModel(id: string): Promise<void> {
    this.idle(); const model = this.models.find(model => model.id === id);
    if (!model) throw new Error("Choose an available model from /model.");
    this.model = id; this.effort = model.defaultEffort;
  }
  async setEffort(effort: string): Promise<void> {
    this.idle(); const model = this.models.find(model => model.id === this.model);
    if (effort === "default") { this.effort = model?.defaultEffort; return; }
    if (!model?.efforts?.includes(effort)) throw new Error("Choose a supported reasoning level shown by /model.");
    this.effort = effort;
  }
  reset(): void { this.idle(); this.sessionId = undefined; this.loaded = false; this.tokens = "Tokens / context: not reported"; this.context = undefined; }
  async listSessions(): Promise<{ id: string; title: string }[]> {
    this.idle();
    const result = await this.rpc.request("thread/list", { cwd: this.cwd, limit: 100, sortKey: "updated_at" });
    return result.data.filter((thread: any) => thread.cwd === this.cwd).map((thread: any) => ({ id: thread.id, title: thread.name || thread.preview || thread.id }));
  }
  async resume(id: string): Promise<void> {
    this.idle();
    const { thread } = await this.rpc.request("thread/read", { threadId: id, includeTurns: true });
    if (thread.cwd !== this.cwd) throw new Error("This session belongs to another project.");
    if (thread.status?.type === "active") throw new Error("This session is active in another client. Stop it there first.");
    this.sessionId = id; this.loaded = false; this.tokens = "Tokens / context: not reported";
    this.emit({ type: "reset", text: "" });
    for (const turn of thread.turns ?? []) for (const item of turn.items ?? []) {
      if (item.type === "agentMessage") this.emit({ type: "text", text: item.text });
      if (item.type === "userMessage") this.emit({ type: "text", text: `You: ${item.content.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n")}` });
    }
  }
  async send(text: string): Promise<void> {
    this.idle(); if (!text.trim()) return;
    if (this.disconnected) throw new Error("Use /login to reconnect this Shell session before sending a message.");
    this.busy = true; this.aborted = new AbortController(); this.streamed.clear(); this.items.clear();
    try {
      if (!await this.readAccount()) throw new Error("Use /login with ChatGPT before sending a message. No API fallback was used.");
      if (this.aborted.signal.aborted) return;
      if (!this.loaded) {
        const config = this.selectedMode
          ? { cwd: this.cwd, model: this.model, modelProvider: "openai", ...this.selectedMode }
          : { cwd: this.cwd, model: this.model, modelProvider: "openai", approvalPolicy: "untrusted", approvalsReviewer: "user", sandbox: "workspace-write" };
        const result = await this.rpc.request(this.sessionId ? "thread/resume" : "thread/start", { ...config, ...(this.sessionId ? { threadId: this.sessionId } : {}) });
        if (result.modelProvider !== "openai") throw new Error("Expected the official OpenAI provider; refusing to send a prompt.");
        this.sessionId = result.thread.id; this.loaded = true; this.model = result.model; this.effort ??= result.reasoningEffort;
      }
      if (this.aborted.signal.aborted) return;
      const finished = new Promise<void>((resolve, reject) => { this.finishTurn = error => error ? reject(error) : resolve(); });
      void finished.catch(() => {});
      const result = await this.rpc.request("turn/start", { threadId: this.sessionId, input: [{ type: "text", text }], model: this.model, effort: this.effort, ...(this.selectedMode ? { approvalPolicy: this.selectedMode.approvalPolicy, sandboxPolicy: this.selectedMode.sandboxPolicy } : { approvalPolicy: "untrusted", approvalsReviewer: "user" }) });
      this.turnId = result.turn.id;
      if (this.aborted.signal.aborted) await this.rpc.request("turn/interrupt", { threadId: this.sessionId, turnId: this.turnId });
      await finished;
    } finally { this.busy = false; this.turnId = undefined; this.finishTurn = undefined; this.aborted.abort(); }
  }
  async cancel(): Promise<void> {
    this.aborted.abort();
    if (this.loginId) {
      try { await this.rpc.request("account/login/cancel", { loginId: this.loginId }); }
      finally { this.loginId = undefined; this.busy = false; }
      return;
    }
    if (this.turnId) await this.rpc.request("turn/interrupt", { threadId: this.sessionId, turnId: this.turnId });
  }
  close(): void { this.aborted.abort(); this.rpc.close(); }
  private notification(method: string, params: any): void {
    if (method === "account/login/completed") {
      if (!this.loginId || params.loginId !== this.loginId) return;
      this.loginId = undefined; this.busy = false;
      if (params.success) this.disconnected = false;
      this.emit({ type: "text", text: params.success ? "ChatGPT login completed." : `Login failed: ${params.error ?? "cancelled"}` });
      void this.readAccount().then(() => this.readQuotas()).then(() => this.emit({ type: "status", text: "" })).catch(() => {});
      return;
    }
    if (method === "account/rateLimits/updated") { this.updateQuotas(params); this.emit({ type: "status", text: "" }); return; }
    if (params.threadId !== this.sessionId) return;
    if (method === "turn/started") this.turnId = params.turn.id;
    if (method === "item/agentMessage/delta") {
      this.streamed.add(params.itemId);
      this.emit({ type: "delta", id: params.itemId, text: params.delta });
    }
    if (method === "item/started") {
      this.items.set(params.item.id, params.item);
      if (["commandExecution", "fileChange", "mcpToolCall"].includes(params.item.type)) this.emit({ type: "text", text: `Tool: ${params.item.type}\n${params.item.command ?? ""}` });
    }
    if (method === "item/completed" && params.item.type === "agentMessage" && !this.streamed.has(params.item.id)) this.emit({ type: "text", text: params.item.text });
    if (method === "thread/tokenUsage/updated") {
      const usage = params.tokenUsage;
      this.tokens = `Session tokens: input ${usage.total.inputTokens} · cached ${usage.total.cachedInputTokens} · output ${usage.total.outputTokens}\nLast context: ${usage.last.totalTokens} / ${usage.modelContextWindow ?? "not reported"}`;
      if (typeof usage.last?.totalTokens === "number" && typeof usage.modelContextWindow === "number") this.context = { used: usage.last.totalTokens, window: usage.modelContextWindow };
      this.emit({ type: "status", text: "" });
    }
    if (method === "turn/completed") {
      if (this.turnId && params.turn.id !== this.turnId) return;
      this.finishTurn?.(params.turn.status === "failed" ? new Error(params.turn.error?.message ?? "Codex turn failed") : undefined);
    }
    if (method === "error") this.emit({ type: "text", text: `Codex: ${params.error?.message ?? "Engine error"}` });
  }
  private async request(method: string, params: any): Promise<any> {
    const scoped = this.busy && params.threadId === this.sessionId && (!this.turnId || params.turnId === this.turnId);
    if (["item/commandExecution/requestApproval", "item/fileChange/requestApproval"].includes(method)) {
      const details = JSON.stringify({ ...params, item: this.items.get(params.itemId) }, null, 2);
      const allowed = scoped && details.length <= 20000 && await this.approve(`${method}\n${details}`, this.aborted.signal);
      return { decision: allowed && !this.aborted.signal.aborted ? "accept" : "decline" };
    }
    if (method === "item/permissions/requestApproval") return { permissions: {}, scope: "turn" };
    if (method === "mcpServer/elicitation/request") return { action: "decline", content: null };
    if (method === "item/tool/requestUserInput") {
      this.emit({ type: "text", text: "Codex requested a questionnaire. Ask it to pose the question in chat; no option was approved." });
      return { answers: {} };
    }
    throw new Error("Unsupported engine request");
  }
}
