import { expect, test } from "bun:test";
import { copyChoices, markdownTranscript, planContextUsage } from "./transcript.ts";

/**
 * `chatwidget/copy_picker.rs` with `markdown.rs` `extract_copy_targets`: the whole answer first, then every
 * fenced code block (with its language when it has one) and every block quote (its «>» removed), in the order
 * they appear; each row previews its first non-empty line, cut at 72 characters. The row names the person
 * reads come from the i18n catalog.
 */
test("copyChoices() offers the whole answer, then each code block and quote in order", () => {
  const long = "x".repeat(80);
  const answer = `Intro\n\n\`\`\`ts\nconst a = 1;\n\`\`\`\n\n> Quoted line\n> second line\n\n\`\`\`\n${long}\n\`\`\`\n`;
  expect(copyChoices(answer)).toEqual([
    { kind: "whole", text: answer, preview: "Intro" },
    { kind: "code", language: "ts", text: "const a = 1;\n", preview: "const a = 1;" },
    { kind: "quote", text: "Quoted line\nsecond line\n", preview: "Quoted line" },
    { kind: "code", text: `${long}\n`, preview: `${"x".repeat(69)}...` },
  ]);
  expect(copyChoices("")).toEqual([]);
});

/** `turn_runtime.rs` `plan_implementation_context_usage_label` with `percent_of_context_window_remaining` (12 000 baseline tokens): the used share, or nothing when unknown or still empty. */
test("planContextUsage() reports the used share of the context like Codex", () => {
  expect(planContextUsage({ used: 70_000, window: 128_000 })).toBe("50% used");
  expect(planContextUsage({ used: 5_000, window: 128_000 })).toBeUndefined();
  expect(planContextUsage(undefined)).toBeUndefined();
});

/**
 * `app/transcript_export.rs` `visible_export_items`: what the person typed inside a review is not exported; the
 * review's own status lines are (`thread_transcript/other_items.rs`), as indented activity. An empty
 * conversation cannot be exported.
 */
test("markdownTranscript() leaves out review prompts, keeps the review lines and refuses an empty conversation", () => {
  expect(markdownTranscript([{ items: [
    { type: "enteredReviewMode", id: "e", review: "current changes" },
    { type: "userMessage", id: "u", content: [{ type: "text", text: "hidden review prompt" }] },
    { type: "exitedReviewMode", id: "x", review: "Looks good." },
    { type: "agentMessage", id: "a", text: "Done." },
  ] }])).toBe("# Codex conversation\n\n## Activity\n\n    >> Code review started: current changes <<\n\n## Activity\n\n    << Code review finished: Looks good. >>\n\n## Assistant\n\nDone.\n");
  expect(() => markdownTranscript([])).toThrow("No conversation content to export.");
});
