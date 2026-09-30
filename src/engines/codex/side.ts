import { SIDE_BOUNDARY_PROMPT, SIDE_DEVELOPER_INSTRUCTIONS } from "./prompts.ts";

/**
 * What `/side` (and `/btw`, the same command) needs from Codex's own code, ported from `tui/src/app/side.rs` and `app_server_session.rs` (rust-v0.159.0): the
 * instructions the side thread gets, the boundary item injected into it and how a refused fork is recognized. The conversation with the app-server is in `session.ts`.
 */

/** `App::side_developer_instructions`: the side instructions after the thread's own ones, separated by a blank line; with none they stand alone. */
export function sideDeveloperInstructions(existing?: string | null): string {
  return existing && existing.trim() ? `${existing}\n\n${SIDE_DEVELOPER_INSTRUCTIONS}` : SIDE_DEVELOPER_INSTRUCTIONS;
}

/**
 * `App::side_boundary_prompt_item`: the `ResponseItem::Message` (a user message with one `input_text`) that `thread/inject_items` appends to the side thread's history so
 * everything inherited from the parent reads as reference only (`ResponseItem.ts`, `ContentItem.ts`; `id`, `phase` and the metadata are left out, as Codex leaves them).
 */
export function sideBoundaryItem() {
  return { type: "message", role: "user", content: [{ type: "input_text", text: SIDE_BOUNDARY_PROMPT }] };
}

/**
 * `is_history_pagination_unsupported`: whether a server's complaint is about the paginated-history feature, which is when the fork is sent again without
 * `excludeTurns`. Codex also checks the JSON-RPC code (`method not found`); Shell's transport keeps only the message, so the words stand for it.
 */
export function isHistoryPaginationUnsupported(message: string): boolean {
  const text = message.toLowerCase();
  return text.includes("method not found")
    || ["historymode", "history mode", "excludeturns", "exclude turns", "thread/turns/list", "thread/items/list"].some(field => text.includes(field))
    || (text.includes("paginated") && ["unknown variant", "unsupported variant", "invalid enum"].some(error => text.includes(error)));
}

/** `side_start_error_message`: a fork refused because the conversation has no first message yet, in either of the two ways the server says it. */
export function sideStartRefusal(message: string): "no-conversation" | undefined {
  return message.includes("no rollout found for thread id") || message.includes("includeTurns is unavailable before first user message") ? "no-conversation" : undefined;
}
