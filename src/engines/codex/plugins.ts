import type { NativePlugin, NativePluginDetail, NativePluginSource } from "../types.ts";

/** The marketplace Codex's own screen hides in the CLI (`CLI_HIDDEN_PLUGIN_MARKETPLACES`). */
const HIDDEN_MARKETPLACES = ["openai-bundled"];

/** A plugin as `plugin/list` gave it, with the marketplace it came in: what the later `plugin/read`, `plugin/install` and `plugin/uninstall` need. */
export interface PluginEntry {
  plugin: NativePlugin;
  /** `marketplacePath` for a marketplace backed by a file, `remoteMarketplaceName` for a remote one — Codex's `PluginLocation`; none when the plugin does not say where it lives. */
  location?: { marketplacePath: string } | { remoteMarketplaceName: string };
  /** The name `plugin/read` and `plugin/install` take (`plugin_request_name`): the remote id for a remote plugin. */
  requestName: string;
  /** The id `plugin/uninstall` takes (`plugin_uninstall_id`). */
  uninstallId?: string;
}

/** The identity of a plugin on the remote catalog, when it has one (`plugin_remote_identity`). */
const remoteIdentity = (summary: any): string | undefined => summary.shareContext?.remotePluginId ?? summary.remotePluginId ?? undefined;

/** The name a plugin is shown with (`plugin_display_name`): its display name, or its plain name when it has none. */
const displayName = (summary: any): string => String(summary.interface?.displayName ?? "").trim() || String(summary.name);

/** The plugin's short description (`plugin_description`), or its long one; none when both are empty. */
const description = (summary: any): string | undefined => {
  const text = String(summary.interface?.shortDescription ?? summary.interface?.longDescription ?? "").trim();
  return text || undefined;
};

/** The marketplace's name for the person (`marketplace_display_name`, without Codex's built-in labels): its display name, or its own name. */
const marketplaceLabel = (marketplace: any): string => String(marketplace.interface?.displayName ?? "").trim() || String(marketplace.name);

/**
 * Whether `candidate` should replace `existing` when both stand for the same remote plugin (`plugin_entry_preferred`): an installed one wins, then
 * one an admin installs by default, then a local copy of a shared plugin, then any non-remote source over a remote one.
 */
function preferred(candidate: PluginEntry & { raw: any }, existing: PluginEntry & { raw: any }): boolean {
  if (candidate.plugin.installed !== existing.plugin.installed) return candidate.plugin.installed;
  const byAdmin = (entry: PluginEntry) => entry.plugin.installPolicy === "installedByDefault";
  if (byAdmin(candidate) !== byAdmin(existing)) return byAdmin(candidate);
  const localShare = (entry: { raw: any }) => Boolean(entry.raw.shareContext) && entry.raw.source?.type !== "remote";
  if (localShare(candidate) !== localShare(existing)) return localShare(candidate);
  return candidate.raw.source?.type !== "remote" && existing.raw.source?.type === "remote";
}

/**
 * The plugins of a `plugin/list` answer (`v2/PluginListResponse.ts`) the way Codex's screen orders them: the CLI-hidden marketplace left out, the
 * same remote plugin listed once, installed plugins first and then by name (case-insensitive). Each keeps where it lives so it can be read and installed
 * from the same marketplace. Marketplace names are the display name Codex gives them, or their own name.
 */
export function pluginEntries(response: any): PluginEntry[] {
  const listed: (PluginEntry & { raw: any })[] = [];
  const byRemote = new Map<string, number>();
  for (const marketplace of response?.marketplaces ?? []) {
    if (HIDDEN_MARKETPLACES.includes(marketplace.name)) continue;
    for (const summary of marketplace.plugins ?? []) {
      const remote = remoteIdentity(summary);
      const location = typeof marketplace.path === "string" && marketplace.path ? { marketplacePath: marketplace.path }
        : remote ? { remoteMarketplaceName: String(marketplace.name) } : undefined;
      const requestName = summary.source?.type === "remote" && remote ? remote : String(summary.name);
      const uninstallId = summary.source?.type === "remote" ? remote : String(summary.id);
      const text = description(summary);
      const entry = {
        raw: summary, location, requestName, ...(uninstallId ? { uninstallId } : {}),
        plugin: {
          key: `${marketplace.name}::${summary.id}`, name: String(summary.name), displayName: displayName(summary), ...(text ? { description: text } : {}),
          marketplace: marketplaceLabel(marketplace), installed: Boolean(summary.installed), enabled: Boolean(summary.enabled),
          installPolicy: summary.installPolicy === "INSTALLED_BY_DEFAULT" ? "installedByDefault" as const : summary.installPolicy === "AVAILABLE" ? "available" as const : "notAvailable" as const,
          availability: summary.availability === "DISABLED_BY_ADMIN" ? "disabledByAdmin" as const : "available" as const,
          canInstall: location !== undefined, canUninstall: uninstallId !== undefined,
        },
      };
      const existing = remote ? byRemote.get(remote) : undefined;
      if (existing === undefined) { if (remote) byRemote.set(remote, listed.length); listed.push(entry); }
      else if (preferred(entry, listed[existing]!)) listed[existing] = entry;
    }
  }
  listed.sort((left, right) =>
    Number(right.plugin.installed) - Number(left.plugin.installed)
    || left.plugin.displayName.toLowerCase().localeCompare(right.plugin.displayName.toLowerCase())
    || left.plugin.displayName.localeCompare(right.plugin.displayName)
    || left.plugin.name.localeCompare(right.plugin.name)
    || left.plugin.key.localeCompare(right.plugin.key));
  return listed.map(({ raw: _raw, ...entry }) => entry);
}

/** A plugin's hooks as Codex sums them up (`plugin_hook_summary`): each event with how many handlers it has, in first-seen order — «PreToolUse (1), Stop (2)». Empty when there are none. */
function hookSummary(hooks: any[]): string {
  const counts = new Map<string, number>();
  for (const hook of hooks) {
    const name = String(hook.eventName ?? "");
    const event = name.charAt(0).toUpperCase() + name.slice(1);
    counts.set(event, (counts.get(event) ?? 0) + 1);
  }
  return [...counts].map(([event, count]) => `${event} (${count})`).join(", ");
}

/** Where a plugin comes from (`plugin_source_summary`), as data the screen words in the person's language. */
function pluginSource(summary: any, marketplace: string): NativePluginSource {
  const source = summary.source ?? {};
  if (source.type === "git") return { kind: "git", url: String(source.url), ...(source.refName ? { ref: String(source.refName) } : {}) };
  if (source.type === "npm") return { kind: "npm", package: String(source.package), ...(source.version ? { version: String(source.version) } : {}) };
  if (source.type === "remote") return { kind: "remote", marketplace };
  return { kind: "local" };
}

/** What `plugin/read` answered (`v2/PluginDetail.ts`) as Shell shows it: description (the plugin's own, or the interface's long and then short one), source, auth policy, and what the plugin holds. */
export function pluginDetail(response: any, marketplace: string): NativePluginDetail {
  const detail = response?.plugin ?? {};
  const summary = detail.summary ?? {};
  const text = String(detail.description ?? summary.interface?.longDescription ?? summary.interface?.shortDescription ?? "").trim();
  const version = String(summary.version ?? summary.localVersion ?? "").trim();
  return {
    ...(text ? { description: text } : {}),
    source: pluginSource(summary, marketplace),
    authPolicy: summary.authPolicy === "ON_USE" ? "onUse" : "onInstall",
    ...(version ? { version } : {}),
    skills: (detail.skills ?? []).map((skill: any) => String(skill.name)),
    hooks: hookSummary(detail.hooks ?? []),
    apps: (detail.apps ?? []).map((app: any) => String(app.name)),
    mcpServers: (detail.mcpServers ?? []).map(String),
  };
}
