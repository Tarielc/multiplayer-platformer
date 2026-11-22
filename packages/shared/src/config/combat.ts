/**
 * Attack ("shove") tuning. Swings are simulated in the shared step function, so the attacker's
 * own client predicts them; hits are decided by the server and replicated as the target's
 * `hurt` timer + knockback velocity.
 *
 * Authored in milliseconds; `resolveCombat` compiles to seconds for the simulation.
 * The client's Attack/Hurt clips take their duration from these values, so animation and
 * gameplay can never drift apart.
 */
export interface CombatTuning {
  /** Swings push other players. `false` keeps attacks purely cosmetic. */
  playerHits: boolean;
  attack: {
    /** Full swing length (the Attack clip plays over exactly this time). */
    durationMs: number;
    /** Time from the start of one swing until the next may start. Must be ≥ durationMs. */
    cooldownMs: number;
    /** Hit window inside the swing, measured from its start. */
    activeFromMs: number;
    activeToMs: number;
    /**
     * Hit box in front of the attacker: `width` px beyond the hitbox edge it faces,
     * `height` px tall, its bottom `offsetY` px above the attacker's feet.
     */
    reach: { width: number; height: number; offsetY: number };
    /** Turning is ignored while swinging (movement input still applies). */
    lockFacing: boolean;
  };
  hurt: {
    /** Inputs are ignored this long after being hit (the Hurt clip plays over this time). */
    stunMs: number;
    /**
     * After the stun, the player can't be hit again for this long, so two attackers taking
     * turns can't keep someone stunned forever.
     */
    immunityMs: number;
    /** Horizontal launch speed away from the attacker, px/s. */
    knockbackX: number;
    /** Upward launch speed, px/s. */
    knockbackY: number;
  };
}

export const COMBAT_TUNING: Readonly<CombatTuning> = {
  playerHits: true,
  attack: {
    durationMs: 350,
    cooldownMs: 450,
    activeFromMs: 100,
    activeToMs: 250,
    reach: { width: 18, height: 24, offsetY: 4 },
    lockFacing: true,
  },
  hurt: {
    stunMs: 300,
    immunityMs: 250,
    knockbackX: 260,
    knockbackY: 300,
  },
};

/** Combat values in simulation units (seconds, px, px/s). */
export interface CompiledCombat {
  playerHits: boolean;
  attackDuration: number;
  attackCooldown: number;
  activeFrom: number;
  activeTo: number;
  reach: { width: number; height: number; offsetY: number };
  lockFacing: boolean;
  stun: number;
  /** Seconds after the stun during which the player can't be hit. */
  immunity: number;
  knockbackX: number;
  knockbackY: number;
}

export function compileCombat(tuning: CombatTuning): CompiledCombat {
  const { attack, hurt } = tuning;
  if (attack.durationMs <= 0) throw new Error('CombatTuning: attack.durationMs must be > 0');
  if (attack.cooldownMs < attack.durationMs) {
    throw new Error('CombatTuning: attack.cooldownMs must be >= attack.durationMs');
  }
  if (attack.activeFromMs < 0 || attack.activeToMs < attack.activeFromMs || attack.activeToMs > attack.durationMs) {
    throw new Error('CombatTuning: the active window must lie inside the swing');
  }
  if (hurt.stunMs < 0 || hurt.immunityMs < 0) throw new Error('CombatTuning: hurt timers must be >= 0');
  return {
    playerHits: tuning.playerHits,
    attackDuration: attack.durationMs / 1000,
    attackCooldown: attack.cooldownMs / 1000,
    activeFrom: attack.activeFromMs / 1000,
    activeTo: attack.activeToMs / 1000,
    reach: { ...attack.reach },
    lockFacing: attack.lockFacing,
    stun: hurt.stunMs / 1000,
    immunity: hurt.immunityMs / 1000,
    knockbackX: hurt.knockbackX,
    knockbackY: hurt.knockbackY,
  };
}

/** Base tuning + optional overrides (tests, experiments). */
export function resolveCombat(
  base: Readonly<CombatTuning> = COMBAT_TUNING,
  overrides?: { playerHits?: boolean; attack?: Partial<CombatTuning['attack']>; hurt?: Partial<CombatTuning['hurt']> },
): CompiledCombat {
  return compileCombat({
    playerHits: overrides?.playerHits ?? base.playerHits,
    attack: { ...base.attack, ...overrides?.attack },
    hurt: { ...base.hurt, ...overrides?.hurt },
  });
}
