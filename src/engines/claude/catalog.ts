import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKUserMessage, Query } from "@anthropic-ai/claude-agent-sdk";
import { claudeEnvironment } from "./auth.ts";

/** Control-plane handshake only: this stream never yields a user message. */
export async function loadClaudeCatalog(
  config: { cwd: string; executable: string; env: NodeJS.ProcessEnv },
  signal?: AbortSignal,
  connect: typeof query = query,
) {
  signal?.throwIfAborted();
  const controller = new AbortController();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  async function* idleInput(): AsyncGenerator<SDKUserMessage> { await gate; }
  const abort = () => { controller.abort(); release(); };
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 15_000);
  let connection: ReturnType<typeof query> | undefined;
  try {
    connection = connect({ prompt: idleInput(), options: {
      cwd: config.cwd, env: claudeEnvironment(config.env), pathToClaudeCodeExecutable: config.executable,
      abortController: controller, persistSession: false, settingSources: ["user", "project", "local"],
      permissionMode: "default", canUseTool: async () => ({ behavior: "deny", message: "Catalog discovery cannot execute tools." }),
    } });
    const result = await connection.initializationResult();
    const usage = await readPlanUsage(connection);
    controller.signal.throwIfAborted();
    return { models: result.models, commands: result.commands ?? [], account: result.account, usage };
  } finally {
    clearTimeout(timeout); signal?.removeEventListener("abort", abort);
    release(); connection?.close();
  }
}

/** Optional, version-sensitive control API. Never gate chat on its availability. */
export async function readPlanUsage(connection: Query) {
  try {
    const response = await connection.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
    if (!response.rate_limits_available || !response.rate_limits) return [];
    return Object.entries(response.rate_limits).flatMap(([label, value]) => {
      if (!value || typeof value !== "object" || !("utilization" in value) || typeof value.utilization !== "number") return [];
      const reset = "resets_at" in value && typeof value.resets_at === "string" ? value.resets_at : undefined;
      return [{ label, usedPercent: value.utilization, ...(reset ? { reset } : {}) }];
    });
  } catch { return []; }
}
