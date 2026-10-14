/**
 * Whether what the person sent is a command (`/help`, `/f614:quit`, `/model opus`) and not a message. Text that starts with «/» is a command, except when it is a path: a command name never has another «/», so if the
 * first word does — `/var/folders/…/orca-paste-….png`, which is how Orca pastes a screenshot, or `/Users/ana/captura.png mira esto` — the whole text is an ordinary message for the agent, whether or not the file exists.
 */
export function isCommandText(text: string): boolean {
  if (!text.startsWith("/")) return false;
  const firstWord = text.split(/\s/, 1)[0]!;
  return !firstWord.slice(1).includes("/");
}
