import type { NativeFeedbackCategory, NativeImportItem, NativeImportSource, NativePlugin, NativePluginDetail } from "../../engines/types.ts";
import { describeError } from "../../shell-error.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Catalog } from "../../i18n/index.ts";
import type { ComposerChoice } from "./composer.ts";
import type { CodexCommandHandler, CodexCommandScreen } from "./codex-commands.ts";

/**
 * Codex's commands that reach outside Shell: `/feedback` sends data to OpenAI, `/import` writes into `~/.codex` and can copy MCP keys and chats,
 * and `/plugins` installs code from third parties. Each one shows Codex's own selectors and words and then, before anything leaves or is written,
 * asks a question with «No» marked (`CodexCommandScreen.confirm`): Enter alone, Esc or «No» call nothing, and only «Yes» calls the assistant.
 */
export function outsideCommandHandlers(screen: CodexCommandScreen): Record<string, CodexCommandHandler> {
  return {
    feedback: () => feedback(screen),
    import: () => importSetup(screen),
    plugins: () => plugins(screen),
  };
}

/** The honest «not from Shell yet» answer, for a session that has no such method (another assistant). */
const notAllowed = (screen: CodexCommandScreen, name: string) => screen.write(getCatalog(screen.locale).codexChat.commandNotAllowed({ name: `/${name}` }));

const FEEDBACK_CATEGORIES: NativeFeedbackCategory[] = ["bug", "bad_result", "good_result", "safety_check", "other"];

/** Codex's five feedback categories in the person's language: their name, and the description Codex gives each one (`feedback_selection_params`). */
function feedbackCategory(nt: Catalog["codexNative"], category: NativeFeedbackCategory): { name: string; description: string } {
  switch (category) {
    case "bug": return { name: nt.feedbackBug, description: nt.feedbackBugDescription };
    case "bad_result": return { name: nt.feedbackBadResult, description: nt.feedbackBadResultDescription };
    case "good_result": return { name: nt.feedbackGoodResult, description: nt.feedbackGoodResultDescription };
    case "safety_check": return { name: nt.feedbackSafetyCheck, description: nt.feedbackSafetyCheckDescription };
    case "other": return { name: nt.feedbackOther, description: nt.feedbackOtherDescription };
  }
}

/**
 * `/feedback`, the way Codex walks it: the category, whether to upload logs and a note; then, because it sends data to OpenAI, one more question —
 * «Send this to OpenAI?», with what goes summed up and «No» marked — before `feedback/upload` is called. Esc anywhere, or «No», sends nothing.
 * The follow-up is Codex's: the address to open an issue (or a thanks for a good result) and the conversation id.
 */
async function feedback(screen: CodexCommandScreen): Promise<void> {
  const { session, write, locale } = screen;
  const nt = getCatalog(locale).codexNative;
  if (!session.uploadFeedback) { notAllowed(screen, "feedback"); return; }
  const picked = await screen.choose(nt.feedbackTitle, FEEDBACK_CATEGORIES.map(category => ({ value: category, display: feedbackCategory(nt, category).name, label: feedbackCategory(nt, category).description })));
  const category = FEEDBACK_CATEGORIES.find(item => item === picked);
  if (!category) return;
  const logs = await screen.choose(nt.feedbackLogsTitle, [
    { value: "yes", display: nt.feedbackLogsYes, label: nt.feedbackLogsYesDescription },
    { value: "no", display: nt.feedbackLogsNo, label: "" },
  ], undefined, { body: nt.feedbackLogsBody });
  if (logs !== "yes" && logs !== "no") return;
  const name = feedbackCategory(nt, category).name;
  const note = await screen.ask(nt.feedbackNoteTitle({ category: name }), category === "safety_check" ? nt.feedbackSafetyPlaceholder : nt.feedbackNotePlaceholder, nt.feedbackDisclosure);
  if (note === undefined) return;
  const includeLogs = logs === "yes";
  const summary = nt.feedbackSummary({
    category: name, note: note || nt.feedbackNoNote, logs: includeLogs ? nt.feedbackLogsIncluded : nt.feedbackLogsExcluded, conversation: session.sessionId ?? nt.feedbackConversationNone,
  });
  if (!await screen.confirm(nt.feedbackConfirmTitle, nt.feedbackConfirmNo, nt.feedbackConfirmYes, summary)) { write(nt.feedbackCancelled); return; }
  try {
    const { threadId } = await session.uploadFeedback({ category, includeLogs, ...(note ? { note } : {}) });
    const prefix = includeLogs ? nt.feedbackUploaded : nt.feedbackRecordedNoLogs;
    write(category === "good_result"
      ? [`${prefix} ${nt.feedbackThanks}`, nt.feedbackThreadId({ id: threadId })].join("\n")
      : [`${prefix} ${nt.feedbackIssue}`, `https://github.com/openai/codex/issues/new?template=3-cli.yml&steps=Uploaded%20thread:%20${threadId}`, nt.feedbackMention({ id: threadId })].join("\n"));
  } catch (error) { write(nt.feedbackFailed({ error: describeError(error, locale) })); }
}

/**
 * The absolute paths in an item's description («Migrate /a/settings.json into /b/config.toml»): the first is where it is copied from and the last where it goes.
 * Words such as «and/or» are not paths. Fewer than two paths mean the description names no route.
 */
function importPaths(description: string): { from: string; to: string } | undefined {
  const paths = description.match(/(?<![\w.])(?:~\/|\/|[A-Za-z]:[\\/])[^\s,;]+/g) ?? [];
  return paths.length >= 2 ? { from: paths[0]!, to: paths[paths.length - 1]! } : undefined;
}

/** Where an import item comes from and goes to, in the person's language, or the project folder it belongs to when its description names no route. */
function importWhere(nt: Catalog["codexNative"], item: NativeImportItem): string {
  const route = importPaths(item.description);
  return route ? nt.importRoute(route) : item.cwd ?? "";
}

/** Up to `limit` names, and «+N more» when there are others. */
function nameList(nt: Catalog["codexNative"], names: string[], limit: number): string {
  const shown = names.slice(0, limit).join(", ");
  return names.length > limit ? `${shown}, ${nt.importMoreNames({ count: names.length - limit })}` : shown;
}

/** One line of the confirmation, naming what is copied and where: «• MCP servers (2: engram, github) — from … to …». */
function importItemLine(nt: Catalog["codexNative"], item: NativeImportItem): string {
  const counted = item.names.length || item.count > 1 ? ` (${item.count}${item.names.length ? `: ${nameList(nt, item.names, 4)}` : ""})` : "";
  const where = importWhere(nt, item);
  return `• ${nt.importItemLabel({ type: item.type })}${counted}${where ? ` — ${where}` : ""}`;
}

/** What the started import says it is doing, one line per type as Codex's `external_agent_config_migration_started_lines`: the number of objects and up to three names. */
function importStartedLines(nt: Catalog["codexNative"], items: NativeImportItem[], remaining: number): string[] {
  const byType = new Map<string, { count: number; names: string[] }>();
  for (const item of items) {
    const entry = byType.get(item.type) ?? { count: 0, names: [] };
    entry.count += item.count; entry.names.push(...item.names);
    byType.set(item.type, entry);
  }
  return [
    nt.importStarted, nt.importAppliesToNew, nt.importImporting,
    ...[...byType].map(([type, entry]) => `• ${nt.importTypeLabel({ type })}: ${entry.count}${entry.names.length ? ` — ${nameList(nt, entry.names, 3)}` : ""}`),
    ...(remaining === 1 ? [nt.importRemainingOne] : remaining > 1 ? [nt.importRemainingMany({ count: remaining })] : []),
  ];
}

/**
 * `/import`: looks for setup in Claude Code and Cursor (Codex's own flow), lets the person choose the source when both have something, and then the items:
 * every one starts marked and Enter on it marks or unmarks it (Shell has no check boxes; the list reopens on that row, like `/experimental`). «Import selected»
 * comes first, so Enter alone goes to the confirmation. Because copying writes into `~/.codex` — MCP keys and chats can be part of it — the confirmation names exactly
 * what is copied and from where, warns about both in plain words and has «No» marked; only «Yes» calls `externalAgentConfig/import`.
 */
async function importSetup(screen: CodexCommandScreen): Promise<void> {
  const { session, write, locale } = screen;
  const nt = getCatalog(locale).codexNative;
  if (!session.detectExternalSetup || !session.importExternalSetup) { notAllowed(screen, "import"); return; }
  const detection = await session.detectExternalSetup();
  if (!detection.sources.length) { write(detection.errors.length ? nt.importDetectFailed({ errors: detection.errors.join("; ") }) : nt.importNone); return; }
  let source: NativeImportSource | undefined = detection.sources[0];
  if (detection.sources.length > 1) {
    const chosen = await screen.choose(nt.importSourceTitle, detection.sources.map(item => ({ value: item.id, display: item.label, label: "" })));
    source = detection.sources.find(item => item.id === chosen);
  }
  if (!source) return;
  const marked = source.items.map(() => true);
  let startAt: string | undefined;
  for (;;) {
    const chosenItems = source.items.filter((_, index) => marked[index]);
    const rows: ComposerChoice[] = [
      { value: "proceed", display: nt.importProceed({ count: chosenItems.length }), label: "", action: true },
      ...source.items.map((item, index) => ({ value: `item:${index}`, display: `[${marked[index] ? "x" : " "}] ${nt.importItemLabel({ type: item.type })}`, label: importWhere(nt, item) })),
      { value: "cancel", display: nt.importCancel, label: "", action: true },
    ];
    const picked = await screen.choose(nt.importTitle({ source: source.label }), rows, undefined, { body: nt.importHelp, ...(startAt ? { startAt } : {}) });
    if (!picked || picked === "cancel") return;
    if (picked.startsWith("item:")) { const index = Number(picked.slice(5)); marked[index] = !marked[index]; startAt = picked; continue; }
    if (!chosenItems.length) { write(nt.importNothingSelected); continue; }
    const body = [nt.importConfirmIntro({ source: source.label }), "", ...chosenItems.map(item => importItemLine(nt, item)), "", nt.importConfirmWarning({ source: source.label })].join("\n");
    if (!await screen.confirm(nt.importConfirmTitle, nt.importConfirmNo, nt.importConfirmYes, body)) { write(nt.importCancelled); return; }
    try { await session.importExternalSetup(source.id, chosenItems); }
    catch (error) { write(nt.importFailed({ error: describeError(error, locale) })); return; }
    write(importStartedLines(nt, chosenItems, source.items.length - chosenItems.length).join("\n"));
    return;
  }
}

/** A plugin's state in the list (`plugin_status_label`). */
function pluginStatus(nt: Catalog["codexNative"], plugin: NativePlugin): string {
  if (plugin.availability === "disabledByAdmin") return nt.pluginStatusDisabled;
  if (!plugin.installed && plugin.installPolicy === "installedByDefault") return nt.pluginStatusAdminAssigned;
  if (plugin.installed) return plugin.enabled ? nt.pluginStatusInstalled : nt.pluginStatusDisabled;
  return plugin.installPolicy === "notAvailable" ? nt.pluginStatusNotInstallable : plugin.installPolicy === "available" ? nt.pluginStatusAvailable : nt.pluginStatusInstalled;
}

/** A plugin's state in its detail (`plugin_detail_status_label`), which says more than the list does. */
function pluginDetailStatus(nt: Catalog["codexNative"], plugin: NativePlugin): string {
  if (plugin.availability === "disabledByAdmin") return nt.pluginDetailDisabledByAdmin;
  if (plugin.installPolicy === "installedByDefault") return plugin.installed ? nt.pluginDetailInstalledByAdmin : nt.pluginDetailEnabledByAdmin;
  if (plugin.installed) return plugin.enabled ? nt.pluginStatusInstalled : nt.pluginStatusDisabled;
  return plugin.installPolicy === "notAvailable" ? nt.pluginStatusNotInstallable : nt.pluginDetailCanInstall;
}

/** Where a plugin comes from (`plugin_source_summary`), in the person's language. */
function pluginSourceText(nt: Catalog["codexNative"], source: NativePluginDetail["source"]): string {
  switch (source.kind) {
    case "local": return nt.pluginSourceLocal;
    case "git": return `Git · ${source.url}${source.ref ? `@${source.ref}` : ""}`;
    case "npm": return `npm · ${source.package}${source.version ? `@${source.version}` : ""}`;
    case "remote": return nt.pluginSourceRemote({ marketplace: source.marketplace });
  }
}

/** The detail of a plugin as text: its header, description, data-sharing note and what it holds (`plugin_detail_popup_params`). */
function pluginDetailText(nt: Catalog["codexNative"], plugin: NativePlugin, detail: NativePluginDetail): string {
  const line = (label: string, value: string) => `${label}: ${value}`;
  return [
    [plugin.displayName, pluginDetailStatus(nt, plugin), pluginSourceText(nt, detail.source)].join(" · "),
    ...(detail.description ? [detail.description] : []),
    nt.pluginTerms,
    line(nt.pluginLineAuth, detail.authPolicy === "onUse" ? nt.pluginAuthOnUse : nt.pluginAuthOnInstall),
    ...(detail.version ? [line(nt.pluginLineVersion, detail.version)] : []),
    line(nt.pluginLineSkills, detail.skills.join(", ") || nt.pluginNoSkills),
    line(nt.pluginLineHooks, detail.hooks || nt.pluginNoHooks),
    line(nt.pluginLineApps, detail.apps.join(", ") || nt.pluginNoApps),
    line(nt.pluginLineMcp, detail.mcpServers.join(", ") || nt.pluginNoMcp),
  ].join("\n");
}

/**
 * The action a plugin's detail offers next to «Back to plugins» (`plugin_detail_popup_params`): «Install plugin» or «Uninstall plugin» when they can run, or the
 * same row with the reason it cannot (`blocked`), in Codex's words.
 */
function pluginAction(nt: Catalog["codexNative"], plugin: NativePlugin): { value: "install" | "uninstall" | "blocked"; display: string; label: string } {
  if (plugin.installed) {
    if (plugin.installPolicy === "installedByDefault") return { value: "blocked", display: nt.pluginInstalledByAdmin, label: nt.pluginInstalledByAdminDescription };
    return plugin.canUninstall ? { value: "uninstall", display: nt.pluginUninstall, label: nt.pluginUninstallDescription }
      : { value: "blocked", display: nt.pluginUninstall, label: nt.pluginNoUninstallId };
  }
  if (plugin.availability === "disabledByAdmin") return { value: "blocked", display: nt.pluginInstall, label: nt.pluginDisabledByAdminDescription };
  if (plugin.installPolicy === "notAvailable") return { value: "blocked", display: nt.pluginInstall, label: nt.pluginNotInstallable };
  if (!plugin.canInstall) return { value: "blocked", display: nt.pluginInstall, label: nt.pluginNoLocation };
  return { value: "install", display: nt.pluginInstall, label: nt.pluginInstallDescription };
}

/**
 * `/plugins`: Codex's plugin list (installed first, with search) and detail. Installing runs code from a third party and uninstalling removes it, so each asks
 * «Install X?» / «Uninstall X?» with «No» marked: Enter alone, Esc or «No» call nothing, and only «Yes» calls `plugin/install` or `plugin/uninstall`. Codex's marketplace
 * management (add, remove, upgrade) is not connected: its row answers honestly and calls nothing. Like Codex, a disabled plugins feature is said instead of listing.
 */
async function plugins(screen: CodexCommandScreen): Promise<void> {
  const { session, write, locale } = screen;
  const nt = getCatalog(locale).codexNative;
  const message = (error: unknown) => describeError(error, locale);
  if (!session.plugins || !session.pluginDetail || !session.installPlugin || !session.uninstallPlugin) { notAllowed(screen, "plugins"); return; }
  const features = await session.experimentalFeatures?.().catch(() => []) ?? [];
  if (features.some(feature => feature.name === "plugins" && !feature.enabled)) { write([nt.pluginsDisabled, nt.pluginsDisabledHint].join("\n")); return; }
  for (;;) {
    let list: NativePlugin[];
    try { list = await session.plugins(); } catch (error) { write(nt.pluginsLoadFailed({ error: message(error) })); return; }
    if (!list.length) { write(nt.pluginsNone); return; }
    write([nt.pluginsSubtitle, nt.pluginsInstalledCount({ installed: list.filter(plugin => plugin.installed).length, total: list.length })].join("\n"));
    const picked = await screen.choose(nt.pluginsTitle, [
      ...list.map(plugin => ({
        value: plugin.key, display: plugin.displayName, search: `${plugin.displayName} ${plugin.name} ${plugin.marketplace}`,
        label: [pluginStatus(nt, plugin), plugin.marketplace, ...(plugin.description ? [plugin.description] : [])].join(" · "),
      })),
      { value: "@marketplaces", display: nt.pluginMarketplaces, label: nt.pluginMarketplacesDescription, search: nt.pluginMarketplaces, action: true },
    ], undefined, { searchable: true, body: nt.pluginsBody });
    if (!picked) return;
    if (picked === "@marketplaces") { write(nt.pluginMarketplacesNotConnected); return; }
    const plugin = list.find(item => item.key === picked);
    if (!plugin) return;
    let detail: NativePluginDetail;
    try { detail = await session.pluginDetail(plugin.key); } catch (error) { write(nt.pluginDetailFailed({ error: message(error) })); return; }
    write(pluginDetailText(nt, plugin, detail));
    const action = pluginAction(nt, plugin);
    const chosen = await screen.choose(nt.pluginsTitle, [
      { value: "back", display: nt.pluginBack, label: nt.pluginBackDescription },
      { value: action.value, display: action.display, label: action.label },
    ]);
    if (chosen === "back") continue;
    if (chosen === "blocked") { write(action.label); return; }
    const source = detail.source.kind === "local" ? "" : `\n${pluginSourceText(nt, detail.source)}`;
    if (chosen === "install") {
      if (!await screen.confirm(nt.pluginInstallTitle({ name: plugin.displayName }), nt.pluginInstallNo, nt.pluginInstallYes, `${nt.pluginInstallBody}${source}`)) { write(nt.pluginInstallCancelled); return; }
      try {
        const { appsNeedingAuth } = await session.installPlugin(plugin.key);
        write([nt.pluginInstalled({ name: plugin.displayName }), ...(appsNeedingAuth.length
          ? [nt.pluginInstalledNeedsAuth({ count: appsNeedingAuth.length, apps: appsNeedingAuth.join(", ") }), nt.pluginInstalledAuthHint] : [nt.pluginInstalledNoAuth])].join("\n"));
      } catch (error) { write(nt.pluginInstallFailed({ name: plugin.displayName, error: message(error) })); }
      return;
    }
    if (chosen === "uninstall") {
      if (!await screen.confirm(nt.pluginUninstallTitle({ name: plugin.displayName }), nt.pluginUninstallNo, nt.pluginUninstallYes, nt.pluginUninstallBody)) { write(nt.pluginUninstallCancelled); return; }
      try { await session.uninstallPlugin(plugin.key); write([nt.pluginUninstalled({ name: plugin.displayName }), nt.pluginUninstalledHint].join("\n")); }
      catch (error) { write(nt.pluginUninstallFailed({ name: plugin.displayName, error: message(error) })); }
    }
    return;
  }
}
