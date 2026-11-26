import type { CharacterId } from '../config/characters';
import type { GameMode } from '../config/modes';

/**
 * Fastest-runs leaderboard. Runs are recorded by the game server itself when a level (or a
 * whole campaign) ends, so times are server-authoritative; clients only read the boards.
 */

/** `level`: one level's time. `campaign`: total time of a campaign played from its first level. */
export type RunKind = 'level' | 'campaign';

/** Max entries a single board request may return. */
export const LEADERBOARD_MAX_LIMIT = 50;
/** Ranks past this are reported as `null` ("unranked") on the results screen. */
export const LEADERBOARD_RANK_CAP = 100;

export interface LeaderboardEntry {
  /** 1-based place on this board (each entrant appears once, with their best time). */
  rank: number;
  /** Race: the player's name. Co-op: every team member. */
  names: string[];
  characters: CharacterId[];
  timeMs: number;
  /** Players in the room when the run was set (1 = solo). */
  playerCount: number;
  deaths: number;
  /** ISO timestamp. */
  createdAt: string;
}

export interface LeaderboardBoard {
  /** `null` for the campaign board. */
  levelId: string | null;
  name: string;
  entries: LeaderboardEntry[];
}

/** `GET /leaderboard?mode=race|coop&solo=0|1&limit=N` */
export type LeaderboardResponse =
  | { enabled: false }
  | {
      enabled: true;
      mode: GameMode;
      solo: boolean;
      campaign: LeaderboardBoard;
      levels: LeaderboardBoard[];
    };

/** How a run that just ended placed; sent to the room in `RoomInfo.records`. */
export interface RunRecordInfo {
  kind: RunKind;
  levelId: string | null;
  /** Players the record belongs to (one in race, the whole team in co-op). */
  playerIds: string[];
  timeMs: number;
  /** Place on the all-players board; `null` past `LEADERBOARD_RANK_CAP`. */
  rank: number | null;
  /** Faster than this entrant's previous best (or their first time on the board). */
  personalBest: boolean;
  /** New #1 on the all-players board. */
  worldRecord: boolean;
}
