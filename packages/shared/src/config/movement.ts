/**
 * Player movement tuning. Every value the platforming feel depends on lives here,
 * so neither the Phaser scenes nor the server loop contain magic numbers.
 *
 * Jump physics are authored the designer-friendly way (height + time to apex) and
 * compiled into gravity / launch velocity:  g = 2h / t²,  v0 = 2h / t. Air jumps are authored
 * as a height too and launch at  √(2·g·airJumpHeight).
 */
export interface MovementTuning {
  /** Apex height of a full (held) jump, in pixels. */
  jumpHeight: number;
  /** Seconds from take-off to the apex of a full jump. */
  timeToApex: number;
  /** Gravity multiplier while falling (snappier, less floaty descents). */
  fallGravityMultiplier: number;
  /** Terminal fall speed, px/s. Keep below tileSize * tickRate to avoid tunnelling. */
  maxFallSpeed: number;
  /** Top horizontal run speed, px/s. */
  maxRunSpeed: number;
  /** Horizontal acceleration while grounded, px/s². */
  groundAcceleration: number;
  /** Horizontal deceleration while grounded with no input, px/s². */
  groundDeceleration: number;
  /** Horizontal acceleration while airborne, px/s². */
  airAcceleration: number;
  /** Horizontal deceleration while airborne with no input, px/s². */
  airDeceleration: number;
  /** Acceleration multiplier when pushing against current velocity (quick turnarounds). */
  turnMultiplier: number;
  /** Variable jump: upward velocity is multiplied by this when jump is released early. */
  jumpCutMultiplier: number;
  /** Extra jumps allowed in mid-air before landing again (1 = double jump, 0 = none). */
  airJumps: number;
  /** Apex height of a full (held) air jump, in pixels, measured from where it starts. */
  airJumpHeight: number;
  /** Grace period after walking off a ledge during which a jump is still allowed. */
  coyoteTimeMs: number;
  /** A jump pressed this long before landing still triggers on touchdown. */
  jumpBufferMs: number;
  /** How long one-way platforms are ignored after down+jump. */
  dropThroughMs: number;
}

export const MOVEMENT_TUNING: Readonly<MovementTuning> = {
  jumpHeight: 112, // 7 tiles at 16 px
  timeToApex: 0.4,
  fallGravityMultiplier: 1.6,
  maxFallSpeed: 900,
  maxRunSpeed: 220,
  groundAcceleration: 2200,
  groundDeceleration: 2600,
  airAcceleration: 1500,
  airDeceleration: 900,
  turnMultiplier: 1.6,
  jumpCutMultiplier: 0.45,
  airJumps: 1,
  airJumpHeight: 80, // 5 tiles
  coyoteTimeMs: 100,
  jumpBufferMs: 120,
  dropThroughMs: 220,
};

/** Movement values in simulation units (px, px/s, px/s², seconds). */
export interface CompiledMovement {
  gravity: number;
  fallGravity: number;
  jumpVelocity: number;
  /** Extra mid-air jumps per airtime (whole number ≥ 0). */
  airJumps: number;
  airJumpVelocity: number;
  maxFallSpeed: number;
  maxRunSpeed: number;
  groundAcceleration: number;
  groundDeceleration: number;
  airAcceleration: number;
  airDeceleration: number;
  turnMultiplier: number;
  jumpCutMultiplier: number;
  coyoteTime: number;
  jumpBuffer: number;
  dropThroughTime: number;
}

export function compileMovement(tuning: MovementTuning): CompiledMovement {
  const { jumpHeight: h, timeToApex: t } = tuning;
  if (h <= 0 || t <= 0) throw new Error('MovementTuning: jumpHeight and timeToApex must be > 0');
  if (tuning.airJumps < 0 || tuning.airJumpHeight < 0) throw new Error('MovementTuning: airJumps and airJumpHeight must be >= 0');
  const gravity = (2 * h) / (t * t);
  return {
    gravity,
    fallGravity: gravity * tuning.fallGravityMultiplier,
    jumpVelocity: (2 * h) / t,
    airJumps: Math.floor(tuning.airJumps),
    airJumpVelocity: Math.sqrt(2 * gravity * tuning.airJumpHeight),
    maxFallSpeed: tuning.maxFallSpeed,
    maxRunSpeed: tuning.maxRunSpeed,
    groundAcceleration: tuning.groundAcceleration,
    groundDeceleration: tuning.groundDeceleration,
    airAcceleration: tuning.airAcceleration,
    airDeceleration: tuning.airDeceleration,
    turnMultiplier: tuning.turnMultiplier,
    jumpCutMultiplier: tuning.jumpCutMultiplier,
    coyoteTime: tuning.coyoteTimeMs / 1000,
    jumpBuffer: tuning.jumpBufferMs / 1000,
    dropThroughTime: tuning.dropThroughMs / 1000,
  };
}

/** Base tuning + optional per-level overrides (from the level manifest). */
export function resolveMovement(
  base: Readonly<MovementTuning> = MOVEMENT_TUNING,
  overrides?: Partial<MovementTuning>,
): CompiledMovement {
  return compileMovement({ ...base, ...overrides });
}
