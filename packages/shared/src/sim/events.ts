export type DeathCause = 'hazard' | 'fall' | 'dev';

/** Discrete things that happened during simulation; broadcast with snapshots for FX/HUD. */
export type GameEvent =
  | { type: 'collect'; playerId: string; entityId: number; kind: string; value: number }
  | { type: 'death'; playerId: string; cause: DeathCause; x: number; y: number }
  | { type: 'respawn'; playerId: string }
  | { type: 'checkpoint'; playerId: string; checkpointId: number }
  | { type: 'levelComplete' };
