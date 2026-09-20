/** Confirmed decisions for `forge614-shell init --product engram`, ready to apply via Engram's public CLI. */
export interface EngramInitDecisions {
  readonly postgresUrl: string | null;
  readonly reinforcement: boolean;
}
