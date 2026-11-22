import type { CharacterId } from './characters';

/**
 * Special abilities, one per character (the Special button):
 *
 *  - Bunny Man (`heal`): pulls the nearest teammate in, hugs and kisses them back to health.
 *  - Virtual Guy (`drone`): sits down and flies a drone with a claw that picks up players and
 *    boxes; Special grabs / drops, Attack recalls it.
 *  - Mask Dude (`giant`): grows big for a while: extra hearts, swings that cost hearts, more
 *    reach and knockback, and less knockback taken.
 *  - Ninja Frog (`tongue`): free-aimed tongue that grabs a player or a box, swallows it, and
 *    spits it along the aim as a projectile that hurts everyone in its path.
 *
 * Authored in milliseconds; `resolveAbilities` compiles everything to seconds. The client's
 * ability animations take their timing from the generated sprite sheets, which these values
 * were matched to (heal 1.7 s, drone deploy 0.53 s, grow 0.68 s, …).
 */
export const Ability = {
  NONE: 0,
  HEAL: 1,
  DRONE: 2,
  GIANT: 3,
  TONGUE: 4,
} as const;
export type AbilityId = (typeof Ability)[keyof typeof Ability];

export const ABILITY_NAMES: Readonly<Record<AbilityId, string>> = {
  0: 'None',
  1: 'Healing Hug',
  2: 'Claw Drone',
  3: 'Giant Form',
  4: 'Tongue Spit',
};

export const CHARACTER_ABILITY: Readonly<Record<CharacterId, AbilityId>> = {
  'bunny-man': Ability.HEAL,
  'virtual-guy': Ability.DRONE,
  'mask-dude': Ability.GIANT,
  'ninja-frog': Ability.TONGUE,
};

/**
 * What the ability owner is doing (`MovementBody.phase`). One namespace for all abilities so a
 * phase alone tells the renderer which animation to show.
 */
export const Phase = {
  NONE: 0,
  HEAL: 1,
  DRONE_DEPLOY: 10,
  DRONE_SIT: 11,
  DRONE_PILOT: 12,
  DRONE_RECALL: 13,
  DRONE_CATCH: 14,
  DRONE_STAND: 15,
  GIANT_GROW: 20,
  GIANT_SHRINK: 21,
  TONGUE_WINDUP: 30,
  TONGUE_SHOOT: 31,
  TONGUE_PULL: 32,
  TONGUE_RETRACT: 33,
  TONGUE_GULP: 34,
  TONGUE_HOLD: 35,
  TONGUE_SPIT: 36,
  TONGUE_SPIT_RECOVER: 37,
} as const;
export type PhaseId = (typeof Phase)[keyof typeof Phase];

/** How another player's ability is holding this body (`MovementBody.held`). */
export const Held = {
  NONE: 0,
  /** Dragged through the air (heal pull, tongue pull). */
  PULLED: 1,
  HUGGED: 2,
  /** Hanging from the drone's claw. */
  CARRIED: 3,
  /** Inside the frog's mouth (hidden). */
  SWALLOWED: 4,
} as const;
export type HeldId = (typeof Held)[keyof typeof Held];

/** What the drone's claw holds (`MovementBody.cargo`; drives its collision box). */
export const Cargo = { NONE: 0, PLAYER: 1, BOX: 2 } as const;

export interface AbilityTuning {
  heal: {
    durationMs: number;
    cooldownMs: number;
    /** Teammates whose feet are within this distance can be pulled in. */
    rangeX: number;
    rangeY: number;
    /** The target is dragged from where it stood to the hug spot between these times. */
    pullFromMs: number;
    pullToMs: number;
    /** Hearts restored (target, and the healer). */
    healAtMs: number;
    amount: number;
    selfAmount: number;
    /**
     * Where the target's feet are, relative to the healer's feet (healer facing right), from
     * the given time on. Matches the `target` points of `heal_caster.json`.
     */
    track: readonly (readonly [ms: number, dx: number, dy: number])[];
    /** Trap immunity after being released. */
    afterglowMs: number;
  };
  drone: {
    deployMs: number;
    /** The drone leaves the pilot's hands this far into the deploy. */
    spawnAtMs: number;
    /** Drone centre relative to the pilot's feet at spawn (facing right). */
    spawnOffset: { x: number; y: number };
    sitMs: number;
    batteryMs: number;
    recallMs: number;
    returnMs: number;
    catchMs: number;
    standMs: number;
    cooldownMs: number;
    acceleration: number;
    deceleration: number;
    maxSpeed: number;
    /** Max speed with cargo. */
    carrySpeed: number;
    /** The drone can't fly further than this from the pilot. */
    leash: number;
    /** Drone collision box (centred). */
    size: { width: number; height: number };
    /** Claw grip point, below the drone centre. */
    gripY: number;
    /** Grab area under the claw (centred on the drone, from the grip down). */
    grab: { width: number; height: number };
  };
  giant: {
    growMs: number;
    durationMs: number;
    shrinkMs: number;
    cooldownMs: number;
    bonusHp: number;
    /** Hearts a giant swing costs (normal swings only shove). */
    swingDamage: number;
    reachMultiplier: number;
    knockbackMultiplier: number;
    /** Knockback a giant takes, as a fraction. */
    knockbackTaken: number;
    /** Hits a giant swing deals to boxes. */
    boxHits: number;
  };
  tongue: {
    windupMs: number;
    speed: number;
    maxLength: number;
    retractSpeed: number;
    pullSpeed: number;
    gulpMs: number;
    holdMaxMs: number;
    /** Spit: the target leaves the mouth after `spitMs`, then `spitRecoverMs` of follow-through. */
    spitMs: number;
    spitRecoverMs: number;
    spitSpeed: number;
    flightMs: number;
    missCooldownMs: number;
    spitCooldownMs: number;
    /** Tongue root relative to the frog's feet (facing right). */
    mouth: { x: number; y: number };
    /** Grab radius around the tongue tip. */
    tipRadius: number;
    /** Hearts the projectile costs everyone it hits. */
    damage: number;
    knockbackX: number;
    knockbackY: number;
  };
}

export const ABILITY_TUNING: Readonly<AbilityTuning> = {
  heal: {
    durationMs: 1700,
    cooldownMs: 6000,
    rangeX: 96,
    rangeY: 40,
    pullFromMs: 400,
    pullToMs: 610,
    healAtMs: 1200,
    amount: 2,
    selfAmount: 1,
    track: [
      [0, 48, 0],
      [610, 14, 0],
      [740, 14, -4],
      [860, 14, 0],
      [1200, 15, 0],
      [1370, 20, 0],
    ],
    afterglowMs: 600,
  },
  drone: {
    deployMs: 530,
    spawnAtMs: 250,
    spawnOffset: { x: 1, y: -35 },
    sitMs: 370,
    batteryMs: 15000,
    recallMs: 310,
    returnMs: 300,
    catchMs: 420,
    standMs: 370,
    cooldownMs: 5000,
    acceleration: 900,
    deceleration: 700,
    maxSpeed: 160,
    carrySpeed: 115,
    leash: 320,
    size: { width: 16, height: 12 },
    gripY: 20,
    grab: { width: 26, height: 18 },
  },
  giant: {
    growMs: 680,
    durationMs: 10000,
    shrinkMs: 540,
    cooldownMs: 12000,
    bonusHp: 2,
    swingDamage: 1,
    reachMultiplier: 1.5,
    knockbackMultiplier: 1.7,
    knockbackTaken: 0.5,
    boxHits: 3,
  },
  tongue: {
    windupMs: 170,
    speed: 560,
    maxLength: 128,
    retractSpeed: 700,
    pullSpeed: 420,
    gulpMs: 250,
    holdMaxMs: 3000,
    spitMs: 100,
    spitRecoverMs: 120,
    spitSpeed: 460,
    flightMs: 650,
    missCooldownMs: 1200,
    spitCooldownMs: 4000,
    mouth: { x: 9, y: -14 },
    tipRadius: 7,
    damage: 1,
    knockbackX: 300,
    knockbackY: 220,
  },
};

/** Ability values in simulation units (seconds, px, px/s). */
export interface CompiledAbilities {
  heal: Omit<AbilityTuning['heal'], 'durationMs' | 'cooldownMs' | 'pullFromMs' | 'pullToMs' | 'healAtMs' | 'track' | 'afterglowMs'> & {
    duration: number;
    cooldown: number;
    pullFrom: number;
    pullTo: number;
    healAt: number;
    track: readonly (readonly [t: number, dx: number, dy: number])[];
    afterglow: number;
  };
  drone: Omit<
    AbilityTuning['drone'],
    'deployMs' | 'spawnAtMs' | 'sitMs' | 'batteryMs' | 'recallMs' | 'returnMs' | 'catchMs' | 'standMs' | 'cooldownMs'
  > & {
    deploy: number;
    spawnAt: number;
    sit: number;
    battery: number;
    recall: number;
    return: number;
    catch: number;
    stand: number;
    cooldown: number;
  };
  giant: Omit<AbilityTuning['giant'], 'growMs' | 'durationMs' | 'shrinkMs' | 'cooldownMs'> & {
    grow: number;
    duration: number;
    shrink: number;
    cooldown: number;
  };
  tongue: Omit<
    AbilityTuning['tongue'],
    'windupMs' | 'gulpMs' | 'holdMaxMs' | 'spitMs' | 'spitRecoverMs' | 'flightMs' | 'missCooldownMs' | 'spitCooldownMs'
  > & {
    windup: number;
    gulp: number;
    holdMax: number;
    spit: number;
    spitRecover: number;
    flight: number;
    missCooldown: number;
    spitCooldown: number;
  };
}

const s = (ms: number) => ms / 1000;

export function compileAbilities(t: Readonly<AbilityTuning>): CompiledAbilities {
  const { heal, drone, giant, tongue } = t;
  if (!(heal.pullFromMs <= heal.pullToMs && heal.pullToMs <= heal.healAtMs && heal.healAtMs <= heal.durationMs)) {
    throw new Error('AbilityTuning: heal times must be ordered pullFrom <= pullTo <= healAt <= duration');
  }
  if (drone.spawnAtMs > drone.deployMs) throw new Error('AbilityTuning: drone.spawnAtMs must be <= deployMs');
  if (tongue.maxLength <= 0 || tongue.speed <= 0) throw new Error('AbilityTuning: tongue speed and length must be > 0');
  return {
    heal: {
      rangeX: heal.rangeX,
      rangeY: heal.rangeY,
      amount: heal.amount,
      selfAmount: heal.selfAmount,
      duration: s(heal.durationMs),
      cooldown: s(heal.cooldownMs),
      pullFrom: s(heal.pullFromMs),
      pullTo: s(heal.pullToMs),
      healAt: s(heal.healAtMs),
      track: heal.track.map(([ms, dx, dy]) => [s(ms), dx, dy] as const),
      afterglow: s(heal.afterglowMs),
    },
    drone: {
      spawnOffset: { ...drone.spawnOffset },
      acceleration: drone.acceleration,
      deceleration: drone.deceleration,
      maxSpeed: drone.maxSpeed,
      carrySpeed: drone.carrySpeed,
      leash: drone.leash,
      size: { ...drone.size },
      gripY: drone.gripY,
      grab: { ...drone.grab },
      deploy: s(drone.deployMs),
      spawnAt: s(drone.spawnAtMs),
      sit: s(drone.sitMs),
      battery: s(drone.batteryMs),
      recall: s(drone.recallMs),
      return: s(drone.returnMs),
      catch: s(drone.catchMs),
      stand: s(drone.standMs),
      cooldown: s(drone.cooldownMs),
    },
    giant: {
      bonusHp: giant.bonusHp,
      swingDamage: giant.swingDamage,
      reachMultiplier: giant.reachMultiplier,
      knockbackMultiplier: giant.knockbackMultiplier,
      knockbackTaken: giant.knockbackTaken,
      boxHits: giant.boxHits,
      grow: s(giant.growMs),
      duration: s(giant.durationMs),
      shrink: s(giant.shrinkMs),
      cooldown: s(giant.cooldownMs),
    },
    tongue: {
      speed: tongue.speed,
      maxLength: tongue.maxLength,
      retractSpeed: tongue.retractSpeed,
      pullSpeed: tongue.pullSpeed,
      spitSpeed: tongue.spitSpeed,
      mouth: { ...tongue.mouth },
      tipRadius: tongue.tipRadius,
      damage: tongue.damage,
      knockbackX: tongue.knockbackX,
      knockbackY: tongue.knockbackY,
      windup: s(tongue.windupMs),
      gulp: s(tongue.gulpMs),
      holdMax: s(tongue.holdMaxMs),
      spit: s(tongue.spitMs),
      spitRecover: s(tongue.spitRecoverMs),
      flight: s(tongue.flightMs),
      missCooldown: s(tongue.missCooldownMs),
      spitCooldown: s(tongue.spitCooldownMs),
    },
  };
}

export const ABILITIES: Readonly<CompiledAbilities> = compileAbilities(ABILITY_TUNING);

export function abilityForCharacter(id: CharacterId): AbilityId {
  return CHARACTER_ABILITY[id];
}
