import { query } from "@anthropic-ai/claude-agent-sdk";
import type { EffortLevel, ModelInfo, Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { checkAuthentication, claudeEnvironment } from "./auth.ts";

type RunInput = { prompt: string; options: Options };
type Dependencies = {
  cwd: string;
  executable: string;
  env: NodeJS.ProcessEnv;
  authenticate?: () => Promise<void>;
  run?: (input: RunInput) => AsyncIterable<SDKMessage>;
};

export class ClaudeSession {
  busy = false;
  sessionId?: string;
  model?: string;
  effort?: EffortLevel;
  models: ModelInfo[] = [];
  private abort?: AbortController;

  constructor(private readonly dependencies: Dependencies) {}

  resume(id: string): void {
    if (this.busy) throw new Error("Stop the current turn before switching sessions.");
    this.sessionId = id;
  }

  reset(): void {
    if (this.busy) throw new Error("Stop the current turn before starting a new chat.");
    this.sessionId = undefined;
  }

  stop(): void { this.abort?.abort(); }

  async send(
    prompt: string,
    onEvent: (event: SDKMessage) => void,
    approve: (tool: string, input: Record<string, unknown>, signal: AbortSignal) => Promise<boolean>,
  ): Promise<void> {
    if (this.busy) throw new Error("A turn is already running. Use /stop first.");
    if (!prompt.trim()) return;
    this.busy = true;
    this.abort = new AbortController();
    try {
      const { cwd, executable, env } = this.dependencies;
      const safeEnv = claudeEnvironment(env);
      await (this.dependencies.authenticate?.() ?? checkAuthentication(executable, safeEnv, cwd));
      this.abort.signal.throwIfAborted();
      const options: Options = {
        cwd, env: safeEnv, pathToClaudeCodeExecutable: executable,
        abortController: this.abort,
        systemPrompt: { type: "preset", preset: "claude_code" },
        settingSources: ["user", "project", "local"],
        permissionMode: "default", persistSession: true, includePartialMessages: true,
        ...(this.sessionId ? { resume: this.sessionId } : {}),
        ...(this.model ? { model: this.model } : {}),
        ...(this.effort ? { effort: this.effort } : {}),
        canUseTool: async (tool, input, context) => {
          const allowed = await approve(tool, input, context.signal);
          return allowed && !context.signal.aborted
            ? { behavior: "allow", updatedInput: input }
            : { behavior: "deny", message: "The user did not approve this tool call." };
        },
      };
      const run = this.dependencies.run ?? ((input: RunInput) => this.officialRun(input));
      let resultSeen = false;
      for await (const event of run({ prompt, options })) {
        if (event.type === "system" && event.subtype === "init") this.sessionId = event.session_id;
        if (event.type === "result") resultSeen = true;
        onEvent(event);
      }
      if (!resultSeen && !this.abort.signal.aborted) throw new Error("Claude Code ended without a result. Check /resume before retrying.");
    } finally {
      this.abort = undefined;
      this.busy = false;
    }
  }

  private async *officialRun(input: RunInput): AsyncGenerator<SDKMessage> {
    const session = query(input);
    try {
      // This control request is a model catalog, not a separate model prompt.
      this.models = await session.supportedModels();
      for await (const event of session) yield event;
    } finally { session.close(); }
  }
}
