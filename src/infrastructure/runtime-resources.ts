/** Runtime measurements owned by this Forge614 Shell process. */
export type RuntimeResources = { shellRssBytes: number };

export function readRuntimeResources(): RuntimeResources {
  return { shellRssBytes: process.memoryUsage().rss };
}

export function formatMemory(bytes: number): string {
  const mebibytes = Math.max(0, bytes) / (1024 * 1024);
  if (mebibytes < 1024) return `${Math.round(mebibytes)} MB`;
  return `${(mebibytes / 1024).toFixed(1)} GB`;
}

export function homeRelativePath(value: string, home = process.env.HOME): string {
  if (!home || (value !== home && !value.startsWith(`${home}/`))) return value;
  return `~${value.slice(home.length)}`;
}
