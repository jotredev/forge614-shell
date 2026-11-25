/** A Forge614 Engines result that Shell can start in its current chat workspace. */
export interface AvailableEngine {
  id: "claude" | "codex" | "antigravity";
  label: string;
  executable: string;
}
