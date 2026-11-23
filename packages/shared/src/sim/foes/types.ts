import type { FoeKind, ShotKind } from '../../config/foes';

/**
 * What a foe is doing. Each kind uses a few of these (the client maps them to clips):
 *  - idle / walk: standing about, patrolling (a wall monkey climbs; a wasp hovers).
 *  - alert: a chicken has spotted someone. chase: running at them.
 *  - attack: a peck / swipe / swing. shoot / throw: a stinger or a banana leaves mid-clip.
 *  - windup → charge → crash → stunned: the bull (and the rhino).
 *  - roar / stomp / block / enrage: the rhino boss (its horn swipe is `attack`).
 *  - hurt: hit by a player. dead: the Death clip, then it's removed.
 *  - held / swallowed / flying: caught by a player's ability (on the frog's tongue or in the
 *    drone's claw / in the frog's mouth / spat out). The ability moves it; it doesn't act.
 */
export const FOE_STATES = [
  'idle',
  'walk',
  'alert',
  'chase',
  'attack',
  'shoot',
  'throw',
  'windup',
  'charge',
  'crash',
  'stunned',
  'roar',
  'stomp',
  'block',
  'enrage',
  'hurt',
  'dead',
  'held',
  'swallowed',
  'flying',
] as const;
export type FoeState = (typeof FOE_STATES)[number];

/** Caught by a player's ability: it doesn't think, move or hurt anyone on its own. */
export function isCaptive(state: FoeState): boolean {
  return state === 'held' || state === 'swallowed' || state === 'flying';
}

/** Which wall a monkey clings to: -1 the one on its left, 1 on its right, 0 none (on the ground). */
export type FoeWall = -1 | 0 | 1;

/** A foe as placed in the level (`parseFoes`). */
export interface FoeDef {
  /** Tiled object id (unique per map). */
  id: number;
  kind: FoeKind;
  /** Feet: bottom-centre of the hitbox. */
  x: number;
  y: number;
  facing: 1 | -1;
  /** Turns back this far (px) from where it starts; 0 = no limit. */
  range: number;
  wall: FoeWall;
}

/** Replicated foe state (every foe still in the level, sorted by id). */
export interface NetFoeState {
  id: number;
  kind: FoeKind;
  /** Feet: bottom-centre of the hitbox. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  state: FoeState;
  /** Seconds since `state` began (the clip clock). */
  t: number;
  hp: number;
  wall: FoeWall;
}

/** A stinger or a banana in flight (`hit`: playing its impact for `t` seconds, then gone). */
export interface NetShotState {
  id: number;
  kind: ShotKind;
  /** Centre. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  hit: boolean;
  /** Seconds since it was fired, or since it hit something. */
  t: number;
}

/** A player as foes see them this tick. */
export interface FoeTarget {
  id: string;
  /** Hitbox (top-left + size). */
  x: number;
  y: number;
  width: number;
  height: number;
  vy: number;
  /** Alive and free: foes notice it and chase it. */
  visible: boolean;
  /** Can be hurt right now (not invulnerable, not already reeling). */
  vulnerable: boolean;
}

/** A foe (or its shot) hit a player. At most one per player per tick. */
export interface FoeStrike {
  targetId: string;
  foeId: number;
  damage: number;
  /** Push direction and speed. */
  dir: 1 | -1;
  knockbackX: number;
  knockbackY: number;
  /** Where it landed (effects). */
  x: number;
  y: number;
}
