import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";
import type { ShellQuestion } from "../../engines/types.ts";
import { normalizeSearch } from "./composer.ts";
import type { ForgeComposer } from "./composer.ts";

/**
 * «Quit anyway? What is running will be stopped.» (`/f614:quit`, Ctrl+C and Ctrl+D while work runs): two rows with words, «No» first
 * and marked, so Enter alone keeps everything — stopping work cannot be undone — and the arrow (or the row's first letter) picks
 * «Yes». Esc is «No». Resolves `true` only for «Yes». Unlike `askPermission` the marked row is the safe one, not the approving one.
 */
export async function askQuit(input: ForgeComposer, locale: Locale): Promise<boolean> {
  const t = getCatalog(locale);
  const row = (value: string, display: string) => ({ value, display, label: "", key: normalizeSearch(display).charAt(0) });
  const choice = await input.choose(t.chat.quitQuestion, [row("no", t.permission.no), row("yes", t.permission.yes)], undefined, { numbered: false, footer: t.chat.quitFooter });
  return choice === "yes";
}

/**
 * A Yes/No question of Shell's own (disconnect, delete, stop, install, send data out — never a permission the assistant asks): its own title and words, «No» first and marked so
 * Enter alone keeps everything as it is, and Esc is «No». `body` is what the question is about and goes away with it. Resolves `true` only for «Yes»; when `signal` aborts the
 * question closes as «No». It is the one place these questions are drawn, so `/logout`, `/feedback`, `/import` and `/plugins` look the same.
 */
export async function askShellQuestion(input: ForgeComposer, question: ShellQuestion, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return false;
  const onAbort = () => input.cancelChoice();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const choice = await input.choose(question.title, [{ value: "no", display: question.no, label: "" }, { value: "yes", display: question.yes, label: "" }], undefined, question.body ? { body: question.body } : undefined);
    return choice === "yes" && !signal?.aborted;
  } finally { signal?.removeEventListener("abort", onAbort); }
}

/**
 * The permission question of both assistants: two rows with words — «Sí» and «No» (or «Yes» and «No») — the approving
 * one first and marked, so Enter alone approves; the arrow (or the row's first letter) picks «No», and so does Esc. No
 * numbers, no slash commands, and one footer that says how to cancel the turn. Resolves `true` only for «Sí»; every
 * other way out (Esc, a typed `/f614:no`, the turn being cancelled) is `false`. Typed `/f614:yes` and `/f614:no` still answer through
 * the chat's own command handling, which is not part of this selector.
 */
export async function askPermission(input: ForgeComposer, locale: Locale): Promise<boolean> {
  const t = getCatalog(locale).permission;
  const row = (value: string, display: string) => ({ value, display, label: "", key: normalizeSearch(display).charAt(0) });
  const choice = await input.choose(t.question, [row("yes", t.yes), row("no", t.no)], undefined, { numbered: false, footer: t.footer });
  return choice === "yes";
}
