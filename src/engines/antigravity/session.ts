import { stripVTControlCharacters } from "node:util";
import type { Emit, NativeModel, NativeSession } from "../types.ts";
import { confirmedLogout } from "../logout.ts";

export interface AntigravityOperations {
  checkLogin?(signal: AbortSignal): Promise<"connected" | "required" | "unknown">;
  confirmLogin?(signal: AbortSignal): Promise<boolean>;
  confirmLogout?(description: string, signal: AbortSignal): Promise<boolean>;
  models(): Promise<string>;
  login(signal: AbortSignal): Promise<void>;
  run(args: string[], prompt: string, emit: (event: any) => void, signal: AbortSignal): Promise<void>;
}

export class AntigravitySession implements NativeSession {
  busy = false;
  sessionId?: string;
  models: NativeModel[] = [];
  resumeNotice = "Conversation selected. History preview is unavailable; no prompt was sent. Waiting for your next message.";
  private model?: string;
  private effort?: string;
  private control = new AbortController();
  private closed = false;
  private signedOut = false;
  private account = "Account not checked · /login checks your existing session";
  private usage = "Tokens / context / quota / cost: not reported yet";
  constructor(private emit: Emit, private operations: AntigravityOperations) {}
  private idle(): void {
    if (this.closed) throw new Error("Antigravity session is closed.");
    if (this.busy) throw new Error("Finish or /stop the active operation first.");
  }
  async initialize(): Promise<void> {
    if (this.operations.checkLogin) await this.checkLogin();
    try { await this.loadModels(); }
    catch { this.emit({ type: "text", text: "Model catalog unavailable. Use /login to check your connection; Shell will not open another interface automatically." }); }
    this.emit({ type: "text", text: "Antigravity uses native permission rules. Headless mode cannot ask for approval; workspace reads/writes may be allowed by native policy. No permission bypass is enabled by Shell." });
  }
  private async loadModels(): Promise<void> {
    const text = stripVTControlCharacters(await this.operations.models());
    this.models = text.split(/\r?\n/).flatMap(line => {
      const match = /^([a-z0-9][a-z0-9._-]+)\s+(.+)$/i.exec(line.trim());
      return match ? [{ id: match[1]!, name: match[2]!, efforts: ["low", "medium", "high"] }] : [];
    });
  }
  async login(): Promise<void> {
    this.idle(); this.busy = true; this.control = new AbortController();
    try {
      const state = await this.checkLogin();
      if (state === "connected") {
        this.emit({ type: "text", text: "Already connected through Antigravity. Staying in Shell; no new login is needed." });
        await this.loadModels(); return;
      }
      if (state === "unknown") {
        this.emit({ type: "text", text: "Could not verify your account. This may be a connection or CLI compatibility issue, not a logout. Nothing was opened. Retry /login after checking your connection." }); return;
      }
      if (!await this.operations.confirmLogin?.(this.control.signal) || this.control.signal.aborted) return;
      await this.operations.login(this.control.signal);
      if (await this.checkLogin() === "connected") await this.loadModels();
    } finally { this.busy = false; }
  }
  async logout(): Promise<void> {
    this.idle(); this.busy = true; this.control = new AbortController();
    try {
      if (!this.operations.confirmLogout) throw new Error("Logout is unavailable in this connector.");
      if (!await confirmedLogout("Antigravity", this.operations.confirmLogout, this.control.signal, async () => {
        this.signedOut = true;
        this.sessionId = undefined; this.models = []; this.model = undefined; this.effort = undefined;
        this.usage = "Tokens / context / quota / cost: not reported yet";
      })) {
        this.emit({ type: "text", text: "Logout cancelled. No account changes were requested." }); return;
      }
      this.account = "Disconnected locally · use /login to reconnect Shell";
      this.emit({ type: "text", text: "Disconnected locally from Antigravity in this Shell session. Your native account and other applications are unchanged. Use /login to reconnect." });
    } finally { this.busy = false; this.emit({ type: "status", text: "" }); }
  }
  private async checkLogin(): Promise<"connected" | "required" | "unknown"> {
    this.account = "Checking Google account…"; this.emit({ type: "status", text: "" });
    let state: "connected" | "required" | "unknown";
    try { state = await this.operations.checkLogin?.(this.control.signal) ?? "unknown"; }
    catch (error) {
      this.account = "Account check stopped · /login to retry";
      this.emit({ type: "status", text: "" }); throw error;
    }
    if (this.control.signal.aborted) throw new Error("Login check cancelled.");
    if (state === "connected") this.signedOut = false;
    this.account = state === "connected" ? "Connected · Google account via Antigravity" : state === "required" ? "Sign-in required · /login" : "Account could not be verified · /login to retry";
    this.emit({ type: "status", text: "" }); return state;
  }
  async setModel(id: string): Promise<void> {
    this.idle(); if (!this.models.some(model => model.id === id)) throw new Error("Choose an available model from /model.");
    this.model = id;
  }
  async setEffort(effort: string): Promise<void> {
    this.idle(); if (!["low", "medium", "high"].includes(effort)) throw new Error("Choose low, medium or high."); this.effort = effort;
  }
  async listSessions(): Promise<{ id: string; title: string }[]> {
    throw new Error("Antigravity headless does not expose history listing. Use /resume <native-conversation-id>; Shell cannot preview that history.");
  }
  async resume(id: string): Promise<void> {
    this.idle(); if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)) throw new Error("Invalid conversation ID.");
    this.sessionId = id; this.emit({ type: "reset", text: "" });
  }
  reset(): void { this.idle(); this.sessionId = undefined; this.usage = "Tokens / context / quota / cost: not reported yet"; }
  status(): string[] {
    return [this.account, `Model: ${this.model ?? "native default (not reported)"} · effort: ${this.effort ?? "native default"}`, this.usage];
  }
  async send(text: string): Promise<void> {
    this.idle(); if (!text.trim()) return;
    if (this.signedOut) throw new Error("Use /login before sending a message.");
    this.busy = true; this.control = new AbortController();
    const args = ["--input-format", "stream-json", "--output-format", "stream-json", "--disable-slash-commands"];
    if (this.model) args.push("--model", this.model);
    if (this.effort) args.push("--effort", this.effort);
    if (this.sessionId) args.push("--conversation", this.sessionId);
    let result: any; let streamed = false;
    try {
      await this.operations.run(args, text, event => {
        if (event.event === "init") {
          if (typeof event.conversation_id === "string") this.sessionId = event.conversation_id;
          if (typeof event.init?.model === "string") this.model = event.init.model;
        } else if (event.event === "step_update") {
          const step = event.step_update;
          if (step?.step_type === "agent_response" && typeof step.text_delta === "string") {
            streamed = true; this.emit({ type: "delta", id: String(step.step_index), text: step.text_delta });
          } else if (step?.step_type === "tool") this.emit({ type: "text", text: `Antigravity tool · ${step.state ?? "running"}` });
        } else if (event.event === "result") result = event.result;
        else if (event.event === "permission_notice") this.emit({ type: "text", text: "Antigravity reported a permission notice. Actions requiring approval can be denied in headless mode. Review native agy permissions; Shell will not auto-approve them." });
      }, this.control.signal);
      if (this.control.signal.aborted) throw new Error("Antigravity cancelled.");
      if (!result) throw new Error("Antigravity stream ended without a result.");
      if (result.status !== "SUCCESS") throw new Error(typeof result.error === "string" ? result.error : `Antigravity stopped: ${result.status}`);
      if (typeof result.conversation_id === "string") this.sessionId = result.conversation_id;
      if (!streamed && typeof result.response === "string") this.emit({ type: "text", text: result.response });
      if (result.usage) this.usage = `Run tokens: input ${result.usage.input_tokens ?? "not reported"} · output ${result.usage.output_tokens ?? "not reported"} · thinking ${result.usage.thinking_tokens ?? "not reported"}\nContext / quota / cost: not reported by this connector`;
      this.emit({ type: "status", text: "" });
    } finally { this.busy = false; }
  }
  async cancel(): Promise<void> { this.control.abort(); }
  close(): void { this.closed = true; this.control.abort(); }
}
