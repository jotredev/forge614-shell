import type { RpcConnection } from "../../infrastructure/rpc.ts";
import type { Approve, Emit, NativeModel, NativeSession } from "../types.ts";

export class GeminiSession implements NativeSession {
  busy = false;
  sessionId?: string;
  models: NativeModel[] = [];
  private capabilities: any = {};
  private googleAuth = false;
  private authenticated = false;
  private model?: string;
  private aborted = new AbortController();
  private usage = "Tokens / context / quota / cost: not reported by Gemini ACP";
  private chunkId = 0;

  constructor(private rpc: RpcConnection, private cwd: string, private emit: Emit, private approve: Approve, private checkConfiguration: () => Promise<void> = async () => {}) {
    rpc.onNotification = (method, params) => this.notification(method, params);
    rpc.onRequest = (method, params) => this.request(method, params);
    rpc.onClose = error => { this.aborted.abort(); this.emit({ type: "text", text: error.message }); };
  }
  async initialize(): Promise<void> {
    const result = await this.rpc.request("initialize", { protocolVersion: 1, clientInfo: { name: "forge614-shell", version: "0.1.0" }, clientCapabilities: {} });
    if (result.protocolVersion !== 1) throw new Error("Unsupported Gemini ACP protocol version. Update Gemini CLI.");
    this.capabilities = result.agentCapabilities ?? {};
    this.googleAuth = result.authMethods?.some((method: any) => method.id === "oauth-personal") ?? false;
    if (!this.googleAuth) throw new Error("This Gemini CLI does not expose Google account authentication.");
  }
  private idle(): void { if (this.busy) throw new Error("Finish or /stop the active turn first."); }
  private async authenticate(): Promise<void> {
    await this.checkConfiguration();
    if (!this.authenticated) {
      this.emit({ type: "text", text: "Connecting through Gemini CLI's Google account login. Complete its browser login if prompted; Shell does not read your credentials." });
      await this.rpc.request("authenticate", { methodId: "oauth-personal" }, 330000);
      this.authenticated = true;
      this.emit({ type: "text", text: "Google account connected. Gemini CLI reuses valid saved credentials without opening another browser window." });
    }
  }
  async login(): Promise<void> { this.idle(); await this.authenticate(); await this.ensureSession(); }
  private updateModels(result: any): void {
    if (result.models) {
      this.model = result.models.currentModelId;
      this.models = result.models.availableModels.map((model: any) => ({ id: model.modelId, name: model.name }));
    }
  }
  private async ensureSession(): Promise<void> {
    if (this.sessionId) return;
    await this.authenticate();
    const result = await this.rpc.request("session/new", { cwd: this.cwd, mcpServers: [] }, 60000);
    this.sessionId = result.sessionId;
    this.updateModels(result);
    await this.rpc.request("session/set_mode", { sessionId: this.sessionId, modeId: "default" });
  }
  status(): string[] {
    return [this.authenticated ? "Google account · authentication owned by Gemini CLI" : "Use /login to connect your Google account.", `Model: ${this.model ?? "engine default"} · reasoning: managed by Gemini (no ACP selector exposed)`, this.usage];
  }
  async setModel(id: string): Promise<void> {
    this.idle(); await this.ensureSession();
    if (!this.models.some(model => model.id === id)) throw new Error("Choose a model from /model.");
    await this.rpc.request("session/set_model", { sessionId: this.sessionId, modelId: id });
    this.model = id;
  }
  async setEffort(_effort: string): Promise<void> { throw new Error("Reasoning selection is not exposed by this Gemini ACP connector. Gemini manages it."); }
  reset(): void { this.idle(); this.sessionId = undefined; this.usage = "Tokens / context / quota / cost: not reported by Gemini ACP"; }
  async listSessions(): Promise<{ id: string; title: string }[]> {
    this.idle();
    if (!this.capabilities.sessionCapabilities?.list) throw new Error("This Gemini CLI does not expose ACP history listing. Use /resume <session-id> from your Gemini history. No background summary or model request was started.");
    const result = await this.rpc.request("session/list", { cwd: this.cwd });
    return result.sessions.filter((session: any) => session.cwd === this.cwd).map((session: any) => ({ id: session.sessionId, title: session.title ?? session.sessionId }));
  }
  async resume(id: string): Promise<void> {
    this.idle();
    if (!this.capabilities.loadSession) throw new Error("This Gemini CLI does not support ACP session loading.");
    await this.authenticate();
    const previous = this.sessionId; this.sessionId = id;
    this.emit({ type: "reset", text: "" });
    try {
      const result = await this.rpc.request("session/load", { sessionId: id, cwd: this.cwd, mcpServers: [] }, 60000);
      this.updateModels(result);
      await this.rpc.request("session/set_mode", { sessionId: id, modeId: "default" });
    } catch (error) { this.sessionId = previous; throw error; }
  }
  async send(text: string): Promise<void> {
    this.idle(); if (!text.trim()) return;
    this.busy = true; this.aborted = new AbortController(); this.chunkId++;
    try {
      await this.checkConfiguration(); await this.ensureSession();
      if (this.aborted.signal.aborted) return;
      const result = await this.rpc.request("session/prompt", { sessionId: this.sessionId, prompt: [{ type: "text", text }] }, 0);
      if (result.usage) {
        const usage = result.usage;
        this.usage = `Turn tokens: input ${usage.inputTokens} · output ${usage.outputTokens} · cached ${usage.cachedReadTokens ?? "not reported"}\nContext / quota / cost: not reported by Gemini ACP`;
      }
      this.emit({ type: "status", text: "" });
    } finally { this.busy = false; this.aborted.abort(); }
  }
  async cancel(): Promise<void> {
    this.aborted.abort();
    if (this.sessionId && this.busy) this.rpc.notify("session/cancel", { sessionId: this.sessionId });
  }
  close(): void { this.aborted.abort(); this.rpc.close(); }
  private notification(method: string, params: any): void {
    if (method !== "session/update" || params.sessionId !== this.sessionId) return;
    const update = params.update;
    if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") this.emit({ type: "delta", id: String(this.chunkId), text: update.content.text });
    if (update.sessionUpdate === "user_message_chunk" && update.content.type === "text") {
      this.chunkId++; this.emit({ type: "text", text: `You: ${update.content.text}` });
    }
    if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
      this.chunkId++;
      this.emit({ type: "text", text: `Tool: ${update.title ?? update.toolCallId} · ${update.status ?? "pending"}` });
    }
    if (update.sessionUpdate === "usage_update") {
      this.usage = `Context: ${update.used ?? "not reported"} / ${update.size ?? "not reported"}\nQuota / cost: not reported by Gemini ACP`;
      this.emit({ type: "status", text: "" });
    }
  }
  private async request(method: string, params: any): Promise<any> {
    if (method !== "session/request_permission") throw new Error("Unsupported Gemini client request");
    const details = JSON.stringify(params.toolCall, null, 2) ?? "";
    const once = params.options?.find((option: any) => option.kind === "allow_once");
    const allowed = this.busy && params.sessionId === this.sessionId && once && details.length <= 20000 && await this.approve(`Gemini permission request\n${details}`, this.aborted.signal);
    return allowed && !this.aborted.signal.aborted ? { outcome: { outcome: "selected", optionId: once.optionId } } : { outcome: { outcome: "cancelled" } };
  }
}
