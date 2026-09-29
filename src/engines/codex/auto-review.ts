import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import type { Catalog } from "../../i18n/index.ts";

/** How many recent denials `/approve` keeps, as Codex's `MAX_RECENT_DENIALS` does. */
export const MAX_RECENT_DENIALS = 10;

/** A denial Shell keeps for `/approve`: what the list shows, and the event Codex wants back untouched in its own shape. */
export interface AutoReviewDenialRecord { id: string; summary: string; rationale?: string; event: Record<string, unknown> }

/** `camelCase` (the notification's words) as `snake_case` (the event's), so `unifiedExec` is `unified_exec` and `socks5Tcp` is `socks5_tcp`. */
const snake = (value: string): string => value.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);

/** A word for a shell command line, quoted only when it needs it (`shlex::try_join`). */
const shellWord = (word: string): string =>
  word === "" ? "''" : /^[A-Za-z0-9_@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'"'"'`)}'`;

/** At most 80 characters, ending in «…» when it was cut (`truncate_text` in Codex's summary of typed input). */
const shortText = (text: string): string => [...text].length > 80 ? `${[...text].slice(0, 79).join("")}…` : text;

/**
 * The one-line summary of a denied action, as Codex's `auto_review_denials::action_summary` words it: a command as it was, and the other
 * kinds with their fixed words in the person's language. `action` is the notification's own (camelCase) action
 * (`v2/GuardianApprovalReviewAction.ts`).
 */
export function actionSummary(action: any, native: Catalog["codexNative"]): string {
  switch (action?.type) {
    case "command": return String(action.command);
    case "execve": return (action.argv?.length ? action.argv : [action.program]).map(String).map(shellWord).join(" ");
    case "writeStdin": return native.denialWriteStdin({ process: String(action.processId), input: shortText(JSON.stringify(String(action.stdin))) });
    case "applyPatch": {
      const files: string[] = (action.files ?? []).map(String);
      return files.length === 1 ? native.denialPatchOne({ file: files[0]! }) : native.denialPatchMany({ count: files.length });
    }
    case "networkAccess": return native.denialNetwork({ target: String(action.target) });
    case "mcpToolCall": return native.denialMcp({ tool: String(action.toolName), label: String(action.connectorName ?? action.server) });
    case "requestPermissions": return action.reason ? native.denialPermissionReason({ reason: String(action.reason) }) : native.denialPermission;
    default: return String(action?.type ?? "");
  }
}

/**
 * The action as the `GuardianAssessmentEvent` holds it (`protocol/src/approvals.rs`, snake_case), rebuilt from the notification's camelCase
 * one the way Codex's own screen does. `undefined` when it cannot be rebuilt faithfully — a permission request for file-system access, whose
 * permissions are shaped differently in the event, or a stdin folder that is not an absolute path — so Shell never sends Codex a guess.
 */
function eventAction(action: any): Record<string, unknown> | undefined {
  switch (action?.type) {
    case "command": return { type: "command", source: snake(String(action.source)), command: action.command, cwd: action.cwd };
    case "execve": return { type: "execve", source: snake(String(action.source)), program: action.program, argv: action.argv, cwd: action.cwd };
    case "writeStdin":
      return typeof action.cwd === "string" && isAbsolute(action.cwd)
        ? { type: "write_stdin", approval_id: action.approvalId, process_id: action.processId, stdin: action.stdin, cwd: pathToFileURL(action.cwd).href }
        : undefined;
    case "applyPatch": return { type: "apply_patch", cwd: action.cwd, files: action.files };
    case "networkAccess": return { type: "network_access", target: action.target, host: action.host, protocol: snake(String(action.protocol)), port: action.port };
    case "mcpToolCall":
      return { type: "mcp_tool_call", server: action.server, tool_name: action.toolName, connector_id: action.connectorId ?? null, connector_name: action.connectorName ?? null, tool_title: action.toolTitle ?? null };
    case "requestPermissions":
      return action.permissions?.fileSystem ? undefined
        : { type: "request_permissions", reason: action.reason ?? null, permissions: { network: action.permissions?.network ?? null, file_system: null } };
    default: return undefined;
  }
}

/**
 * A denial for `/approve` from an `item/autoApprovalReview/completed` notification (`v2/ItemGuardianApprovalReviewCompletedNotification.ts`),
 * or `undefined` when the review was not denied or its action cannot be sent back. The event has what Codex's `on_guardian_review_notification`
 * builds (a target item is left out, as it does), and only the fields the review gave.
 */
export function denialFromNotification(params: any, native: Catalog["codexNative"]): AutoReviewDenialRecord | undefined {
  const review = params?.review;
  if (review?.status !== "denied" || typeof params.reviewId !== "string") return undefined;
  const action = eventAction(params.action);
  if (!action) return undefined;
  const event: Record<string, unknown> = {
    id: params.reviewId, turn_id: params.turnId, started_at_ms: params.startedAtMs,
    ...(typeof params.completedAtMs === "number" ? { completed_at_ms: params.completedAtMs } : {}),
    status: "denied",
    ...(review.riskLevel ? { risk_level: review.riskLevel } : {}),
    ...(review.userAuthorization ? { user_authorization: review.userAuthorization } : {}),
    ...(typeof review.rationale === "string" ? { rationale: review.rationale } : {}),
    ...(params.decisionSource ? { decision_source: snake(String(params.decisionSource)) } : {}),
    action,
  };
  return { id: params.reviewId, summary: actionSummary(params.action, native), ...(typeof review.rationale === "string" ? { rationale: review.rationale } : {}), event };
}
