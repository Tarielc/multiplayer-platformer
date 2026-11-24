import { msToTicks } from './net';

/**
 * Fall damage. A fall is measured from the highest point of the airtime (where the player last
 * moved upwards) to where their feet land, so falling past terminal speed still counts.
 *
 * Anything that sends the player back up breaks the fall: a double jump, a trampoline, a
 * stomp, being knocked upwards. Landings after being carried or thrown (claw, tongue) and
 * after a drone flight never hurt.
 *
 * Authored in pixels and milliseconds; `compileFallDamage` converts times to ticks.
 */
export interface FallDamageTuning {
  /**
   * Drops up to this many pixels are free. Keep it above the highest jump (full jump + double
   * jump, ~12 tiles) and a trampoline's launch (~14 tiles), so landing back where you took
   * off never hurts.
   */
  safeDropPx: number;
  /** Past the safe drop, one heart is lost, plus one more for every further `pxPerHeart`. */
  pxPerHeart: number;
  /** A hurtful landing stuns the player this long (the Hurt clip plays; inputs are ignored). */
  stunMs: number;
  /** After a hurtful landing traps and foes can't hurt the player for this long (they blink). */
  invulnerabilityMs: number;
}

export const FALL_DAMAGE_TUNING: Readonly<FallDamageTuning> = {
  safeDropPx: 256, // 16 tiles of 16 px
  pxPerHeart: 128, // 8 tiles: 16-23 tiles cost 1 heart, 24-31 cost 2, 32+ cost 3
  stunMs: 300,
  invulnerabilityMs: 800,
};

/** Fall damage in simulation units (px, seconds, ticks). */
export interface CompiledFallDamage {
  safeDrop: number;
  pxPerHeart: number;
  stun: number;
  invulnerabilityTicks: number;
}

export function compileFallDamage(tuning: FallDamageTuning): CompiledFallDamage {
  if (tuning.safeDropPx < 0) throw new Error('FallDamageTuning: safeDropPx must be >= 0');
  if (tuning.pxPerHeart <= 0) throw new Error('FallDamageTuning: pxPerHeart must be > 0');
  if (tuning.stunMs < 0 || tuning.invulnerabilityMs < 0) throw new Error('FallDamageTuning: timers must be >= 0');
  return {
    safeDrop: tuning.safeDropPx,
    pxPerHeart: tuning.pxPerHeart,
    stun: tuning.stunMs / 1000,
    invulnerabilityTicks: msToTicks(tuning.invulnerabilityMs),
  };
}

export const FALL_DAMAGE: Readonly<CompiledFallDamage> = compileFallDamage(FALL_DAMAGE_TUNING);

/** Hearts a drop of `dropPx` pixels costs (0 within the safe drop). */
export function fallDamageFor(dropPx: number, config: Readonly<CompiledFallDamage> = FALL_DAMAGE): number {
  if (!(dropPx > config.safeDrop)) return 0;
  return 1 + Math.floor((dropPx - config.safeDrop) / config.pxPerHeart);
}
