import type { NetTrapState } from '../sim/traps/types';
import type { NetPlayerPatch, NetPlayerState, NetPropState, NetWorldState } from './state';

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
  'airJumpsLeft',
  'alive',
  'respawnIn',
  'score',
  'deaths',
  'atExit',
  'checkpointId',
  'tp',
  'attackHeld',
  'attack',
  'attackCooldown',
  'attackSeq',
  'hurt',
  'stepTick',
  'hp',
  'invulnUntil',
  'ability',
  'specialHeld',
  'phase',
  'phaseTime',
  'specialCooldown',
  'specialSeq',
  'aim',
  'reach',
  'giant',
  'droneX',
  'droneY',
  'droneVx',
  'droneVy',
  'cargo',
  'held',
  'flight',
  'grab',
  'maxHp',
  'ack',
] as const satisfies readonly (keyof NetPlayerState)[];

/**
 * Compile-time completeness check: a field added to `NetPlayerState` but not to
 * `PLAYER_FIELDS` would only sync on keyframes. This line fails `typecheck` instead.
 */
type MissingPlayerField = Exclude<keyof NetPlayerState, (typeof PLAYER_FIELDS)[number] | 'id'>;
const ALL_PLAYER_FIELDS_DIFFED: [MissingPlayerField] extends [never] ? true : MissingPlayerField = true;
void ALL_PLAYER_FIELDS_DIFFED;

export interface WorldDelta {
  /** New players (complete objects) or changed fields of existing ones. */
  upserts: NetPlayerPatch[];
  removed: string[];
  /** Collectible ids picked up since the base state. */
  collected: number[];
  /** The complete trap state, only when it changed since the base state. */
  traps?: NetTrapState[];
  /** The complete prop list, only when it changed since the base state. */
  props?: NetPropState[];
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
  const delta: WorldDelta = {
    upserts,
    removed: [...previous.keys()],
    collected: next.collected.filter((id) => !seen.has(id)),
  };
  if (!sameTraps(prev.traps, next.traps)) delta.traps = next.traps;
  if (!sameProps(prev.props, next.props)) delta.props = next.props;
  return delta;
}

function sameTraps(a: readonly NetTrapState[], b: readonly NetTrapState[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.id !== y.id || x.hits !== y.hits || x.trigger !== y.trigger || x.x !== y.x || x.y !== y.y || x.taken !== y.taken) {
      return false;
    }
  }
  return true;
}

function sameProps(a: readonly NetPropState[], b: readonly NetPropState[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.id !== y.id || x.x !== y.x || x.y !== y.y || x.vx !== y.vx || x.vy !== y.vy || x.state !== y.state || x.owner !== y.owner) {
      return false;
    }
  }
  return true;
}

export function isDeltaEmpty(delta: WorldDelta): boolean {
  return (
    delta.upserts.length === 0 && delta.removed.length === 0 && delta.collected.length === 0 && !delta.traps && !delta.props
  );
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
  return { tick, players: [...players.values()], collected, traps: delta.traps ?? base.traps, props: delta.props ?? base.props };
}
