/** A Forge614 Engines result that Shell can start in its current chat workspace. */
export interface AvailableEngine {
  id: "claude" | "codex";
  label: string;
  executable: string;
}
