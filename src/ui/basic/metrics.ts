import { accent, border, fit } from "./theme.ts";

export function usageTitle(label: string): string {
  const names: Record<string, string> = { five_hour: "5-hour limit", seven_day: "Weekly limit", seven_day_opus: "Weekly · Opus", seven_day_sonnet: "Weekly · Sonnet", seven_day_oauth_apps: "Weekly · connected apps", extra_usage: "Extra usage" };
  return names[label] ?? (label.includes("_") ? label.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase()) + " (provider)" : label);
}

/** Provider-internal buckets are not stable user-facing plan limits. */
export function isDisplayableUsage(label: string): boolean {
  return label !== "nimbus_quill";
}
export function resetLabel(reset?: string, now = Date.now()): string {
  if (!reset) return "Reset time unavailable";
  if (/^\d+[dhm](\s+\d+[dhm])*$/.test(reset)) return `Resets in ${reset}`;
  const timestamp = Date.parse(reset);
  if (!Number.isFinite(timestamp)) return "Reset time unavailable";
  const minutes = Math.ceil((timestamp - now) / 60000);
  if (minutes <= 0) return "Awaiting updated limit";
  if (minutes >= 1440) return `Resets in ${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h`;
  if (minutes >= 60) return `Resets in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `Resets in ${minutes}m`;
}
export function progressBar(percent: number, width: number): string {
  const cells = Math.max(1, Math.floor(width));
  const used = Math.max(0, Math.min(cells, Math.round(percent / 100 * cells)));
  return accent("█".repeat(used)) + border("░".repeat(cells - used));
}

/** Braille cells make a portable terminal ring without image-protocol support. */
export function contextRing(percent: number): string[] {
  const bits = [[1, 8], [2, 16], [4, 32], [64, 128]];
  return Array.from({ length: 6 }, (_, row) => {
    const cells: string[] = [];
    for (let col = 0; col < 12; col++) {
      let mask = 0, filled = 0;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) {
        const dx = (col * 2 + x - 11.5) / 11, dy = (row * 4 + y - 11.5) / 11;
        const radius = Math.hypot(dx, dy);
        if (radius < 0.72 || radius > 1) continue;
        mask |= bits[y]![x]!;
        const angle = (Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2);
        if (angle / (Math.PI * 2) < Math.max(0, Math.min(100, percent)) / 100) filled++;
      }
      cells.push((filled ? accent : border)(String.fromCharCode(0x2800 + mask)));
    }
    if (row === 2) {
      const label = `${Math.round(percent)}%`;
      cells.splice(3, 6, fit(" ".repeat(Math.max(0, Math.floor((6 - label.length) / 2))) + accent(label), 6));
    }
    return cells.join("");
  });
}
