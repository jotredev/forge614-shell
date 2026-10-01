/** The path with the home folder written as «~» (the path unchanged when it is not inside it). */
export function homeRelativePath(value: string, home = process.env.HOME): string {
  if (!home || (value !== home && !value.startsWith(`${home}/`))) return value;
  return `~${value.slice(home.length)}`;
}
