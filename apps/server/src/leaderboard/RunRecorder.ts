import type { CharacterId, GameMode, LeaderboardEntry, RunKind, RunRecordInfo } from '@platformer/shared';

/** One finished run, as the room hands it to the recorder. */
export interface RunInput {
  kind: RunKind;
  mode: GameMode;
  /** `null` for a campaign run. */
  levelId: string | null;
  /** Level checksum, or `campaignChecksum()` of the levels played: old map versions drop off the boards. */
  checksum: string;
  timeMs: number;
  /** Room player ids the run belongs to (echoed back in `RunRecordInfo`, never stored). */
  playerIds: string[];
  names: string[];
  characters: CharacterId[];
  /** Players in the room when the run ended (1 = solo). */
  playerCount: number;
  deaths: number;
  roomId: string;
}

export interface BoardQuery {
  kind: RunKind;
  mode: GameMode;
  levelId: string | null;
  checksum: string;
  /** Only runs played alone. */
  solo: boolean;
  limit: number;
}

/**
 * Where fastest runs are kept. The room calls `record` when a level or campaign ends; it never
 * waits on it inside the tick, and failures resolve to "nothing recorded" rather than throwing.
 */
export interface RunRecorder {
  readonly enabled: boolean;
  record(runs: readonly RunInput[]): Promise<RunRecordInfo[]>;
  board(query: BoardQuery): Promise<LeaderboardEntry[]>;
  close(): Promise<void>;
}

/** Used when no database is configured: the game runs, the leaderboard is off. */
export class NullRunRecorder implements RunRecorder {
  readonly enabled = false;
  async record(): Promise<RunRecordInfo[]> {
    return [];
  }
  async board(): Promise<LeaderboardEntry[]> {
    return [];
  }
  async close(): Promise<void> {}
}
