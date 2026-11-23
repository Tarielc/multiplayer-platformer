/**
 * Foes: tuning for the five enemies, the rhino boss, and their projectiles. Simulated on the server only
 * (`sim/foes`), replicated to clients, which draw them from `data/sprites/foes/`.
 *
 * Distances in px, speeds in px/s, times in ms. Clip lengths (`*Ms` of attacks, hurt, death)
 * match the sprite sheets' animations, so what the art shows is what the simulation does: a
 * peck hurts on the frames where the beak is out, a stinger leaves on the frame it is fired.
 * Positions on a foe are relative to its feet (the bottom-centre of its hitbox), x towards the
 * way it faces.
 */
export const FOE_KINDS = ['mushroom', 'chicken', 'wasp', 'monkey', 'bull', 'rhino'] as const;
export type FoeKind = (typeof FOE_KINDS)[number];

export const SHOT_KINDS = ['stinger', 'banana', 'shockwave', 'rock'] as const;
export type ShotKind = (typeof SHOT_KINDS)[number];

/** Bosses: the level's exit stays shut while one is alive, and tongues and claws can't catch them. */
export const BOSS_KINDS: readonly FoeKind[] = ['rhino'];

export function isFoeKind(value: unknown): value is FoeKind {
  return typeof value === 'string' && (FOE_KINDS as readonly string[]).includes(value);
}

export function isBoss(kind: FoeKind): boolean {
  return BOSS_KINDS.includes(kind);
}

/** A box relative to a foe's feet: `x` px ahead of its centre, `y` px up, `width`×`height` around that point. */
export interface FoeBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A melee attack: plays for `durationMs`, hurts while `activeFromMs`..`activeToMs` (once per attack). */
export interface FoeMelee {
  durationMs: number;
  activeFromMs: number;
  activeToMs: number;
  /** Where it hurts. */
  box: FoeBox;
  /** Starts when a player's centre is this close (px, each axis). */
  rangeX: number;
  rangeY: number;
  cooldownMs: number;
  damage: number;
}

export interface FoeCommon {
  hp: number;
  /** Hitbox; the foe's position is its bottom-centre (flying foes too). */
  width: number;
  height: number;
  /** Hearts a player loses touching it (0: harmless to touch). */
  contactDamage: number;
  /** Players landing on top hurt it and bounce off (and touching it from above never hurts). */
  stompable: boolean;
  /** The Hurt clip; the foe reacts (and can't attack) this long. */
  hurtMs: number;
  /** The Death clip; the foe is gone after it. */
  deathMs: number;
  /** Shove taken from a hit, px/s. */
  knockbackX: number;
  knockbackY: number;
  /** Points for the player who finishes it. */
  score: number;
  /** Default turn-back distance from where it starts (Tiled `range` property, px; 0 = none). */
  range: number;
}

export interface FoeTuning {
  /** Foes freeze while no player is this close (px, each axis): only the action near players runs. */
  wakeX: number;
  wakeY: number;
  /** Ground foes fall like this, px/s² (and no faster than `maxFall`). */
  gravity: number;
  maxFall: number;
  /** Ground foes slow down this fast after a shove, px/s². */
  friction: number;
  /** What a foe's hit does to a player (on top of the hearts each attack costs). */
  hit: { invulnerabilityMs: number; knockbackX: number; knockbackY: number };
  /** Players bounce off a stomped foe at this speed, px/s; a stomp costs it this much. */
  stomp: { bounce: number; damage: number };
  /** Hearts a swing takes from a foe (a giant's swing takes `giant.swingDamage`). */
  swingDamage: number;

  mushroom: FoeCommon & { walkSpeed: number; turnPauseMs: number };
  chicken: FoeCommon & {
    /** Pottering about at `wanderSpeed` (the run clip at half speed), idling in between. */
    wanderSpeed: number;
    wanderMs: [number, number];
    idleMs: [number, number];
    /** Spots a player this close (px, each axis) in plain sight, squawks for `alertMs`, then chases. */
    sightX: number;
    sightY: number;
    alertMs: number;
    chaseSpeed: number;
    /** Gives up when the player has been out of sight (or further than `giveUpX`) for `giveUpMs`. */
    giveUpX: number;
    giveUpMs: number;
    peck: FoeMelee;
  };
  wasp: FoeCommon & {
    speed: number;
    /** Patrol bob, px and ms per cycle. */
    bobAmp: number;
    bobMs: number;
    /** Shoots at players this close (px, straight line) in plain sight. */
    sight: number;
    /** Keeps this far to the side of / above its target (px). */
    keepX: number;
    keepY: number;
    /** Never strays further than this from where it started (px). */
    leash: number;
    shoot: { durationMs: number; fireAtMs: number; cooldownMs: number; muzzleX: number; muzzleY: number };
  };
  monkey: FoeCommon & {
    /** On a wall it climbs up and down `range` px; on the ground it walks. */
    climbSpeed: number;
    walkSpeed: number;
    idleMs: [number, number];
    moveMs: [number, number];
    /** Throws at players this close (px, each axis) in plain sight, in front of it. */
    sightX: number;
    sightY: number;
    throw: { durationMs: number; releaseAtMs: number; cooldownMs: number; releaseX: number; releaseY: number };
    /** On a wall the release point and the swipe sit a little lower and nearer. */
    wallThrow: { durationMs: number; releaseAtMs: number; cooldownMs: number; releaseX: number; releaseY: number };
    melee: FoeMelee;
    wallSwipe: FoeMelee;
  };
  bull: FoeCommon & {
    walkSpeed: number;
    turnPauseMs: number;
    /** Charges at players this close (px, each axis) in plain sight, ahead of it. */
    sightX: number;
    sightY: number;
    windupMs: number;
    chargeSpeed: number;
    chargeAccel: number;
    maxChargeMs: number;
    /** Hitting a wall: the crash clip, then dazed. */
    crashMs: number;
    stunnedMs: number;
    /** After a charge it doesn't start another this soon. */
    cooldownMs: number;
    /** The horns during a charge: a hit with them throws players further. */
    horns: FoeBox;
    hornKnockbackX: number;
    hornKnockbackY: number;
  };
  /**
   * The boss. Sleeps until a player comes into sight, roars, then walks at the nearest player
   * and every so often charges (until it crashes into a wall: rocks fall from the ceiling, and it
   * stands dazed) or stomps (a shockwave runs along the ground both ways, and a rock comes loose
   * over anyone up on a ledge); it swipes its horn at
   * anyone right in front of it. Armoured: hits only hurt it while it is dazed. At half health it
   * flies into a rage (faster, more rocks, shorter daze).
   */
  rhino: FoeCommon & {
    /** Wakes up (roars) when a player is this close (px, each axis) in plain sight. */
    sightX: number;
    sightY: number;
    roarMs: number;
    /** Walking at its target this long (s range, ms) before the next charge or stomp. */
    thinkMs: [number, number];
    walkSpeed: number;
    windupMs: number;
    chargeSpeed: number;
    chargeAccel: number;
    maxChargeMs: number;
    crashMs: number;
    stunnedMs: number;
    /** Chance of a charge (rather than a stomp) when its target is about level with it and far enough away. */
    chargeChance: number;
    chargeMinX: number;
    /** Rocks shaken loose by a crash, spread over the arena (one above each player first). */
    rocks: number;
    stomp: { durationMs: number; impactAtMs: number; impactX: number };
    blockMs: number;
    enrageMs: number;
    /** In a rage (at half health or less). */
    rage: { thinkMs: [number, number]; walkSpeed: number; chargeSpeed: number; stunnedMs: number; rocks: number };
    hornSwipe: FoeMelee;
    /** The horns during a charge: a hit with them throws players further. */
    horns: FoeBox;
    hornKnockbackX: number;
    hornKnockbackY: number;
  };

  stinger: ShotTuning & { speed: number };
  banana: ShotTuning & {
    gravity: number;
    /** Flight time of the lob, from the distance to the target (clamped). */
    flightMinMs: number;
    flightMaxMs: number;
    /** px/s of horizontal distance per second of flight, before clamping. */
    lobSpeed: number;
  };
  /** Runs along the ground (jump it) until it meets a wall or a ledge. */
  shockwave: ShotTuning & { speed: number };
  /** Hangs from the ceiling for `warnMs` (harmless, shaking), then falls. */
  rock: ShotTuning & { warnMs: number; gravity: number; maxFall: number };
}

export interface ShotTuning {
  width: number;
  height: number;
  damage: number;
  /** Gone after this long without hitting anything. */
  lifeMs: number;
  /** The impact clip. */
  impactMs: number;
}

export const FOE_TUNING: Readonly<FoeTuning> = {
  wakeX: 600,
  wakeY: 400,
  gravity: 1400,
  maxFall: 600,
  friction: 900,
  hit: { invulnerabilityMs: 1000, knockbackX: 220, knockbackY: 300 },
  stomp: { bounce: 330, damage: 1 },
  swingDamage: 1,

  mushroom: {
    hp: 1,
    width: 18,
    height: 18,
    contactDamage: 1,
    stompable: true,
    hurtMs: 330,
    deathMs: 650,
    knockbackX: 140,
    knockbackY: 160,
    score: 10,
    range: 48,
    walkSpeed: 28,
    turnPauseMs: 700,
  },
  chicken: {
    hp: 2,
    width: 16,
    height: 20,
    contactDamage: 0,
    stompable: true,
    hurtMs: 320,
    deathMs: 760,
    knockbackX: 170,
    knockbackY: 200,
    score: 15,
    range: 40,
    wanderSpeed: 40,
    wanderMs: [600, 1400],
    idleMs: [1000, 2400],
    sightX: 150,
    sightY: 40,
    alertMs: 400,
    chaseSpeed: 90,
    giveUpX: 240,
    giveUpMs: 1500,
    peck: {
      durationMs: 590,
      activeFromMs: 190,
      activeToMs: 330,
      box: { x: 17, y: 12, width: 14, height: 12 },
      rangeX: 22,
      rangeY: 18,
      cooldownMs: 350,
      damage: 1,
    },
  },
  wasp: {
    hp: 1,
    width: 16,
    height: 14,
    contactDamage: 1,
    stompable: false,
    hurtMs: 310,
    deathMs: 660,
    knockbackX: 120,
    knockbackY: 40,
    score: 15,
    range: 40,
    speed: 55,
    bobAmp: 3,
    bobMs: 1200,
    sight: 170,
    keepX: 80,
    keepY: 48,
    leash: 150,
    // The stinger leaves on frame 4 of the Shoot clip, from the curled-under tip of the abdomen.
    shoot: { durationMs: 670, fireAtMs: 330, cooldownMs: 1700, muzzleX: 8, muzzleY: -5 },
  },
  monkey: {
    hp: 2,
    width: 16,
    height: 22,
    contactDamage: 0,
    stompable: false,
    hurtMs: 320,
    deathMs: 770,
    knockbackX: 150,
    knockbackY: 180,
    score: 20,
    range: 32,
    climbSpeed: 28,
    walkSpeed: 50,
    idleMs: [700, 1600],
    moveMs: [500, 1100],
    sightX: 190,
    sightY: 110,
    // Release points from the sheet (frame 2 of Throw / Wall Throw), relative to the feet.
    throw: { durationMs: 570, releaseAtMs: 240, cooldownMs: 1500, releaseX: 13, releaseY: 22 },
    wallThrow: { durationMs: 570, releaseAtMs: 240, cooldownMs: 1500, releaseX: 15, releaseY: 24 },
    melee: {
      durationMs: 520,
      activeFromMs: 200,
      activeToMs: 340,
      box: { x: 15, y: 12, width: 16, height: 16 },
      rangeX: 26,
      rangeY: 22,
      cooldownMs: 500,
      damage: 1,
    },
    wallSwipe: {
      durationMs: 500,
      activeFromMs: 180,
      activeToMs: 320,
      box: { x: 17, y: 12, width: 16, height: 16 },
      rangeX: 28,
      rangeY: 24,
      cooldownMs: 500,
      damage: 1,
    },
  },
  bull: {
    hp: 3,
    width: 34,
    height: 22,
    contactDamage: 1,
    stompable: true,
    hurtMs: 330,
    deathMs: 670,
    knockbackX: 90,
    knockbackY: 120,
    score: 30,
    range: 64,
    walkSpeed: 34,
    turnPauseMs: 900,
    sightX: 210,
    sightY: 36,
    windupMs: 880,
    chargeSpeed: 230,
    chargeAccel: 700,
    maxChargeMs: 2600,
    crashMs: 350,
    stunnedMs: 1600,
    cooldownMs: 900,
    horns: { x: 20, y: 18, width: 14, height: 14 },
    hornKnockbackX: 360,
    hornKnockbackY: 320,
  },

  rhino: {
    hp: 12,
    width: 60,
    height: 46,
    contactDamage: 1,
    stompable: true,
    hurtMs: 330,
    deathMs: 1050,
    knockbackX: 40,
    knockbackY: 0,
    score: 200,
    range: 0,
    sightX: 320,
    sightY: 120,
    roarMs: 1020,
    thinkMs: [1400, 2400],
    walkSpeed: 30,
    windupMs: 920,
    chargeSpeed: 250,
    chargeAccel: 800,
    maxChargeMs: 4000,
    crashMs: 460,
    stunnedMs: 2800,
    chargeChance: 0.6,
    chargeMinX: 96,
    rocks: 3,
    // The front foot lands on frame 5 of the Stomp clip.
    stomp: { durationMs: 990, impactAtMs: 630, impactX: 12 },
    blockMs: 240,
    enrageMs: 1070,
    rage: { thinkMs: [800, 1500], walkSpeed: 54, chargeSpeed: 310, stunnedMs: 2000, rocks: 5 },
    // The horn hooks up and forward on frames 2–3 of Horn Swipe.
    hornSwipe: {
      durationMs: 560,
      activeFromMs: 200,
      activeToMs: 340,
      box: { x: 36, y: 30, width: 32, height: 44 },
      rangeX: 56,
      rangeY: 36,
      cooldownMs: 700,
      damage: 1,
    },
    horns: { x: 30, y: 28, width: 16, height: 20 },
    hornKnockbackX: 420,
    hornKnockbackY: 340,
  },

  stinger: { width: 8, height: 4, damage: 1, lifeMs: 2500, impactMs: 240, speed: 170 },
  banana: { width: 10, height: 8, damage: 1, lifeMs: 3000, impactMs: 350, gravity: 520, flightMinMs: 450, flightMaxMs: 1100, lobSpeed: 150 },
  shockwave: { width: 18, height: 12, damage: 1, lifeMs: 2400, impactMs: 280, speed: 170 },
  rock: { width: 14, height: 14, damage: 1, lifeMs: 4000, impactMs: 350, warnMs: 750, gravity: 900, maxFall: 420 },
};
