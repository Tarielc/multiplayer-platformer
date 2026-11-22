import type { NetPlayerPatch, NetPlayerState, NetWorldState } from './state';

/** Fields compared for player deltas (everything except `id`). */
const PLAYER_FIELDS = [
  'x',
  'y',
  'vx',
  'vy',
  'facing',
  'grounded',
  'jumpHeld',
  'jumping',
  'coyote',
  'buffer',
  'drop',
  'alive',
  'respawnIn',
  'score',
  'deaths',
  'atExit',
  'checkpointId',
  'tp',
  'ack',
] as const satisfies readonly (keyof NetPlayerState)[];

export interface WorldDelta {
  /** New players (complete objects) or changed fields of existing ones. */
  upserts: NetPlayerPatch[];
  removed: string[];
  /** Collectible ids picked up since the base state. */
  collected: number[];
}

/**
 * Field-level diff between two world states. Safe to apply against the previous broadcast
 * because WebSockets deliver every message, in order.
 */
export function diffWorld(prev: NetWorldState, next: NetWorldState): WorldDelta {
  const previous = new Map(prev.players.map((p) => [p.id, p]));
  const upserts: NetPlayerPatch[] = [];
  for (const player of next.players) {
    const old = previous.get(player.id);
    previous.delete(player.id);
    if (!old) {
      upserts.push({ ...player });
      continue;
    }
    const patch: Record<string, unknown> = { id: player.id };
    let changed = false;
    for (const field of PLAYER_FIELDS) {
      if (old[field] !== player[field]) {
        patch[field] = player[field];
        changed = true;
      }
    }
    if (changed) upserts.push(patch as NetPlayerPatch);
  }
  const seen = new Set(prev.collected);
  return {
    upserts,
    removed: [...previous.keys()],
    collected: next.collected.filter((id) => !seen.has(id)),
  };
}

export function isDeltaEmpty(delta: WorldDelta): boolean {
  return delta.upserts.length === 0 && delta.removed.length === 0 && delta.collected.length === 0;
}

/** Rebuilds the full state at `tick` from a base state and a delta. Returns a new object. */
export function applyWorldDelta(base: NetWorldState, tick: number, delta: WorldDelta): NetWorldState {
  const players = new Map(base.players.map((p) => [p.id, p]));
  for (const id of delta.removed) players.delete(id);
  for (const patch of delta.upserts) {
    const old = players.get(patch.id);
    players.set(patch.id, old ? { ...old, ...patch } : (patch as NetPlayerState));
  }
  const collected = delta.collected.length
    ? [...base.collected, ...delta.collected].sort((a, b) => a - b)
    : base.collected;
  return { tick, players: [...players.values()], collected };
}
