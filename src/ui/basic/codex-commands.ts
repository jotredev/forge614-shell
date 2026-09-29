import type { NativeSession, NativeSkill } from "../../engines/types.ts";
import { ShellError } from "../../shell-error.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";
import type { ComposerChoice } from "./composer.ts";
import { formatDuration } from "./duration.ts";

/** What Codex's commands need from the screen; the composition in `native.ts` provides it, so nothing here touches the terminal directly. */
export interface CodexCommandScreen {
  session: NativeSession;
  cwd: string;
  locale: Locale;
  /** Adds a short message to the conversation view. */
  write(text: string): void;
  /** Empties the conversation view: a new conversation starts. */
  clearView(): void;
  /** Asks a Yes/No question with «No» first (so Enter alone keeps things as they are); Esc counts as No. */
  confirm(title: string, no: string, yes: string): Promise<boolean>;
  /** Replaces what the `$` autocomplete offers. */
  setSkillChoices(skills: ComposerChoice[]): void;
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
  const { session, write, locale } = screen;
  const tc = getCatalog(locale).codexCommands;
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
  };
}
