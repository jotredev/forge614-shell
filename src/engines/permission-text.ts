import { getCatalog } from "../i18n/index.ts";
import type { Locale } from "../i18n/index.ts";
import { parseClaudeMcpToolName } from "./mcp-labels.ts";

/** Longest a sentence the assistant wrote (a Bash `description`, Codex's `reason`) or a file path is shown; the rest is cut with «…». */
const DESCRIPTION_LIMIT = 300;
/** Longest a `field: value` line of a tool without a dedicated layout is shown. */
const VALUE_LIMIT = 120;
/** Most `field: value` lines shown for such a tool; more end with «…». */
const FIELD_LIMIT = 5;
/** Most files listed for a Codex file change; the rest is counted. */
const FILE_LIMIT = 10;
/** The command is shown whole up to here — the same 20000 characters after which the request is denied unseen (`permissionTooLarge`). */
const COMMAND_LIMIT = 20000;
/** Longest the working folder of a request is shown: short enough that the card that draws it never breaks the path in the middle of a name. */
const FOLDER_LIMIT = 48;

/** One line, with runs of whitespace collapsed. */
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();
/** `text` cut to `max` characters, the last one being «…», when it is longer. */
const clip = (text: string, max: number): string => text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
/**
 * A folder path within `max` characters: as it is when it fits; otherwise «…» and its last folders, whole (the end is what tells
 * projects apart), or the last characters of a single name longer than that.
 */
const clipFolder = (path: string, max: number = FOLDER_LIMIT): string => {
  if (path.length <= max) return path;
  const tail = path.slice(-(max - 1));
  const boundary = tail.startsWith("/") ? 0 : tail.indexOf("/");
  return `…${boundary >= 0 ? tail.slice(boundary) : tail}`;
};
/** A non-empty string, or nothing: request fields arrive as `string | null | undefined` (or anything, for an open tool input). */
const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value : undefined;
/** The command in its own block: every line indented by four spaces, quotes exactly as written. */
const commandBlock = (command: string | undefined): string | undefined =>
  command ? clip(command.replace(/\r\n?/g, "\n").trimEnd(), COMMAND_LIMIT).split("\n").map(line => `    ${line}`).join("\n") : undefined;
/** The parts that exist, one blank line apart: what, where, then the command. */
const sections = (...parts: (string | undefined)[]): string => parts.filter(Boolean).join("\n\n");
/** The lines that exist as one section. */
const lines = (...parts: (string | undefined)[]): string | undefined => parts.filter(Boolean).join("\n") || undefined;

/** A field value as plain words: a list is its items, an object is its keys, a long text is cut; nothing of the JSON survives. */
function plainValue(value: unknown): string | undefined {
  if (typeof value === "string") return clip(oneLine(value), VALUE_LIMIT) || undefined;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (Array.isArray(value)) return clip(value.map(item => typeof item === "object" ? undefined : plainValue(item)).filter(Boolean).join(", "), VALUE_LIMIT) || undefined;
  if (value && typeof value === "object") return clip(`(${Object.keys(value).join(", ")})`, VALUE_LIMIT);
  return undefined;
}

/** The first `FIELD_LIMIT` fields of an open tool input as `field: value` lines, «…» when there are more; empty and null fields are left out. */
function fieldLines(input: Record<string, unknown>): string | undefined {
  const shown = Object.entries(input).flatMap(([name, value]) => { const plain = plainValue(value); return plain === undefined ? [] : [`${name}: ${plain}`]; });
  return lines(...shown.slice(0, FIELD_LIMIT), shown.length > FIELD_LIMIT ? "…" : undefined);
}

/**
 * A Claude Code tool permission request (`canUseTool(toolName, input)`) in plain words: what the assistant wants to do
 * in one sentence (its own `description` for Bash, otherwise one built from the kind of action), then where, then the
 * command in its own block. The inputs follow the SDK's tool input types (`sdk-tools.d.ts`); a tool without a layout of
 * its own gets its name and its first fields as `field: value` lines. `cwd` is the folder the session works in, named
 * for the tools that act on it. Nothing of the JSON input is ever shown.
 */
export function formatClaudePermission(tool: string, input: Record<string, unknown>, options: { locale: Locale; cwd?: string }): string {
  const t = getCatalog(options.locale).permission;
  const where = (path?: string) => (path ?? options.cwd) ? `${t.inPlace}: ${clip(path ?? options.cwd!, DESCRIPTION_LIMIT)}` : undefined;
  const filePath = (path: unknown) => text(path) ? `${t.file}: ${clip(text(path)!, DESCRIPTION_LIMIT)}` : undefined;
  switch (tool) {
    case "Bash": {
      const description = text(input.description);
      return sections(description ? clip(oneLine(description), DESCRIPTION_LIMIT) : t.runCommand, options.cwd ? `${t.folder}: ${clipFolder(options.cwd)}` : undefined, commandBlock(text(input.command)));
    }
    case "Edit": case "MultiEdit": return sections(t.editFile, filePath(input.file_path));
    case "Write": return sections(t.writeFile, filePath(input.file_path));
    case "NotebookEdit": return sections(t.editNotebook, filePath(input.notebook_path));
    case "Read": return sections(t.readFile, filePath(input.file_path));
    case "Glob": return sections(t.findFiles, lines(text(input.pattern) ? `${t.pattern}: ${clip(oneLine(text(input.pattern)!), VALUE_LIMIT)}` : undefined, where(text(input.path))));
    case "Grep": return sections(t.searchText, lines(
      text(input.pattern) ? `${t.text}: ${clip(oneLine(text(input.pattern)!), VALUE_LIMIT)}` : undefined, where(text(input.path)),
      text(input.glob) ? `${t.filter}: ${clip(oneLine(text(input.glob)!), VALUE_LIMIT)}` : undefined));
    case "WebFetch": return sections(t.fetchPage, text(input.url) ? `${t.address}: ${clip(oneLine(text(input.url)!), DESCRIPTION_LIMIT)}` : undefined);
    case "WebSearch": return sections(t.searchWeb, text(input.query) ? `${t.search}: ${clip(oneLine(text(input.query)!), DESCRIPTION_LIMIT)}` : undefined);
    default: {
      const mcp = parseClaudeMcpToolName(tool);
      return sections(mcp ? t.mcpTool(mcp) : t.genericTool({ tool }), fieldLines(input));
    }
  }
}

/**
 * A Codex permission request in plain words, for the two methods Shell answers (`item/commandExecution/requestApproval`,
 * `item/fileChange/requestApproval`). `params` are the request's own fields (`v2/CommandExecutionRequestApprovalParams.ts`,
 * `v2/FileChangeRequestApprovalParams.ts`) and `item` is the thread item Codex announced for it in `item/started`
 * (`v2/ThreadItem.ts`): the command and folder of a command, the files of a file change. Codex's `reason` says what,
 * else a sentence is built from the kind of action; then where (folder, or the files with what each change does), then
 * the command in its own block. Nothing of the event's JSON is ever shown.
 */
export function formatCodexPermission(method: string, params: Record<string, unknown>, item: Record<string, unknown> | undefined, locale: Locale): string {
  const t = getCatalog(locale).permission;
  const reason = text(params.reason);
  const what = (fallback: string) => reason ? clip(oneLine(reason), DESCRIPTION_LIMIT) : fallback;
  if (method === "item/commandExecution/requestApproval") {
    const cwd = text(params.cwd) ?? text(item?.cwd);
    return sections(what(t.runCommand), cwd ? `${t.folder}: ${clipFolder(cwd)}` : undefined, commandBlock(text(params.command) ?? text(item?.command)));
  }
  if (method === "item/fileChange/requestApproval") {
    const changes = (Array.isArray(item?.changes) ? item.changes as Record<string, unknown>[] : []).flatMap(change => {
      const kind = change.kind as Record<string, unknown> | undefined;
      const path = text(change.path);
      return path && text(kind?.type) ? [{ path, kind: text(kind?.type)!, movedTo: text(kind?.move_path) }] : [];
    });
    if (!changes.length) return sections(what(t.changeFilesUnknown));
    const kinds = new Set(changes.map(change => change.kind));
    const label = (kind: string) => kind === "add" ? t.kindAdd : kind === "delete" ? t.kindDelete : t.kindUpdate;
    const target = (change: (typeof changes)[number]) => `${clip(change.path, DESCRIPTION_LIMIT)}${change.movedTo ? ` (${t.movedTo({ path: clip(change.movedTo, DESCRIPTION_LIMIT) })})` : ""}`;
    const count = changes.length;
    const sentence = count === 1
      ? changes[0]!.kind === "add" ? t.createFile : changes[0]!.kind === "delete" ? t.deleteFile : t.editFile
      : kinds.size > 1 ? t.changeFiles({ count })
        : kinds.has("add") ? t.createFiles({ count }) : kinds.has("delete") ? t.deleteFiles({ count }) : t.editFiles({ count });
    const where = count === 1
      ? `${t.file}: ${target(changes[0]!)}`
      : lines(`${t.files}:`, ...changes.slice(0, FILE_LIMIT).map(change => `- ${label(change.kind)}: ${target(change)}`), count > FILE_LIMIT ? `- ${t.andMore({ count: count - FILE_LIMIT })}` : undefined);
    return sections(what(sentence), where);
  }
  return sections(what(t.genericTool({ tool: method })));
}
