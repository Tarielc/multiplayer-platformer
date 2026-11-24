import { msToTicks } from './net';

/**
 * Fall damage, for players, foes and boxes. A fall is measured from the highest point of the
 * airtime (where it last moved upwards) to where it lands, so falling past terminal speed
 * still counts. Something carried (the drone's claw, a tongue, a hug) falls from where it is
 * let go.
 *
 * Anything that sends a player back up breaks the fall: a double jump, a trampoline, a stomp,
 * being knocked upwards. Spat players and foes don't take fall damage on top of the spit's.
 *
 * A box falling onto a player, a foe or another box hurts it, and takes a hit itself.
 *
 * Authored in pixels and milliseconds; `compileFallDamage` converts times to ticks.
 */
export interface FallDamageTuning {
  players: {
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
  };
  /** Foes (not wasps, which fly): past the safe drop one hit point, plus one per further `pxPerHit`. */
  foes: { safeDropPx: number; pxPerHit: number };
  /** Boxes: past the safe drop one hit (variants break after 1, 2 or 3), plus one per further `pxPerHit`. */
  boxes: { safeDropPx: number; pxPerHit: number };
  /** A falling box landing on a player, a foe or another box, or a falling foe landing on another foe. */
  crush: {
    /** The box must have fallen at least this far (boxes set down gently just stack). */
    minDropPx: number;
    /** Hearts (players), hit points (foes) or hits (boxes) it costs what it lands on. */
    damage: number;
    /** A player it lands on is knocked away from under it, px/s. */
    knockbackX: number;
    knockbackY: number;
  };
}

export const FALL_DAMAGE_TUNING: Readonly<FallDamageTuning> = {
  players: {
    safeDropPx: 256, // 16 tiles of 16 px
    pxPerHeart: 128, // 8 tiles: 16-23 tiles cost 1 heart, 24-31 cost 2, 32+ cost 3
    stunMs: 300,
    invulnerabilityMs: 800,
  },
  foes: { safeDropPx: 128, pxPerHit: 128 }, // 8 tiles: 1 hit point, 16 tiles: 2, 24: 3
  boxes: { safeDropPx: 96, pxPerHit: 96 }, // 6 tiles: 1 hit (a plain crate breaks), 12: 2, 18: 3
  crush: { minDropPx: 32, damage: 1, knockbackX: 160, knockbackY: 180 },
};

/** How much a drop costs: nothing up to `safeDrop` px, then 1, plus 1 per further `step` px. */
export interface FallRule {
  safeDrop: number;
  step: number;
}

/** Fall damage in simulation units (px, seconds, ticks). */
export interface CompiledFallDamage {
  players: FallRule;
  foes: FallRule;
  boxes: FallRule;
  /** Seconds a hurtful landing stuns a player. */
  stun: number;
  /** Ticks of invulnerability after a hurtful landing (or a box on the head). */
  invulnerabilityTicks: number;
  crush: { minDrop: number; damage: number; knockbackX: number; knockbackY: number };
}

function rule(name: string, safeDropPx: number, step: number): FallRule {
  if (safeDropPx < 0) throw new Error(`FallDamageTuning: ${name}.safeDropPx must be >= 0`);
  if (step <= 0) throw new Error(`FallDamageTuning: ${name} needs a step > 0`);
  return { safeDrop: safeDropPx, step };
}

export function compileFallDamage(tuning: FallDamageTuning): CompiledFallDamage {
  const { players, crush } = tuning;
  if (players.stunMs < 0 || players.invulnerabilityMs < 0) throw new Error('FallDamageTuning: timers must be >= 0');
  if (crush.minDropPx < 0 || crush.damage < 0) throw new Error('FallDamageTuning: crush values must be >= 0');
  return {
    players: rule('players', players.safeDropPx, players.pxPerHeart),
    foes: rule('foes', tuning.foes.safeDropPx, tuning.foes.pxPerHit),
    boxes: rule('boxes', tuning.boxes.safeDropPx, tuning.boxes.pxPerHit),
    stun: players.stunMs / 1000,
    invulnerabilityTicks: msToTicks(players.invulnerabilityMs),
    crush: { minDrop: crush.minDropPx, damage: crush.damage, knockbackX: crush.knockbackX, knockbackY: crush.knockbackY },
  };
}

export const FALL_DAMAGE: Readonly<CompiledFallDamage> = compileFallDamage(FALL_DAMAGE_TUNING);

/** What a drop of `dropPx` pixels costs under `rule` (players by default): 0 within the safe drop. */
export function fallDamageFor(dropPx: number, rule: Readonly<FallRule> = FALL_DAMAGE.players): number {
  if (!(dropPx > rule.safeDrop)) return 0;
  return 1 + Math.floor((dropPx - rule.safeDrop) / rule.step);
}
