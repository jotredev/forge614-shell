import { expect, test } from "bun:test";
import { getCatalog } from "./index.ts";
import type { Locale } from "./index.ts";

/**
 * Every text of a catalog with the path that reaches it. A function entry is rendered with placeholder parameters
 * («<name>», «<command>»…), so the command names written inside templates are read too, not only the plain strings.
 */
function catalogTexts(locale: Locale): { path: string; text: string }[] {
  const found: { path: string; text: string }[] = [];
  const params = new Proxy({}, { get: (_target, key) => `<${String(key)}>` });
  const visit = (value: unknown, path: string) => {
    if (typeof value === "string") found.push({ path, text: value });
    else if (typeof value === "function") found.push({ path, text: String(value(params)) });
    else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) visit(child, path ? `${path}.${key}` : key);
  };
  visit(getCatalog(locale), "");
  return found;
}

/** A command name written with its slash and no prefix in front of it (`/login`, but not `/f614:login`, a path or a word before the slash). */
const bare = (name: string) => new RegExp(`(?<![\\w:/.-])/${name}(?![\\w:-])`);

/** Names that belonged to Shell without a prefix and that no assistant has under that name: after 1.12.0 they exist only as `/f614:<name>` (or are gone). */
const RETIRED_BARE_NAMES = ["refresh", "yes", "no", "commands", "help", "thinking", "forge614-status", "quit!", "exit!"];

/** The texts that may still say `/login` on its own: Claude Code's own command, named by Claude-only texts (with Codex it is `/f614:login`). */
const CLAUDE_ONLY_LOGIN_TEXTS = [
  "chat.reconnectBeforeMessage", "claudeChat.couldNotVerifyAccount", "claudeChat.disconnectedLocally", "claudeChat.loginNotVerified",
  "cli.help", "errors.claude-login-required", "errors.claude-subscription-required",
];

/** The Codex-only texts that send the person to sign in: they name Shell's `/f614:login` because Codex has no `/login` of its own. */
const CODEX_LOGIN_TEXTS = [
  "codexChat.useLoginForCatalog", "codexSession.chatgptLoginRequired", "codexSession.disconnectedLocally", "codexSession.disconnectedShort",
  "codexSession.disconnectedStatus", "codexSession.notLoggedIn", "errors.codex-refresh-requires-login",
  "errors.codex-requires-login-no-fallback", "errors.codex-requires-login-to-send",
];

/** The only names Shell owns after 1.12.0; a text naming any other `/f614:` command names something that does not exist. */
const SHELL_COMMANDS = ["commands", "help", "login", "no", "quit", "refresh", "status", "stop", "yes"];

for (const locale of ["en", "es"] as const) {
  /**
   * The check behind the owner's rule «only each assistant's own commands go without a prefix»: no catalog text (English or
   * Spanish, plain or template) may name a Shell command as `/refresh`, `/yes`, `/help`, `/quit!`…. It exists because every
   * message that told the person which command to type had the old bare name, and a new text is easy to write the old way.
   */
  test(`no ${locale} text names a retired unprefixed Shell command`, () => {
    for (const name of RETIRED_BARE_NAMES) {
      expect(catalogTexts(locale).filter(item => bare(name).test(item.text)).map(item => item.path), `/${name}`).toEqual([]);
    }
  });

  /**
   * `/login` is Claude Code's own command, so only Claude-only texts may say it bare; every other text that mentions it
   * (the shared ones fill in the right command per assistant, the Codex ones say `/f614:login`).
   */
  test(`in ${locale} only Claude-only texts say /login without a prefix, and the Codex ones say /f614:login`, () => {
    const texts = catalogTexts(locale);
    expect(texts.filter(item => bare("login").test(item.text)).map(item => item.path).sort()).toEqual(CLAUDE_ONLY_LOGIN_TEXTS);
    expect(texts.filter(item => item.text.includes("/f614:login") && CODEX_LOGIN_TEXTS.includes(item.path)).map(item => item.path).sort()).toEqual(CODEX_LOGIN_TEXTS);
  });

  /**
 * The four texts that tell the person how to leave while work is in progress. `/quit` is the assistant's own command and refuses
 * in that very situation, so the way out is Shell's `/f614:quit`; a text that says plain `/quit` would send the person in circles.
 */
for (const locale of ["en", "es"] as const) {
  test(`in ${locale} the texts about leaving while work runs name /f614:quit and never a plain /quit`, () => {
    const texts = catalogTexts(locale).filter(item => ["chat.quitConfirmActiveWork", "claudeChat.workOrAuthActive", "codexChat.workOrLoginActive", "codexChat.cancellationRequested"].includes(item.path));
    expect(texts.map(item => item.path).sort()).toEqual(["chat.quitConfirmActiveWork", "claudeChat.workOrAuthActive", "codexChat.cancellationRequested", "codexChat.workOrLoginActive"]);
    for (const item of texts) {
      expect(item.text, item.path).toContain("/f614:quit");
      expect(bare("quit").test(item.text), item.path).toBe(false);
    }
  });
}

/** A `/f614:` name in a text must be one of Shell's real commands, so a typo or a command that was removed cannot reach the person. */
  test(`every /f614: command named in ${locale} texts is a command Shell has`, () => {
    const named = new Set<string>();
    for (const item of catalogTexts(locale)) for (const match of item.text.matchAll(/\/f614:([a-z]+)/g)) named.add(match[1]!);
    expect([...named].filter(name => !SHELL_COMMANDS.includes(name))).toEqual([]);
    // Not empty: the texts do send the person to Shell's commands, so the check above is looking at something.
    expect(named.has("quit") && named.has("login") && named.has("help")).toBe(true);
  });
}

/**
 * `--help` is the first place a person reads the commands: it says which ones are the assistant's own (as in its terminal) and
 * which are Shell's, all with the `/f614:` prefix and nothing left of the old names.
 */
test("--help names Shell's commands with /f614: in both languages", () => {
  for (const locale of ["en", "es"] as const) {
    const help = getCatalog(locale).cli.help({ version: "9.9.9" });
    for (const name of ["login", "status", "refresh", "stop", "quit", "commands", "help"]) expect(help, `${locale} /f614:${name}`).toContain(`/f614:${name}`);
    for (const name of RETIRED_BARE_NAMES) expect(bare(name).test(help), `${locale} /${name}`).toBe(false);
  }
});
