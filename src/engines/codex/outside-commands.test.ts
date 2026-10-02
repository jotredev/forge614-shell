import { expect, test } from "bun:test";
import { pathToFileURL } from "node:url";
import { CodexSession } from "./session.ts";
import { limitLabel } from "./limits.ts";
import { FixtureRpc } from "../../../tests/support/rpc-fixture.ts";
import type { Locale } from "../../i18n/index.ts";

/** A connected Codex session on `/project`, with the replies `initialize` needs; `configure` adds or replaces replies. */
async function connected(locale: Locale = "en", configure: (rpc: FixtureRpc) => void = () => {}) {
  const rpc = new FixtureRpc(); const events: any[] = [];
  rpc.replies.set("initialize", {});
  rpc.replies.set("account/read", { account: { type: "chatgpt", planType: "plus" }, requiresOpenaiAuth: true });
  rpc.replies.set("model/list", { data: [{ model: "m", displayName: "M", isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: [] }], nextCursor: null });
  rpc.replies.set("account/rateLimits/read", { rateLimits: { primary: { usedPercent: 24, resetsAt: 1900000000, windowDurationMins: 10080 } } });
  rpc.replies.set("thread/start", { thread: { id: "t", path: "/home/u/.codex/sessions/rollout-1.jsonl" }, model: "m", modelProvider: "openai" });
  rpc.replies.set("turn/start", { turn: { id: "u", status: "inProgress" } });
  configure(rpc);
  const session = new CodexSession(rpc, "/project", event => events.push(event), async () => false, undefined, undefined, locale);
  await session.initialize();
  return { rpc, session, events };
}

/** Opens conversation `t` and completes one turn, so Codex has a thread, a rollout path and a last turn id like after a real message. */
async function withConversation(env: Awaited<ReturnType<typeof connected>>) {
  const pending = env.session.send("hello");
  await new Promise(resolve => setImmediate(resolve));
  env.rpc.onNotification("turn/completed", { threadId: "t", turn: { id: "u", status: "completed" } });
  await pending;
}

/**
 * The names of a limit window come from what Codex reports (`windowDurationMins`, `v2/RateLimitWindow.ts`) and follow Codex's own
 * `get_limits_duration` (5 hours, daily, weekly, monthly, annual, each within 5%). Other lengths are said in hours or days, and a window
 * with no length says «usage limit». Exists because Shell showed «codex primary · 14% usado», words that mean nothing to the person.
 */
test("a limit window is named by its length, in English and Spanish, and never «primary» or «secondary»", () => {
  const cases: [number | null | undefined, boolean, string, string][] = [
    [300, false, "5-hour limit", "Límite de 5 horas"],
    [301, false, "5-hour limit", "Límite de 5 horas"],
    [1440, false, "Daily limit", "Límite diario"],
    [10080, true, "Weekly limit", "Límite semanal"],
    [43200, false, "Monthly limit", "Límite mensual"],
    [525600, false, "Annual limit", "Límite anual"],
    [180, false, "3-hour limit", "Límite de 3 h"],
    [4320, false, "3-day limit", "Límite de 3 días"],
    [90, false, "90-minute limit", "Límite de 90 min"],
    [null, false, "Usage limit", "Límite de uso"],
    [undefined, false, "Usage limit", "Límite de uso"],
    [null, true, "Additional usage limit", "Límite de uso adicional"],
  ];
  for (const [minutes, secondary, en, es] of cases) {
    expect(limitLabel(minutes, secondary, "en"), `${minutes} en`).toBe(en);
    expect(limitLabel(minutes, secondary, "es"), `${minutes} es`).toBe(es);
    for (const text of [en, es]) expect(text.toLowerCase()).not.toMatch(/primary|secondary|primari|secundari/);
  }
});

/** `/status` and the sidebar meter show each limit by its window («5-hour limit», «Weekly limit»), and a bucket other than Codex's own keeps its name after the window. */
test("the status lines and the usage meters name each limit by its window, in both languages", async () => {
  const limits = { rateLimits: { primary: { usedPercent: 14, windowDurationMins: 300, resetsAt: null }, secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: null } },
    rateLimitsByLimitId: {
      codex: { limitId: "codex", limitName: null, primary: { usedPercent: 14, windowDurationMins: 300, resetsAt: null }, secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: null } },
      codex_other: { limitId: "codex_other", limitName: "GPT-5.3-Codex-Spark", primary: { usedPercent: 3, windowDurationMins: 10080, resetsAt: null }, secondary: null },
    } };
  const { session: en } = await connected("en", rpc => rpc.replies.set("account/rateLimits/read", limits));
  expect(en.visual().usage?.map(item => item.label)).toEqual(["5-hour limit", "Weekly limit", "Weekly limit · GPT-5.3-Codex-Spark"]);
  expect(en.status().join("\n")).toContain("5-hour limit: 14% used · resets not reported (last report)");
  expect(en.status().join("\n")).toContain("Weekly limit: 40% used · resets not reported (last report)");
  const { session: es } = await connected("es", rpc => rpc.replies.set("account/rateLimits/read", limits));
  expect(es.visual().usage?.map(item => item.label)).toEqual(["Límite de 5 horas", "Límite semanal", "Límite semanal · GPT-5.3-Codex-Spark"]);
  expect(es.status().join("\n")).not.toMatch(/primary|secondary/i);
  expect(en.status().join("\n")).not.toMatch(/primary|secondary/i);
});

/** A limit with no window length reads «Usage limit» (and «Límite de uso»), not «codex primary». */
test("a limit with no window length says «Usage limit» and never «codex primary»", async () => {
  const { session } = await connected("en", rpc => rpc.replies.set("account/rateLimits/read", { rateLimits: { primary: { usedPercent: 14, resetsAt: null } } }));
  expect(session.visual().usage?.map(item => item.label)).toEqual(["Usage limit"]);
  expect(session.status().join("\n")).toContain("Usage limit: 14% used");
  expect(session.status().join("\n")).not.toContain("codex primary");
  const { session: es } = await connected("es", rpc => rpc.replies.set("account/rateLimits/read", { rateLimits: { primary: { usedPercent: 14, resetsAt: null } } }));
  expect(es.visual().usage?.map(item => item.label)).toEqual(["Límite de uso"]);
});

/**
 * `item/autoApprovalReview/completed` exactly as `v2/ItemGuardianApprovalReviewCompletedNotification.ts` defines it (camelCase). Codex's own screen
 * rebuilds the snake_case `GuardianAssessmentEvent` from it (`chatwidget/protocol_requests.rs`), and that event is what `/approve` sends back.
 */
const denial = (over: Record<string, unknown> = {}, review: Record<string, unknown> = {}) => ({
  threadId: "t", turnId: "u", startedAtMs: 1000, completedAtMs: 1500, reviewId: "review-1", targetItemId: "item-1", decisionSource: "agent",
  review: { status: "denied", riskLevel: "high", userAuthorization: "low", rationale: "Deletes files outside the project", ...review },
  action: { type: "command", source: "shell", command: "rm -rf /tmp/build", cwd: "/project" },
  ...over,
});

/** Only a denial of the open conversation is kept; approved, timed-out and other-thread reviews are not, and the list has Codex's own summary and rationale. */
test("recent auto-review denials are kept newest first, only when denied and only for this conversation", async () => {
  const env = await connected(); await withConversation(env);
  expect(env.session.autoReviewDenials()).toEqual([]);
  env.rpc.onNotification("item/autoApprovalReview/completed", denial({ reviewId: "ok" }, { status: "approved" }));
  env.rpc.onNotification("item/autoApprovalReview/completed", denial({ reviewId: "late" }, { status: "timedOut" }));
  env.rpc.onNotification("item/autoApprovalReview/completed", denial({ reviewId: "elsewhere", threadId: "other" }));
  expect(env.session.autoReviewDenials()).toEqual([]);
  env.rpc.onNotification("item/autoApprovalReview/completed", denial());
  env.rpc.onNotification("item/autoApprovalReview/completed", denial({ reviewId: "review-2", action: { type: "command", source: "unifiedExec", command: "curl example.com", cwd: "/project" } }, { rationale: null }));
  expect(env.session.autoReviewDenials()).toEqual([
    { id: "review-2", summary: "curl example.com" },
    { id: "review-1", summary: "rm -rf /tmp/build", rationale: "Deletes files outside the project" },
  ]);
});

/** Codex keeps ten (`MAX_RECENT_DENIALS`), moves a denial that arrives again to the front instead of listing it twice, and forgets them all when the conversation changes. */
test("the denial list holds ten, does not repeat one and is emptied with the conversation", async () => {
  const env = await connected(); await withConversation(env);
  for (let index = 0; index < 12; index++) env.rpc.onNotification("item/autoApprovalReview/completed", denial({ reviewId: `review-${index}` }));
  env.rpc.onNotification("item/autoApprovalReview/completed", denial({ reviewId: "review-5" }));
  expect(env.session.autoReviewDenials().map(item => item.id)).toEqual(["review-5", "review-11", "review-10", "review-9", "review-8", "review-7", "review-6", "review-4", "review-3", "review-2"]);
  env.session.reset();
  expect(env.session.autoReviewDenials()).toEqual([]);
});

/** Each kind of action is summed up like `auto_review_denials::action_summary`, with the fixed words in the person's language and the command, path or name as it came. */
test("each kind of denied action gets Codex's one-line summary, in English and Spanish", async () => {
  const actions: [Record<string, unknown>, string, string][] = [
    [{ type: "command", source: "shell", command: "rm -rf /tmp/x", cwd: "/project" }, "rm -rf /tmp/x", "rm -rf /tmp/x"],
    [{ type: "execve", source: "shell", program: "/bin/rm", argv: ["rm", "-rf", "my dir"], cwd: "/project" }, "rm -rf 'my dir'", "rm -rf 'my dir'"],
    [{ type: "execve", source: "shell", program: "/bin/ls", argv: [], cwd: "/project" }, "/bin/ls", "/bin/ls"],
    [{ type: "writeStdin", approvalId: "a", processId: "42", stdin: "yes\n", cwd: "/project" }, "send input to terminal 42: \"yes\\n\"", "enviar texto a la terminal 42: \"yes\\n\""],
    [{ type: "applyPatch", cwd: "/project", files: ["/project/a.ts"] }, "apply_patch touching /project/a.ts", "apply_patch sobre /project/a.ts"],
    [{ type: "applyPatch", cwd: "/project", files: ["/project/a.ts", "/project/b.ts"] }, "apply_patch touching 2 files", "apply_patch sobre 2 archivos"],
    [{ type: "networkAccess", target: "https://example.com:443", host: "example.com", protocol: "https", port: 443 }, "network access to https://example.com:443", "acceso a la red: https://example.com:443"],
    [{ type: "mcpToolCall", server: "github", toolName: "create_issue", connectorId: null, connectorName: null, toolTitle: null }, "MCP create_issue on github", "MCP create_issue en github"],
    [{ type: "mcpToolCall", server: "github", toolName: "create_issue", connectorId: "c", connectorName: "GitHub", toolTitle: null }, "MCP create_issue on GitHub", "MCP create_issue en GitHub"],
    [{ type: "requestPermissions", reason: "needs the network", permissions: { network: { enabled: true }, fileSystem: null } }, "permission request: needs the network", "solicitud de permisos: needs the network"],
    [{ type: "requestPermissions", reason: null, permissions: { network: { enabled: true }, fileSystem: null } }, "permission request", "solicitud de permisos"],
  ];
  for (const [locale, index] of [["en", 1], ["es", 2]] as const) {
    const env = await connected(locale); await withConversation(env);
    for (const [number, item] of actions.entries()) {
      env.rpc.onNotification("item/autoApprovalReview/completed", denial({ reviewId: `r${number}`, action: item[0] }));
      expect(env.session.autoReviewDenials()[0], `${locale} ${number}`).toMatchObject({ id: `r${number}`, summary: item[index] as string });
    }
  }
});

/**
 * `/approve` → `thread/approveGuardianDeniedAction` (`v2/ThreadApproveGuardianDeniedActionParams.ts`: `threadId` and the serialized
 * `GuardianAssessmentEvent`, snake_case). Codex takes the denial off its list before sending, so approving it twice sends nothing the second time.
 */
test("approving a denial sends the thread id and the snake_case event once and takes it off the list", async () => {
  const env = await connected("en", rpc => rpc.replies.set("thread/approveGuardianDeniedAction", {})); await withConversation(env);
  env.rpc.onNotification("item/autoApprovalReview/completed", denial());
  expect(await env.session.approveAutoReviewDenial("review-1")).toBe(true);
  expect(env.rpc.calls.filter(call => call.method === "thread/approveGuardianDeniedAction")).toEqual([{
    method: "thread/approveGuardianDeniedAction",
    params: { threadId: "t", event: {
      id: "review-1", turn_id: "u", started_at_ms: 1000, completed_at_ms: 1500, status: "denied", risk_level: "high", user_authorization: "low",
      rationale: "Deletes files outside the project", decision_source: "agent",
      action: { type: "command", source: "shell", command: "rm -rf /tmp/build", cwd: "/project" },
    } },
  }]);
  expect(env.session.autoReviewDenials()).toEqual([]);
  expect(await env.session.approveAutoReviewDenial("review-1")).toBe(false);
  expect(env.rpc.calls.filter(call => call.method === "thread/approveGuardianDeniedAction")).toHaveLength(1);
});

/** The other action kinds are re-shaped from the notification's camelCase to the event's snake_case (`source` `unifiedExec` → `unified_exec`, `toolName` → `tool_name`, `socks5Tcp` → `socks5_tcp`, the stdin folder as a `file://` address). */
test("every kind of action reaches Codex in the shape of its own event", async () => {
  const env = await connected("en", rpc => rpc.replies.set("thread/approveGuardianDeniedAction", {})); await withConversation(env);
  const cases: [Record<string, unknown>, Record<string, unknown>][] = [
    [{ type: "command", source: "unifiedExec", command: "ls", cwd: "/project" }, { type: "command", source: "unified_exec", command: "ls", cwd: "/project" }],
    [{ type: "execve", source: "shell", program: "/bin/ls", argv: ["ls", "-la"], cwd: "/project" }, { type: "execve", source: "shell", program: "/bin/ls", argv: ["ls", "-la"], cwd: "/project" }],
    [{ type: "writeStdin", approvalId: "a1", processId: "42", stdin: "y\n", cwd: "/project" }, { type: "write_stdin", approval_id: "a1", process_id: "42", stdin: "y\n", cwd: pathToFileURL("/project").href }],
    [{ type: "applyPatch", cwd: "/project", files: ["/project/a.ts"] }, { type: "apply_patch", cwd: "/project", files: ["/project/a.ts"] }],
    [{ type: "networkAccess", target: "socks5://h:1", host: "h", protocol: "socks5Tcp", port: 1 }, { type: "network_access", target: "socks5://h:1", host: "h", protocol: "socks5_tcp", port: 1 }],
    [{ type: "mcpToolCall", server: "gh", toolName: "t", connectorId: null, connectorName: "GitHub", toolTitle: null }, { type: "mcp_tool_call", server: "gh", tool_name: "t", connector_id: null, connector_name: "GitHub", tool_title: null }],
    [{ type: "requestPermissions", reason: "net", permissions: { network: { enabled: true }, fileSystem: null } }, { type: "request_permissions", reason: "net", permissions: { network: { enabled: true }, file_system: null } }],
  ];
  for (const [number, [action, expected]] of cases.entries()) {
    env.rpc.onNotification("item/autoApprovalReview/completed", denial({ reviewId: `r${number}`, action }));
    await env.session.approveAutoReviewDenial(`r${number}`);
    expect(env.rpc.calls.filter(call => call.method === "thread/approveGuardianDeniedAction").at(-1)!.params.event.action, String(number)).toEqual(expected);
  }
});

/** A permission request that asks for file-system access has a different shape in the event than in the notification; Shell does not rebuild that, so it does not offer it (it would be rejected). */
test("a denied permission request for file-system access is not offered", async () => {
  const env = await connected(); await withConversation(env);
  env.rpc.onNotification("item/autoApprovalReview/completed", denial({ action: { type: "requestPermissions", reason: "write", permissions: { network: null, fileSystem: { read: null, write: ["/etc"] } } } }));
  expect(env.session.autoReviewDenials()).toEqual([]);
});

/**
 * `/feedback` → `feedback/upload` (`v2/FeedbackUploadParams.ts`) with what `build_feedback_upload_params` sends: the category's classification, the note as `reason`,
 * the conversation id, whether logs go, the conversation's rollout file (`Thread.path`) as an extra log and the last turn id as a tag. Only what exists is sent.
 */
test("feedback upload sends Codex's parameters, and leaves out what is not there", async () => {
  const env = await connected("en", rpc => rpc.replies.set("feedback/upload", { threadId: "t", promptHash: null })); await withConversation(env);
  expect(await env.session.uploadFeedback({ category: "bad_result", includeLogs: true, note: "It ignored my request" })).toEqual({ threadId: "t" });
  expect(env.rpc.calls.at(-1)).toEqual({ method: "feedback/upload", params: {
    classification: "bad_result", reason: "It ignored my request", threadId: "t", includeLogs: true,
    extraLogFiles: ["/home/u/.codex/sessions/rollout-1.jsonl"], tags: { turn_id: "u" },
  } });
  await env.session.uploadFeedback({ category: "good_result", includeLogs: false });
  expect(env.rpc.calls.at(-1)).toEqual({ method: "feedback/upload", params: { classification: "good_result", threadId: "t", includeLogs: false, tags: { turn_id: "u" } } });
  const empty = await connected("en", rpc => rpc.replies.set("feedback/upload", { threadId: "new", promptHash: null }));
  expect(await empty.session.uploadFeedback({ category: "other", includeLogs: false })).toEqual({ threadId: "new" });
  expect(empty.rpc.calls.at(-1)).toEqual({ method: "feedback/upload", params: { classification: "other", includeLogs: false } });
  for (const [category, classification] of [["bug", "bug"], ["safety_check", "safety_check"]] as const) {
    await env.session.uploadFeedback({ category, includeLogs: false });
    expect(env.rpc.calls.at(-1)!.params.classification).toBe(classification);
  }
});

/** What Codex 0.159.0's `externalAgentConfig/detect` answers (`v2/ExternalAgentConfigMigrationItem.ts`, `MigrationDetails.ts`): items of several types, some home-wide and some for the project. */
const settingsItem = { itemType: "CONFIG", description: "Migrate /home/u/.claude/settings.json into /home/u/.codex/config.toml", cwd: null, details: null };
const mcpItem = { itemType: "MCP_SERVER_CONFIG", description: "Migrate MCP servers from /home/u/.claude.json into /home/u/.codex/config.toml", cwd: null,
  details: { plugins: [], skills: [], sessions: [], mcpServers: [{ name: "forge614-engram" }, { name: "github" }], hooks: [], subagents: [], commands: [] } };
const sessionsItem = { itemType: "SESSIONS", description: "Migrate recent Claude Code sessions", cwd: "/project",
  details: { plugins: [], skills: [], sessions: [{ path: "/home/u/.claude/projects/p/1.jsonl", cwd: "/project", title: "Fix login" }, { path: "/home/u/.claude/projects/p/2.jsonl", cwd: "/project", title: null }], mcpServers: [], hooks: [], subagents: [], commands: [] } };

/** Detection asks only Claude Code, with the home folder and this project, keeps the source when it found something, and reports it when it failed. */
test("import detection asks Claude Code with Codex's parameters and reads the items", async () => {
  const env = await connected("en", rpc => {
    rpc.handler = async (method, params) => {
      if (method === "externalAgentConfig/detect") {
        if (params.migrationSource === "claude-code") return { items: [settingsItem, mcpItem, sessionsItem], connectors: [] };
        throw new Error("unexpected source");
      }
      if (!rpc.replies.has(method)) throw new Error(`Unexpected ${method}`);
      return rpc.replies.get(method);
    };
  });
  const result = await env.session.detectExternalSetup();
  expect(env.rpc.calls.filter(call => call.method === "externalAgentConfig/detect").map(call => call.params)).toEqual([
    { includeHome: true, cwds: ["/project"], migrationSource: "claude-code" },
  ]);
  expect(result.errors).toEqual([]);
  expect(result.sources.map(source => [source.id, source.label])).toEqual([["claude-code", "Claude Code"]]);
  expect(result.sources[0]!.items.map(item => ({ type: item.type, description: item.description, cwd: item.cwd, count: item.count, names: item.names }))).toEqual([
    { type: "CONFIG", description: settingsItem.description, cwd: null, count: 1, names: [] },
    { type: "MCP_SERVER_CONFIG", description: mcpItem.description, cwd: null, count: 2, names: ["forge614-engram", "github"] },
    { type: "SESSIONS", description: sessionsItem.description, cwd: "/project", count: 2, names: ["Fix login"] },
  ]);
});

/** When Claude Code's own check fails, the failure is reported by name and no source is returned. */
test("import detection reports Claude Code by name when its check fails", async () => {
  const env = await connected("en", rpc => {
    rpc.handler = async method => {
      if (method === "externalAgentConfig/detect") throw new Error("boom");
      if (!rpc.replies.has(method)) throw new Error(`Unexpected ${method}`);
      return rpc.replies.get(method);
    };
  });
  const result = await env.session.detectExternalSetup();
  expect(result.errors).toEqual(["Claude Code: boom"]);
  expect(result.sources).toEqual([]);
});

/**
 * `/import` → `externalAgentConfig/import` (`v2/ExternalAgentConfigImportParams.ts`): the chosen items exactly as the server listed them, plus the same
 * `migrationSource` the detection used; Codex also sends `source: "cli"` and `providerId`. One import at a time, as Codex says; its end arrives as a notification.
 */
test("import sends the chosen items untouched, refuses a second one and reports the end in the person's language", async () => {
  for (const [locale, finished] of [["en", "Import finished: 2 imported, 1 failed."], ["es", "Importación terminada: 2 importados, 1 con fallo."]] as const) {
    const env = await connected(locale, rpc => rpc.replies.set("externalAgentConfig/import", { importId: "imp-1" }));
    await env.session.importExternalSetup("claude-code", [
      { type: "CONFIG", description: "", cwd: null, count: 1, names: [], raw: settingsItem },
      { type: "MCP_SERVER_CONFIG", description: "", cwd: null, count: 2, names: [], raw: mcpItem },
    ]);
    expect(env.rpc.calls.find(call => call.method === "externalAgentConfig/import")).toEqual({
      method: "externalAgentConfig/import",
      params: { migrationItems: [settingsItem, mcpItem], source: "cli", providerId: "claude-code", migrationSource: "claude-code" },
    });
    await expect(env.session.importExternalSetup("claude-code", [])).rejects.toThrow(locale === "en"
      ? "A previous external agent import is still running. Wait for it to finish before importing again."
      : "Una importación anterior sigue en curso. Espera a que termine antes de importar otra vez.");
    env.rpc.onNotification("externalAgentConfig/import/completed", { importId: "other", itemTypeResults: [] });
    expect(env.events.filter(event => event.type === "text")).toEqual([]);
    env.rpc.onNotification("externalAgentConfig/import/completed", { importId: "imp-1", itemTypeResults: [
      { itemType: "CONFIG", successes: [{}], failures: [] },
      { itemType: "MCP_SERVER_CONFIG", successes: [{}], failures: [{}] },
    ] });
    const text = env.events.filter(event => event.type === "text").map(event => event.text).join("\n");
    expect(text).toContain(finished);
    await env.session.importExternalSetup("claude-code", []);
    expect(env.rpc.calls.filter(call => call.method === "externalAgentConfig/import")).toHaveLength(2);
  }
});

/** A `PluginSummary` with every field `v2/PluginSummary.ts` has; `over` changes what a case needs. */
const summary = (over: Record<string, unknown> = {}) => ({
  id: "figma@openai-curated", remotePluginId: null, version: null, localVersion: null, name: "figma", shareContext: null, source: { type: "local", path: "/m/figma" },
  installed: false, installedAt: null, enabled: false, installPolicy: "AVAILABLE", installPolicySource: null, mustShowInstallationInterstitial: null, authPolicy: "ON_INSTALL",
  availability: "AVAILABLE", disabledReason: null, eligiblePlanTypes: null,
  interface: { displayName: "Figma", shortDescription: "Design context", longDescription: null, developerName: null, category: null, capabilities: [], websiteUrl: null, privacyPolicyUrl: null, termsOfServiceUrl: null, defaultPrompt: null, brandColor: null, composerIcon: null, composerIconUrl: null, logo: null, logoDark: null, logoUrl: null, logoUrlDark: null, screenshots: [], screenshotUrls: [] },
  keywords: [], ...over,
});
const pluginList = { marketplaces: [
  { name: "openai-bundled", path: "/b/marketplace.json", interface: null, plugins: [summary({ id: "hidden@openai-bundled", name: "hidden" })] },
  { name: "openai-curated", path: "/m/.agents/plugins/marketplace.json", interface: { displayName: "OpenAI Curated" }, plugins: [
    summary(),
    summary({ id: "docs@openai-curated", name: "docs", installed: true, enabled: true, interface: null }),
  ] },
  { name: "workspace-directory", path: null, interface: null, plugins: [
    summary({ id: "remote-tool@ws", name: "remote-tool", remotePluginId: "plugins~remote-1", source: { type: "remote" }, interface: { ...summary().interface, displayName: "Remote tool" } }),
  ] },
], marketplaceLoadErrors: [], featuredPluginIds: [] };

/**
 * `/plugins` → `plugin/list` with the folder (`v2/PluginListParams.ts`), as Codex's screen asks it. Like Codex, the marketplace it hides from the CLI
 * (`openai-bundled`) is left out, installed plugins come first and the rest by name, and each plugin carries where it lives so the same marketplace is used to read and install it.
 */
test("the plugin list is asked with the folder, hides the bundled marketplace and puts installed plugins first", async () => {
  const env = await connected("en", rpc => rpc.replies.set("plugin/list", pluginList));
  const plugins = await env.session.plugins();
  expect(env.rpc.calls.find(call => call.method === "plugin/list")).toEqual({ method: "plugin/list", params: { cwds: ["/project"], forceRefetch: false } });
  expect(plugins.map(plugin => [plugin.name, plugin.displayName, plugin.marketplace, plugin.installed, plugin.description])).toEqual([
    ["docs", "docs", "OpenAI Curated", true, undefined],
    ["figma", "Figma", "OpenAI Curated", false, "Design context"],
    ["remote-tool", "Remote tool", "workspace-directory", false, "Design context"],
  ]);
});

/** `plugin/read` needs the marketplace file for a local marketplace and the marketplace name plus the remote id for a remote one (`PluginLocation::into_request_params`). */
test("reading, installing and uninstalling use the marketplace location Codex uses", async () => {
  const detail = { plugin: { marketplaceName: "openai-curated", marketplacePath: "/m/.agents/plugins/marketplace.json", summary: summary(), shareUrl: null, description: "Turn Figma files into implementation context.",
    skills: [{ name: "design-review", description: "", shortDescription: null, interface: null, path: null, enabled: true }],
    onboardingSkill: null, hooks: [{ key: "a", eventName: "preToolUse" }, { key: "b", eventName: "stop" }, { key: "c", eventName: "stop" }],
    apps: [{ id: "figma", name: "Figma", description: null, installUrl: null, category: null }], appTemplates: [], mcpServers: ["figma-mcp"], scheduledTasks: null } };
  const env = await connected("en", rpc => {
    rpc.replies.set("plugin/list", pluginList); rpc.replies.set("plugin/read", detail);
    rpc.replies.set("plugin/install", { authPolicy: "ON_INSTALL", appsNeedingAuth: [{ id: "figma", name: "Figma", description: null, installUrl: null, category: null }] });
    rpc.replies.set("plugin/uninstall", {});
  });
  const plugins = await env.session.plugins();
  const figma = plugins.find(plugin => plugin.name === "figma")!; const docs = plugins.find(plugin => plugin.name === "docs")!; const remote = plugins.find(plugin => plugin.name === "remote-tool")!;
  const read = await env.session.pluginDetail(figma.key);
  expect(env.rpc.calls.find(call => call.method === "plugin/read")!.params).toEqual({ marketplacePath: "/m/.agents/plugins/marketplace.json", pluginName: "figma" });
  expect(read).toMatchObject({
    description: "Turn Figma files into implementation context.", source: { kind: "local" }, authPolicy: "onInstall",
    skills: ["design-review"], hooks: "PreToolUse (1), Stop (2)", apps: ["Figma"], mcpServers: ["figma-mcp"],
  });
  await env.session.pluginDetail(remote.key);
  expect(env.rpc.calls.filter(call => call.method === "plugin/read").at(-1)!.params).toEqual({ remoteMarketplaceName: "workspace-directory", pluginName: "plugins~remote-1" });
  expect(await env.session.installPlugin(figma.key)).toEqual({ appsNeedingAuth: ["Figma"] });
  expect(env.rpc.calls.find(call => call.method === "plugin/install")!.params).toEqual({ marketplacePath: "/m/.agents/plugins/marketplace.json", pluginName: "figma" });
  await env.session.installPlugin(remote.key);
  expect(env.rpc.calls.filter(call => call.method === "plugin/install").at(-1)!.params).toEqual({ remoteMarketplaceName: "workspace-directory", pluginName: "plugins~remote-1" });
  await env.session.uninstallPlugin(docs.key);
  expect(env.rpc.calls.find(call => call.method === "plugin/uninstall")).toEqual({ method: "plugin/uninstall", params: { pluginId: "docs@openai-curated" } });
  await env.session.uninstallPlugin(remote.key);
  expect(env.rpc.calls.filter(call => call.method === "plugin/uninstall").at(-1)!.params).toEqual({ pluginId: "plugins~remote-1" });
});
