export type DeathCause = 'hazard' | 'fall' | 'dev' | 'trap' | 'crush';

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
  | { type: 'boxHit'; playerId: string; boxId: number; hits: number; broken: boolean };
