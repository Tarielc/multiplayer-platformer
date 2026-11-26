import { msToTicks } from './net';

/**
 * Trap and interactive-entity tuning. Authored in milliseconds and pixels; `compileTraps`
 * converts times to ticks. Body sizes match the sprites in `data/sprites/traps/` (the client's
 * `trapArt.ts` says where each body sits inside its frame).
 *
 * Per-object Tiled properties (documented in docs/level-authoring.md) override the defaults
 * marked "default" below.
 */
export interface TrapTuning {
  damage: {
    /** Hearts lost per trap hit. */
    amount: number;
    /** After a trap hit the player can't be hurt by traps for this long (they blink). */
    invulnerabilityMs: number;
    /** Knockback away from the trap, px/s. */
    knockbackX: number;
    knockbackY: number;
  };
  spikes: {
    /** Strips are made of tiles this size. */
    tile: number;
    /** Hurt box inside each tile (pointing up): sides and top are trimmed to the spike blades. */
    insetSide: number;
    insetTop: number;
  };
  trampoline: {
    /** The springy top surface you land on. */
    width: number;
    height: number;
    /** Default launch speed, px/s (800 ≈ 14 tiles of 16 px). */
    launch: number;
  };
  saw: {
    /** Hurt radius (the sprite is 38 px across). */
    radius: number;
    /** Default average speed along the track, px/s. */
    speed: number;
  };
  fallingPlatform: {
    width: number;
    height: number;
    /** Default time between being stood on and starting to fall (it shakes meanwhile). */
    delayMs: number;
    gravity: number;
    maxSpeed: number;
    /** How long it falls before vanishing. */
    fallMs: number;
    /** How long it stays gone before reappearing at home. */
    respawnMs: number;
  };
  fan: {
    /** Body pointing up (left/right fans swap width and height). */
    width: number;
    height: number;
    /** Default length of the wind stream, px. */
    range: number;
    /** Width of the wind stream across its direction, px. */
    streamWidth: number;
    /** Wind acceleration, px/s², and the speed it stops adding at, px/s. */
    accel: number;
    maxSpeed: number;
    /** Default on/off cycle. `offMs: 0` keeps the fan always on. */
    onMs: number;
    offMs: number;
  };
  rockHead: {
    size: number;
    accel: number;
    maxSpeed: number;
    /** Default pause against each wall. */
    waitMs: number;
  };
  spikeHead: {
    /** Solid body, spikes included. Touching it hurts. */
    size: number;
  };
  button: {
    /**
     * The cap (the pressed-down art): one-way like a platform, low enough to walk up onto.
     * Things standing or resting on it press it.
     */
    width: number;
    height: number;
  };
  box: {
    width: number;
    height: number;
    /** Hits needed to break variants 1, 2 and 3. */
    hits: readonly [number, number, number];
    /** A box ignores further hits for this long (one swing is one hit). */
    hitCooldownMs: number;
  };
}

export const TRAP_TUNING: Readonly<TrapTuning> = {
  damage: { amount: 1, invulnerabilityMs: 1000, knockbackX: 200, knockbackY: 340 },
  spikes: { tile: 16, insetSide: 2, insetTop: 10 },
  trampoline: { width: 24, height: 11, launch: 800 },
  saw: { radius: 16, speed: 90 },
  fallingPlatform: { width: 32, height: 10, delayMs: 500, gravity: 1400, maxSpeed: 600, fallMs: 1500, respawnMs: 2500 },
  fan: { width: 24, height: 8, range: 112, streamWidth: 32, accel: 4200, maxSpeed: 260, onMs: 2000, offMs: 1500 },
  rockHead: { size: 32, accel: 1400, maxSpeed: 420, waitMs: 900 },
  spikeHead: { size: 42 },
  box: { width: 20, height: 20, hits: [1, 2, 3], hitCooldownMs: 200 },
  button: { width: 14, height: 3 },
};

/** Trap tuning in simulation units: times in ticks, everything else as authored. */
export interface CompiledTraps {
  damage: { amount: number; invulnerabilityTicks: number; knockbackX: number; knockbackY: number };
  spikes: TrapTuning['spikes'];
  trampoline: TrapTuning['trampoline'];
  saw: TrapTuning['saw'];
  fallingPlatform: {
    width: number;
    height: number;
    delayTicks: number;
    gravity: number;
    maxSpeed: number;
    fallTicks: number;
    respawnTicks: number;
  };
  fan: {
    width: number;
    height: number;
    range: number;
    streamWidth: number;
    accel: number;
    maxSpeed: number;
    onTicks: number;
    offTicks: number;
  };
  rockHead: { size: number; accel: number; maxSpeed: number; waitTicks: number };
  spikeHead: TrapTuning['spikeHead'];
  box: { width: number; height: number; hits: readonly [number, number, number]; hitCooldownTicks: number };
  button: TrapTuning['button'];
}

export function compileTraps(t: TrapTuning): CompiledTraps {
  const positive = (value: number, what: string) => {
    if (!(value > 0)) throw new Error(`TrapTuning: ${what} must be > 0`);
    return value;
  };
  positive(t.spikes.tile, 'spikes.tile');
  positive(t.rockHead.accel, 'rockHead.accel');
  positive(t.rockHead.maxSpeed, 'rockHead.maxSpeed');
  positive(t.fallingPlatform.gravity, 'fallingPlatform.gravity');
  positive(t.saw.speed, 'saw.speed');
  if (t.box.hits.some((h) => !(h >= 1))) throw new Error('TrapTuning: box.hits must all be >= 1');
  return {
    damage: {
      amount: t.damage.amount,
      invulnerabilityTicks: msToTicks(t.damage.invulnerabilityMs),
      knockbackX: t.damage.knockbackX,
      knockbackY: t.damage.knockbackY,
    },
    spikes: { ...t.spikes },
    trampoline: { ...t.trampoline },
    saw: { ...t.saw },
    fallingPlatform: {
      width: t.fallingPlatform.width,
      height: t.fallingPlatform.height,
      delayTicks: msToTicks(t.fallingPlatform.delayMs),
      gravity: t.fallingPlatform.gravity,
      maxSpeed: t.fallingPlatform.maxSpeed,
      fallTicks: Math.max(1, msToTicks(t.fallingPlatform.fallMs)),
      respawnTicks: Math.max(1, msToTicks(t.fallingPlatform.respawnMs)),
    },
    fan: {
      width: t.fan.width,
      height: t.fan.height,
      range: t.fan.range,
      streamWidth: t.fan.streamWidth,
      accel: t.fan.accel,
      maxSpeed: t.fan.maxSpeed,
      onTicks: msToTicks(t.fan.onMs),
      offTicks: msToTicks(t.fan.offMs),
    },
    rockHead: { size: t.rockHead.size, accel: t.rockHead.accel, maxSpeed: t.rockHead.maxSpeed, waitTicks: msToTicks(t.rockHead.waitMs) },
    spikeHead: { ...t.spikeHead },
    box: {
      width: t.box.width,
      height: t.box.height,
      hits: [...t.box.hits] as [number, number, number],
      hitCooldownTicks: Math.max(1, msToTicks(t.box.hitCooldownMs)),
    },
    button: { ...t.button },
  };
}

/** The default tuning, compiled. Server and clients must use the same values. */
export const TRAP_CONFIG: Readonly<CompiledTraps> = compileTraps(TRAP_TUNING);
