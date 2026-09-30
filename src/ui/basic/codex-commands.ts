import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { NativeReviewTarget, NativeSession, NativeSkill, NativeWorkMode } from "../../engines/types.ts";
import { ShellError, describeError } from "../../shell-error.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";
import type { ComposerChoice } from "./composer.ts";
import { formatDuration } from "./duration.ts";
import { CODEX_INIT_PROMPT } from "../../engines/codex/prompts.ts";
import { copyChoices } from "../../engines/codex/transcript.ts";
import type { CopyChoice } from "../../engines/codex/transcript.ts";
import { outsideCommandHandlers } from "./codex-outside-commands.ts";
import { threadCommandHandlers } from "./codex-thread-commands.ts";

/**
 * What some Codex commands do on the person's own machine, as Codex's terminal app does it locally too: read-only
 * git in the session folder (`/diff`, the `/review` pickers), the clipboard (`/copy`, `/export`), a new file that
 * never overwrites (`/export`) and the browser (`/apps`). The composition provides the real ones; tests pass stand-ins.
 */
export interface CodexLocalTools {
  gitDiff(cwd: string): Promise<{ inRepo: boolean; diff: string }>;
  gitBranches(cwd: string): Promise<string[]>;
  gitCurrentBranch(cwd: string): Promise<string | undefined>;
  gitCommits(cwd: string, limit: number): Promise<{ sha: string; subject: string }[]>;
  /** Rejects when nothing could be copied. */
  copyText(text: string): Promise<void>;
  /** Rejects, without touching it, when the file already exists. */
  saveNewFile(path: string, text: string): Promise<void>;
  /** False when the browser could not be opened. */
  openLink(url: string): Promise<boolean>;
}

/** What Codex's commands need from the screen; the composition in `native.ts` provides it, so nothing here touches the terminal directly. */
export interface CodexCommandScreen {
  session: NativeSession;
  cwd: string;
  locale: Locale;
  local: CodexLocalTools;
  /** Adds a short message to the conversation view. */
  write(text: string): void;
  /** Empties the conversation view: a new conversation starts. */
  clearView(): void;
  /**
   * Asks a Yes/No question with «No» first (so Enter alone keeps things as they are); Esc counts as No. `body` is what the question is about
   * (what would be sent, copied or installed): it lives inside the question and goes away with it.
   */
  confirm(title: string, no: string, yes: string, body?: string): Promise<boolean>;
  /** Asks for a line of free text under `title`: what was written (empty when nothing was), or undefined on Esc. `body` is an explanation that goes away with the question. */
  ask(title: string, placeholder: string, body?: string): Promise<string | undefined>;
  /** Opens a selector (see `ForgeComposer.choose`): the chosen row's value, or undefined on Esc. `body` is an explanation that lives inside the question and goes away with it. */
  choose(title: string, items: ComposerChoice[], current?: string, options?: { searchable?: boolean; body?: string }): Promise<string | undefined>;
  /** Replaces what the `$` autocomplete offers. */
  setSkillChoices(skills: ComposerChoice[]): void;
  /** Sends `text` as a normal message of the person, exactly as if it had been typed. */
  submit(text: string): void;
  /** Puts `text` in the message box for the person to go on typing. */
  setComposerText(text: string): void;
  /** Saves the work mode or the collaboration mode so the next opening restores it. */
  rememberWorkMode(id: string): void;
  rememberCollaborationMode(id: string): void;
  /** Redraws the status and mode indicators after a change. */
  refresh(): void;
  /** Shows `title` (and `detail`, when given) in the box's busy line with the time, as `/compact` does, until the returned function is called. */
  working(title: string, detail?: string): () => void;
}

/** Runs one Codex command; `argument` is what was typed after the name. */
export type CodexCommandHandler = (argument: string) => Promise<void>;

/** The `$` autocomplete rows for a skill list: the value typed is `$name`, the label is the skill's own description. */
export function skillChoices(skills: NativeSkill[]): ComposerChoice[] {
  return skills.map(skill => ({ value: `$${skill.name}`, label: skill.description }));
}

/**
 * The Codex commands Shell has connected through the app-server, by their official name (`findCodexCommand`
 * resolves the typed spelling, aliases included). Each one calls the session's method and answers in one short
 * message in the person's language; a session that lacks the method (another assistant) gets the honest
 * «not allowed from Shell yet» answer instead of a crash. A command Codex lists but is not here is answered the
 * same way by the caller.
 */
export function codexCommandHandlers(screen: CodexCommandScreen): Record<string, CodexCommandHandler> {
  const { session, write, locale, local, cwd } = screen;
  const tc = getCatalog(locale).codexCommands;
  const nt = getCatalog(locale).codexNative;
  const t = getCatalog(locale).chat;
  const message = (error: unknown) => describeError(error, locale);
  const notReported = getCatalog(locale).codexSession.notReported;
  const notAllowed = (name: string) => write(getCatalog(locale).codexChat.commandNotAllowed({ name: `/${name}` }));
  /** Runs `body` with the session's method, or answers honestly when the session has no such method. */
  const needs = <T>(name: string, method: T | undefined, body: (method: T) => Promise<void>): Promise<void> =>
    method ? body(method) : Promise.resolve(notAllowed(name));

  return {
    rename: async argument => {
      const name = argument.trim();
      if (!name) { write(tc.renameUsage); return; }
      await needs("rename", session.renameThread?.bind(session), async rename => { await rename(name); write(tc.renamed({ name })); });
    },
    archive: () => needs("archive", session.archiveThread?.bind(session), async archive => {
      await archive(); screen.clearView(); write(tc.archived);
    }),
    delete: () => needs("delete", session.deleteThread?.bind(session), async remove => {
      // With nothing open there is nothing to delete: say so before asking anything.
      if (!session.sessionId) throw new ShellError("codex-command-needs-conversation");
      if (!await screen.confirm(tc.deletePrompt, tc.deleteKeep, tc.deleteConfirm)) { write(tc.deleteKept); return; }
      await remove(); screen.clearView(); write(tc.deleted);
    }),
    clear: () => needs("clear", session.clearThread?.bind(session), async clear => {
      await clear(); screen.clearView(); write(tc.cleared);
    }),
    goal: async argument => {
      const text = argument.trim();
      if (text === "clear") {
        await needs("goal", session.clearGoal?.bind(session), async clear => { write(await clear() ? tc.goalCleared : tc.goalNothingToClear); });
      } else if (!text) {
        await needs("goal", session.getGoal?.bind(session), async get => {
          const goal = await get();
          write(goal ? tc.goalLine({
            objective: goal.objective, status: goal.status, used: String(goal.tokensUsed),
            budget: goal.tokenBudget === undefined ? "" : String(goal.tokenBudget), time: formatDuration(goal.timeUsedSeconds),
          }) : tc.goalNone);
        });
      } else {
        await needs("goal", session.setGoal?.bind(session), async set => { write(tc.goalSet({ objective: (await set(text)).objective })); });
      }
    },
    mcp: argument => needs("mcp", session.mcpServers?.bind(session), async list => {
      const verbose = argument.trim().toLowerCase() === "verbose";
      const servers = await list(verbose);
      if (!servers.length) { write(tc.mcpNone); return; }
      const lines = [tc.mcpHeader];
      for (const server of servers) {
        lines.push(tc.mcpServerLine({ name: server.name, status: server.status, count: String(server.tools.length) }));
        if (verbose) lines.push(tc.mcpDetailLine({ version: server.version ?? notReported, auth: server.auth, origin: server.origin ?? notReported, resources: String(server.resources) }));
        if (server.toolsError) lines.push(tc.mcpToolsError({ error: server.toolsError }));
        if (verbose) for (const tool of server.tools) lines.push(`    - ${tool.name}${tool.description ? `: ${tool.description.split("\n")[0]}` : ""}`);
        else if (server.tools.length) lines.push(`    ${server.tools.map(tool => tool.name).join(", ")}`);
      }
      write(lines.join("\n"));
    }),
    hooks: () => needs("hooks", session.hooks?.bind(session), async list => {
      const hooks = await list();
      if (!hooks.length) { write(tc.hooksNone); return; }
      write([tc.hooksHeader, ...hooks.map(hook => tc.hookLine({
        event: hook.event, handler: hook.handler, detail: hook.detail ?? "—", state: tc.hookState({ enabled: hook.enabled, trust: hook.trust }),
      }))].join("\n"));
    }),
    usage: () => needs("usage", session.accountUsage?.bind(session), async read => {
      const usage = await read();
      const rows: [string, string | undefined][] = [
        [tc.usageLifetimeTokens, usage.lifetimeTokens], [tc.usagePeakDailyTokens, usage.peakDailyTokens], [tc.usageLongestTurn, usage.longestTurnSeconds],
        [tc.usageCurrentStreak, usage.currentStreakDays], [tc.usageLongestStreak, usage.longestStreakDays],
      ];
      const lines = rows.flatMap(([label, value]) => value === undefined ? [] : [tc.usageLine({ label, value })]);
      write(lines.length ? [tc.usageHeader, ...lines, tc.usageResetNote].join("\n") : tc.usageNone);
    }),
    pwd: async () => { write(tc.pwd({ path: screen.cwd })); },
    ps: () => needs("ps", session.backgroundTerminals?.bind(session), async list => {
      const terminals = await list();
      write(terminals.length ? [tc.psHeader, ...terminals.map(item => tc.psLine({ command: item.command, folder: item.cwd, pid: item.pid === undefined ? notReported : String(item.pid) }))].join("\n") : tc.psNone);
    }),
    stop: () => needs("stop", session.stopBackgroundTerminals?.bind(session), async stop => { write(await stop() ? tc.stopped : tc.stopNone); }),
    skills: () => needs("skills", session.skills?.bind(session), async list => {
      const skills = await list();
      screen.setSkillChoices(skillChoices(skills));
      write(skills.length ? [tc.skillsHeader, ...skills.map(skill => tc.skillLine({ name: skill.name, description: skill.description }))].join("\n") : tc.skillsNone);
    }),
    permissions: () => choosePermissions(screen),
    init: async () => { screen.submit(CODEX_INIT_PROMPT); },
    diff: async () => {
      let text: string;
      try {
        const result = await local.gitDiff(cwd);
        // The diff goes in a code block so the chat's Markdown shows it as it is (Codex shows it in its own pager).
        text = !result.inRepo ? nt.diffNotRepo : result.diff.trim() ? `\`\`\`diff\n${result.diff.replace(/\n$/, "")}\n\`\`\`` : nt.diffNoChanges;
      } catch (error) { text = nt.diffFailed({ error: message(error) }); }
      write(text);
    },
    apps: () => needs("apps", session.apps?.bind(session), async list => {
      const apps = await list();
      if (!apps.length) { write(nt.appsNone); return; }
      const status = (app: { installed: boolean; enabled: boolean }) => app.installed ? (app.enabled ? nt.appInstalled : nt.appInstalledDisabled) : nt.appCanInstall;
      write([nt.appsTitle, nt.appsHint, nt.appsInstalledCount({ installed: apps.filter(app => app.installed).length, total: apps.length })].join("\n"));
      const picked = await screen.choose(nt.appsTitle, apps.map(app => ({
        value: app.id, display: app.name, label: app.description ? `${status(app)} · ${app.description}` : status(app), search: `${app.name} ${app.id}`,
      })), undefined, { searchable: true });
      const app = apps.find(item => item.id === picked);
      if (!app) return;
      if (!app.installUrl) { write(nt.appLinkUnavailable({ status: status(app) })); return; }
      write(app.installed ? nt.appManage : nt.appInstall);
      if (!await local.openLink(app.installUrl)) write(tc.appOpenFailed({ url: app.installUrl }));
    }),
    experimental: () => needs("experimental", session.experimentalFeatures?.bind(session), async list => {
      let features;
      try { features = await list(); } catch { write(nt.experimentalUnavailable); return; }
      // Codex's menu lists only the features in beta (`bottom_pane/experimental_features_view.rs`).
      const beta = features.filter(feature => feature.stage === "beta");
      if (!beta.length) { write(nt.experimentalNone); return; }
      write([nt.experimentalTitle, nt.experimentalHelp].join("\n"));
      const picked = await screen.choose(nt.experimentalTitle, beta.map(feature => ({
        value: feature.name, display: `[${feature.enabled ? "x" : " "}] ${feature.displayName ?? feature.name}`, label: feature.description ?? "",
      })));
      const feature = beta.find(item => item.name === picked);
      if (!feature || !session.setExperimentalFeature) return;
      let result;
      try { result = await session.setExperimentalFeature(feature.name, !feature.enabled); } catch { write(nt.experimentalSaveFailed); return; }
      const enabled = result.features.find(item => item.name === feature.name)?.enabled ?? !feature.enabled;
      write(tc.featureState({ name: feature.displayName ?? feature.name, state: enabled ? tc.stateOn : tc.stateOff }));
      if (result.overridden) write(nt.experimentalOverridden);
    }),
    memories: () => needs("memories", session.memorySettings?.bind(session), async read => chooseMemories(screen, await read())),
    review: async argument => {
      if (!session.startReview) { notAllowed("review"); return; }
      // `/review text` goes straight in as custom instructions, as in Codex.
      const target: NativeReviewTarget | undefined = argument.trim() ? { type: "custom", instructions: argument.trim() } : await chooseReviewTarget(screen);
      if (target) await session.startReview(target);
    },
    fork: argument => needs("fork", session.forkThread?.bind(session), async fork => {
      try { await fork(argument.trim() || undefined); }
      catch (error) { if (error instanceof ShellError) throw error; write(nt.forkFailed({ error: message(error) })); return; }
      write(nt.forkCreated);
    }),
    plan: async argument => {
      const modes = session.collaborationModes?.() ?? [];
      if (!modes.length || !session.setCollaborationMode) { write([nt.collaborationDisabled, nt.collaborationDisabledHint].join("\n")); return; }
      if (!modes.some(mode => mode.id === "plan")) { write(nt.planUnavailable); return; }
      if (await session.setCollaborationMode("plan") === "next-turn") write(t.workModeNextTurn({ mode: modes.find(mode => mode.id === "plan")!.label }));
      screen.rememberCollaborationMode("plan");
      screen.refresh();
      // `/plan text` also sends the text, now in Plan.
      if (argument.trim()) screen.submit(argument.trim());
    },
    export: argument => needs("export", session.exportTranscript?.bind(session), async read => {
      const destination = argument.trim() ? "file" : await screen.choose(nt.exportTitle, [
        { value: "copy", display: nt.exportCopy, label: nt.exportCopyDescription },
        { value: "file", display: nt.exportSave, label: nt.exportSaveDescription },
      ]);
      if (!destination) return;
      let markdown: string;
      try { markdown = await read(); } catch (error) { write(nt.exportFailed({ error: message(error) })); return; }
      if (destination === "copy") {
        try { await local.copyText(markdown); write(nt.copied({ label: nt.copyConversation })); } catch (error) { write(nt.copyFailed({ error: message(error) })); }
        return;
      }
      const path = exportPath(cwd, argument.trim() || `codex-session-${session.sessionId}.md`);
      try { await local.saveNewFile(path, markdown); write(nt.exportSaved({ path })); } catch (error) { write(nt.exportFailed({ error: message(error) })); }
    }),
    copy: async () => {
      const choices = copyChoices(session.lastResponse?.() ?? "");
      if (!choices.length) { write(nt.copyNoResponse); return; }
      const name = (choice: CopyChoice) => choice.kind === "whole" ? nt.copyWhole : choice.kind === "quote" ? nt.copyQuote : choice.language ? nt.copyCode({ language: choice.language }) : nt.copyCodeBlock;
      const picked = await screen.choose(nt.copyTitle, choices.map((choice, index) => ({ value: String(index), display: name(choice), label: choice.preview })));
      if (picked === undefined) return;
      const choice = choices[Number(picked)]!;
      try { await local.copyText(choice.text); write(nt.copied({ label: name(choice) })); } catch (error) { write(nt.copyFailed({ error: message(error) })); }
    },
    // Codex's `/mention` only puts «@» in the box; typing after it searches the folder's files.
    mention: async () => { screen.setComposerText("@"); },
    approve: () => needs("approve", session.autoReviewDenials?.bind(session), async list => {
      const denials = list();
      if (!denials.length) { write([nt.approveNone, nt.approveNoneHint].join("\n")); return; }
      const picked = await screen.choose(nt.approveTitle, denials.map(denial => ({ value: denial.id, display: denial.summary, label: denial.rationale ?? nt.approveNoRationale, search: `${denial.summary} ${denial.rationale ?? ""}` })), undefined, { searchable: true, body: nt.approveSelect });
      if (!picked || !session.approveAutoReviewDenial) return;
      if (!await session.approveAutoReviewDenial(picked)) { write(nt.approveGone); return; }
      write([nt.approveRecorded, nt.approveRecordedHint].join("\n"));
    }),
    ...outsideCommandHandlers(screen),
    ...threadCommandHandlers(screen),
  };
}

/** Where `/export` writes: `~/…` in the home folder, an absolute path as is, anything else inside the session folder (`write_transcript` in Codex). */
function exportPath(cwd: string, requested: string): string {
  if (requested === "~" || requested.startsWith("~/")) return join(homedir(), requested.slice(1));
  return isAbsolute(requested) ? requested : join(cwd, requested);
}

/**
 * `/permissions`: Codex's own menu (`chatwidget/permission_popups.rs`) — its title, the modes the adapter lists with
 * their descriptions, the current one marked. A mode that asks first (Full Access) shows Codex's confirmation with
 * «Yes, continue anyway» first, as Codex does, and its warning inside the question (never written into the chat, so it goes
 * away with the question); «Cancel» goes back to the menu. The chosen mode is applied, saved and
 * announced in Codex's words; while a turn runs, Shell also says it applies from the next one.
 */
async function choosePermissions(screen: CodexCommandScreen): Promise<void> {
  const { session, write, locale } = screen;
  const nt = getCatalog(locale).codexNative;
  const modes: NativeWorkMode[] = session.workModes?.() ?? [];
  if (!modes.length || !session.setWorkMode) { write(getCatalog(locale).codexChat.commandNotAllowed({ name: "/permissions" })); return; }
  for (;;) {
    const picked = await screen.choose(nt.permissionsTitle, modes.map(mode => ({ value: mode.id, display: mode.label, label: mode.description ?? "" })), session.workMode?.());
    const mode = modes.find(item => item.id === picked);
    if (!mode) return;
    if (mode.confirm) {
      const answer = await screen.choose(nt.fullAccessTitle, [
        { value: "yes", display: nt.fullAccessAccept, label: nt.fullAccessAcceptDescription },
        { value: "cancel", display: nt.fullAccessCancel, label: nt.fullAccessCancelDescription },
      ], undefined, { body: nt.fullAccessBody });
      if (answer === "cancel") continue;
      if (answer !== "yes") return;
    }
    const change = await session.setWorkMode(mode.id);
    screen.rememberWorkMode(mode.id);
    write(nt.permissionsUpdated({ label: mode.label }));
    if (change === "next-turn") write(getCatalog(locale).chat.workModeNextTurn({ mode: mode.label }));
    screen.refresh();
    return;
  }
}

/**
 * `/memories` with the assistant's settings: when the feature is off, Codex's «Enable memories?» with «Yes, enable»
 * first; otherwise its three rows. Shell has no check boxes, so Enter on a setting switches it and saves both, and
 * «Reset all memories» asks first with «Go back» first — Enter alone or Esc deletes nothing; «Go back» returns to
 * the settings, as in Codex.
 */
async function chooseMemories(screen: CodexCommandScreen, settings: { featureEnabled: boolean; useMemories: boolean; generateMemories: boolean }): Promise<void> {
  const { session, write, locale } = screen;
  const nt = getCatalog(locale).codexNative;
  const tc = getCatalog(locale).codexCommands;
  const message = (error: unknown) => describeError(error, locale);
  if (!settings.featureEnabled) {
    write(nt.enableMemoriesSubtitle);
    const answer = await screen.choose(nt.enableMemoriesTitle, [
      { value: "yes", display: nt.enableYes, label: nt.enableYesDescription },
      { value: "no", display: nt.enableNo, label: nt.enableNoDescription },
    ]);
    if (answer !== "yes" || !session.enableMemories) return;
    try {
      const result = await session.enableMemories();
      write(result.status === "ok" ? nt.memoriesEnabled : nt.memoriesEnableOverridden({ message: result.message ?? nt.overriddenFallback }));
    } catch (error) { write(nt.memoriesEnableFailed({ error: message(error) })); }
    return;
  }
  let { useMemories, generateMemories } = settings;
  write([nt.memoriesTitle, nt.memoriesHelp].join("\n"));
  for (;;) {
    const box = (on: boolean) => `[${on ? "x" : " "}]`;
    const picked = await screen.choose(nt.memoriesTitle, [
      { value: "use", display: `${box(useMemories)} ${nt.useMemories}`, label: nt.useMemoriesDescription },
      { value: "generate", display: `${box(generateMemories)} ${nt.generateMemories}`, label: nt.generateMemoriesDescription },
      { value: "reset", display: nt.resetMemories, label: nt.resetMemoriesDescription },
    ]);
    if (!picked) return;
    if (picked === "reset") {
      write(nt.resetHelp);
      const answer = await screen.choose(nt.resetTitle, [
        { value: "back", display: nt.resetBack, label: nt.resetBackDescription },
        { value: "reset", display: nt.resetMemories, label: nt.resetConfirmDescription },
      ]);
      if (answer === "back") continue;
      if (answer !== "reset" || !session.resetMemories) return;
      try { await session.resetMemories(); write(nt.resetDone); } catch (error) { write(nt.resetFailed({ error: message(error) })); }
      return;
    }
    if (picked === "use") useMemories = !useMemories; else generateMemories = !generateMemories;
    if (!session.saveMemorySettings) return;
    try {
      const result = await session.saveMemorySettings(useMemories, generateMemories);
      write(result.status === "ok"
        ? tc.memoriesSaved({ use: useMemories ? tc.stateOn : tc.stateOff, generate: generateMemories ? tc.stateOn : tc.stateOff })
        : nt.memoriesOverridden({ message: result.message ?? nt.overriddenFallback }));
    } catch (error) { write(nt.memoriesSaveFailed({ error: message(error) })); }
    return;
  }
}

/**
 * `/review` without text: Codex's four presets in its order (`chatwidget/review_popups.rs`). A base branch or a
 * commit comes from a searchable list of the local repository (default branch first; the last 100 commits); Esc
 * there goes back to the presets, as in Codex. «Custom review instructions» puts `/review ` in the box so the
 * person types them and presses Enter.
 */
async function chooseReviewTarget(screen: CodexCommandScreen): Promise<NativeReviewTarget | undefined> {
  const { local, cwd, locale } = screen;
  const nt = getCatalog(locale).codexNative;
  for (;;) {
    const preset = await screen.choose(nt.reviewTitle, [
      { value: "base", display: nt.reviewBaseBranch, label: nt.reviewBaseBranchDescription },
      { value: "uncommitted", display: nt.reviewUncommitted, label: "" },
      { value: "commit", display: nt.reviewCommit, label: "" },
      { value: "custom", display: nt.reviewCustom, label: "" },
    ]);
    if (preset === "uncommitted") return { type: "uncommittedChanges" };
    if (preset === "base") {
      const [branches, current] = await Promise.all([local.gitBranches(cwd), local.gitCurrentBranch(cwd)]);
      const branch = await screen.choose(`${nt.reviewBranchTitle} · ${nt.reviewCurrentBranch({ branch: current ?? nt.reviewDetachedHead })}`,
        branches.map(name => ({ value: name, display: name, label: "" })), undefined, { searchable: true });
      if (branch) return { type: "baseBranch", branch };
      continue;
    }
    if (preset === "commit") {
      const commits = await local.gitCommits(cwd, 100);
      const sha = await screen.choose(nt.reviewCommitTitle, commits.map(commit => ({ value: commit.sha, display: commit.subject, label: "", search: `${commit.subject} ${commit.sha}` })), undefined, { searchable: true });
      const commit = commits.find(item => item.sha === sha);
      if (commit) return { type: "commit", sha: commit.sha, title: commit.subject };
      continue;
    }
    if (preset === "custom") { screen.setComposerText("/review "); screen.write(getCatalog(locale).codexCommands.reviewCustomHint); }
    return undefined;
  }
}
