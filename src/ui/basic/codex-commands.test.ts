import { expect, test } from "bun:test";
import { codexCommandHandlers } from "./codex-commands.ts";
import type { CodexCommandScreen } from "./codex-commands.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { NativeSession, NativeWorkMode } from "../../engines/types.ts";

/** Codex's permission menu as the adapter lists it: one mode that applies at once and Full Access, which asks first. */
const modes: NativeWorkMode[] = [
  { id: "ask", label: "Ask for approval" },
  { id: "full", label: "Full Access", confirm: true },
];

/** A screen that records what is written into the chat and every question asked (with its options), and answers the questions in order. */
function recordingScreen(locale: "en" | "es", answers: (string | undefined)[]) {
  const written: string[] = []; const asked: { title: string; options: unknown }[] = [];
  const session = { workModes: () => modes, workMode: () => undefined, setWorkMode: async () => "applied" } as unknown as NativeSession;
  const screen = {
    session, cwd: "/project", locale, local: {}, write: (text: string) => { written.push(text); },
    choose: async (title: string, _items: unknown, _current: unknown, options: unknown) => { asked.push({ title, options }); return answers.shift(); },
    rememberWorkMode: () => {}, refresh: () => {},
  } as unknown as CodexCommandScreen;
  return { screen, written, asked };
}

/**
 * Came out of the real-account test: `/permissions` → Full Access → Cancel left Codex's warning («With full access, Codex can edit…»)
 * printed in the chat. The warning now travels inside the question (the `body` option of `choose`), so it leaves with it: nothing of it
 * is ever written into the chat, whether the person cancels, accepts or closes the menu.
 */
for (const locale of ["en", "es"] as const) {
  const nt = getCatalog(locale).codexNative;
  test(`Full Access carries Codex's warning inside the question and never writes it into the chat, on Cancel (${locale})`, async () => {
    const { screen, written, asked } = recordingScreen(locale, ["full", "cancel", undefined]);
    await codexCommandHandlers(screen).permissions!("");
    expect(written).toEqual([]);
    expect(asked).toEqual([
      { title: nt.permissionsTitle, options: undefined },
      { title: nt.fullAccessTitle, options: { body: nt.fullAccessBody } },
      { title: nt.permissionsTitle, options: undefined },
    ]);
  });

  test(`Full Access accepted writes only the «permissions updated» line, not the warning (${locale})`, async () => {
    const { screen, written, asked } = recordingScreen(locale, ["full", "yes"]);
    await codexCommandHandlers(screen).permissions!("");
    expect(written).toEqual([nt.permissionsUpdated({ label: "Full Access" })]);
    expect(asked[1]).toEqual({ title: nt.fullAccessTitle, options: { body: nt.fullAccessBody } });
  });
}
