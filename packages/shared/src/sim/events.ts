import type { FoeKind } from '../config/foes';

export type DeathCause = 'hazard' | 'fall' | 'dev' | 'trap' | 'crush' | 'ability' | 'foe';

/** Discrete things that happened during simulation; broadcast with snapshots for FX/HUD. */
export type GameEvent =
  /** `recharged`: seconds the pickup took off the collector's special cooldown (0: none). */
  | { type: 'collect'; playerId: string; entityId: number; kind: string; value: number; recharged: number }
  | { type: 'death'; playerId: string; cause: DeathCause; x: number; y: number }
  | { type: 'respawn'; playerId: string }
  | { type: 'checkpoint'; playerId: string; checkpointId: number }
  | { type: 'levelComplete' }
  /** Race: a player reached the trophy in `place` (1-based), `timeMs` after the level started. */
  | { type: 'finish'; playerId: string; place: number; timeMs: number; x: number; y: number }
  /** A trap cost a heart (`hp` left). `side`: where the player touched it (spike-head squash). */
  | { type: 'trapHit'; playerId: string; trapId: number; hp: number; side: 'up' | 'down' | 'left' | 'right' }
  /** A trampoline launched a player. */
  | { type: 'bounce'; playerId: string; trapId: number }
  /** A box was hit (by a swing or something thrown at it); `broken` on the last hit. */
  | { type: 'boxHit'; playerId: string; boxId: number; hits: number; broken: boolean }
  /** A special ability got going (sound, HUD). */
  | { type: 'special'; playerId: string; ability: number }
  /** Bunny Man's kiss landed: `targetId` (or nobody) and the healer got hearts back. */
  | { type: 'heal'; playerId: string; targetId: string | null; x: number; y: number }
  /** A claw or tongue caught a player (`targetId`), a box (`boxId`) or a foe (`foeId`). */
  | { type: 'grab'; playerId: string; targetId: string | null; boxId: number | null; foeId: number | null }
  /** The claw let go / the frog spat (`spit`) what it held. */
  | { type: 'release'; playerId: string; spit: boolean; x: number; y: number }
  /** An ability hurt a player: giant swing or a spat projectile. */
  | { type: 'abilityHit'; playerId: string; by: string; hp: number; x: number; y: number }
  /** A carried or spat box shattered. */
  | { type: 'propBreak'; boxId: number; variant: 1 | 2 | 3; x: number; y: number }
  /** A foe (or its stinger / banana) cost a player a heart (`hp` left). */
  | { type: 'foeHit'; playerId: string; foeId: number; hp: number; x: number; y: number }
  /**
   * A player hurt a foe: a swing, a stomp (`stomp`), or something the frog spat (`spit`; the
   * frog is `playerId`, '' if they left). `hp` 0: it is beaten, and `score` points went to that player;
   * `recharged`: the seconds that took off their special cooldown (0: none).
   * `blocked`: its armour took the hit (the rhino boss, unless dazed), `hp` unchanged.
   */
  | {
      type: 'foeHurt';
      playerId: string;
      foeId: number;
      kind: FoeKind;
      hp: number;
      blocked: boolean;
      stomp: boolean;
      spit: boolean;
      score: number;
      recharged: number;
      x: number;
      y: number;
    }
  /** A swing knocked a stinger or a banana out of the air. */
  | { type: 'parry'; playerId: string; x: number; y: number };
