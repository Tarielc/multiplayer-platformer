import type { CompiledTraps } from '../../config/traps';
import { TICK_DT } from '../../config/net';
import type { Rect, Vec2 } from '../../util/math';
import type { Dir4, FallingPlatformTrap, FanTrap, RockHeadTrap, SawTrap } from './types';

/**
 * Trap motion as pure functions of the tick. Server, client prediction and rendering all call
 * these, so a trap is in the same place for everyone at the same tick. Ticks may be
 * fractional (rendering between two steps).
 */

/** Always-positive modulo. */
export function mod(value: number, n: number): number {
  return ((value % n) + n) % n;
}

/** Distance covered `t` seconds after starting from rest at `accel`, capped at `maxSpeed`. */
export function accelDistance(t: number, accel: number, maxSpeed: number): number {
  if (t <= 0) return 0;
  const tMax = maxSpeed / accel;
  if (t <= tMax) return 0.5 * accel * t * t;
  return 0.5 * accel * tMax * tMax + maxSpeed * (t - tMax);
}

/** Inverse of `accelDistance`: seconds needed to cover `distance`. */
export function accelTime(distance: number, accel: number, maxSpeed: number): number {
  if (distance <= 0) return 0;
  const tMax = maxSpeed / accel;
  const dMax = 0.5 * accel * tMax * tMax;
  if (distance <= dMax) return Math.sqrt((2 * distance) / accel);
  return tMax + (distance - dMax) / maxSpeed;
}

// --- saw -------------------------------------------------------------------------------------

/**
 * Centre of a saw: eased ping-pong between A and B (slow at the ends, fast in the middle).
 * The easing is a smoothstep polynomial, not a cosine: only + − × keep every engine exact.
 */
export function sawCenter(saw: SawTrap, tick: number): Vec2 {
  if (saw.periodTicks <= 0) return { x: saw.ax, y: saw.ay };
  const u = mod(tick + saw.phaseTicks, saw.periodTicks) / saw.periodTicks;
  const w = u < 0.5 ? 2 * u : 2 - 2 * u;
  const s = w * w * (3 - 2 * w);
  return { x: saw.ax + (saw.bx - saw.ax) * s, y: saw.ay + (saw.by - saw.ay) * s };
}

// --- rock-head -------------------------------------------------------------------------------

export function rockHeadPeriod(rock: RockHeadTrap): number {
  return 2 * (rock.waitTicks + rock.travelTicks);
}

/** Top-left coordinate on the rock-head's axis at `tick`. */
export function rockHeadOffset(rock: RockHeadTrap, tick: number): number {
  const { waitTicks: w, travelTicks: tr, from, to } = rock;
  const length = Math.abs(to - from);
  const sign = Math.sign(to - from);
  const c = mod(tick + rock.phaseTicks, rockHeadPeriod(rock));
  const travelled = (elapsed: number) => Math.min(length, accelDistance(elapsed * TICK_DT, rock.accel, rock.maxSpeed));
  if (c < w) return from;
  if (c < w + tr) return from + sign * travelled(c - w);
  if (c < 2 * w + tr) return to;
  return to - sign * travelled(c - 2 * w - tr);
}

export function rockHeadRect(rock: RockHeadTrap, tick: number): Rect {
  const offset = rockHeadOffset(rock, tick);
  return {
    x: rock.axis === 'x' ? offset : rock.x,
    y: rock.axis === 'y' ? offset : rock.y,
    width: rock.width,
    height: rock.height,
  };
}

/** The wall a rock-head moving from `a` towards `b` slams into. */
function impactSide(axis: 'x' | 'y', a: number, b: number): Dir4 {
  if (axis === 'x') return b > a ? 'right' : 'left';
  return b > a ? 'down' : 'up';
}

export interface RockHeadImpact {
  tick: number;
  /** Side of the rock-head that hit the wall. */
  side: Dir4;
}

/**
 * Wall impacts with `fromTick < tick <= toTick` (integer ticks), oldest first. The client
 * plays the squash animation and thud from these, with no events on the wire.
 */
export function rockHeadImpacts(rock: RockHeadTrap, fromTick: number, toTick: number): RockHeadImpact[] {
  const out: RockHeadImpact[] = [];
  const period = rockHeadPeriod(rock);
  if (period <= 0 || toTick <= fromTick) return out;
  const arriveTo = rock.waitTicks + rock.travelTicks; // cycle time of the slam into `to`
  const marks: Array<{ at: number; side: Dir4 }> = [
    { at: arriveTo, side: impactSide(rock.axis, rock.from, rock.to) },
    { at: period, side: impactSide(rock.axis, rock.to, rock.from) }, // back at `from` (= cycle start)
  ];
  const firstCycle = Math.floor((fromTick + rock.phaseTicks) / period) - 1;
  const lastCycle = Math.floor((toTick + rock.phaseTicks) / period) + 1;
  for (let k = firstCycle; k <= lastCycle; k++) {
    for (const mark of marks) {
      const tick = k * period + mark.at - rock.phaseTicks;
      if (tick > fromTick && tick <= toTick) out.push({ tick, side: mark.side });
    }
  }
  return out.sort((a, b) => a.tick - b.tick);
}

// --- falling platform ------------------------------------------------------------------------

export type FallingPhase = 'idle' | 'shaking' | 'falling' | 'gone';

export interface FallingState {
  phase: FallingPhase;
  /** Drop below the home position, px. */
  dy: number;
  /** Ticks since the phase started. */
  elapsed: number;
}

/** Ticks from being stood on until the platform is back home. */
export function fallingCycleTicks(platform: FallingPlatformTrap, config: Readonly<CompiledTraps>): number {
  const c = config.fallingPlatform;
  return platform.delayTicks + c.fallTicks + c.respawnTicks;
}

export function fallingPlatformState(
  platform: FallingPlatformTrap,
  trigger: number | null,
  tick: number,
  config: Readonly<CompiledTraps>,
): FallingState {
  if (trigger === null || tick < trigger) return { phase: 'idle', dy: 0, elapsed: 0 };
  const c = config.fallingPlatform;
  let e = tick - trigger;
  if (e < platform.delayTicks) return { phase: 'shaking', dy: 0, elapsed: e };
  e -= platform.delayTicks;
  if (e < c.fallTicks) return { phase: 'falling', dy: accelDistance(e * TICK_DT, c.gravity, c.maxSpeed), elapsed: e };
  e -= c.fallTicks;
  if (e < c.respawnTicks) return { phase: 'gone', dy: 0, elapsed: e };
  return { phase: 'idle', dy: 0, elapsed: e - c.respawnTicks };
}

// --- fan -------------------------------------------------------------------------------------

export function fanOn(fan: FanTrap, tick: number): boolean {
  if (fan.offTicks <= 0) return true;
  if (fan.onTicks <= 0) return false;
  return mod(tick + fan.phaseTicks, fan.onTicks + fan.offTicks) < fan.onTicks;
}
