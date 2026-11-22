import type { Rect } from '../../util/math';

/**
 * Traps and interactive entities, as parsed from Tiled objects (`parseTraps`). Every value
 * that affects the simulation is resolved here (defaults + per-object properties, times in
 * ticks), so the definitions alone decide where a trap is at any tick.
 */
export const TRAP_KINDS = ['spikes', 'trampoline', 'saw', 'fallingPlatform', 'fan', 'rockHead', 'spikeHead', 'box'] as const;
export type TrapKind = (typeof TRAP_KINDS)[number];

export type Dir4 = 'up' | 'down' | 'left' | 'right';
export const DIR4: readonly Dir4[] = ['up', 'down', 'left', 'right'];

interface TrapCommon {
  /** Tiled object id (unique per map). */
  id: number;
  name: string;
}

/** A row (or column) of spike tiles. `dir` is where the blades point. */
export interface SpikesTrap extends TrapCommon, Rect {
  kind: 'spikes';
  dir: Dir4;
}

/** Rect = the spring's top surface. Landing on it launches the body upward. */
export interface TrampolineTrap extends TrapCommon, Rect {
  kind: 'trampoline';
  launch: number;
}

/** A spinning blade whose centre ping-pongs from A to B (A = B: it spins in place). */
export interface SawTrap extends TrapCommon {
  kind: 'saw';
  ax: number;
  ay: number;
  bx: number;
  by: number;
  radius: number;
  /** One full A → B → A trip; 0 for a stationary saw. */
  periodTicks: number;
  phaseTicks: number;
}

/** One-way platform that falls `delayTicks` after someone stands on it, then comes back. */
export interface FallingPlatformTrap extends TrapCommon, Rect {
  kind: 'fallingPlatform';
  delayTicks: number;
}

/** Rect = the fan body. `stream` is the area its wind blows through when on. */
export interface FanTrap extends TrapCommon, Rect {
  kind: 'fan';
  dir: Dir4;
  stream: Rect;
  onTicks: number;
  /** 0 = always on. */
  offTicks: number;
  phaseTicks: number;
}

/**
 * Solid block sliding between two walls on one axis: waits, accelerates, slams into the wall,
 * waits, goes back. `from`/`to` are the top-left coordinate on `axis` against each wall; the
 * cycle starts resting at `from` and first moves towards `to`.
 */
export interface RockHeadTrap extends TrapCommon {
  kind: 'rockHead';
  axis: 'x' | 'y';
  /** Top-left on the other axis (fixed). */
  x: number;
  y: number;
  width: number;
  height: number;
  from: number;
  to: number;
  waitTicks: number;
  /** Ticks to travel from one wall to the other. */
  travelTicks: number;
  accel: number;
  maxSpeed: number;
  phaseTicks: number;
}

/** Solid block covered in spikes. Touching any side hurts. */
export interface SpikeHeadTrap extends TrapCommon, Rect {
  kind: 'spikeHead';
}

/** Solid box broken by `maxHits` attacks or stomps. */
export interface BoxTrap extends TrapCommon, Rect {
  kind: 'box';
  variant: 1 | 2 | 3;
  maxHits: number;
}

export type TrapDef =
  | SpikesTrap
  | TrampolineTrap
  | SawTrap
  | FallingPlatformTrap
  | FanTrap
  | RockHeadTrap
  | SpikeHeadTrap
  | BoxTrap;

export type TrapOf<K extends TrapKind> = Extract<TrapDef, { kind: K }>;

/**
 * Replicated trap state: only traps that differ from their initial state are listed
 * (sorted by id). Positions are never sent; they follow from the tick.
 */
export interface NetTrapState {
  id: number;
  /** Box: hits taken so far. */
  hits?: number;
  /** Falling platform: tick it was stood on. */
  trigger?: number;
}

/** Something a body collides with this tick. */
export interface TrapCollider extends Rect {
  id: number;
  kind: TrapKind;
  /** Only blocks bodies falling onto its top (falling platforms, trampolines). */
  oneWay: boolean;
  /** Landing on top launches the body upward at this speed (trampolines, boxes); 0 = none. */
  bounce: number;
}

/** Something that hurts on overlap this tick. */
export interface TrapHazard {
  id: number;
  kind: TrapKind;
  /** Rectangle hurt area… */
  rect: Rect | null;
  /** …or a circle (saws). */
  circle: { x: number; y: number; r: number } | null;
  /** Knockback pushes away from this point. */
  sourceX: number;
  sourceY: number;
}
