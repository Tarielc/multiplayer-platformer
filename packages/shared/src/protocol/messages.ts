import type { CharacterId } from '../config/characters';
import type { GameMode } from '../config/modes';
import type { GameEvent } from '../sim/events';
import type { RunRecordInfo } from './leaderboard';
import type { NetFoeState, NetShotState } from '../sim/foes/types';
import type { NetTrapState } from '../sim/traps/types';
import type { NetPlayerPatch, NetPropState, NetWorldState } from './state';

/** `levelFailed`: a co-op team wipe; after a short pause the same level starts over. */
export type RoomPhase = 'lobby' | 'countdown' | 'playing' | 'levelComplete' | 'levelFailed';

export interface RoomPlayerInfo {
  id: string;
  name: string;
  slot: number;
  ready: boolean;
  connected: boolean;
  isHost: boolean;
  menuOpen: boolean;
  /** Score banked from completed levels this campaign. */
  campaignScore: number;
  /** Playable character (unique per room while there are enough characters). */
  characterId: CharacterId;
}

export interface RoomLevelInfo {
  id: string;
  name: string;
  /** `levelChecksum()` of the server's parse; clients compare against their own. */
  checksum: string;
  /** Increments for every new world (level start / restart). */
  run: number;
}

export interface LevelResult {
  playerId: string;
  name: string;
  slot: number;
  score: number;
  collected: number;
  deaths: number;
  /** Race: finishing place (1-based); `null` if they didn't finish in time (or in co-op). */
  place: number | null;
  /** Race: time to the trophy; `null` without a place. Co-op: the team's time for the level. */
  timeMs: number | null;
  /** Race: campaign points for the place (`racePoints`), added to `campaignScore` with `score`. */
  placePoints: number;
}

export interface RoomInfo {
  roomId: string;
  phase: RoomPhase;
  hostId: string | null;
  maxPlayers: number;
  players: RoomPlayerInfo[];
  /** Game mode the host picked in the lobby (kept for the whole campaign). */
  mode: GameMode;
  /** Level the host picked in the lobby. */
  selectedLevelId: string;
  /** Level currently loaded (countdown / playing / levelComplete). */
  level: RoomLevelInfo | null;
  /** True while every connected player has the pause menu open. */
  paused: boolean;
  /** Remaining time of the current countdown or results screen when this was sent. */
  countdownMs: number;
  /** Race: time left for the others after the first finish, when this was sent; `null` before. */
  raceEndsInMs: number | null;
  /**
   * Co-op: the team size the running level's foes were scaled for (counted when it started;
   * `modeFoes(mode, scaledFor)` gives the tuning). `null` when nothing is scaled (race, lobby).
   */
  scaledFor: number | null;
  results: LevelResult[] | null;
  /**
   * Leaderboard placings for the level that just ended (and the campaign, after its last level).
   * Filled in shortly after `results` once the database answers; `null` when nothing was recorded.
   */
  records: RunRecordInfo[] | null;
  nextLevelId: string | null;
  /** Set when returning to the lobby after the final level. */
  campaignComplete: boolean;
  devCommands: boolean;
}

export type DevCommand = 'skipLevel' | 'respawn';
export const DEV_COMMANDS: readonly DevCommand[] = ['skipLevel', 'respawn'];

/** Messages sent by browsers / bots. Everything here is untrusted: see `parseClientMessage`. */
export type ClientMessage =
  | {
      t: 'join';
      protocol: number;
      roomId: string;
      name: string;
      clientId: string;
      /** Preferred character; the server picks the next free one if it is taken. */
      characterId?: CharacterId;
    }
  | { t: 'ready'; ready: boolean }
  | { t: 'selectCharacter'; characterId: CharacterId }
  | { t: 'selectLevel'; levelId: string }
  | { t: 'selectMode'; mode: GameMode }
  | { t: 'input'; seq: number; buttons: number }
  | { t: 'menu'; open: boolean }
  | { t: 'ping'; id: number; at: number }
  | { t: 'leave' }
  | { t: 'resync' }
  | { t: 'dev'; cmd: DevCommand };

export type ErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'ROOM_IN_PROGRESS'
  | 'PROTOCOL_MISMATCH'
  | 'BAD_REQUEST'
  | 'NOT_ALLOWED'
  | 'REPLACED'
  | 'SERVER_FULL'
  | 'SERVER_SHUTDOWN';

export type ServerMessage =
  | {
      t: 'welcome';
      protocol: number;
      roomId: string;
      playerId: string;
      slot: number;
      /** True when the server re-attached an existing player (refresh / reconnect). */
      rejoined: boolean;
      tickRate: number;
      snapshotRate: number;
    }
  | { t: 'room'; room: RoomInfo }
  | { t: 'snapshot'; run: number; tick: number; state: NetWorldState; events: GameEvent[] }
  | {
      t: 'delta';
      run: number;
      tick: number;
      baseTick: number;
      upserts: NetPlayerPatch[];
      removed: string[];
      collected: number[];
      /** Only present when the trap state changed. */
      traps?: NetTrapState[];
      /** Only present when the props changed. */
      props?: NetPropState[];
      /** Only present when the foes changed. */
      foes?: NetFoeState[];
      /** Only present when the shots changed. */
      shots?: NetShotState[];
      events: GameEvent[];
    }
  | { t: 'pong'; id: number; at: number; serverTick: number }
  | { t: 'error'; code: ErrorCode; message: string };

export type ClientMessageOf<T extends ClientMessage['t']> = Extract<ClientMessage, { t: T }>;
export type ServerMessageOf<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;

/** WebSocket close codes used by the server (4000-4999 are application-defined). */
export const CloseCode = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  REPLACED: 4001,
  REJECTED: 4002,
  PROTOCOL: 4003,
  ABUSE: 4004,
  SHUTDOWN: 4005,
} as const;
