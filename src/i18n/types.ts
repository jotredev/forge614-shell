export type Locale = "es" | "en";

/**
 * Stable identifiers for every error Shell itself raises (never for raw text received from Claude,
 * Codex, Engines, or Engram — those are thrown as plain `Error`s and pass through `describeError`
 * unchanged). A `ShellError` carries one of these plus an interpolation-params bag; only the
 * presentation boundary (`describeError`) ever turns it into locale text, so the same error can be
 * logged, tested, or re-thrown without depending on which language happened to be active.
 */
export type ShellErrorCode =
  | "claude-env-conflict"
  | "claude-login-required"
  | "claude-subscription-required"
  | "claude-not-found"
  | "claude-login-exit-code"
  | "claude-switch-session-busy"
  | "claude-new-chat-busy"
  | "claude-work-mode-unknown"
  | "claude-mode-rejected"
  | "claude-turn-already-running"
  | "claude-no-result"
  | "codex-mode-unknown"
  | "codex-mode-rejected"
  | "codex-compact-no-conversation"
  | "codex-command-needs-conversation"
  | "clipboard-unavailable"
  | "codex-refresh-requires-login"
  | "codex-login-not-managed"
  | "codex-turn-busy"
  | "codex-agent-read-only"
  | "codex-model-unknown"
  | "codex-effort-unknown"
  | "codex-session-foreign-project"
  | "codex-session-active-elsewhere"
  | "codex-requires-login-to-send"
  | "codex-requires-login-no-fallback"
  | "codex-unexpected-provider"
  | "codex-unsupported-request"
  | "engines-invalid-detection"
  | "engines-incompatible-schema"
  | "engines-unavailable"
  | "engines-unavailable-at-path"
  | "engines-command-failed"
  | "engines-invalid-plan"
  | "engines-invalid-apply-result"
  | "engines-invalid-verification"
  | "engines-invalid-update-result"
  | "engines-outdated"
  | "engram-unavailable-at-path"
  | "engram-command-failed"
  | "engram-invalid-result"
  | "engram-reinforcement-failed-after-init"
  | "engram-update-invalid-result"
  | "GROUP_NAME_INVALID"
  | "GROUP_NAME_TAKEN"
  | "ENGRAM_GROUP_LIST_INVALID"
  | "ENGRAM_GROUP_RESULT_INVALID"
  | "codex-turn-failed"
  | "engine-request-timeout"
  | "init-requires-product"
  | "init-unexpected-args"
  | "init-unsupported-product"
  | "updater-update-failed"
  | "updater-uninstall-failed";

/**
 * Shell's translated presentation strings. Never covers command names, paths, environment
 * variables, or other identifiers (`forge614-shell`, `FORGE614_HOME`, `MCP`, `Claude Code`,
 * `Codex`, …) — those stay literal in both catalogs and are passed in as interpolation values.
 * A catalog is `const x: Catalog = {...}` typed against this interface, so `tsc` fails the build
 * the moment a future catalog is missing a required key — no key is optional here on purpose.
 */
export interface Catalog {
  languageSelector: {
    title: string;
    spanish: string;
    english: string;
    hint: string;
  };
  languageCommand: {
    /** `locale` is the resolved value ("es"/"en"), interpolated literally — never translated. */
    confirmed: (params: { locale: string }) => string;
    invalidUsage: string;
    invalidLocale: (params: { value: string }) => string;
  };
  startup: {
    requiresInteractiveTerminal: string;
  };
  engramInit: {
    introTitle: string;
    introBody: string;
    continueLabel: string;
    postgresTitle: string;
    postgresNo: string;
    postgresYes: string;
    postgresConnectionTitle: string;
    postgresConnectionPrompt: string;
    postgresConnectionRequired: string;
    reinforcementTitle: string;
    reinforcementBody: string;
    yesLabel: string;
    noLabel: string;
    summaryTitle: string;
    confirmLabel: string;
    cancelLabel: string;
    summaryLocalStorage: string;
    summaryPostgresEnabled: string;
    summaryPostgresDisabled: string;
    summaryReinforcementEnabled: string;
    summaryReinforcementDisabled: string;
    summaryCommandsHeading: string;
    summaryNoAgentNotice: string;
    navHint: string;
  };
  /** Group-selection screen shown once inside `init --product engram` (acta 0023 §5). */
  groupPicker: {
    title: string;
    existingHeading: string;
    /** `projects` is a comma-separated list of project names, already shortened to fit. */
    projectsLine: (params: { projects: string }) => string;
    noProjects: string;
    createLabel: string;
    looseLabel: string;
    hint: string;
  };
  groupName: {
    title: string;
    prompt: string;
    hint: string;
  };
  /** One line per outcome of the group step, folded into the final result screen. */
  groupResult: {
    bound: (params: { group: string }) => string;
    created: (params: { group: string }) => string;
    loose: string;
    skipped: string;
    failed: (params: { message: string }) => string;
    /** Shown while Engram lists the existing groups. */
    loading: string;
    /** Shown while Engram applies the chosen group. */
    applying: string;
  };
  /** Notices Forge614 Engram reports; Shell shows its own text for the code, never Engram's message. */
  engramNotices: {
    /** `backup` is the backup path Engram reported, or an empty string when there was none. */
    databaseMigrated: (params: { backup: string }) => string;
    projectReboundFromFile: string;
    projectFileInvalid: string;
  };
  memoryPicker: {
    title: string;
    hint: string;
    body: string;
  };
  memoryPreview: {
    title: string;
    confirmLabel: string;
    cancelLabel: string;
    overallLine: (params: { agent: string; status: string }) => string;
    pathsToChangeLabel: string;
    noneLabel: string;
    mcpAndInstructionsLine: (params: { mcp: string; instructions: string }) => string;
    hookLine: (params: { hook: string }) => string;
    blockedLine: (params: { agent: string; detail: string }) => string;
    nothingChangedYet: string;
    statusWillAdd: string;
    statusAlreadyConfigured: string;
    statusAlreadyPresent: string;
    statusAlreadyInstalled: string;
    statusBlocked: string;
    statusUnsupportedMcp: string;
    statusNotSupported: string;
  };
  memorySetup: {
    detecting: string;
    planning: (params: { agent: string }) => string;
    verifying: (params: { agent: string }) => string;
    applying: (params: { agent: string }) => string;
    initializing: string;
    detectionFailed: (params: { message: string }) => string;
    noAssistantsFound: string;
    setupSkipped: string;
    noAssistantSelected: string;
    outcomeConfigured: (params: { agent: string }) => string;
    outcomePrepared: (params: { agent: string; detail: string }) => string;
    outcomeUnsupported: (params: { agent: string; detail: string }) => string;
    outcomeBlocked: (params: { agent: string; detail: string }) => string;
    outcomeSkipped: (params: { agent: string }) => string;
    outcomeFailed: (params: { agent: string; detail: string }) => string;
    verificationAbsent: (params: { agent: string }) => string;
    instructionsUnsupported: (params: { agent: string }) => string;
    verificationIncomplete: (params: { agent: string }) => string;
    preparedNeedsTrust: (params: { agent: string }) => string;
    preparedPending: (params: { agent: string }) => string;
    applyNotApplied: string;
  };
  result: {
    initComplete: string;
    cancelledTitle: string;
    cancelledBody: string;
    resultTitle: string;
    restartHint: string;
    memorySetupFailed: (params: { message: string }) => string;
    stdinClosedTitle: string;
    stdinClosedBody: string;
    startFailed: (params: { message: string }) => string;
  };
  options: {
    engineInvalidValue: string;
    engineSpecifiedTwice: string;
  };
  logout: {
    /** Title of the question that disconnects: it names the assistant. */
    confirmTitle: (params: { engine: string }) => string;
    /** Body of that question: what is left untouched and the command that reconnects. */
    confirmBody: (params: { loginCommand: string }) => string;
    /** The marked row («No»: everything stays as it is) and the row that disconnects. */
    stay: string;
    disconnect: string;
    disconnectFailed: string;
  };
  /**
   * One template per `ShellErrorCode`, each taking whatever named params that code needs (unused
   * params are simply ignored) and returning the fully rendered, locale-appropriate message. Only
   * `describeError` (in `src/shell-error.ts`) calls these — nothing else should reference `errors`
   * directly, so every Shell-own error is translated in exactly one place.
   */
  errors: Record<ShellErrorCode, (params: Record<string, string>) => string>;
  cli: {
    updateFailed: (params: { message: string }) => string;
    uninstallFailed: (params: { message: string }) => string;
    initFailed: (params: { message: string }) => string;
    languageFailed: (params: { message: string }) => string;
    couldNotStart: (params: { message: string }) => string;
    requiresInteractiveStartup: string;
    engineNotOnPath: (params: { engine: string }) => string;
    /** The full `--help` body. `version` is interpolated literally; command names, flags, and env
     * var names inside it are never translated — only the surrounding prose is. */
    help: (params: { version: string }) => string;
  };
  spinner: {
    detectingEngines: string;
  };
  visualPicker: {
    title: string;
    basicLabel: string;
    fullLabel: string;
    hint: string;
    fullDisabledHint: string;
  };
  enginePicker: {
    title: string;
    /** Mark beside the assistant used last time. */
    lastUsed: string;
    noEnginesFound: string;
  };
  /** Shared between the Claude and Codex chat UIs — the wording is identical in both today. */
  chat: {
    genericCommandLabel: string;
    commandSelectModel: string;
    commandSelectReasoning: string;
    commandChatHistory: string;
    commandNewConversation: string;
    commandShowStatus: string;
    commandShowHelp: string;
    commandConnectAccount: string;
    commandDisconnectLocally: string;
    commandSessionDetails: string;
    commandCancelActiveTurn: string;
    commandRefreshPlanUsage: string;
    commandBrowseCommands: string;
    commandExitShell: string;
    permissionRequestedTitle: string;
    awaitingAnswer: string;
    noPermissionPending: string;
    answerPendingPermissionFirst: string;
    unknownCommand: (params: { name: string }) => string;
    /** One line after a work-mode change the assistant only reads when a turn starts. */
    workModeNextTurn: (params: { mode: string }) => string;
    commandCompact: string;
    statusWorking: string;
    statusReady: string;
    statusConnectWithLogin: (params: { command: string }) => string;
    waitForCurrentOperation: string;
    turnAlreadyRunning: string;
    reconnectBeforeMessage: string;
    errorPrefixed: (params: { message: string }) => string;
    turnStopped: (params: { message: string }) => string;
    nodeWarning: (params: { message: string }) => string;
    /** The line the chat shows when a click on a link or path could not open it; `target` is the address or the path. */
    linkOpenFailed: (params: { target: string }) => string;
    resumeUseNumber: string;
    noSessionsFound: string;
    quitConfirmActiveWork: string;
    /** `/f614:quit` (and Ctrl+C / Ctrl+D) while work runs: the question, and the footer under its «Yes» / «No» rows. */
    quitQuestion: string;
    quitFooter: string;
    historyRestored: string;
    nativeCliOptionsUnsupported: (params: { id: string }) => string;
    nativeRequiresInteractiveTerminal: string;
    commandReasoningLevel: string;
    commandRefreshPlanUsageEngines: string;
    commandCancelKeepOpen: string;
    commandBrowseAllCommands: string;
    helpOrCommandsHint: string;
    shiftEnterNewline: string;
    commandsFallbackTitle: string;
    menuFooter: (params: { title: string; from: number; to: number; total: number }) => string;
    searchLabel: string;
    searchPlaceholder: string;
    searchNoMatches: string;
    askFooter: string;
    /** Group title of the files `@` offers. */
    filesGroup: string;
    /** Group title of the skills `$` offers, and the name its footer counts them by. */
    skillsGroup: string;
    skillsFooterTitle: string;
  };
  /** Help lines by tone (see `WorkModeTone`); the mode's own name always comes from the assistant's adapter. */
  workMode: {
    bypassPermissionsHelp: string;
    autoModeHelp: string;
    manualModeHelp: string;
    readOnlyModeHelp: string;
    acceptEditsHelp: string;
    planModeHelp: string;
    dontAskModeHelp: string;
    engineMode: string;
    shiftTabToCycle: string;
    /** The help when Shift+Tab switches the assistant's collaboration modes (Codex: Plan ↔ Default) instead of cycling permissions; `modes` are the assistant's own names joined by «↔». */
    shiftTabCollaboration: (params: { modes: string }) => string;
  };
  claudeChat: {
    cliOptionsUnsupported: string;
    requiresInteractiveTerminal: string;
    catalogLoadFailed: string;
    permissionTooLarge: (params: { tool: string }) => string;
    questionnaireUnsupported: string;
    claudeError: (params: { message: string }) => string;
    finishOrStopFirst: string;
    /** A command of Claude Code's own that Shell has not connected yet (`/status`, `/help`): said honestly, never as an unknown command. */
    workOrAuthActive: string;
    checkingAccount: string;
    connectedExistingAccount: string;
    signInRequired: string;
    loginNotVerified: string;
    loginFlowFinished: string;
    disconnectedLocally: string;
    logoutCancelled: string;
    catalogNotLoaded: string;
    chooseModelFromCommand: string;
    requestedModel: (params: { model: string }) => string;
    noReasoningOptions: string;
    defaultRecommended: string;
    defaultResolvesLater: string;
    effortNotSupported: string;
    invalidEffort: string;
    noClaudeSessionsFound: string;
    useResumeFirst: string;
    usageUnavailable: string;
    couldNotVerifyAccount: string;
    statusCheckingAccount: string;
    toolRequested: string;
    toolRunning: (params: { duration: string }) => string;
    toolCompleted: (params: { duration: string }) => string;
    toolFailed: (params: { duration: string }) => string;
  };
  /** The status line that says where Engram's memory comes from (`memorySourceLine`). */
  memorySource: {
    byAssistant: string;
    byShell: string;
  };
  /** The texts of Claude Code's own `/status` and `/help` as Shell shows them (`claudeStatusLines`, `claudeHelpLines`). */
  claudePanels: {
    statusTitle: string;
    labelVersion: string; labelSession: string; labelFolder: string; labelEmail: string; labelOrganization: string; labelPlan: string;
    labelApiKey: string; labelProvider: string; labelModel: string; labelPermissionMode: string; labelSettingSources: string; labelMcpServers: string;
    apiKeyFromEnvironment: string; apiKeyFromHelper: string; apiKeyFromLogin: string; apiKeyNone: string;
    settingSourceUser: string; settingSourceProject: string; settingSourceLocal: string;
    /** Names of the groups the MCP servers of `/status` come in, one per state. */
    mcpNone: string; mcpGroupConnected: string; mcpGroupConnecting: string; mcpGroupNeedsSignIn: string; mcpGroupFailed: string; mcpGroupDisabled: string; mcpGroupOther: string;
    statusAfterFirstMessage: string;
    helpTitle: string; helpCommands: string; helpShellCommands: string; helpShortcuts: string;
    keySend: string; keyNewLine: string; keyCycleModes: string; keyAcceptCommand: string; keyCloseMenu: string; keyLeave: string;
  };
  telemetry: {
    notReported: string;
    modelLine: (params: { model: string; effort: string }) => string;
    effortNone: string;
    tokensLine: (params: { input: string; output: string; cacheRead: string; cacheWrite: string }) => string;
    contextLine: (params: { used: string; window: string }) => string;
    costLine: (params: { estimate: string }) => string;
    /** `name` is the limit's plain name (the sidebar's), `status` the translated status and `resets` a whole phrase (`resetsAt` or `resetsUnknown`). */
    quotaLine: (params: { name: string; used: string; status: string; resets: string }) => string;
    resetsAt: (params: { moment: string }) => string;
    resetsUnknown: string;
    /** The statuses the SDK reports for a limit (`SDKRateLimitInfo.status`), in plain words. */
    statusAllowed: string;
    statusAllowedWarning: string;
    statusRejected: string;
    percentUsed: (params: { percent: number }) => string;
    extraUsageActive: string;
  };
  /** A moment in local time (`formatMoment`): short month names, the 12-hour clock's two halves and the order of the pieces. */
  moments: {
    months: string[];
    am: string;
    pm: string;
    dateTime: (params: { month: string; day: string; time: string }) => string;
  };
  chatRoles: {
    you: string;
    assistant: string;
    system: string;
  };
  jumpToLatest: {
    label: string;
  };
  /** The short notices the chat shows when what was selected with the mouse is copied. */
  chatSelection: {
    copied: string;
    copyFailed: string;
  };
  sidebarControls: {
    hide: string;
    show: string;
    releaseToHide: string;
  };
  metrics: {
    reasoningDefaultLabel: string;
    effortLow: string;
    effortMedium: string;
    effortHigh: string;
    effortXhigh: string;
    effortMax: string;
    usageFiveHourLimit: string;
    usageWeeklyLimit: string;
    usageWeeklyOpus: string;
    usageWeeklySonnet: string;
    usageWeeklyConnectedApps: string;
    usageExtraUsage: string;
    usageWeeklyOverageIncluded: string;
    usageOtherLimit: string;
    usageProviderSuffix: string;
    usageDailyLimit: string;
    usageMonthlyLimit: string;
    usageAnnualLimit: string;
    usageHoursLimit: (params: { count: number }) => string;
    usageDaysLimit: (params: { count: number }) => string;
    usageMinutesLimit: (params: { count: number }) => string;
    usageGenericLimit: string;
    usageAdditionalLimit: string;
    usageLimitOfBucket: (params: { limit: string; bucket: string }) => string;
    resetTimeUnavailable: string;
    resetsIn: (params: { time: string }) => string;
    awaitingUpdatedLimit: string;
  };
  sidebar: {
    refreshNotSupported: string;
    connectFirst: (params: { command: string }) => string;
    usageUpdated: string;
    refreshFailed: string;
    checking: string;
    unverified: string;
    disconnected: string;
    loginToConnect: (params: { command: string }) => string;
    checkingNativeAccount: string;
    headingSession: string;
    headingContext: string;
    headingPlanUsage: string;
    fieldAccount: string;
    fieldConnected: string;
    fieldProvider: string;
    fieldUser: string;
    notReported: string;
    fieldModel: string;
    notReportedYet: string;
    fieldReasoning: string;
    fieldSession: string;
    newConversation: string;
    fieldOpened: string;
    fieldShellUptime: string;
    conversationLabel: string;
    percentUsed: (params: { percent: number }) => string;
    percentFree: (params: { percent: number }) => string;
    contextAfterFirstMessage: string;
    contextAfterNextMessage: string;
    usageUnavailable: string;
    lastMessageTitle: string;
    lastMessageRead: (params: { tokens: string }) => string;
    lastMessageWrote: (params: { tokens: string }) => string;
    payPerUseTitle: string;
    payPerUseAmount: (params: { amount: string }) => string;
    payPerUseUnderOneCent: string;
    planDoesNotBill: string;
  };
  statusBar: {
    checkingAccount: string;
    accountUnverified: string;
    disconnected: string;
    detachedHead: string;
    changes: (params: { count: number }) => string;
    clean: string;
    context: (params: { percent: number }) => string;
    /** «F614», the first thing of the line: it opens the Forge614 panel. The same in every language. */
    forge614Indicator: string;
    /** «⇌ {count} MCP», the number of connected MCP servers: it opens the MCP panel. The same in every language. */
    mcpIndicator: (params: { count: number }) => string;
    /** The arrow after an indicator: pointing up at rest, down while its panel is open. The same in every language. */
    arrowClosed: string;
    arrowOpen: string;
  };
  /** The two panels the bottom bar opens (`ui/basic/status-panel.ts`). */
  statusPanel: {
    mcpTitle: string;
    /** The state words of an MCP server, each drawn in its own color. */
    stateConnected: string;
    stateStarting: string;
    stateNeedsSignIn: string;
    stateFailed: string;
    stateCancelled: string;
    stateDisabled: string;
    /** Marks the row of Forge614 Engram's MCP server (`forge614-engram`). The same in every language. */
    engramServer: string;
    /** The Forge614 panel's title and the names of its three rows. The same in every language. */
    forge614Title: string;
    shell: string;
    engines: string;
    engram: string;
    memoryInUse: string;
    memoryNotInUse: string;
    notInstalled: string;
    /** The last row of a panel that does not fit: how many rows were left out. */
    more: (params: { count: number }) => string;
  };
  backgroundActivity: {
    heading: string;
    running: string;
    done: string;
    failed: string;
    idle: string;
    notReportedByEngine: string;
    statusBarCount: (params: { count: number }) => string;
  };
  update: {
    updated: (params: { label: string; detail?: string }) => string;
    alreadyUpToDate: (params: { label: string; detail?: string }) => string;
    notInstalled: (params: { label: string }) => string;
    failed: (params: { label: string; detail: string }) => string;
    noDetailsReported: string;
  };
  /** Codex's own session layer (`src/engines/codex/session.ts`) — status text, login flow
   * narration, and quota lines it builds itself, as opposed to `codexChat`'s UI-dispatch text. */
  codexSession: {
    notLoggedIn: string;
    quotaNotReported: string;
    tokensNotReported: string;
    chatgptAccount: (params: { plan: string }) => string;
    planNotReported: string;
    chatgptLoginRequired: string;
    connectedExistingAccount: string;
    openingLoginBrowser: (params: { url: string }) => string;
    browserLaunchRequested: string;
    browserOpenFailed: string;
    logoutCancelled: string;
    disconnectedLocally: string;
    disconnectedShort: string;
    disconnectedStatus: string;
    modelEffortLine: (params: { model: string; effort: string }) => string;
    engineDefault: string;
    costNotReported: string;
    notReported: string;
    quotaLine: (params: { label: string; percent: string; resets: string }) => string;
    loginCompleted: string;
    loginFailed: (params: { detail: string }) => string;
    cancelled: string;
    questionnaireUnsupported: string;
    engineErrorFallback: string;
    /** What the person is told, once, when `/f614:stop` ends the turn on Shell's side: Codex did not answer in time (the connection is closed), or said no turn was running. */
    stopNoAnswer: string;
    stopReconnected: string;
    stopNoActiveTurn: string;
    stopNotFinished: string;
    sessionTokensLine: (params: { input: string; cached: string; output: string; lastContext: string; window: string }) => string;
    /** The three lines `/status` adds to match Codex's own: folder, work mode and conversation. */
    folderLine: (params: { path: string }) => string;
    workModeLine: (params: { mode: string }) => string;
    conversationLine: (params: { id: string }) => string;
    conversationNotStarted: string;
  };
  /**
   * What the person reads after Codex's own commands that Shell has connected (`/rename`, `/goal`, `/mcp`,
   * `/hooks`, `/usage`, `/pwd`, `/ps`, `/stop`, `/skills`, `/archive`, `/delete`, `/clear`). The commands'
   * names and descriptions are Codex's and are not translated; only Shell's own short messages are.
   */
  codexCommands: {
    renameUsage: string;
    renamed: (params: { name: string }) => string;
    archived: string;
    deletePrompt: string;
    deleteKeep: string;
    deleteConfirm: string;
    deleteKept: string;
    deleted: string;
    cleared: string;
    goalNone: string;
    goalLine: (params: { objective: string; status: string; used: string; budget: string; time: string }) => string;
    goalSet: (params: { objective: string }) => string;
    goalCleared: string;
    goalNothingToClear: string;
    mcpNone: string;
    mcpHeader: string;
    mcpServerLine: (params: { name: string; status: string; count: string }) => string;
    mcpDetailLine: (params: { version: string; auth: string; origin: string; resources: string }) => string;
    mcpToolsError: (params: { error: string }) => string;
    hooksNone: string;
    hooksHeader: string;
    hookLine: (params: { event: string; handler: string; detail: string; state: string }) => string;
    hookState: (params: { enabled: boolean; trust: string }) => string;
    usageNone: string;
    usageHeader: string;
    usageLine: (params: { label: string; value: string }) => string;
    usageLifetimeTokens: string;
    usagePeakDailyTokens: string;
    usageLongestTurn: string;
    usageCurrentStreak: string;
    usageLongestStreak: string;
    usageResetNote: string;
    pwd: (params: { path: string }) => string;
    psNone: string;
    psHeader: string;
    psLine: (params: { command: string; folder: string; pid: string }) => string;
    stopNone: string;
    stopped: string;
    skillsNone: string;
    skillsHeader: string;
    skillLine: (params: { name: string; description: string }) => string;
    /** Answer for a Codex command that only exists in Codex's own screen (keyboard, window, desktop, debug), e.g. `/theme`. */
    screenOnly: (params: { name: string }) => string;
    /** Said once when the remembered permission mode is no longer offered (e.g. Read Only on macOS) and `mode` was used instead. */
    retiredModeReplaced: (params: { mode: string }) => string;
    /** `/experimental`: the new state of the feature just switched. */
    featureState: (params: { name: string; state: string }) => string;
    stateOn: string;
    stateOff: string;
    /** `/memories`: what was saved, with Codex's own setting names. */
    memoriesSaved: (params: { use: string; generate: string }) => string;
    /** `/apps`: the browser could not be opened; the link is shown to open by hand. */
    appOpenFailed: (params: { url: string }) => string;
    /** `/review` → custom instructions: the box is prefilled with `/review ` and this says what to do. */
    reviewCustomHint: string;
  };
  /**
   * The words of the screens Shell reproduces from Codex (`/permissions`, Plan, `/review`, `/fork`, `/apps`,
   * `/experimental`, `/memories`, `/export`, `/copy`, `/diff`, `/approve`, `/feedback`, `/import`, `/plugins`),
   * taken from Codex 0.159.0's terminal app (`codex-rs/tui/src`) in English and translated into Spanish: the
   * person reads every text in Shell's language, and only the names of commands and modes stay as Codex has them.
   * Where Codex has no such text (the questions that ask before something leaves Shell or is written outside it)
   * the wording is Shell's own, in both languages.
   */
  codexNative: {
    permissionsTitle: string;
    askForApproval: string;
    askForApprovalDescription: string;
    approveForMe: string;
    approveForMeDescription: string;
    fullAccess: string;
    fullAccessDescription: string;
    permissionsUpdated: (params: { label: string }) => string;
    fullAccessTitle: string;
    fullAccessBody: string;
    fullAccessAccept: string;
    fullAccessAcceptDescription: string;
    fullAccessCancel: string;
    fullAccessCancelDescription: string;
    planModeIndicator: string;
    collaborationDisabled: string;
    collaborationDisabledHint: string;
    planUnavailable: string;
    planTitle: string;
    planYes: string;
    planYesDescription: string;
    planClear: string;
    planClearFresh: string;
    planClearUsage: (params: { label: string }) => string;
    planNo: string;
    planNoDescription: string;
    planDefaultUnavailable: string;
    planNoApprovedPlan: string;
    reviewTitle: string;
    reviewBaseBranch: string;
    reviewBaseBranchDescription: string;
    reviewUncommitted: string;
    reviewCommit: string;
    reviewCustom: string;
    reviewBranchTitle: string;
    reviewCurrentBranch: (params: { branch: string }) => string;
    reviewDetachedHead: string;
    reviewCommitTitle: string;
    reviewStarted: (params: { hint: string }) => string;
    reviewFinished: string;
    forkCreated: string;
    forkNameFailed: (params: { error: string }) => string;
    forkFailed: (params: { error: string }) => string;
    appsTitle: string;
    appsHint: string;
    appsInstalledCount: (params: { installed: number; total: number }) => string;
    appInstalled: string;
    appInstalledDisabled: string;
    appCanInstall: string;
    appManage: string;
    appInstall: string;
    appLinkUnavailable: (params: { status: string }) => string;
    appsNone: string;
    experimentalTitle: string;
    experimentalHelp: string;
    experimentalNone: string;
    experimentalUnavailable: string;
    experimentalOverridden: string;
    experimentalSaveFailed: string;
    memoriesTitle: string;
    memoriesHelp: string;
    useMemories: string;
    useMemoriesDescription: string;
    generateMemories: string;
    generateMemoriesDescription: string;
    resetMemories: string;
    resetMemoriesDescription: string;
    resetTitle: string;
    resetHelp: string;
    resetConfirmDescription: string;
    resetBack: string;
    resetBackDescription: string;
    resetDone: string;
    resetFailed: (params: { error: string }) => string;
    memoriesSaveFailed: (params: { error: string }) => string;
    memoriesOverridden: (params: { message: string }) => string;
    memoryModeFailed: (params: { error: string }) => string;
    enableMemoriesTitle: string;
    enableMemoriesSubtitle: string;
    enableYes: string;
    enableYesDescription: string;
    enableNo: string;
    enableNoDescription: string;
    memoriesEnabled: string;
    memoriesEnableOverridden: (params: { message: string }) => string;
    memoriesEnableFailed: (params: { error: string }) => string;
    overriddenFallback: string;
    exportTitle: string;
    exportHelp: string;
    exportCopy: string;
    exportCopyDescription: string;
    exportSave: string;
    exportSaveDescription: string;
    exportSaved: (params: { path: string }) => string;
    exportFailed: (params: { error: string }) => string;
    exportNoConversation: string;
    copyTitle: string;
    copyWhole: string;
    copyCode: (params: { language: string }) => string;
    copyCodeBlock: string;
    copyQuote: string;
    copyConversation: string;
    copied: (params: { label: string }) => string;
    copyFailed: (params: { error: string }) => string;
    copyNoResponse: string;
    diffNoChanges: string;
    diffNotRepo: string;
    diffFailed: (params: { error: string }) => string;
    approveNone: string;
    approveNoneHint: string;
    approveTitle: string;
    approveSelect: string;
    approveNoRationale: string;
    approveRecorded: string;
    approveRecordedHint: string;
    approveGone: string;
    denialWriteStdin: (params: { process: string; input: string }) => string;
    denialPatchOne: (params: { file: string }) => string;
    denialPatchMany: (params: { count: number }) => string;
    denialNetwork: (params: { target: string }) => string;
    denialMcp: (params: { tool: string; label: string }) => string;
    denialPermissionReason: (params: { reason: string }) => string;
    denialPermission: string;
    feedbackTitle: string;
    feedbackBug: string;
    feedbackBugDescription: string;
    feedbackBadResult: string;
    feedbackBadResultDescription: string;
    feedbackGoodResult: string;
    feedbackGoodResultDescription: string;
    feedbackSafetyCheck: string;
    feedbackSafetyCheckDescription: string;
    feedbackOther: string;
    feedbackOtherDescription: string;
    feedbackLogsTitle: string;
    feedbackLogsBody: string;
    feedbackLogsYes: string;
    feedbackLogsYesDescription: string;
    feedbackLogsNo: string;
    feedbackNoteTitle: (params: { category: string }) => string;
    feedbackNotePlaceholder: string;
    feedbackSafetyPlaceholder: string;
    feedbackDisclosure: string;
    feedbackConfirmTitle: string;
    feedbackConfirmNo: string;
    feedbackConfirmYes: string;
    feedbackSummary: (params: { category: string; note: string; logs: string; conversation: string }) => string;
    feedbackNoNote: string;
    feedbackLogsIncluded: string;
    feedbackLogsExcluded: string;
    feedbackConversationNone: string;
    feedbackCancelled: string;
    feedbackUploaded: string;
    feedbackRecordedNoLogs: string;
    feedbackIssue: string;
    feedbackMention: (params: { id: string }) => string;
    feedbackThanks: string;
    feedbackThreadId: (params: { id: string }) => string;
    feedbackFailed: (params: { error: string }) => string;
    importNone: string;
    importDetectFailed: (params: { errors: string }) => string;
    importTitle: (params: { source: string }) => string;
    importHelp: string;
    importProceed: (params: { count: number }) => string;
    importCancel: string;
    importHome: string;
    importProject: (params: { path: string }) => string;
    importNothingSelected: string;
    importConfirmTitle: string;
    importConfirmIntro: (params: { source: string }) => string;
    importConfirmWarning: (params: { source: string }) => string;
    importConfirmNo: string;
    importConfirmYes: string;
    importRoute: (params: { from: string; to: string }) => string;
    importCancelled: string;
    importStarted: string;
    importAppliesToNew: string;
    importImporting: string;
    importMoreNames: (params: { count: number }) => string;
    importRemainingOne: string;
    importRemainingMany: (params: { count: number }) => string;
    importFailed: (params: { error: string }) => string;
    importRunning: string;
    importFinished: (params: { imported: number; failed: number }) => string;
    importResultsByType: string;
    importResultLine: (params: { label: string; imported: number; failed: number }) => string;
    importRunAgain: string;
    pluginsDisabled: string;
    pluginsDisabledHint: string;
    pluginsTitle: string;
    pluginsSubtitle: string;
    pluginsBody: string;
    pluginsInstalledCount: (params: { installed: number; total: number }) => string;
    pluginsNone: string;
    pluginsLoadFailed: (params: { error: string }) => string;
    pluginStatusInstalled: string;
    pluginStatusDisabled: string;
    pluginStatusAvailable: string;
    pluginStatusNotInstallable: string;
    pluginStatusAdminAssigned: string;
    pluginDetailCanInstall: string;
    pluginDetailInstalledByAdmin: string;
    pluginDetailEnabledByAdmin: string;
    pluginDetailDisabledByAdmin: string;
    pluginTerms: string;
    pluginSourceLocal: string;
    pluginSourceRemote: (params: { marketplace: string }) => string;
    pluginAuthOnInstall: string;
    pluginAuthOnUse: string;
    pluginLineAuth: string;
    pluginLineVersion: string;
    pluginLineSkills: string;
    pluginLineHooks: string;
    pluginLineApps: string;
    pluginLineMcp: string;
    pluginNoSkills: string;
    pluginNoHooks: string;
    pluginNoApps: string;
    pluginNoMcp: string;
    pluginBack: string;
    pluginBackDescription: string;
    pluginInstall: string;
    pluginInstallDescription: string;
    pluginUninstall: string;
    pluginUninstallDescription: string;
    pluginInstalledByAdmin: string;
    pluginInstalledByAdminDescription: string;
    pluginDisabledByAdminDescription: string;
    pluginNotInstallable: string;
    pluginNoLocation: string;
    pluginNoUninstallId: string;
    pluginInstallTitle: (params: { name: string }) => string;
    pluginInstallBody: string;
    pluginInstallNo: string;
    pluginInstallYes: string;
    pluginInstallCancelled: string;
    pluginUninstallTitle: (params: { name: string }) => string;
    pluginUninstallBody: string;
    pluginUninstallNo: string;
    pluginUninstallYes: string;
    pluginUninstallCancelled: string;
    pluginInstalled: (params: { name: string }) => string;
    pluginInstalledNoAuth: string;
    pluginInstalledNeedsAuth: (params: { count: number; apps: string }) => string;
    pluginInstalledAuthHint: string;
    pluginUninstalled: (params: { name: string }) => string;
    pluginUninstalledHint: string;
    pluginInstallFailed: (params: { name: string; error: string }) => string;
    pluginUninstallFailed: (params: { name: string; error: string }) => string;
    pluginDetailFailed: (params: { error: string }) => string;
    pluginMarketplaces: string;
    pluginMarketplacesDescription: string;
    pluginMarketplacesNotConnected: string;
    /** The name of an import item's type in its list («Settings», «Recent chat sessions»), and in the summaries («Chat sessions»); an unknown type keeps its own code. */
    importItemLabel: (params: { type: string }) => string;
    importTypeLabel: (params: { type: string }) => string;
    /** `/recap`: the summary in its frame («↳ Recap: …», «Next: …») and Codex's three messages. */
    recapLine: (params: { summary: string }) => string;
    recapNextLine: (params: { action: string }) => string;
    recapEmpty: string;
    recapBusy: string;
    recapFailed: string;
    /** `/side` and `/btw`: Codex's messages when the side conversation cannot open or a command is not kept in it. */
    sideNoConversation: string;
    sideAlreadyOpen: string;
    sideReviewing: (params: { name: string }) => string;
    sideStartFailed: (params: { error: string }) => string;
    sidePrepareFailed: (params: { error: string }) => string;
    sideUnavailableCommand: (params: { name: string }) => string;
    /** Shell's own words for the side conversation on screen: the header in its view and the pieces of the fixed line in the box («Side conversation · from main thread · Ctrl+C to close»). */
    sideHeader: string;
    sideTitle: string;
    sideFromMain: string;
    sideMainNeedsApproval: string;
    sideCloseHint: string;
    /** Shell's own words for a subagent being watched, read only: the header, the pieces of the fixed line and the answer to a command that is not kept there. */
    agentHeader: (params: { name: string }) => string;
    agentTitle: (params: { name: string }) => string;
    agentReadOnly: string;
    agentReturnHint: string;
    agentUnavailableCommand: (params: { name: string }) => string;
    /** `/subagents`: Codex's picker, its «Enable subagents?» question and how saving went; the state words and the line about writing to `~/.codex` are Shell's own. */
    subagentsTitle: string;
    subagentsSubtitle: string;
    subagentMain: string;
    subagentAgent: string;
    subagentRunning: string;
    subagentIdle: string;
    subagentClosed: string;
    subagentsNone: string;
    subagentOpenFailed: (params: { error: string }) => string;
    subagentsEnableTitle: string;
    subagentsEnableSubtitle: string;
    subagentsEnableYesDescription: string;
    subagentsEnableNoDescription: string;
    subagentsEnableWrites: string;
    subagentsEnabled: string;
    subagentsEnableOverridden: (params: { message: string }) => string;
    subagentsEnableFailed: (params: { error: string }) => string;
    /** `/agents` with the embedded server: Codex's «Shared agents unavailable», and Shell's line saying it does not start that server. */
    agentsUnavailableTitle: string;
    agentsUnavailableSubtitle: string;
    agentsNoServer: string;
  };
  /**
   * The permission question (its two words and its footer) and the plain-language text of a permission request
   * (`engines/permission-text.ts`). The names of tools, servers and commands, and any text the assistant itself wrote
   * (a Bash `description`, Codex's `reason`), are never part of these: they go in as they came.
   */
  permission: {
    question: string;
    yes: string;
    no: string;
    footer: string;
    folder: string;
    file: string;
    files: string;
    inPlace: string;
    pattern: string;
    search: string;
    address: string;
    text: string;
    filter: string;
    runCommand: string;
    editFile: string;
    writeFile: string;
    editNotebook: string;
    createFile: string;
    deleteFile: string;
    readFile: string;
    findFiles: string;
    searchText: string;
    fetchPage: string;
    searchWeb: string;
    mcpTool: (params: { tool: string; server: string }) => string;
    genericTool: (params: { tool: string }) => string;
    editFiles: (params: { count: number }) => string;
    createFiles: (params: { count: number }) => string;
    deleteFiles: (params: { count: number }) => string;
    changeFiles: (params: { count: number }) => string;
    changeFilesUnknown: string;
    kindAdd: string;
    kindDelete: string;
    kindUpdate: string;
    movedTo: (params: { path: string }) => string;
    andMore: (params: { count: number }) => string;
  };
  codexChat: {
    compacted: string;
    /** The status line while `/compact` runs, as Codex words it: title, then detail, then the time. */
    compactingTitle: string;
    compactingDetail: string;
    /** The status line while `/recap` waits, as Codex words its loading line («Generating conversation recap»). */
    recapLoadingTitle: string;
    /** Honest answer for a `/command` Shell cannot pass on to Codex through its app-server. */
    commandNotAllowed: (params: { name: string }) => string;
    workOrLoginActive: string;
    cancellationRequested: string;
    logoutUnavailable: string;
    selectedModel: (params: { model: string }) => string;
    useLoginForCatalog: string;
    noSessionsFound: string;
    chooseSessionOrId: string;
    waitForEngine: string;
    connectionFailed: (params: { message: string }) => string;
    refreshNotAvailable: string;
    waitForCurrentOperationToFinish: string;
    toolFallbackTitle: string;
    toolFallbackDetail: string;
  };
}
