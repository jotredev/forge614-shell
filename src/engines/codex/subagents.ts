/**
 * What `/subagents` needs from Codex's own code, ported from `tui/src/app/loaded_threads.rs`, `agent_picker.rs`, `session_lifecycle.rs` and `multi_agents.rs`
 * (rust-v0.159.0): how a thread the app-server reports becomes a row of the picker, which loaded threads are descendants of the conversation and how a row is named.
 * Everything here is pure; the conversation with the app-server is in `session.ts`.
 */

/** A thread that may be a subagent of the conversation, reduced to what the picker and the tree walk read. */
export interface SubagentThread {
  id: string;
  /** The thread that spawned it (`SubAgentSource::ThreadSpawn.parent_thread_id`); none for a thread that is not a spawned subagent. */
  parentId?: string;
  agentPath?: string; nickname?: string; role?: string;
  /** Usually its first message, without the memory block Shell puts in front of it. */
  preview: string;
  /** `running` (an active turn), `closed` (the server does not hold it in memory) or `idle`. */
  state: "running" | "idle" | "closed";
  /** Unix seconds, to keep the spawn order. */
  createdAt: number;
}

const clean = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;

/**
 * A `Thread` of the protocol (`v2/Thread.ts`) as a `SubagentThread`: the spawn edge, path, nickname and role come from its `source`
 * (`{ subAgent: { thread_spawn: … } }`, `v2/SessionSource.ts`) and the nickname and role also from the thread itself; the state from its `status`.
 * `preview` is passed already cleaned by the caller.
 */
export function toSubagentThread(thread: any, preview: string): SubagentThread {
  const spawn = thread?.source?.subAgent?.thread_spawn;
  const parentId = clean(spawn?.parent_thread_id);
  const agentPath = clean(spawn?.agent_path);
  const nickname = clean(thread?.agentNickname) ?? clean(spawn?.agent_nickname);
  const role = clean(thread?.agentRole) ?? clean(spawn?.agent_role);
  const status = thread?.status?.type;
  return {
    id: String(thread.id), preview,
    ...(parentId ? { parentId } : {}), ...(agentPath ? { agentPath } : {}), ...(nickname ? { nickname } : {}), ...(role ? { role } : {}),
    state: status === "active" ? "running" : status === "notLoaded" ? "closed" : "idle",
    createdAt: typeof thread?.createdAt === "number" ? thread.createdAt : 0,
  };
}

/**
 * `find_loaded_subagent_threads_for_primary`: from the flat list of loaded threads, every descendant of `primaryId`, found by following the spawn edges at any depth.
 * Threads that were not spawned by another, or whose chain does not reach `primaryId`, and `primaryId` itself are left out.
 */
export function descendantsOf(primaryId: string, threads: readonly SubagentThread[]): SubagentThread[] {
  const found = new Map<string, SubagentThread>();
  const pending = [primaryId];
  for (let parent = pending.pop(); parent !== undefined; parent = pending.pop()) {
    for (const thread of threads) {
      if (thread.parentId !== parent || found.has(thread.id) || thread.id === primaryId) continue;
      found.set(thread.id, thread);
      pending.push(thread.id);
    }
  }
  return [...found.values()];
}

/**
 * The name Codex's picker gives a subagent: its agent path when it has one, otherwise `nickname [role]`, the nickname, or `[role]`. Empty when it has none of them,
 * which the screen replaces with the first message or with a generic word.
 */
export function subagentName(thread: Pick<SubagentThread, "agentPath" | "nickname" | "role">): string {
  const path = clean(thread.agentPath);
  if (path) return path;
  const nickname = clean(thread.nickname); const role = clean(thread.role);
  if (nickname && role) return `${nickname} [${role}]`;
  return nickname ?? (role ? `[${role}]` : "");
}

/** `can_fallback_from_include_turns_error`: a `thread/read` with turns that the server cannot give for this thread, which Codex answers by reading it without them. */
export function canReadWithoutTurns(message: string): boolean {
  return ["includeTurns is unavailable before first user message", "thread/turns/list is unavailable before first user message", "ephemeral threads do not support includeTurns"]
    .some(phrase => message.includes(phrase));
}
