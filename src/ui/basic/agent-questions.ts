import type { ForgeComposer } from "./composer.ts";
import type { Locale } from "../../i18n/index.ts";
import type { AgentQuestion } from "../../engines/types.ts";

export async function askAgentQuestions(
  input: ForgeComposer, questions: AgentQuestion[], signal: AbortSignal, locale: Locale,
): Promise<Record<string, string[]> | undefined> {
  if (signal.aborted) return undefined;
  const cancel = () => input.cancelChoice();
  signal.addEventListener("abort", cancel, { once: true });
  const answers: Record<string, string[]> = {};
  try {
    for (const question of questions) {
      if (signal.aborted || !question.question || !question.id) return undefined;
      const other = locale === "es" ? "Otra respuesta" : "Other answer";
      const done = locale === "es" ? "Continuar" : "Continue";
      const placeholder = locale === "es" ? "Escribe tu respuesta" : "Type your answer";
      if (!question.options?.length) {
        const answer = await input.ask(question.header, placeholder, { body: question.question, ...(question.isSecret ? { secret: true } : {}) });
        if (answer === undefined || signal.aborted) return undefined;
        answers[question.id] = [answer];
        continue;
      }
      const selected: string[] = [];
      let startAt: string | undefined;
      while (true) {
        const items = question.options.map((option, index) => ({
          value: `option:${index}`,
          display: `${option.label}${selected.includes(option.label) ? " ✓" : ""}`,
          label: option.description,
        }));
        if (question.isOther !== false) items.push({ value: "other", display: other, label: "" });
        if (question.multiSelect) items.push({ value: "done", display: done, label: "" });
        const choice = await input.choose(question.header, items, undefined, { body: question.question, ...(startAt ? { startAt } : {}) });
        if (choice === undefined || signal.aborted) return undefined;
        if (choice === "done") { answers[question.id] = selected; break; }
        if (choice === "other") {
          const answer = await input.ask(question.header, placeholder, { body: question.question, ...(question.isSecret ? { secret: true } : {}) });
          if (answer === undefined || signal.aborted) return undefined;
          if (!question.multiSelect) { answers[question.id] = [answer]; break; }
          if (answer && !selected.includes(answer)) selected.push(answer);
          startAt = "other";
          continue;
        }
        const index = Number(choice.slice("option:".length));
        const label = question.options[index]?.label;
        if (label === undefined) return undefined;
        if (!question.multiSelect) { answers[question.id] = [label]; break; }
        if (selected.includes(label)) selected.splice(selected.indexOf(label), 1);
        else selected.push(label);
        startAt = choice;
      }
    }
    return signal.aborted ? undefined : answers;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
