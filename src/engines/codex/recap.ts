import { RECAP_PROMPT_PREFIX } from "./prompts.ts";

/**
 * What `/recap` needs from Codex's own code, ported from `tui/src/app/recap.rs`, `recap_history.rs`,
 * `temporary_structured_request.rs` and `context-fragments/src/recap_prompt.rs` (rust-v0.159.0): the prompt, the history it carries, the schema of the
 * answer, how the answer is checked and how the temporary thread is set up. Everything here is pure; the conversation with the app-server is in `session.ts`.
 */

/** One message the person sees in the conversation: theirs (`user`) or Codex's (`assistant`). Tool output, reasoning and other threads are never part of it. */
export interface RecapCell { role: "user" | "assistant"; text: string }

/** `RECAP_HISTORY_MAX_TURNS`: how many answered exchanges the history holds at most. */
export const RECAP_HISTORY_MAX_TURNS = 8;
/** `RecapPrompt::MAX_ESTIMATED_TOKENS` (8 192) at `APPROX_BYTES_PER_TOKEN` (4): the whole prompt, instructions included, in UTF-8 bytes. */
export const RECAP_MAX_BYTES = 8_192 * 4;
const byteLength = (text: string) => Buffer.byteLength(text);
/** `RecapPrompt::HISTORY_MAX_BYTES`: what is left for the conversation once the fixed instructions are counted. */
export const RECAP_HISTORY_MAX_BYTES = RECAP_MAX_BYTES - byteLength(RECAP_PROMPT_PREFIX);
/** `STRUCTURED_TURN_TIMEOUT`: how long starting the thread, running the turn and detaching each may take. */
export const RECAP_TURN_TIMEOUT_MS = 30_000;
/** `STRUCTURED_RESPONSE_MAX_BYTES`: a model answer bigger than this is refused. */
export const RECAP_RESPONSE_MAX_BYTES = 8 * 1024;
const RECAP_MAX_CHARS = 700;
const RECAP_NEXT_MAX_CHARS = 200;
const OMITTED_HISTORY = "[Earlier exchanges omitted]\n\n";
const EXCERPT_MARKER = "\n[... excerpted ...]\n";

/** Rust's `floor_char_boundary`: the greatest character boundary at or before `index`. */
function floorBoundary(bytes: Buffer, index: number): number {
  if (index >= bytes.length) return bytes.length;
  let boundary = index;
  while (boundary > 0 && (bytes[boundary]! & 0xc0) === 0x80) boundary--;
  return boundary;
}

/** Rust's `ceil_char_boundary`: the smallest character boundary at or after `index`. */
function ceilBoundary(bytes: Buffer, index: number): number {
  if (index >= bytes.length) return bytes.length;
  let boundary = index;
  while (boundary < bytes.length && (bytes[boundary]! & 0xc0) === 0x80) boundary++;
  return boundary;
}

/** The beginning and the end of `text` around a marker when it does not fit `maxBytes` (`excerpt`): both ends of a long message are what says the most. */
function excerpt(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text);
  if (bytes.length <= maxBytes) return text;
  const content = maxBytes - EXCERPT_MARKER.length;
  if (content < 0) return bytes.subarray(0, floorBoundary(bytes, maxBytes)).toString("utf8");
  const head = floorBoundary(bytes, Math.floor(content / 2));
  const tail = ceilBoundary(bytes, bytes.length - (content - Math.floor(content / 2)));
  return `${bytes.subarray(0, head).toString("utf8")}${EXCERPT_MARKER}${bytes.subarray(tail).toString("utf8")}`;
}

interface Exchange { user: string; assistant: string }

/** `Exchange::fields`: the labelled, non-empty parts of an exchange; a request the assistant has not answered is «Pending user request». */
function exchangeFields(exchange: Exchange): [string, string][] {
  const fields: [string, string][] = [[exchange.assistant ? "User" : "Pending user request", exchange.user], ["Assistant", exchange.assistant]];
  return fields.filter(([, text]) => text !== "");
}

/**
 * `recent_exchanges`: walks the messages from the newest, joins the ones that follow each other from the same side (steering counts as one request) and stops
 * after eight answered exchanges. A newer request nobody answered yet is kept as the last exchange.
 */
function recentExchanges(cells: readonly RecapCell[]): Exchange[] {
  const exchanges: Exchange[] = [];
  let current: Exchange = { user: "", assistant: "" };
  let answered = 0;
  for (let index = cells.length - 1; index >= 0; index--) {
    const cell = cells[index]!;
    let content = cell.text.trim();
    if (!content) continue;
    // Walking backwards, an assistant message that comes before a request belongs to the previous exchange.
    if (cell.role === "assistant" && current.user) {
      answered += current.assistant ? 1 : 0;
      exchanges.push(current);
      current = { user: "", assistant: "" };
      if (answered === RECAP_HISTORY_MAX_TURNS) break;
    }
    const field = cell.role === "user" ? "user" : "assistant";
    if (current[field]) content += `\n\n${current[field]}`;
    current[field] = content;
  }
  if (current.user) exchanges.push(current);
  return exchanges.reverse();
}

/**
 * `recap_history`: the conversation as `User: …` / `Assistant: …` blocks separated by blank lines, at most eight answered exchanges and at most
 * `RECAP_HISTORY_MAX_BYTES`. Over that, the oldest exchanges are dropped first («[Earlier exchanges omitted]»), keeping the newest answer together with any newer
 * unanswered request; if that is still too much, every message keeps both its ends around «[... excerpted ...]». Empty when there is no request to summarize.
 */
export function recapHistory(cells: readonly RecapCell[]): string {
  const exchanges = recentExchanges(cells);
  const latest = exchanges[exchanges.length - 1];
  if (!latest) return "";
  const blocks = exchanges.map(exchange => exchangeFields(exchange).map(([label, text]) => `${label}: ${text}`).join("\n\n"));
  let bytes = blocks.reduce((total, block) => total + byteLength(block), 0) + 2 * (blocks.length - 1);
  if (bytes <= RECAP_HISTORY_MAX_BYTES) return blocks.join("\n\n");

  const retained = latest.assistant === "" ? 2 : 1;
  const oldestRetained = Math.max(0, exchanges.length - retained);
  let start = 0;
  while (bytes > RECAP_HISTORY_MAX_BYTES - OMITTED_HISTORY.length && start < oldestRetained) {
    bytes -= byteLength(blocks[start]!) + 2;
    start++;
  }
  const omission = start > 0 ? OMITTED_HISTORY : "";
  const budget = RECAP_HISTORY_MAX_BYTES - omission.length;
  if (bytes <= budget) return `${omission}${blocks.slice(start).join("\n\n")}`;

  const fields = exchanges.slice(start).flatMap(exchangeFields);
  const overhead = fields.reduce((total, [label]) => total + label.length + 2, 0) + 2 * (fields.length - 1);
  let remaining = Math.max(0, budget - overhead);
  const excerpts = fields.map(([label, text], index) => {
    const share = Math.floor(remaining / (fields.length - index));
    // Reserve a share for the later fields, without wasting space on short replies.
    const reserved = fields.slice(index + 1).reduce((total, [, later]) => total + Math.min(byteLength(later), share), 0);
    const part = excerpt(text, remaining - reserved);
    remaining -= byteLength(part);
    return `${label}: ${part}`;
  });
  return `${omission}${excerpts.join("\n\n")}`;
}

/** `RecapPrompt::new(history).render()`: Codex's instructions and, right after «Conversation:», the history cut at `RECAP_HISTORY_MAX_BYTES` on a character boundary. */
export function recapPrompt(history: string): string {
  const bytes = Buffer.from(history);
  const end = floorBoundary(bytes, Math.min(RECAP_HISTORY_MAX_BYTES, bytes.length));
  return `${RECAP_PROMPT_PREFIX}${bytes.subarray(0, end).toString("utf8")}`;
}

/** `recap_output_schema()`: the `outputSchema` of the recap turn. */
export function recapOutputSchema() {
  return {
    type: "object",
    properties: {
      summary: { type: "string", minLength: 1, maxLength: RECAP_MAX_CHARS },
      next_action: { type: ["string", "null"], maxLength: RECAP_NEXT_MAX_CHARS },
    },
    required: ["summary", "next_action"],
    additionalProperties: false,
  };
}

/** What the person is shown: the summary and, when there is one, the next action. */
export interface Recap { summary: string; nextAction?: string }

/**
 * `parse_recap`: the model's answer must be a JSON object with exactly `summary` (text) and `next_action` (text or null), both within their limits once trimmed
 * (700 and 200 characters); a blank next action means none. Anything else is not a recap.
 */
export function parseRecap(response: string): Recap | undefined {
  let value: unknown;
  try { value = JSON.parse(response); } catch { return undefined; }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const fields = value as Record<string, unknown>;
  const keys = Object.keys(fields);
  if (keys.length !== 2 || !keys.includes("summary") || !keys.includes("next_action")) return undefined;
  if (typeof fields.summary !== "string" || (fields.next_action !== null && typeof fields.next_action !== "string")) return undefined;
  const summary = fields.summary.trim();
  if (!summary || [...summary].length > RECAP_MAX_CHARS) return undefined;
  const nextAction = typeof fields.next_action === "string" ? fields.next_action.trim() : "";
  if ([...nextAction].length > RECAP_NEXT_MAX_CHARS) return undefined;
  return { summary, ...(nextAction ? { nextAction } : {}) };
}

/**
 * The `config` overrides of the temporary thread (`start_temporary_thread`): Codex's list of features and tools switched off, the read-only permission profile,
 * and every MCP server (named once, in order) disabled — the recap works on text the person wrote, so it must not reach a tool, a memory or an outside service.
 */
export function temporaryThreadConfig(mcpServerNames: Iterable<string>): Record<string, unknown> {
  const switchedOff = [
    "features.apps", "features.code_mode", "features.code_mode_only", "features.context_management", "features.current_time_reminder", "features.deferred_executor",
    "features.enable_fanout", "features.goals", "features.hooks", "features.image_generation", "features.memories", "features.multi_agent", "features.multi_agent_v2",
    "features.plugins", "features.request_permissions_tool", "features.shell_snapshot", "features.shell_tool", "features.standalone_web_search", "features.token_budget",
    "features.tool_suggest", "features.unified_exec", "features.view_image", "cloud.skills.enabled", "skills.include_instructions",
    "tools.experimental_request_user_input.enabled", "tools.update_plan.enabled",
  ];
  return {
    ...Object.fromEntries(switchedOff.map(key => [key, false])),
    web_search: "disabled",
    default_permissions: ":read-only",
    mcp_servers: Object.fromEntries([...new Set(mcpServerNames)].sort().map(name => [name, { enabled: false }])),
  };
}
