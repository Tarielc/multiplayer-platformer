export type DeathCause = 'hazard' | 'fall' | 'dev' | 'trap' | 'crush' | 'ability';

/** Discrete things that happened during simulation; broadcast with snapshots for FX/HUD. */
export type GameEvent =
  | { type: 'collect'; playerId: string; entityId: number; kind: string; value: number }
  | { type: 'death'; playerId: string; cause: DeathCause; x: number; y: number }
  | { type: 'respawn'; playerId: string }
  | { type: 'checkpoint'; playerId: string; checkpointId: number }
  | { type: 'levelComplete' }
  /** A trap cost a heart (`hp` left). `side`: where the player touched it (spike-head squash). */
  | { type: 'trapHit'; playerId: string; trapId: number; hp: number; side: 'up' | 'down' | 'left' | 'right' }
  /** A trampoline launched a player. */
  | { type: 'bounce'; playerId: string; trapId: number }
  /** A box was hit (by a swing or a stomp); `broken` on the last hit. */
  | { type: 'boxHit'; playerId: string; boxId: number; hits: number; broken: boolean }
  /** A special ability got going (sound, HUD). */
  | { type: 'special'; playerId: string; ability: number }
  /** Bunny Man's kiss landed: `targetId` (or nobody) and the healer got hearts back. */
  | { type: 'heal'; playerId: string; targetId: string | null; x: number; y: number }
  /** A claw or tongue caught a player (`targetId`) or a box (`boxId`). */
  | { type: 'grab'; playerId: string; targetId: string | null; boxId: number | null }
  /** The claw let go / the frog spat (`spit`) what it held. */
  | { type: 'release'; playerId: string; spit: boolean; x: number; y: number }
  /** An ability hurt a player: giant swing or a spat projectile. */
  | { type: 'abilityHit'; playerId: string; by: string; hp: number; x: number; y: number }
  /** A carried or spat box shattered. */
  | { type: 'propBreak'; boxId: number; variant: 1 | 2 | 3; x: number; y: number };
