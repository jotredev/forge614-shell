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
  | "claude-turn-busy"
  | "claude-turn-already-running"
  | "claude-no-result"
  | "codex-mode-unknown"
  | "codex-refresh-requires-login"
  | "codex-login-not-managed"
  | "codex-turn-busy"
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
  | "codex-turn-failed"
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
    confirmPrompt: (params: { engine: string }) => string;
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
    noEnginesFound: string;
  };
  /** Shared between the Claude and Codex chat UIs — the wording is identical in both today. */
  chat: {
    genericCommandLabel: string;
    commandSelectModel: string;
    commandSelectReasoning: string;
    commandChatHistory: string;
    commandNewConversation: string;
    commandConnectAccount: string;
    commandDisconnectLocally: string;
    commandSessionDetails: string;
    commandCancelActiveTurn: string;
    commandRefreshPlanUsage: string;
    commandBrowseCommands: string;
    commandExitShell: string;
    permissionRequestedTitle: string;
    permissionInlineLegend: string;
    awaitingPermission: string;
    permissionFooter: string;
    denyLabel: string;
    allowOnceLabel: string;
    noPermissionPending: string;
    answerPendingPermissionFirst: string;
    unknownCommand: (params: { name: string }) => string;
    statusWorking: string;
    statusReady: string;
    statusConnectWithLogin: string;
    waitForCurrentOperation: string;
    turnAlreadyRunning: string;
    reconnectBeforeMessage: string;
    errorPrefixed: (params: { message: string }) => string;
    turnStopped: (params: { message: string }) => string;
    resumeUseNumber: string;
    noSessionsFound: string;
    quitConfirmActiveWork: string;
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
  };
  workMode: {
    bypassPermissionsOn: string;
    bypassPermissionsHelp: string;
    autoModeOn: string;
    autoModeHelp: string;
    manualModeOn: string;
    manualModeHelp: string;
    acceptEditsOn: string;
    acceptEditsHelp: string;
    planModeOn: string;
    planModeHelp: string;
    dontAskModeOn: string;
    dontAskModeHelp: string;
    readOnly: string;
    workspaceWrite: string;
    manualModeOnWithSandbox: (params: { sandbox: string }) => string;
    manualModeApprovalHelp: string;
    autoModeOnWithSandbox: (params: { sandbox: string }) => string;
    trustedWorkspaceHelp: string;
    engineMode: string;
    shiftTabToCycle: string;
  };
  claudeChat: {
    cliOptionsUnsupported: string;
    requiresInteractiveTerminal: string;
    catalogLoadFailed: string;
    permissionTooLarge: (params: { tool: string }) => string;
    questionnaireUnsupported: string;
    claudeError: (params: { message: string }) => string;
    finishOrStopFirst: string;
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
    resumeInstruction: string;
    noClaudeSessionsFound: string;
    useResumeFirst: string;
    usageUnavailable: string;
    couldNotVerifyAccount: string;
    statusCheckingAccount: string;
    toolRequested: string;
    toolRunning: (params: { seconds: number }) => string;
    toolCompleted: (params: { seconds: string }) => string;
    toolFailed: (params: { seconds: string }) => string;
  };
  telemetry: {
    notReported: string;
    modelLine: (params: { model: string; effort: string }) => string;
    effortNone: string;
    tokensLine: (params: { input: string; output: string; cacheRead: string; cacheWrite: string }) => string;
    contextLine: (params: { used: string; window: string }) => string;
    costLine: (params: { estimate: string }) => string;
    quotaLine: (params: { key: string; used: string; status: string; resets: string }) => string;
    percentUsed: (params: { percent: number }) => string;
    extraUsageActive: string;
  };
  chatRoles: {
    you: string;
    assistant: string;
    system: string;
  };
  jumpToLatest: {
    label: string;
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
    usageProviderSuffix: string;
    resetTimeUnavailable: string;
    resetsIn: (params: { time: string }) => string;
    awaitingUpdatedLimit: string;
  };
  sidebar: {
    refreshNotSupported: string;
    connectFirst: string;
    usageUpdated: string;
    refreshFailed: string;
    checking: string;
    unverified: string;
    disconnected: string;
    loginToConnect: string;
    checkingNativeAccount: string;
    headingSession: string;
    headingContext: string;
    headingPlanUsage: string;
    headingResources: string;
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
    measurementUnavailable: string;
    availableAfterFirstResponse: string;
    usageUnavailable: string;
    fieldLastTurn: string;
    tokensIn: string;
    tokensOut: string;
    fieldEstimatedCost: string;
    referenceOnlyNotBilled: string;
    fieldShellRam: string;
    fieldEngineRam: string;
    notReportedByEngine: string;
  };
  statusBar: {
    checkingAccount: string;
    accountUnverified: string;
    disconnected: string;
    detachedHead: string;
    changes: (params: { count: number }) => string;
    clean: string;
  };
  backgroundActivity: {
    heading: string;
    running: string;
    done: string;
    failed: string;
    idle: string;
    notReportedByEngine: string;
    elapsedSeconds: (params: { seconds: number }) => string;
    elapsedMinutes: (params: { minutes: number }) => string;
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
    sessionTokensLine: (params: { input: string; cached: string; output: string; lastContext: string; window: string }) => string;
  };
  codexChat: {
    workOrLoginActive: string;
    cancellationRequested: string;
    logoutUnavailable: string;
    selectedModel: (params: { model: string }) => string;
    useLoginForCatalog: string;
    noReasoningOptionsForModel: string;
    resumeInstruction: string;
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
