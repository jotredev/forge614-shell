import type { Readable, Writable } from "node:stream";

// Protocol payloads are validated/interpreted by each engine adapter, not by the transport.
export interface RpcConnection {
  request(method: string, params?: any, timeoutMs?: number): Promise<any>;
  notify(method: string, params?: any): void;
  onNotification: (method: string, params: any) => void;
  onRequest: (method: string, params: any) => Promise<any>;
  onClose: (error: Error) => void;
  close(): void;
}

export class JsonRpcPeer implements RpcConnection {
  onNotification = (_method: string, _params: any): void => {};
  onRequest = async (_method: string, _params: any): Promise<any> => { throw new Error("Unsupported engine request"); };
  onClose = (_error: Error): void => {};
  private sequence = 0;
  private buffer = "";
  private closed = false;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer?: ReturnType<typeof setTimeout> }>();

  constructor(private input: Readable, private output: Writable, private version: boolean) {
    input.setEncoding("utf8");
    input.on("data", this.receive);
    input.once("end", this.ended);
    input.once("error", this.failed);
    output.on("error", this.failed);
  }
  private ended = () => this.fail(new Error("Engine connection closed"));
  private failed = (error: Error) => this.fail(error);
  private write(message: any): void {
    if (this.closed) throw new Error("Engine connection closed");
    this.output.write(JSON.stringify(this.version ? { jsonrpc: "2.0", ...message } : message) + "\n");
  }
  request(method: string, params: any = {}, timeoutMs = 30000): Promise<any> {
    if (this.closed) return Promise.reject(new Error("Engine connection closed"));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs > 0 ? setTimeout(() => {
        this.fail(new Error(`Engine request timed out: ${method}`));
      }, timeoutMs) : undefined;
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); }
      catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
    });
  }
  notify(method: string, params: any = {}): void { this.write({ method, params }); }
  private receive = (chunk: string) => {
    this.buffer += chunk;
    if (this.buffer.length > 16 * 1024 * 1024) { this.fail(new Error("Engine message exceeded size limit")); return; }
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).trim(); this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line);
        if (typeof message.method === "string") {
          if (message.id !== undefined) {
            void this.onRequest(message.method, message.params ?? {}).then(
              result => { if (!this.closed) this.write({ id: message.id, result: result ?? {} }); },
              () => { if (!this.closed) this.write({ id: message.id, error: { code: -32601, message: "Unsupported or denied client request" } }); },
            ).catch(error => this.fail(error));
          } else this.onNotification(message.method, message.params ?? {});
        } else {
          const pending = this.pending.get(message.id);
          if (!pending) continue;
          clearTimeout(pending.timer); this.pending.delete(message.id);
          if (message.error) pending.reject(new Error(String(message.error.message ?? "Engine request failed")));
          else pending.resolve(message.result);
        }
      } catch { this.fail(new Error("Invalid engine protocol message")); return; }
    }
  };
  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    this.input.removeListener("data", this.receive);
    this.output.end();
    this.onClose(error);
  }
  close(): void { this.fail(new Error("Engine connection closed")); }
}
