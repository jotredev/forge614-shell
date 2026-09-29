/**
 * Codex's own text formats for `/export`, `/copy` and the «Implement this plan?» prompt, reproduced from Codex
 * 0.159.0's terminal app (`codex-rs/tui/src`) over the app-server's thread items (`v2/ThreadItem.ts`). They are
 * data formats, not screen text, so they stay in English like Codex writes them.
 */

/** Removes terminal escape sequences and control characters (keeping line breaks and tabs), like `sanitize_user_text`. */
function sanitize(text: string): string {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

/** The lines of a text, without the empty line a final newline would add. */
function lines(text: string): string[] {
  const parts = text.split("\n");
  if (parts.at(-1) === "") parts.pop();
  return parts;
}

/** Capitalized, like Rust's `Debug` of a unit variant (`completed` → `Completed`). */
const debugName = (value: unknown) => { const text = String(value ?? ""); return text.charAt(0).toUpperCase() + text.slice(1); };

type Section = { heading: "User" | "Assistant" | "Plan" | "Reasoning" | "Activity"; lines: string[] };

/** One exported section per item, as `thread_items_to_transcript_cells` and `export_activity_cell` produce them; an item Codex does not export gives none. */
function section(item: any): Section | undefined {
  switch (item?.type) {
    case "userMessage": {
      const text = (item.content ?? []).filter((part: any) => part?.type === "text").map((part: any) => String(part.text)).join("\n");
      return { heading: "User", lines: lines(sanitize(text)) };
    }
    case "agentMessage": return { heading: "Assistant", lines: lines(String(item.text ?? "")) };
    case "plan": return { heading: "Plan", lines: lines(String(item.text ?? "")) };
    case "reasoning": return { heading: "Reasoning", lines: lines((item.summary ?? []).join("\n").trim()) };
    case "commandExecution": return typeof item.command === "string" ? { heading: "Activity", lines: [`$ ${item.command}`] } : undefined;
    case "enteredReviewMode": return { heading: "Activity", lines: [`>> Code review started: ${item.review} <<`] };
    case "exitedReviewMode": return { heading: "Activity", lines: lines(`<< Code review finished: ${item.review} >>`) };
    case "fileChange": {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      return { heading: "Activity", lines: [
        `file changes: ${debugName(item.status)} · ${changes.length} changes`,
        ...changes.flatMap((change: any) => [`${debugName(change?.kind?.type ?? change?.kind)}: ${change?.path}`, ...lines(String(change?.diff ?? ""))]),
      ] };
    }
    case "mcpToolCall": {
      const out = [`mcp tool: ${item.server}/${item.tool}(${JSON.stringify(item.arguments ?? null)}) · ${debugName(item.status)}`];
      for (const content of item.result?.content ?? []) out.push(...(content?.type === "text" ? lines(String(content.text)) : [JSON.stringify(content)]));
      if (item.result?.structuredContent) out.push(`structured result: ${JSON.stringify(item.result.structuredContent)}`);
      if (item.error?.message) out.push(...lines(`error: ${item.error.message}`));
      return { heading: "Activity", lines: out };
    }
    default: return undefined;
  }
}

/**
 * `/export`: the whole conversation as Codex's Markdown transcript (`app/transcript_export.rs`
 * `render_markdown_transcript`): «# Codex conversation», then one «## User / Assistant / Plan / Reasoning /
 * Activity» section per item, activity indented by four spaces. What the person typed during a review is left
 * out (`visible_export_items`). Throws Codex's own message when there is nothing to export.
 */
export function markdownTranscript(turns: { items?: unknown[] }[]): string {
  let markdown = "# Codex conversation\n";
  let reviewMode = false;
  for (const turn of turns) for (const item of turn.items ?? []) {
    const type = (item as any)?.type;
    if (type === "enteredReviewMode" || type === "exitedReviewMode") reviewMode = type === "enteredReviewMode";
    else if (type === "userMessage" && reviewMode) continue;
    const found = section(item);
    if (!found || !found.lines.length) continue;
    markdown += `\n## ${found.heading}\n\n`;
    for (const line of found.lines) markdown += `${found.heading === "Activity" ? "    " : ""}${line}\n`;
  }
  if (markdown === "# Codex conversation\n") throw new Error("No conversation content to export.");
  return markdown;
}

/** One row of the `/copy` picker: what it copies, what kind of part it is (the screen names it from the catalog) and its one-line preview. */
export type CopyChoice = { kind: "whole" | "code" | "quote"; language?: string; text: string; preview: string };

/** The first non-empty line, trimmed and cut at 72 characters with «...» like `truncate_text`. */
function preview(text: string): string {
  const line = text.split("\n").map(item => item.trim()).find(Boolean) ?? "";
  const chars = Array.from(line);
  return chars.length > 72 ? `${chars.slice(0, 69).join("")}...` : line;
}

/**
 * `/copy` (`chatwidget/copy_picker.rs` with `markdown.rs` `extract_copy_targets`): the whole answer, then each
 * fenced code block (its language is the first word of the fence's info) and each block quote (with «>» and one
 * space removed from every line), in the order they appear. An empty answer offers nothing.
 */
export function copyChoices(markdown: string): CopyChoice[] {
  if (!markdown) return [];
  const choices: CopyChoice[] = [{ kind: "whole", text: markdown, preview: preview(markdown) }];
  const source = markdown.split("\n");
  for (let index = 0; index < source.length; index++) {
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(source[index]!);
    if (fence) {
      const marker = fence[1]!;
      const language = fence[2]!.trim().split(/[, \t]/)[0] || undefined;
      const body: string[] = [];
      for (index++; index < source.length && !new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`).test(source[index]!); index++) body.push(source[index]!);
      const text = body.map(line => `${line}\n`).join("");
      choices.push({ kind: "code", ...(language ? { language } : {}), text, preview: preview(text) });
      continue;
    }
    if (/^ {0,3}>/.test(source[index]!)) {
      const quoted: string[] = [];
      for (; index < source.length && /^ {0,3}>/.test(source[index]!); index++) quoted.push(source[index]!.replace(/^ *>/, "").replace(/^ /, ""));
      index--;
      const text = quoted.map(line => `${line}\n`).join("");
      if (text.trim()) choices.push({ kind: "quote", text, preview: preview(text) });
    }
  }
  return choices;
}

/** The tokens Codex counts as always present in the context (`BASELINE_TOKENS`, `protocol/src/protocol.rs`). */
const BASELINE_TOKENS = 12_000;

/**
 * The «current context» label of «Yes, clear context and implement» (`plan_implementation_context_usage_label`):
 * the share of the usable window already used, after Codex's 12 000-token baseline, as «N% used»; nothing when
 * the context is unknown or still empty.
 */
export function planContextUsage(context: { used: number; window: number } | undefined): string | undefined {
  if (!context) return undefined;
  let remaining = 0;
  if (context.window > BASELINE_TOKENS) {
    const effective = context.window - BASELINE_TOKENS;
    const used = Math.max(context.used - BASELINE_TOKENS, 0);
    remaining = Math.round(Math.min(Math.max(Math.max(effective - used, 0) / effective * 100, 0), 100));
  }
  const used = 100 - remaining;
  return used > 0 ? `${used}% used` : undefined;
}
