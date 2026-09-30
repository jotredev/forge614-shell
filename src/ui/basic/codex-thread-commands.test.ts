import { expect, test } from "bun:test";
import { codexCommandHandlers } from "./codex-commands.ts";
import type { CodexCommandScreen } from "./codex-commands.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";
import type { NativeDetour, NativeRecapResult, NativeSession, NativeSideStart, NativeSubagent, NativeSubagentList } from "../../engines/types.ts";
import type { ComposerChoice } from "./composer.ts";

/** What a handler did on the screen, in order: the messages written, the questions asked (with their rows and options), the busy labels shown and the messages sent. */
interface Trace { written: string[]; asked: { title: string; items: ComposerChoice[]; current?: string; options?: { searchable?: boolean; body?: string } }[]; log: string[]; submitted: string[]; composer: string[] }

/** A screen double that records everything and answers the questions from `answers`, in order (`undefined` is Esc). */
function harness(locale: Locale, session: Partial<NativeSession>, answers: (string | undefined)[] = []) {
  const trace: Trace = { written: [], asked: [], log: [], submitted: [], composer: [] };
  const screen = {
    session: session as NativeSession, cwd: "/project", locale, local: {},
    write: (text: string) => { trace.written.push(text); trace.log.push(`write:${text.split("\n")[0]}`); },
    choose: async (title: string, items: ComposerChoice[], current?: string, options?: { searchable?: boolean; body?: string }) => { trace.asked.push({ title, items, current, options }); trace.log.push(`choose:${title}`); return answers.shift(); },
    working: (title: string, detail?: string) => { trace.log.push(`working:${title}${detail ? ` · ${detail}` : ""}`); return () => { trace.log.push("working-done"); }; },
    submit: (text: string) => { trace.submitted.push(text); trace.log.push(`submit:${text}`); },
    setComposerText: (text: string) => { trace.composer.push(text); },
    refresh: () => {},
  } as unknown as CodexCommandScreen;
  return { handlers: codexCommandHandlers(screen), trace };
}
const both = ["en", "es"] as const;

// ── /recap ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * `/recap`: while Codex works the box says «Generating conversation recap» (Codex's loading line, translated), and when it ends the summary comes with its «Recap:» frame
 * and, when there is one, the next action. The busy label is gone before the result is written.
 */
for (const locale of both) {
  test(`/recap shows the loading line while it works and then the summary with its next action (${locale})`, async () => {
    const nt = getCatalog(locale).codexNative; const tc = getCatalog(locale).codexChat;
    const { handlers, trace } = harness(locale, { recap: async () => { trace.log.push("recap()"); return { status: "ok", summary: "You fixed the login.", nextAction: "Deploy it." } satisfies NativeRecapResult; } });
    await handlers.recap!("");
    expect(trace.log).toEqual([`working:${tc.recapLoadingTitle}`, "recap()", "working-done", `write:${nt.recapLine({ summary: "You fixed the login." })}`]);
    expect(trace.written).toEqual([`${nt.recapLine({ summary: "You fixed the login." })}\n${nt.recapNextLine({ action: "Deploy it." })}`]);
  });

  test(`/recap without a next action writes only the summary, and every failure has its own message (${locale})`, async () => {
    const nt = getCatalog(locale).codexNative;
    const cases: [NativeRecapResult, string][] = [
      [{ status: "ok", summary: "Nothing else." }, nt.recapLine({ summary: "Nothing else." })],
      [{ status: "empty" }, nt.recapEmpty], [{ status: "busy" }, nt.recapBusy], [{ status: "failed" }, nt.recapFailed],
    ];
    for (const [result, expected] of cases) {
      const { handlers, trace } = harness(locale, { recap: async () => result });
      await handlers.recap!("");
      expect(trace.written, result.status).toEqual([expected]);
      expect(trace.log.at(-2), "the busy label ends before the message").toBe("working-done");
    }
  });
}

/** Codex's four messages, word for word in English and translated (not copied) in Spanish. */
test("the recap messages are Codex's in English and translated into Spanish", () => {
  const en = getCatalog("en"); const es = getCatalog("es");
  expect(en.codexNative.recapEmpty).toBe("There is no conversation history to recap.");
  expect(en.codexNative.recapBusy).toBe("A recap is already being generated.");
  expect(en.codexNative.recapFailed).toBe("Could not generate a recap. Please try again.");
  expect(en.codexChat.recapLoadingTitle).toBe("Generating conversation recap");
  expect(en.codexNative.recapLine({ summary: "S" })).toBe("↳ Recap: S");
  expect(en.codexNative.recapNextLine({ action: "A" })).toBe("Next: A");
  expect(es.codexNative.recapEmpty).toBe("No hay historial de la conversación para resumir.");
  expect(es.codexNative.recapBusy).toBe("Ya se está generando un resumen.");
  expect(es.codexNative.recapFailed).toBe("No se pudo generar el resumen. Inténtalo de nuevo.");
  expect(es.codexChat.recapLoadingTitle).toBe("Generando el resumen de la conversación");
  expect(es.codexNative.recapLine({ summary: "S" })).toBe("↳ Resumen: S");
  expect(es.codexNative.recapNextLine({ action: "A" })).toBe("Siguiente: A");
});

/** A session without a recap request (another assistant) gets the honest «not from Shell yet» answer, not a crash. */
test("/recap, /side and /subagents on a session that lacks them answer honestly", async () => {
  for (const locale of both) {
    for (const name of ["recap", "side", "btw", "subagents"]) {
      const { handlers, trace } = harness(locale, {});
      await handlers[name]!("");
      expect(trace.written, name).toEqual([getCatalog(locale).codexChat.commandNotAllowed({ name: `/${name}` })]);
    }
  }
});

// ── /side and /btw ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * `/side question` (and `/btw`, which Codex's list gives the same description and behavior) opens the side conversation and sends the question straight away; `/side` alone
 * only opens it. The question goes only after the conversation is open, so it is written in the side view.
 */
for (const name of ["side", "btw"] as const) {
  test(`/${name} opens the side conversation and, with a question, sends it after opening`, async () => {
    const open = (): { handlers: ReturnType<typeof harness>["handlers"]; trace: Trace } => {
      const made = harness("en", { startSide: async () => { made.trace.log.push("startSide"); return { status: "started" } satisfies NativeSideStart; } });
      return made;
    };
    const withQuestion = open();
    await withQuestion.handlers[name]!("  what does this do?  ");
    expect(withQuestion.trace.log).toEqual(["startSide", "submit:what does this do?"]);
    expect(withQuestion.trace.written).toEqual([]);

    const bare = open();
    await bare.handlers[name]!("");
    expect(bare.trace.log).toEqual(["startSide"]);
    expect(bare.trace.composer).toEqual([]);
  });
}

/**
 * When the side conversation cannot open, Codex says why and gives the question back (`restore_side_user_message`): it returns to the box untouched, without the `/side`, and
 * nothing is sent. Each reason has Codex's words (`SIDE_NO_STARTED_CONVERSATION_MESSAGE`, `SIDE_ALREADY_OPEN_MESSAGE`, the review and failure messages).
 */
for (const locale of both) {
  test(`/side that cannot open says why and puts the question back in the box (${locale})`, async () => {
    const nt = getCatalog(locale).codexNative;
    const cases: [NativeSideStart, string][] = [
      [{ status: "no-conversation" }, nt.sideNoConversation], [{ status: "already-open" }, nt.sideAlreadyOpen], [{ status: "reviewing" }, nt.sideReviewing({ name: "/btw" })],
      [{ status: "failed", stage: "start", error: "transport disconnected" }, nt.sideStartFailed({ error: "transport disconnected" })],
      [{ status: "failed", stage: "prepare", error: "inject refused" }, nt.sidePrepareFailed({ error: "inject refused" })],
    ];
    for (const [result, expected] of cases) {
      const { handlers, trace } = harness(locale, { startSide: async () => result });
      await handlers.btw!("why is the build slow?");
      expect(trace.written, result.status).toEqual([expected]);
      expect(trace.composer, result.status).toEqual(["why is the build slow?"]);
      expect(trace.submitted, result.status).toEqual([]);
    }
  });
}

/** Codex's side messages, word for word in English (with the command as typed where Codex puts it) and translated into Spanish. */
test("the side messages are Codex's in English and translated into Spanish", () => {
  const en = getCatalog("en").codexNative; const es = getCatalog("es").codexNative;
  expect(en.sideNoConversation).toBe("'/side' is unavailable until the current conversation has started. Send a message first, then try /side again.");
  expect(en.sideAlreadyOpen).toBe("A side conversation is already open. Press ctrl + c to return before starting another.");
  expect(en.sideReviewing({ name: "/btw" })).toBe("'/btw' is unavailable while code review is running.");
  expect(en.sideStartFailed({ error: "E" })).toBe("Failed to start side conversation: E");
  expect(en.sideUnavailableCommand({ name: "/model" })).toBe("'/model' is unavailable in side conversations. Press Ctrl+C to return to the main thread first.");
  expect(es.sideNoConversation).toBe("'/side' no está disponible hasta que empiece la conversación actual. Envía un mensaje primero y vuelve a probar /side.");
  expect(es.sideAlreadyOpen).toBe("Ya hay una conversación lateral abierta. Pulsa Ctrl+C para volver antes de abrir otra.");
  expect(es.sideReviewing({ name: "/btw" })).toBe("'/btw' no está disponible mientras se ejecuta una revisión de código.");
  expect(es.sideStartFailed({ error: "E" })).toBe("No se pudo iniciar la conversación lateral: E");
  expect(es.sideUnavailableCommand({ name: "/model" })).toBe("'/model' no está disponible en las conversaciones laterales. Pulsa Ctrl+C para volver primero al hilo principal.");
});

// ── /subagents ─────────────────────────────────────────────────────────────────────────────────────────────────────

const main: NativeSubagent = { id: "t", name: "", main: true, state: "idle", current: true };
const reviewer: NativeSubagent = { id: "c1", name: "/root/reviewer", preview: "Review the login tests", main: false, state: "running", current: false };
const helper: NativeSubagent = { id: "p1", name: "", preview: "An older helper", main: false, state: "closed", current: false };
const nameless: NativeSubagent = { id: "n1", name: "", main: false, state: "idle", current: false };
const list = (agents: NativeSubagent[], enabled = true): NativeSubagentList => ({ enabled, agents });

/**
 * The picker Codex shows (`agent_picker_selection_view_params`): «Subagents», the main conversation first as «Main [default]», then each subagent by its name — or its first
 * message when it has none, or «Agent» — with its state and id, and the one on screen marked. The subtitle keeps Codex's «Select an agent to watch.» (Shell has no Alt+arrow
 * switching, so it does not promise it).
 */
for (const locale of both) {
  test(`/subagents lists the main conversation and each subagent with its state, and marks the one on screen (${locale})`, async () => {
    const nt = getCatalog(locale).codexNative;
    const { handlers, trace } = harness(locale, { subagents: async () => list([main, reviewer, helper, nameless]) }, [undefined]);
    await handlers.subagents!("");
    const asked = trace.asked[0]!;
    expect(asked.title).toBe(nt.subagentsTitle);
    expect(asked.options).toEqual({ searchable: true, body: nt.subagentsSubtitle });
    expect(asked.current).toBe("t");
    expect(asked.items.map(item => [item.value, item.display, item.label])).toEqual([
      ["t", `• ${nt.subagentMain}`, `${nt.subagentIdle} · t`],
      ["c1", "• /root/reviewer", `${nt.subagentRunning} · c1`],
      ["p1", "• An older helper", `${nt.subagentClosed} · p1`],
      ["n1", `• ${nt.subagentAgent}`, `${nt.subagentIdle} · n1`],
    ]);
    expect(asked.items[1]!.search).toContain("Review the login tests");
    expect(trace.written).toEqual([]);
  });
}

/** Choosing a subagent opens it (`SelectAgentThread`); choosing the one already on screen, Esc, or a list that changed underneath do nothing; a failure is said, not thrown. */
test("choosing a subagent watches it, choosing the current one or pressing Esc does nothing, and a failure is told", async () => {
  const watched: string[] = [];
  const session = { subagents: async () => list([main, reviewer]), watchSubagent: async (id: string) => { watched.push(id); } };
  await harness("en", session, ["c1"]).handlers.subagents!("");
  await harness("en", session, ["t"]).handlers.subagents!("");
  await harness("en", session, [undefined]).handlers.subagents!("");
  await harness("en", session, ["gone"]).handlers.subagents!("");
  expect(watched).toEqual(["c1"]);
  const failing = harness("en", { ...session, watchSubagent: async () => { throw new Error("thread not loaded: c1"); } }, ["c1"]);
  await failing.handlers.subagents!("");
  expect(failing.trace.written).toEqual([getCatalog("en").codexNative.subagentOpenFailed({ error: "thread not loaded: c1" })]);
});

/** From a watched subagent the picker's first row, the main conversation, returns to it (`leaveDetour`); it is not opened as an agent. */
test("choosing Main from a watched subagent goes back to the main conversation", async () => {
  const calls: string[] = [];
  const onScreen: NativeSubagent[] = [{ ...main, current: false }, { ...reviewer, current: true }];
  const session = { subagents: async () => list(onScreen), detour: () => ({ kind: "agent", readOnly: true } satisfies NativeDetour), leaveDetour: async () => { calls.push("leave"); }, watchSubagent: async () => { calls.push("watch"); } };
  await harness("en", session, ["t"]).handlers.subagents!("");
  expect(calls).toEqual(["leave"]);
});

/** Without subagents Codex says «No agents available yet.» (`open_agent_picker`) and opens no picker. */
for (const locale of both) {
  test(`/subagents without subagents says there are none (${locale})`, async () => {
    const { handlers, trace } = harness(locale, { subagents: async () => list([main]) });
    await handlers.subagents!("");
    expect(trace.written).toEqual([getCatalog(locale).codexNative.subagentsNone]);
    expect(trace.asked).toEqual([]);
    const fresh = harness(locale, { subagents: async () => list([]) });
    await fresh.handlers.subagents!("");
    expect(fresh.trace.written).toEqual([getCatalog(locale).codexNative.subagentsNone]);
  });
}

/**
 * With the subagents feature off and no subagents, Codex asks «Enable subagents?» (`open_feature_enable_prompt`) with «Yes, enable» first and its own description, and «Not now».
 * Saving writes into the person's Codex configuration, so the question itself says so — in its body, which goes away with it, never in the chat.
 */
for (const locale of both) {
  test(`/subagents with the feature off asks first, with Yes marked and the write to ~/.codex said in the question (${locale})`, async () => {
    const nt = getCatalog(locale).codexNative;
    const { handlers, trace } = harness(locale, { subagents: async () => list([main], false), enableSubagents: async () => ({ status: "ok" }) }, [undefined]);
    await handlers.subagents!("");
    expect(trace.written).toEqual([]);
    const question = trace.asked[0]!;
    expect(question.title).toBe(nt.subagentsEnableTitle);
    expect(question.items.map(item => [item.value, item.display, item.label])).toEqual([
      ["yes", nt.enableYes, nt.subagentsEnableYesDescription], ["no", nt.enableNo, nt.subagentsEnableNoDescription],
    ]);
    expect(question.options?.body).toBe(`${nt.subagentsEnableSubtitle}\n${nt.subagentsEnableWrites}`);
    expect(question.options?.body).toContain("~/.codex");
  });
}

/** Only «Yes, enable» writes; «Not now» and Esc leave the configuration alone. What Codex answers is told in its words (saved, overridden by a higher layer, or failed). */
test("the enable question writes only on Yes and tells how it went", async () => {
  const en = getCatalog("en").codexNative;
  let writes = 0;
  const make = (answer: string | undefined, write: () => Promise<{ status: "ok" | "okOverridden"; message?: string }>) =>
    harness("en", { subagents: async () => list([main], false), enableSubagents: async () => { writes++; return write(); } }, [answer]);
  for (const answer of ["no", undefined]) await make(answer, async () => ({ status: "ok" })).handlers.subagents!("");
  expect(writes).toBe(0);
  const saved = make("yes", async () => ({ status: "ok" })); await saved.handlers.subagents!("");
  expect(saved.trace.written).toEqual([en.subagentsEnabled]);
  const overridden = make("yes", async () => ({ status: "okOverridden", message: "Managed by your organization" })); await overridden.handlers.subagents!("");
  expect(overridden.trace.written).toEqual([en.subagentsEnableOverridden({ message: "Managed by your organization" })]);
  const withoutMessage = make("yes", async () => ({ status: "okOverridden" })); await withoutMessage.handlers.subagents!("");
  expect(withoutMessage.trace.written).toEqual([en.subagentsEnableOverridden({ message: en.overriddenFallback })]);
  const failed = make("yes", async () => { throw new Error("config/batchWrite failed"); }); await failed.handlers.subagents!("");
  expect(failed.trace.written).toEqual([en.subagentsEnableFailed({ error: "config/batchWrite failed" })]);
  expect(writes).toBe(4);
});

/** The subagent texts: Codex's words in English, translated (not copied) into Spanish. */
test("the subagent texts are Codex's in English and translated into Spanish", () => {
  const en = getCatalog("en").codexNative; const es = getCatalog("es").codexNative;
  expect([en.subagentsTitle, en.subagentsSubtitle, en.subagentMain, en.subagentAgent, en.subagentsNone]).toEqual(["Subagents", "Select an agent to watch.", "Main [default]", "Agent", "No agents available yet."]);
  expect([en.subagentsEnableTitle, en.subagentsEnableSubtitle, en.enableYes, en.subagentsEnableYesDescription, en.enableNo, en.subagentsEnableNoDescription]).toEqual([
    "Enable subagents?", "Subagents are disabled in this session.", "Yes, enable", "Save on the server for new threads without changing this thread", "Not now", "Keep subagents disabled",
  ]);
  expect(en.subagentsEnabled).toBe("Subagents setting saved on the server for new threads. This thread is unchanged. Project or task settings may override it.");
  expect(en.subagentsEnableOverridden({ message: "M" })).toBe("Subagents setting was saved but is overridden: M");
  expect(en.subagentsEnableFailed({ error: "E" })).toBe("Failed to save Subagents setting: E");
  expect([es.subagentsTitle, es.subagentsSubtitle, es.subagentMain, es.subagentAgent, es.subagentsNone]).toEqual(["Subagentes", "Elige un agente para mirarlo.", "Principal [predeterminado]", "Agente", "Todavía no hay agentes disponibles."]);
  expect([es.subagentsEnableTitle, es.subagentsEnableSubtitle, es.enableYes, es.subagentsEnableNoDescription]).toEqual(["¿Activar los subagentes?", "Los subagentes están desactivados en esta sesión.", "Sí, activar", "Dejar los subagentes desactivados"]);
  expect(es.subagentsEnabled).toBe("El ajuste de subagentes se guardó en el servidor para las conversaciones nuevas. Esta conversación no cambia. Los ajustes del proyecto o de la tarea pueden reemplazarlo.");
  expect(en.subagentsEnableWrites).toContain("~/.codex/config.toml");
  expect(es.subagentsEnableWrites).toContain("~/.codex/config.toml");
});

// ── /agents ────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * With the embedded server (the case of Shell) Codex's `/agents` shows «Shared agents unavailable» — «This session isn’t connected to a shared background server.»
 * (`open_agents_overview`). Shell does not start that server, so it says so and offers nothing to start. Came out of the third real-account test: Codex's note that
 * starting one «will not interrupt or move this session» is left out, because Shell does not offer to start it and the line only confused. The exact text is written out.
 */
for (const locale of both) {
  test(`/agents says the shared agents are unavailable and starts nothing (${locale})`, async () => {
    const nt = getCatalog(locale).codexNative;
    const { handlers, trace } = harness(locale, {});
    await handlers.agents!("");
    expect(trace.written).toEqual([[nt.agentsUnavailableTitle, nt.agentsUnavailableSubtitle, nt.agentsNoServer].join("\n")]);
    expect(trace.written[0]).toBe(locale === "en"
      ? "Shared agents unavailable\nThis session isn’t connected to a shared background server.\nShell does not start that server."
      : "Agentes compartidos no disponibles\nEsta sesión no está conectada a un servidor compartido en segundo plano.\nShell no inicia ese servidor.");
    expect(trace.written[0]).not.toMatch(/interrump|interrupt/);
    expect(trace.asked).toEqual([]);
  });
}
/** Codex's title and subtitle of «Shared agents unavailable» (`open_agents_overview`), word for word in English and translated into Spanish; Shell's own last line exists in both, and the «starting a server» note no longer does. */
test("the /agents texts are Codex's in English and translated into Spanish", () => {
  const en = getCatalog("en").codexNative; const es = getCatalog("es").codexNative;
  expect([en.agentsUnavailableTitle, en.agentsUnavailableSubtitle]).toEqual([
    "Shared agents unavailable", "This session isn’t connected to a shared background server.",
  ]);
  expect([es.agentsUnavailableTitle, es.agentsUnavailableSubtitle]).toEqual([
    "Agentes compartidos no disponibles", "Esta sesión no está conectada a un servidor compartido en segundo plano.",
  ]);
  expect("agentsUnavailableNote" in en).toBe(false);
  expect("agentsUnavailableNote" in es).toBe(false);
  expect(en.agentsNoServer.length).toBeGreaterThan(10);
  expect(es.agentsNoServer).not.toBe(en.agentsNoServer);
});
