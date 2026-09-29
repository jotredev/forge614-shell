import type { RpcConnection } from "../../src/infrastructure/rpc.ts";

export class FixtureRpc implements RpcConnection {
  onNotification = (_method: string, _params: any) => {};
  onRequest = async (_method: string, _params: any): Promise<any> => { throw new Error("Unexpected request"); };
  onClose = (_error: Error) => {};
  calls: { method: string; params: any }[] = [];
  /** The timeout (ms) each method was last asked with; a method asked with none is absent. Kept apart from `calls` so those keep their exact `{ method, params }` shape. */
  timeouts = new Map<string, number>();
  replies = new Map<string, any>();
  handler?: (method: string, params: any) => Promise<any>;
  async request(method: string, params: any = {}, timeoutMs?: number) {
    this.calls.push({ method, params });
    if (timeoutMs !== undefined) this.timeouts.set(method, timeoutMs);
    if (this.handler) return this.handler(method, params);
    if (!this.replies.has(method)) throw new Error(`Unexpected ${method}`);
    return this.replies.get(method);
  }
  notify(method: string, params: any = {}) { this.calls.push({ method, params }); }
  close() {}
}
