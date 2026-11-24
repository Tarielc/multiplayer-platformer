import { FOE_TUNING, isBoss, type FoeBox, type FoeCommon, type FoeMelee, type FoeTuning, type ShotKind } from '../../config/foes';
import { TICK_DT } from '../../config/net';
import { CellFlag, type LevelData } from '../../level/types';
import { approach, clamp, rectsOverlap, type Rect } from '../../util/math';
import { cellAt } from '../collision';
import { isCaptive, type FoeDef, type FoeState, type FoeStrike, type FoeTarget, type NetFoeState, type NetShotState } from './types';

/** A live foe: the replicated state plus the server's bookkeeping. */
export interface Foe extends NetFoeState {
  readonly homeX: number;
  readonly homeY: number;
  readonly range: number;
  grounded: boolean;
  /** Seconds until it may attack again. */
  cooldown: number;
  /** Seconds the current idle / stroll lasts. */
  span: number;
  /** Which way a wall monkey climbs (-1 up, 1 down). */
  dir: 1 | -1;
  /** The player it is after (chases, aims). */
  target: string | null;
  /** Seconds that player has been out of sight. */
  lost: number;
  /** The current attack already hurt someone / already let its shot go. */
  done: boolean;
  /** Seed of its pottering about (xorshift32), so the simulation stays deterministic. */
  rng: number;
  /** The player whose ability holds it, or spat it ('' when free). */
  owner: string;
  /** Spat: seconds of flight left. */
  flight: number;
  /** The rhino: 0 asleep (it roars on waking), 1 fighting, 2 in a rage. */
  phase: number;
  /**
   * Fall tracking: its feet `y` at the top of the current airtime, or where it was let go after
   * being carried (null on the ground; `Infinity` after being spat: the spit pays for the landing).
   */
  fallFrom: number | null;
  /** The player who let it fall (dropped it), credited if the landing beats it ('' none). */
  fallBy: string;
  /** Foes it already came down on during this fall (each is hit once). */
  fallHits: number[];
}

/** A foe touched down after a fall of `drop` px (`by`: who dropped it, '' nobody). */
export interface FoeLanding {
  foe: Foe;
  drop: number;
  by: string;
}

/** A falling foe (`faller`, `drop` px into its fall) came down on `foe`'s head (`by`: who dropped it). */
export interface FoeSquash {
  foe: Foe;
  faller: Foe;
  drop: number;
  by: string;
}

/** What a hit did to a foe: hearts left, `'blocked'` (armour), or null (already dying). */
export type FoeHurtResult = number | 'blocked' | null;

export interface Shot extends NetShotState {
  /** The foe that fired it. */
  owner: number;
}

const EPS = 1e-6;
/** Foes this far below the map are gone. */
const FALL_OUT = 64;

/**
 * The level's foes and the stingers and bananas they throw. Server-side only: the world steps
 * it once per tick (after the players moved) with where the players are, and gets back who
 * was hit. Foes collide with the level's tiles only (not with traps or players), stay out of
 * spikes and lava, and die in them if they are shoved in.
 */
export class FoeField {
  foes: Foe[];
  shots: Shot[] = [];
  private nextShotId = 1;
  /** Landings since the world last took them (`takeLandings`). */
  private landings: FoeLanding[] = [];
  /** Foes landed on by falling foes since the world last took them (`takeSquashes`). */
  private squashes: FoeSquash[] = [];
  /** Hurt zones foes keep out of: hazard zones, spikes, spike-heads. */
  private readonly noGo: readonly Rect[];

  private constructor(
    readonly level: LevelData,
    readonly config: Readonly<FoeTuning>,
    foes: Foe[],
    private readonly dt: number,
    noGo?: readonly Rect[],
  ) {
    this.foes = foes;
    this.noGo =
      noGo ??
      [...level.hazards, ...level.traps.flatMap((t) => (t.kind === 'spikes' || t.kind === 'spikeHead' ? [t] : []))].map((r) => ({
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      }));
  }

  static forLevel(level: LevelData, config: Readonly<FoeTuning> = FOE_TUNING, dt = TICK_DT): FoeField {
    return new FoeField(level, config, level.foes.map((def) => spawnFoe(def, config)), dt);
  }

  clone(): FoeField {
    const copy = new FoeField(
      this.level,
      this.config,
      this.foes.map((f) => ({ ...f, fallHits: [...f.fallHits] })),
      this.dt,
      this.noGo,
    );
    copy.shots = this.shots.map((s) => ({ ...s }));
    copy.nextShotId = this.nextShotId;
    return copy;
  }

  get empty(): boolean {
    return this.foes.length === 0 && this.shots.length === 0;
  }

  /** Foes that can be hit: not dying, not in a player's grip (or spat). */
  live(): Foe[] {
    return this.foes.filter((f) => this.catchable(f));
  }

  /** Whether `foe` can be hit (alive and loose). */
  catchable(foe: Readonly<Foe>): boolean {
    return foe.state !== 'dead' && !isCaptive(foe.state);
  }

  /** Whether a tongue or claw can catch `foe`: loose, and not a boss. */
  grabbable(foe: Readonly<Foe>): boolean {
    return this.catchable(foe) && !isBoss(foe.kind);
  }

  /** A boss is still alive (the exit stays shut). */
  get bossAlive(): boolean {
    return this.foes.some((f) => isBoss(f.kind) && f.state !== 'dead');
  }

  /** A tongue or claw caught `foe`: it stops what it was doing (a monkey lets go of its wall). */
  seize(foe: Foe, owner: string): void {
    this.enter(foe, 'held');
    foe.owner = owner;
    foe.vx = 0;
    foe.vy = 0;
    foe.wall = 0;
    foe.grounded = false;
  }

  /** Moves a caught foe's feet to (x, y); `swallowed` puts it in the frog's mouth (hidden). */
  carry(foe: Foe, x: number, y: number, vx: number, vy: number, state: 'held' | 'swallowed'): void {
    foe.x = x;
    foe.y = y;
    foe.vx = vx;
    foe.vy = vy;
    if (foe.state !== state) this.enter(foe, state);
  }

  /** Let go (dropped by the claw, coughed up): it falls from about (x, y), dazed for a moment. */
  release(foe: Foe, x: number, y: number, vx: number, vy: number): void {
    this.place(foe, x, y);
    this.enter(foe, 'hurt');
    foe.fallFrom = foe.y;
    foe.fallBy = foe.owner;
    foe.fallHits = [];
    foe.owner = '';
    foe.flight = 0;
    foe.vx = vx;
    foe.vy = vy;
    foe.grounded = false;
  }

  /** Spat out: flies from about (x, y) at (vx, vy) for `seconds`, or until it hits something. */
  launch(foe: Foe, x: number, y: number, vx: number, vy: number, seconds: number, owner: string): void {
    this.place(foe, x, y);
    this.enter(foe, 'flying');
    foe.owner = owner;
    foe.vx = vx;
    foe.vy = vy;
    foe.flight = seconds;
    foe.grounded = false;
    if (Math.abs(vx) > 1e-3) foe.facing = vx > 0 ? 1 : -1;
  }

  /** One tick of a spat foe's flight: straight on (no gravity). True when it hit the level. */
  fly(foe: Foe): boolean {
    foe.flight -= this.dt;
    const vy = foe.vy;
    const wall = this.moveX(foe, foe.vx * this.dt);
    const floor = this.moveY(foe, vy * this.dt, false);
    // moveY stops it (vy = 0) on a ceiling as well as on a floor.
    return wall || floor || (vy !== 0 && foe.vy === 0);
  }

  /** A spat foe's flight is over: it drops, dazed (the caller hurts it for the landing). */
  land(foe: Foe): void {
    this.enter(foe, 'hurt');
    foe.fallFrom = Infinity;
    foe.owner = '';
    foe.flight = 0;
    foe.vx *= 0.3;
    foe.vy = 0;
    foe.grounded = false;
  }

  hitbox(foe: Readonly<NetFoeState>): Rect {
    const c = this.config[foe.kind];
    return { x: foe.x - c.width / 2, y: foe.y - c.height, width: c.width, height: c.height };
  }

  /** The stompable foe `target` is landing on, if any (its feet at most a fall-step into its top). */
  stompVictim(target: FoeTarget): Foe | null {
    if (target.vy <= 0) return null;
    const feet = target.y + target.height;
    const slack = Math.max(6, target.vy * this.dt + 2);
    for (const foe of this.foes) {
      if (!this.catchable(foe) || !this.config[foe.kind].stompable) continue;
      const box = this.hitbox(foe);
      if (feet <= box.y + slack && rectsOverlap(targetRect(target), box)) return foe;
    }
    return null;
  }

  /**
   * A player hurt `foe` (`dir`: away from them). Returns the hearts it has left, `'blocked'` if
   * its armour took the hit (the rhino, unless it is dazed), or null if it can't be hurt
   * (already dying). A charging bull doesn't flinch.
   */
  hurt(foe: Foe, damage: number, dir: 1 | -1, by: string): FoeHurtResult {
    if (foe.state === 'dead') return null;
    if (foe.kind === 'rhino' && foe.state !== 'stunned' && foe.state !== 'hurt') {
      if (!foe.target && by) foe.target = by;
      if (foe.phase === 0) {
        // Woken up by it: roars first.
        if (foe.state !== 'roar') this.enter(foe, 'roar');
      } else if (foe.state === 'idle' || foe.state === 'walk' || foe.state === 'block') {
        // Shrugs it off; standing about, it braces (the Block clip). Mid-attack it doesn't even flinch.
        foe.vx = 0;
        this.enter(foe, 'block');
      }
      return 'blocked';
    }
    foe.hp = Math.max(0, foe.hp - damage);
    if (foe.hp <= 0) {
      this.die(foe);
      return 0;
    }
    if (foe.kind !== 'wasp' || !foe.target) foe.target = by;
    foe.lost = 0;
    if (foe.kind === 'bull' && (foe.state === 'charge' || foe.state === 'windup')) return foe.hp;
    const c = this.config[foe.kind];
    // A dazed rhino stays dazed for what is left of it (`span`), flinching at each hit.
    this.enter(foe, 'hurt');
    if (foe.wall === 0) {
      foe.facing = dir > 0 ? -1 : 1; // face whoever hit it
      foe.vx = dir * c.knockbackX;
      foe.vy = -c.knockbackY;
      foe.grounded = false;
    }
    return foe.hp;
  }

  /** Swings knock stingers, bananas and falling rocks out of the air (not shockwaves). Returns how many. */
  parry(area: Rect): number {
    let count = 0;
    for (const shot of this.shots) {
      if (shot.hit || shot.kind === 'shockwave' || this.hanging(shot) || !rectsOverlap(area, this.shotRect(shot))) continue;
      this.impact(shot);
      count += 1;
    }
    return count;
  }

  /** One tick: foes think and move, shots fly, and whoever they hit is returned (once per player). */
  step(tick: number, targets: readonly FoeTarget[]): FoeStrike[] {
    const strikes: FoeStrike[] = [];
    const struck = new Set<string>();
    const strike = (hit: FoeStrike): boolean => {
      if (struck.has(hit.targetId)) return false;
      struck.add(hit.targetId);
      strikes.push(hit);
      return true;
    };
    for (const foe of this.foes) {
      if (isCaptive(foe.state)) {
        // In a player's grip (or spat): the ability moves it. Spikes and lava still kill it.
        foe.t += this.dt;
        foe.fallFrom = foe.state === 'flying' ? Infinity : foe.y;
        if (foe.state !== 'swallowed' && this.inHazard(foe)) this.die(foe);
        continue;
      }
      // A boss, once woken, fights on wherever the players are in its hall.
      if (foe.state !== 'dead' && !(isBoss(foe.kind) && foe.phase > 0) && !this.awake(foe, targets)) continue;
      foe.t += this.dt;
      foe.cooldown = Math.max(0, foe.cooldown - this.dt);
      switch (foe.kind) {
        case 'mushroom':
          this.mushroom(foe);
          break;
        case 'chicken':
          this.chicken(foe, targets, strike);
          break;
        case 'wasp':
          this.wasp(foe, targets, tick);
          break;
        case 'monkey':
          this.monkey(foe, targets, strike);
          break;
        case 'bull':
          this.bull(foe, targets);
          break;
        case 'rhino':
          this.rhino(foe, targets, strike);
          break;
      }
      const blocked = this.physics(foe);
      if (foe.state === 'dead') continue;
      if ((foe.kind === 'bull' || foe.kind === 'rhino') && foe.state === 'charge' && blocked) this.crash(foe, targets);
      if (this.inHazard(foe)) {
        this.die(foe);
        continue;
      }
      this.contact(foe, targets, strike);
    }
    this.foes = this.foes.filter(
      (f) => !(f.state === 'dead' && f.t >= this.config[f.kind].deathMs / 1000) && f.y < this.level.heightPx + FALL_OUT,
    );
    this.stepShots(targets, strike);
    return strikes;
  }

  toNetFoes(): NetFoeState[] {
    return this.foes.map((f) => ({
      id: f.id,
      kind: f.kind,
      x: round(f.x),
      y: round(f.y),
      vx: round(f.vx),
      vy: round(f.vy),
      facing: f.facing,
      state: f.state,
      t: round(f.t),
      hp: f.hp,
      wall: f.wall,
    }));
  }

  toNetShots(): NetShotState[] {
    return this.shots.map((s) => ({
      id: s.id,
      kind: s.kind,
      x: round(s.x),
      y: round(s.y),
      vx: round(s.vx),
      vy: round(s.vy),
      hit: s.hit,
      t: round(s.t),
    }));
  }

  // --- the five foes ---------------------------------------------------------------------

  /** Walks its beat and pauses at each end. Hurts on touch. */
  private mushroom(foe: Foe): void {
    const c = this.config.mushroom;
    switch (foe.state) {
      case 'idle':
      case 'walk':
        this.patrol(foe, c.walkSpeed, c.turnPauseMs);
        break;
      case 'hurt':
        this.slide(foe);
        if (foe.t >= c.hurtMs / 1000) this.enter(foe, 'walk');
        break;
      case 'dead':
        this.slide(foe);
        break;
      default:
        this.enter(foe, 'walk');
    }
  }

  /** Potters about; on seeing a player squawks, chases them (not off ledges) and pecks. */
  private chicken(foe: Foe, targets: readonly FoeTarget[], strike: (hit: FoeStrike) => boolean): void {
    const c = this.config.chicken;
    switch (foe.state) {
      case 'idle':
      case 'walk': {
        const seen = this.spot(foe, targets, c.sightX, c.sightY, false);
        if (seen) {
          foe.target = seen.id;
          foe.lost = 0;
          this.face(foe, seen);
          foe.vx = 0;
          this.enter(foe, 'alert');
          break;
        }
        this.wander(foe, c.wanderSpeed, c.idleMs, c.wanderMs);
        break;
      }
      case 'alert':
        foe.vx = 0;
        if (foe.t >= c.alertMs / 1000) this.enter(foe, 'chase');
        break;
      case 'chase': {
        const target = this.pursue(foe, targets, c.giveUpX, c.sightY * 2, c.giveUpMs);
        if (!target) {
          this.rest(foe, c.idleMs);
          break;
        }
        const dx = centerX(target) - foe.x;
        if (Math.abs(dx) > 3) foe.facing = dx > 0 ? 1 : -1;
        if (foe.cooldown <= 0 && this.inReach(foe, target, c.peck)) {
          foe.vx = 0;
          this.enter(foe, 'attack');
          break;
        }
        foe.vx = Math.abs(dx) < 6 || this.blockedAhead(foe, foe.facing, false) ? 0 : foe.facing * c.chaseSpeed;
        break;
      }
      case 'attack':
        foe.vx = 0;
        this.melee(foe, c.peck, targets, strike);
        if (foe.t >= c.peck.durationMs / 1000) {
          foe.cooldown = c.peck.cooldownMs / 1000;
          this.enter(foe, 'chase');
        }
        break;
      case 'hurt':
        this.slide(foe);
        if (foe.t >= c.hurtMs / 1000) this.enter(foe, foe.target ? 'chase' : 'idle');
        break;
      case 'dead':
        this.slide(foe);
        break;
      default:
        this.enter(foe, 'idle');
    }
  }

  /**
   * Hovers on its beat; with a player in sight it keeps off to their side and above them, and
   * fires a stinger at them every so often.
   */
  private wasp(foe: Foe, targets: readonly FoeTarget[], tick: number): void {
    const c = this.config.wasp;
    const half = c.height / 2;
    switch (foe.state) {
      case 'idle':
      case 'walk':
      case 'chase': {
        const seen = this.spotWithin(foe, targets, c.sight);
        if (seen) {
          foe.target = seen.id;
          this.face(foe, seen);
          if (foe.state !== 'chase') this.enter(foe, 'chase');
          const tx = centerX(seen);
          const side = foe.x >= tx ? 1 : -1;
          const goalX = clamp(tx + side * c.keepX, foe.homeX - c.leash, foe.homeX + c.leash);
          const goalY = clamp(centerY(seen) - c.keepY + half, foe.homeY - c.leash, foe.homeY + c.leash);
          this.steer(foe, goalX, goalY, c.speed);
          if (foe.cooldown <= 0) this.enter(foe, 'shoot');
          break;
        }
        if (foe.state === 'chase') {
          foe.target = null;
          this.enter(foe, 'walk');
        }
        if (foe.state !== 'walk') this.enter(foe, 'walk');
        const out = (foe.x - foe.homeX) * foe.facing;
        if ((foe.range > 0 && out >= foe.range) || this.wallAhead(foe, foe.facing)) foe.facing = foe.facing === 1 ? -1 : 1;
        // Drift back towards its beat, bobbing.
        const bob = c.bobAmp * Math.sin((tick * this.dt * 2 * Math.PI) / (c.bobMs / 1000) + foe.id);
        foe.vx = foe.facing * c.speed * 0.6;
        foe.vy = clamp((foe.homeY + bob - foe.y) * 4, -c.speed, c.speed);
        break;
      }
      case 'shoot': {
        foe.vx *= 0.9;
        foe.vy *= 0.9;
        const target = this.find(targets, foe.target);
        if (target && !foe.done) this.face(foe, target);
        if (!foe.done && foe.t >= c.shoot.fireAtMs / 1000) {
          foe.done = true;
          const mx = foe.x + foe.facing * c.shoot.muzzleX;
          const my = foe.y - c.shoot.muzzleY;
          const dx = target ? centerX(target) - mx : foe.facing;
          const dy = target ? centerY(target) - my : 0;
          const len = Math.hypot(dx, dy) || 1;
          const speed = this.config.stinger.speed;
          this.fire('stinger', mx, my, (dx / len) * speed, (dy / len) * speed, foe.id);
        }
        if (foe.t >= c.shoot.durationMs / 1000) {
          foe.cooldown = c.shoot.cooldownMs / 1000;
          this.enter(foe, 'chase');
        }
        break;
      }
      case 'hurt':
        foe.vx *= 0.92;
        foe.vy *= 0.92;
        if (foe.t >= c.hurtMs / 1000) this.enter(foe, 'chase');
        break;
      case 'dead':
        foe.vx = 0;
        foe.vy = 0;
        break;
      default:
        this.enter(foe, 'walk');
    }
  }

  /**
   * Clings to a wall, climbing up and down (or walks about on the ground). Throws bananas at
   * players it can see in front of it, and swipes at anyone who comes too close.
   */
  private monkey(foe: Foe, targets: readonly FoeTarget[], strike: (hit: FoeStrike) => boolean): void {
    const c = this.config.monkey;
    const onWall = foe.wall !== 0;
    const swipe = onWall ? c.wallSwipe : c.melee;
    const toss = onWall ? c.wallThrow : c.throw;
    switch (foe.state) {
      case 'idle':
      case 'walk': {
        const seen = foe.cooldown <= 0 ? this.spot(foe, targets, c.sightX, c.sightY, onWall) : null;
        if (seen) {
          foe.target = seen.id;
          if (!onWall) this.face(foe, seen);
          foe.vx = 0;
          if (onWall) foe.vy = 0;
          this.enter(foe, this.inReach(foe, seen, swipe) ? 'attack' : 'throw');
          break;
        }
        if (onWall) this.climb(foe);
        else this.wander(foe, c.walkSpeed, c.idleMs, c.moveMs);
        break;
      }
      case 'throw': {
        this.hold(foe);
        if (!foe.done && foe.t >= toss.releaseAtMs / 1000) {
          foe.done = true;
          this.lob(foe, foe.x + foe.facing * toss.releaseX, foe.y - toss.releaseY, this.find(targets, foe.target));
        }
        if (foe.t >= toss.durationMs / 1000) {
          foe.cooldown = toss.cooldownMs / 1000;
          this.rest(foe, c.idleMs);
        }
        break;
      }
      case 'attack':
        this.hold(foe);
        this.melee(foe, swipe, targets, strike);
        if (foe.t >= swipe.durationMs / 1000) {
          foe.cooldown = swipe.cooldownMs / 1000;
          this.rest(foe, c.idleMs);
        }
        break;
      case 'hurt':
        this.hold(foe);
        if (foe.t >= c.hurtMs / 1000) this.rest(foe, c.idleMs);
        break;
      case 'dead':
        this.slide(foe);
        break;
      default:
        this.enter(foe, 'idle');
    }
  }

  /**
   * Plods its beat. A player ahead of it in plain sight: it paws the ground, then charges until
   * it hits a wall (crashes, then stands dazed), runs out of ground, or runs out of steam.
   */
  private bull(foe: Foe, targets: readonly FoeTarget[]): void {
    const c = this.config.bull;
    switch (foe.state) {
      case 'idle':
      case 'walk': {
        const seen = foe.cooldown <= 0 && foe.grounded ? this.spot(foe, targets, c.sightX, c.sightY, true) : null;
        if (seen) {
          foe.target = seen.id;
          foe.vx = 0;
          this.enter(foe, 'windup');
          break;
        }
        this.patrol(foe, c.walkSpeed, c.turnPauseMs);
        break;
      }
      case 'windup':
        foe.vx = 0;
        if (foe.t >= c.windupMs / 1000) this.enter(foe, 'charge');
        break;
      case 'charge':
        if (foe.t >= c.maxChargeMs / 1000 || this.dropAhead(foe, foe.facing)) {
          foe.vx = 0;
          foe.cooldown = c.cooldownMs / 1000;
          this.rest(foe, [c.turnPauseMs, c.turnPauseMs]);
          break;
        }
        foe.vx = approach(foe.vx, foe.facing * c.chargeSpeed, c.chargeAccel * this.dt);
        break;
      case 'crash':
        this.slide(foe);
        if (foe.t >= c.crashMs / 1000) this.enter(foe, 'stunned');
        break;
      case 'stunned':
        this.slide(foe);
        if (foe.t >= c.stunnedMs / 1000) {
          foe.cooldown = c.cooldownMs / 1000;
          foe.facing = foe.facing === 1 ? -1 : 1; // shakes it off and turns around
          this.enter(foe, 'walk');
        }
        break;
      case 'hurt':
        this.slide(foe);
        if (foe.t >= c.hurtMs / 1000) this.enter(foe, 'walk');
        break;
      case 'dead':
        this.slide(foe);
        break;
      default:
        this.enter(foe, 'walk');
    }
  }

  /**
   * The boss (see `FoeTuning.rhino`): asleep, then a roar, then it walks at the nearest player,
   * swiping at anyone right in front, and every `thinkMs` charges or stomps. Hurt only while dazed.
   */
  private rhino(foe: Foe, targets: readonly FoeTarget[], strike: (hit: FoeStrike) => boolean): void {
    const c = this.config.rhino;
    const rage = foe.phase === 2;
    const seconds = (ms: number) => ms / 1000;
    switch (foe.state) {
      case 'idle':
      case 'walk': {
        if (foe.phase === 0) {
          foe.vx = 0;
          const seen = this.spot(foe, targets, c.sightX, c.sightY, false);
          if (seen) {
            foe.target = seen.id;
            this.face(foe, seen);
            this.enter(foe, 'roar');
          }
          break;
        }
        // Half health or less: it flies into a rage, once.
        if (foe.phase === 1 && foe.hp <= c.hp / 2) {
          foe.vx = 0;
          this.enter(foe, 'enrage');
          break;
        }
        const target = this.nearest(foe, targets);
        if (!target) {
          foe.vx = 0;
          if (foe.state !== 'idle') this.enter(foe, 'idle');
          break;
        }
        foe.target = target.id;
        if (foe.state === 'idle') {
          this.enter(foe, 'walk');
          foe.span = this.between(foe, rage ? c.rage.thinkMs : c.thinkMs);
        }
        const dx = centerX(target) - foe.x;
        if (Math.abs(dx) > 4) foe.facing = dx > 0 ? 1 : -1;
        // The clock to its next charge or stomp runs whatever else it does (swipes included).
        foe.span -= this.dt;
        if (foe.span > 0 && foe.cooldown <= 0 && this.inReach(foe, target, c.hornSwipe)) {
          foe.vx = 0;
          this.enter(foe, 'attack');
          break;
        }
        if (foe.span <= 0 && foe.grounded) {
          foe.vx = 0;
          const level = Math.abs(centerY(target) - (foe.y - c.height / 2)) <= c.height;
          const charge = level && Math.abs(dx) >= c.chargeMinX && this.random(foe) < c.chargeChance;
          this.enter(foe, charge ? 'windup' : 'stomp');
          break;
        }
        const close = Math.abs(dx) < c.width / 2;
        foe.vx = close || this.blockedAhead(foe, foe.facing, false) ? 0 : foe.facing * (rage ? c.rage.walkSpeed : c.walkSpeed);
        break;
      }
      case 'roar':
        foe.vx = 0;
        if (foe.t >= seconds(c.roarMs)) {
          foe.phase = 1;
          this.enter(foe, 'idle');
        }
        break;
      case 'enrage':
        foe.vx = 0;
        if (foe.t >= seconds(c.enrageMs)) {
          foe.phase = 2;
          this.enter(foe, 'idle');
        }
        break;
      case 'block':
        this.slide(foe);
        if (foe.t >= seconds(c.blockMs)) this.enter(foe, 'idle');
        break;
      case 'attack': {
        foe.vx = 0;
        this.melee(foe, c.hornSwipe, targets, strike);
        if (foe.t >= seconds(c.hornSwipe.durationMs)) {
          foe.cooldown = seconds(c.hornSwipe.cooldownMs);
          // Back to walking, its charge-or-stomp clock still running.
          const span = foe.span;
          this.enter(foe, 'walk');
          foe.span = span;
        }
        break;
      }
      case 'windup': {
        foe.vx = 0;
        const target = this.find(targets, foe.target);
        if (target && foe.t < seconds(c.windupMs) / 2) this.face(foe, target);
        if (foe.t >= seconds(c.windupMs)) this.enter(foe, 'charge');
        break;
      }
      case 'charge':
        if (foe.t >= seconds(c.maxChargeMs) || this.dropAhead(foe, foe.facing)) {
          foe.vx = 0;
          this.enter(foe, 'idle');
          break;
        }
        foe.vx = approach(foe.vx, foe.facing * (rage ? c.rage.chargeSpeed : c.chargeSpeed), c.chargeAccel * this.dt);
        break;
      case 'stomp':
        foe.vx = 0;
        if (!foe.done && foe.t >= seconds(c.stomp.impactAtMs)) {
          foe.done = true;
          const s = this.config.shockwave;
          const y = foe.y - s.height / 2;
          for (const dir of [1, -1] as const) {
            this.fire('shockwave', foe.x + dir * (c.stomp.impactX + s.width / 2), y, dir * s.speed, 0, foe.id);
          }
          // The shockwaves can't reach anyone up on a ledge: a rock comes loose over them instead.
          const ts = this.level.tileSize;
          for (const target of targets) {
            if (!target.visible || target.y + target.height > foe.y - ts || Math.abs(centerX(target) - foe.x) > c.sightX * 2) continue;
            const ceiling = this.ceilingAbove(centerX(target), target.y);
            if (ceiling !== null) this.fire('rock', centerX(target), ceiling + this.config.rock.height / 2, 0, 0, foe.id);
          }
        }
        if (foe.t >= seconds(c.stomp.durationMs)) this.enter(foe, 'idle');
        break;
      case 'crash':
        this.slide(foe);
        if (foe.t >= seconds(c.crashMs)) {
          this.enter(foe, 'stunned');
          foe.span = seconds(rage ? c.rage.stunnedMs : c.stunnedMs);
        }
        break;
      case 'stunned':
        this.slide(foe);
        foe.span -= this.dt;
        if (foe.span <= 0) {
          foe.facing = foe.facing === 1 ? -1 : 1; // shakes it off and turns around
          this.enter(foe, 'idle');
        }
        break;
      case 'hurt':
        this.slide(foe);
        foe.span -= this.dt;
        if (foe.t >= seconds(c.hurtMs)) this.enter(foe, foe.span > 0 ? 'stunned' : 'idle');
        break;
      case 'dead':
        this.slide(foe);
        break;
      default:
        this.enter(foe, 'idle');
    }
  }

  private crash(foe: Foe, targets: readonly FoeTarget[]): void {
    this.enter(foe, 'crash');
    if (foe.kind === 'rhino') {
      foe.vx = -foe.facing * 90;
      foe.vy = -120;
      this.rockfall(foe, targets);
    } else {
      foe.vx = -foe.facing * 70;
      foe.vy = -150;
    }
    foe.grounded = false;
  }

  /**
   * The crash shakes rocks loose: one over each player, the rest spread over the floor it
   * stands on (between the walls either side), each hanging from the ceiling above its spot.
   */
  private rockfall(foe: Foe, targets: readonly FoeTarget[]): void {
    const c = this.config.rhino;
    const r = this.config.rock;
    const count = foe.phase === 2 ? c.rage.rocks : c.rocks;
    const ts = this.level.tileSize;
    const probeY = foe.y - ts / 2;
    const reach = 48 * ts;
    let left = foe.x;
    while (left > foe.x - reach && !this.solidAt(left - ts, probeY)) left -= ts;
    let right = foe.x;
    while (right < foe.x + reach && !this.solidAt(right + ts, probeY)) right += ts;
    left = Math.floor(left / ts) * ts + r.width;
    right = Math.ceil(right / ts) * ts - r.width;
    const spots: number[] = [];
    for (const target of targets) {
      if (target.visible && spots.length < count && centerX(target) >= left && centerX(target) <= right) spots.push(centerX(target));
    }
    for (let tries = 0; spots.length < count && tries < count * 8; tries++) {
      const x = left + (right - left) * this.random(foe);
      if (spots.every((s) => Math.abs(s - x) >= r.width * 2)) spots.push(x);
    }
    for (const x of spots) {
      const ceiling = this.ceilingAbove(x, probeY);
      if (ceiling === null) continue;
      this.fire('rock', x, ceiling + r.height / 2, 0, 0, foe.id);
    }
  }

  /** The bottom of the first solid tile straight above (x, y), or null (open sky). */
  private ceilingAbove(x: number, y: number): number | null {
    const ts = this.level.tileSize;
    for (let row = Math.floor(y / ts) - 1; row >= 0; row--) {
      if (cellAt(this.level, Math.floor(x / ts), row) & CellFlag.SOLID) return (row + 1) * ts;
    }
    return null;
  }

  /** The nearest player it can go after (anywhere: a boss doesn't lose sight of anyone). */
  private nearest(foe: Foe, targets: readonly FoeTarget[]): FoeTarget | null {
    let best: FoeTarget | null = null;
    let bestDistance = Infinity;
    for (const target of targets) {
      if (!target.visible) continue;
      const distance = Math.abs(centerX(target) - foe.x) + Math.abs(centerY(target) - this.eyeY(foe));
      if (distance < bestDistance) {
        best = target;
        bestDistance = distance;
      }
    }
    return best;
  }

  // --- shared behaviours -----------------------------------------------------------------

  private enter(foe: Foe, state: FoeState): void {
    foe.state = state;
    foe.t = 0;
    foe.done = false;
  }

  private die(foe: Foe): void {
    this.enter(foe, 'dead');
    foe.hp = 0;
    foe.target = null;
    foe.owner = '';
    foe.flight = 0;
    foe.vx = 0;
    if (foe.kind === 'wasp') foe.vy = 0;
    // A monkey lets go of its wall.
    foe.wall = 0;
  }

  /** Idle for a while (a random span from `ms`). */
  private rest(foe: Foe, ms: readonly [number, number]): void {
    foe.vx = 0;
    this.enter(foe, 'idle');
    foe.span = this.between(foe, ms);
  }

  /** Walks back and forth, pausing at each turn. */
  private patrol(foe: Foe, speed: number, pauseMs: number): void {
    if (foe.state === 'idle') {
      foe.vx = 0;
      if (foe.t >= foe.span) this.enter(foe, 'walk');
      return;
    }
    if (this.blockedAhead(foe, foe.facing, true)) {
      foe.facing = foe.facing === 1 ? -1 : 1;
      this.rest(foe, [pauseMs, pauseMs]);
      return;
    }
    foe.vx = foe.facing * speed;
  }

  /** Short strolls in a random direction between idle spells. */
  private wander(foe: Foe, speed: number, idleMs: readonly [number, number], walkMs: readonly [number, number]): void {
    if (foe.state === 'idle') {
      foe.vx = 0;
      if (foe.t < foe.span) return;
      if (this.random(foe) < 0.5) foe.facing = foe.facing === 1 ? -1 : 1;
      this.enter(foe, 'walk');
      foe.span = this.between(foe, walkMs);
      return;
    }
    if (this.blockedAhead(foe, foe.facing, true)) {
      foe.facing = foe.facing === 1 ? -1 : 1;
      this.rest(foe, idleMs);
      return;
    }
    foe.vx = foe.facing * speed;
    if (foe.t >= foe.span) this.rest(foe, idleMs);
  }

  /** A wall monkey climbs `range` px up and down its wall, resting in between. */
  private climb(foe: Foe): void {
    const c = this.config.monkey;
    foe.vx = 0;
    if (foe.state === 'idle') {
      foe.vy = 0;
      if (foe.t < foe.span) return;
      foe.dir = this.random(foe) < 0.5 ? -1 : 1;
      this.enter(foe, 'walk');
      foe.span = this.between(foe, c.moveMs);
      return;
    }
    const next = foe.y + foe.dir * c.climbSpeed * this.dt;
    const outOfRange = foe.range > 0 && (next - foe.homeY) * foe.dir > foe.range;
    const edgeY = foe.dir < 0 ? next - c.height - 1 : next + 1;
    const end = this.solidAt(foe.x, edgeY) || this.hazardAt(foe.x, edgeY);
    if (outOfRange || end || !this.wallBeside(foe, next)) {
      foe.dir = foe.dir === 1 ? -1 : 1;
      this.rest(foe, c.idleMs);
      foe.vy = 0;
      return;
    }
    foe.vy = foe.dir * c.climbSpeed;
    if (foe.t >= foe.span) {
      this.rest(foe, c.idleMs);
      foe.vy = 0;
    }
  }

  /** Stands still (on a wall: holds on; on the ground: skids to a stop). */
  private hold(foe: Foe): void {
    if (foe.wall !== 0) {
      foe.vx = 0;
      foe.vy = 0;
    } else {
      this.slide(foe);
    }
  }

  /** Ground friction (after a shove). */
  private slide(foe: Foe): void {
    if (foe.grounded) foe.vx = approach(foe.vx, 0, this.config.friction * this.dt);
  }

  /** Flies towards a point, slowing as it gets there. */
  private steer(foe: Foe, x: number, y: number, speed: number): void {
    foe.vx = clamp((x - foe.x) * 2.5, -speed, speed);
    foe.vy = clamp((y - foe.y) * 2.5, -speed, speed);
  }

  private face(foe: Foe, target: FoeTarget): void {
    const dx = centerX(target) - foe.x;
    if (Math.abs(dx) > 1) foe.facing = dx > 0 ? 1 : -1;
  }

  /** The player it chases, while it can still see them (or lost them only a moment ago). */
  private pursue(foe: Foe, targets: readonly FoeTarget[], maxX: number, maxY: number, giveUpMs: number): FoeTarget | null {
    const target = this.find(targets, foe.target);
    if (!target) {
      foe.target = null;
      return null;
    }
    const near = Math.abs(centerX(target) - foe.x) <= maxX && Math.abs(centerY(target) - this.eyeY(foe)) <= maxY;
    if (near && this.canSee(foe.x, this.eyeY(foe), centerX(target), centerY(target))) foe.lost = 0;
    else foe.lost += this.dt;
    if (foe.lost >= giveUpMs / 1000) {
      foe.target = null;
      return null;
    }
    return target;
  }

  /** The nearest player in sight (within `maxX`/`maxY` of its eyes; `ahead`: only in front). */
  private spot(foe: Foe, targets: readonly FoeTarget[], maxX: number, maxY: number, ahead: boolean): FoeTarget | null {
    const eyeY = this.eyeY(foe);
    let best: FoeTarget | null = null;
    let bestDistance = Infinity;
    for (const target of targets) {
      if (!target.visible) continue;
      const dx = centerX(target) - foe.x;
      const dy = centerY(target) - eyeY;
      if (Math.abs(dx) > maxX || Math.abs(dy) > maxY || (ahead && dx * foe.facing < 0)) continue;
      const distance = dx * dx + dy * dy;
      if (distance >= bestDistance || !this.canSee(foe.x, eyeY, centerX(target), centerY(target))) continue;
      best = target;
      bestDistance = distance;
    }
    return best;
  }

  /** The nearest player in sight within `radius` px. */
  private spotWithin(foe: Foe, targets: readonly FoeTarget[], radius: number): FoeTarget | null {
    const seen = this.spot(foe, targets, radius, radius, false);
    if (!seen) return null;
    return Math.hypot(centerX(seen) - foe.x, centerY(seen) - this.eyeY(foe)) <= radius ? seen : null;
  }

  private find(targets: readonly FoeTarget[], id: string | null): FoeTarget | null {
    if (!id) return null;
    return targets.find((t) => t.id === id && t.visible) ?? null;
  }

  private eyeY(foe: Foe): number {
    return foe.y - this.config[foe.kind].height * 0.6;
  }

  /** A melee attack can start: the player is right in front, about level with it. */
  private inReach(foe: Foe, target: FoeTarget, melee: FoeMelee): boolean {
    const dx = centerX(target) - foe.x;
    const dy = centerY(target) - (foe.y - this.config[foe.kind].height / 2);
    return dx * foe.facing >= -2 && Math.abs(dx) <= melee.rangeX && Math.abs(dy) <= melee.rangeY;
  }

  /** The attack's hit window: the first player in the box is hit (one per attack). */
  private melee(foe: Foe, melee: FoeMelee, targets: readonly FoeTarget[], strike: (hit: FoeStrike) => boolean): void {
    if (foe.done || foe.t < melee.activeFromMs / 1000 || foe.t > melee.activeToMs / 1000) return;
    const box = this.box(foe, melee.box);
    const { hit } = this.config;
    for (const target of targets) {
      if (!target.vulnerable || !rectsOverlap(box, targetRect(target))) continue;
      const landed = strike({
        targetId: target.id,
        foeId: foe.id,
        damage: melee.damage,
        dir: foe.facing,
        knockbackX: hit.knockbackX,
        knockbackY: hit.knockbackY,
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
      });
      if (landed) {
        foe.done = true;
        return;
      }
    }
  }

  /** Touching it hurts (a charging bull's or rhino's horns throw you further). Landing on top never does. */
  private contact(foe: Foe, targets: readonly FoeTarget[], strike: (hit: FoeStrike) => boolean): void {
    const c: FoeCommon = this.config[foe.kind];
    if (c.contactDamage <= 0 || foe.state === 'hurt' || foe.state === 'stunned' || (foe.kind === 'rhino' && foe.phase === 0)) return;
    const body = this.hitbox(foe);
    const charger = foe.kind === 'bull' ? this.config.bull : foe.kind === 'rhino' ? this.config.rhino : null;
    const charging = charger !== null && foe.state === 'charge';
    const horns = charger && charging ? this.box(foe, charger.horns) : null;
    const { hit } = this.config;
    for (const target of targets) {
      if (!target.vulnerable) continue;
      const rect = targetRect(target);
      if (!rectsOverlap(rect, body) && !(horns && rectsOverlap(rect, horns))) continue;
      if (c.stompable && target.y + target.height <= body.y + Math.max(6, target.vy * this.dt + 2)) continue;
      const away = centerX(target) - foe.x;
      strike({
        targetId: target.id,
        foeId: foe.id,
        damage: c.contactDamage,
        dir: Math.abs(away) > 0.5 ? (away > 0 ? 1 : -1) : foe.facing,
        knockbackX: charger && charging ? charger.hornKnockbackX : hit.knockbackX,
        knockbackY: charger && charging ? charger.hornKnockbackY : hit.knockbackY,
        x: (centerX(target) + foe.x) / 2,
        y: (centerY(target) + body.y + body.height / 2) / 2,
      });
    }
  }

  /** A box relative to the feet, mirrored with the facing. */
  private box(foe: Foe, b: FoeBox): Rect {
    return { x: foe.x + foe.facing * b.x - b.width / 2, y: foe.y - b.y - b.height / 2, width: b.width, height: b.height };
  }

  // --- projectiles -------------------------------------------------------------------------

  private fire(kind: ShotKind, x: number, y: number, vx: number, vy: number, owner: number): void {
    this.shots.push({ id: this.nextShotId++, kind, x, y, vx, vy, hit: false, t: 0, owner });
  }

  /** A banana lobbed to land on the target (or straight ahead). */
  private lob(foe: Foe, x: number, y: number, target: FoeTarget | null): void {
    const b = this.config.banana;
    const tx = target ? centerX(target) : x + foe.facing * 96;
    const ty = target ? centerY(target) : y;
    const dx = tx - x;
    const time = clamp(Math.abs(dx) / b.lobSpeed, b.flightMinMs / 1000, b.flightMaxMs / 1000);
    this.fire('banana', x, y, dx / time, (ty - y - 0.5 * b.gravity * time * time) / time, foe.id);
  }

  /** A rock still hanging from the ceiling (harmless). */
  private hanging(shot: Shot): boolean {
    return shot.kind === 'rock' && !shot.hit && shot.t < this.config.rock.warnMs / 1000;
  }

  private impact(shot: Shot): void {
    shot.hit = true;
    shot.t = 0;
    shot.vx = 0;
    shot.vy = 0;
  }

  private shotRect(shot: Shot): Rect {
    const c = this.config[shot.kind];
    return { x: shot.x - c.width / 2, y: shot.y - c.height / 2, width: c.width, height: c.height };
  }

  private stepShots(targets: readonly FoeTarget[], strike: (hit: FoeStrike) => boolean): void {
    const { level } = this;
    this.shots = this.shots.filter((shot) => {
      const c = this.config[shot.kind];
      shot.t += this.dt;
      if (shot.hit) return shot.t < c.impactMs / 1000;
      if (this.hanging(shot)) return true;
      if (shot.kind === 'banana') shot.vy += this.config.banana.gravity * this.dt;
      if (shot.kind === 'rock') shot.vy = Math.min(this.config.rock.maxFall, shot.vy + this.config.rock.gravity * this.dt);
      shot.x += shot.vx * this.dt;
      shot.y += shot.vy * this.dt;
      if (shot.t >= c.lifeMs / 1000 || shot.y > level.heightPx + FALL_OUT || shot.x < -FALL_OUT || shot.x > level.widthPx + FALL_OUT) return false;
      if (shot.kind === 'shockwave') {
        // Along the ground: a wall stops it, and it dies out at a ledge.
        const dir = shot.vx >= 0 ? 1 : -1;
        const feet = shot.y + c.height / 2;
        if (this.solidAt(shot.x + (dir * c.width) / 2, feet - 2) || !this.floorAt(shot.x, feet + 2)) {
          this.impact(shot);
          return true;
        }
      } else if (shot.kind === 'rock') {
        // Lands on the floor (it falls through one-way platforms).
        const bottom = shot.y + c.height / 2;
        if (this.solidAt(shot.x, bottom)) {
          shot.y = Math.floor(bottom / level.tileSize) * level.tileSize - c.height / 2;
          this.impact(shot);
          return true;
        }
      } else if (this.solidAt(shot.x, shot.y)) {
        this.impact(shot);
        return true;
      }
      const rect = this.shotRect(shot);
      for (const target of targets) {
        if (!target.vulnerable || !rectsOverlap(rect, targetRect(target))) continue;
        const dir = shot.vx > 0.5 ? 1 : shot.vx < -0.5 ? -1 : centerX(target) >= shot.x ? 1 : -1;
        const { hit } = this.config;
        strike({ targetId: target.id, foeId: shot.owner, damage: c.damage, dir, knockbackX: hit.knockbackX, knockbackY: hit.knockbackY, x: shot.x, y: shot.y });
        this.impact(shot);
        break;
      }
      return true;
    });
  }

  // --- movement and the level --------------------------------------------------------------

  /** Asleep while no player is anywhere near (alive or not): nothing changes, nothing is sent. */
  private awake(foe: Foe, targets: readonly FoeTarget[]): boolean {
    const { wakeX, wakeY } = this.config;
    return targets.some((t) => Math.abs(centerX(t) - foe.x) <= wakeX && Math.abs(centerY(t) - foe.y) <= wakeY);
  }

  /** Gravity and tile collisions. Returns true when it ran into a wall sideways. */
  private physics(foe: Foe): boolean {
    const flying = foe.kind === 'wasp';
    const clinging = foe.wall !== 0;
    if (!flying && !clinging) {
      foe.vy = Math.min(this.config.maxFall, foe.vy + this.config.gravity * this.dt);
    }
    const blocked = this.moveX(foe, foe.vx * this.dt);
    if (blocked) foe.vx = 0;
    const feetBefore = foe.y;
    const landed = this.moveY(foe, foe.vy * this.dt, !flying);
    foe.grounded = !flying && !clinging && landed;
    this.fallOnFoes(foe, feetBefore);
    this.trackFall(foe);
    return blocked;
  }

  /**
   * A falling foe whose feet came down through another foe's head this tick lands on it (once
   * per fall); the world decides what that costs (`takeSquashes`). It falls on through, as
   * foes don't stand on each other.
   */
  private fallOnFoes(foe: Foe, feetBefore: number): void {
    const from = foe.fallFrom;
    if (from === null || from === Infinity || foe.y <= feetBefore || foe.state === 'dead' || foe.kind === 'wasp') return;
    const box = this.hitbox(foe);
    const slack = Math.max(6, foe.y - feetBefore + 2);
    for (const other of this.foes) {
      if (other === foe || !this.catchable(other) || foe.fallHits.includes(other.id)) continue;
      const head = this.hitbox(other);
      if (feetBefore > head.y + slack || !rectsOverlap(box, head)) continue;
      foe.fallHits.push(other.id);
      this.squashes.push({ foe: other, faller: foe, drop: foe.y - from, by: foe.fallBy });
    }
  }

  /** Follows a foe's airtime; a landing is kept for the world to charge (`takeLandings`). */
  private trackFall(foe: Foe): void {
    if (foe.state === 'dead' || foe.kind === 'wasp' || foe.wall !== 0) {
      foe.fallFrom = null;
      foe.fallBy = '';
      return;
    }
    if (foe.grounded) {
      const from = foe.fallFrom;
      const by = foe.fallBy;
      foe.fallFrom = null;
      foe.fallBy = '';
      foe.fallHits = [];
      if (from !== null && foe.y - from > 0) this.landings.push({ foe, drop: foe.y - from, by });
      return;
    }
    if (foe.fallFrom === null || (foe.vy < 0 && foe.fallFrom !== Infinity)) foe.fallFrom = foe.y;
  }

  /** Foes that touched down since the last call, with how far they fell. */
  takeLandings(): FoeLanding[] {
    const out = this.landings;
    this.landings = [];
    return out;
  }

  /** Foes that falling foes came down on since the last call. */
  takeSquashes(): FoeSquash[] {
    const out = this.squashes;
    this.squashes = [];
    return out;
  }

  private moveX(foe: Foe, dx: number): boolean {
    if (dx === 0) return false;
    const c = this.config[foe.kind];
    const ts = this.level.tileSize;
    const r0 = Math.floor((foe.y - c.height) / ts);
    const r1 = Math.floor((foe.y - EPS) / ts);
    const solidColumn = (col: number) => {
      for (let row = r0; row <= r1; row++) if (cellAt(this.level, col, row) & CellFlag.SOLID) return true;
      return false;
    };
    if (dx > 0) {
      const edge = foe.x + c.width / 2;
      for (let col = Math.floor((edge - EPS) / ts) + 1; col <= Math.floor((edge + dx - EPS) / ts); col++) {
        if (solidColumn(col)) {
          foe.x = col * ts - c.width / 2;
          return true;
        }
      }
    } else {
      const edge = foe.x - c.width / 2;
      for (let col = Math.floor(edge / ts) - 1; col >= Math.floor((edge + dx) / ts); col--) {
        if (solidColumn(col)) {
          foe.x = (col + 1) * ts + c.width / 2;
          return true;
        }
      }
    }
    foe.x += dx;
    return false;
  }

  /** Returns true when it landed on something (one-way platforms count when `platforms`). */
  private moveY(foe: Foe, dy: number, platforms: boolean): boolean {
    if (dy === 0) return false;
    const c = this.config[foe.kind];
    const ts = this.level.tileSize;
    const c0 = Math.floor((foe.x - c.width / 2) / ts);
    const c1 = Math.floor((foe.x + c.width / 2 - EPS) / ts);
    const rowHas = (row: number, flags: number) => {
      for (let col = c0; col <= c1; col++) if (cellAt(this.level, col, row) & flags) return true;
      return false;
    };
    if (dy > 0) {
      const floorFlags = platforms ? CellFlag.SOLID | CellFlag.ONE_WAY : CellFlag.SOLID;
      for (let row = Math.floor((foe.y - EPS) / ts) + 1; row <= Math.floor((foe.y + dy - EPS) / ts); row++) {
        if (rowHas(row, floorFlags)) {
          foe.y = row * ts;
          foe.vy = 0;
          return true;
        }
      }
    } else {
      const top = foe.y - c.height;
      for (let row = Math.floor(top / ts) - 1; row >= Math.floor((top + dy) / ts); row--) {
        if (rowHas(row, CellFlag.SOLID)) {
          foe.y = (row + 1) * ts + c.height;
          foe.vy = 0;
          return false;
        }
      }
    }
    foe.y += dy;
    return false;
  }

  /** Puts `foe`'s feet at (x, y), or at the nearest spot around it clear of walls. */
  private place(foe: Foe, x: number, y: number): void {
    const reach = this.level.tileSize;
    for (let d = 0; d <= reach; d += 2) {
      for (const [dx, dy] of [
        [0, -d],
        [-d, 0],
        [d, 0],
        [0, d],
        [-d, -d],
        [d, -d],
      ] as const) {
        if (!this.fits(foe, x + dx, y + dy)) continue;
        foe.x = x + dx;
        foe.y = y + dy;
        return;
      }
    }
    foe.x = x;
    foe.y = y;
  }

  /** Whether `foe` with its feet at (x, y) is clear of solid tiles. */
  private fits(foe: Foe, x: number, y: number): boolean {
    const c = this.config[foe.kind];
    const ts = this.level.tileSize;
    const c0 = Math.floor((x - c.width / 2) / ts);
    const c1 = Math.floor((x + c.width / 2 - EPS) / ts);
    const r0 = Math.floor((y - c.height) / ts);
    const r1 = Math.floor((y - EPS) / ts);
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) if (cellAt(this.level, col, row) & CellFlag.SOLID) return false;
    }
    return true;
  }

  private flagsAt(x: number, y: number): number {
    const ts = this.level.tileSize;
    return cellAt(this.level, Math.floor(x / ts), Math.floor(y / ts));
  }

  private solidAt(x: number, y: number): boolean {
    return (this.flagsAt(x, y) & CellFlag.SOLID) !== 0;
  }

  private floorAt(x: number, y: number): boolean {
    return (this.flagsAt(x, y) & (CellFlag.SOLID | CellFlag.ONE_WAY)) !== 0;
  }

  private hazardAt(x: number, y: number): boolean {
    if (this.flagsAt(x, y) & CellFlag.HAZARD) return true;
    return this.noGo.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
  }

  private inHazard(foe: Foe): boolean {
    const box = this.hitbox(foe);
    const inset = { x: box.x + 2, y: box.y + 2, width: box.width - 4, height: box.height - 2 };
    if (this.noGo.some((r) => rectsOverlap(inset, r))) return true;
    const ts = this.level.tileSize;
    for (let row = Math.floor(inset.y / ts); row <= Math.floor((inset.y + inset.height - EPS) / ts); row++) {
      for (let col = Math.floor(inset.x / ts); col <= Math.floor((inset.x + inset.width - EPS) / ts); col++) {
        if (cellAt(this.level, col, row) & CellFlag.HAZARD) return true;
      }
    }
    return false;
  }

  private wallAhead(foe: Foe, dir: 1 | -1): boolean {
    const c = this.config[foe.kind];
    const front = foe.x + dir * (c.width / 2 + 2);
    return this.solidAt(front, foe.y - 1) || this.solidAt(front, foe.y - c.height / 2) || this.solidAt(front, foe.y - c.height + 1);
  }

  /** No ground (or something that hurts) just past its front foot. */
  private dropAhead(foe: Foe, dir: 1 | -1): boolean {
    if (!foe.grounded) return false;
    const c = this.config[foe.kind];
    const front = foe.x + dir * (c.width / 2 + 1);
    return !this.floorAt(front, foe.y + 1) || this.hazardAt(front + dir, foe.y - 2) || this.hazardAt(front, foe.y + 2);
  }

  /** A wall, a ledge, spikes or lava ahead, or (with `keepRange`) the end of its beat. */
  private blockedAhead(foe: Foe, dir: 1 | -1, keepRange: boolean): boolean {
    if (this.wallAhead(foe, dir) || this.dropAhead(foe, dir)) return true;
    return keepRange && foe.range > 0 && (foe.x - foe.homeX) * dir >= foe.range;
  }

  /** A wall monkey's wall still runs alongside its whole body at feet height `y`. */
  private wallBeside(foe: Foe, y: number): boolean {
    const c = this.config.monkey;
    const x = foe.x + foe.wall * (c.width / 2 + 1);
    return this.solidAt(x, y - 2) && this.solidAt(x, y - c.height + 2);
  }

  /** Line of sight through the tiles (solid ones block it). */
  private canSee(x0: number, y0: number, x1: number, y1: number): boolean {
    const step = this.level.tileSize / 4;
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step);
    for (let i = 1; i < n; i++) {
      const k = i / n;
      if (this.solidAt(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k)) return false;
    }
    return true;
  }

  private random(foe: Foe): number {
    let x = foe.rng | 0 || 1;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    foe.rng = x >>> 0;
    return foe.rng / 4294967296;
  }

  /** A random duration in seconds between `ms[0]` and `ms[1]`. */
  private between(foe: Foe, ms: readonly [number, number]): number {
    return (ms[0] + (ms[1] - ms[0]) * this.random(foe)) / 1000;
  }
}

function spawnFoe(def: FoeDef, config: Readonly<FoeTuning>): Foe {
  const c = config[def.kind];
  return {
    id: def.id,
    kind: def.kind,
    x: def.x,
    y: def.y,
    vx: 0,
    vy: 0,
    facing: def.facing,
    state: 'idle',
    t: 0,
    hp: c.hp,
    wall: def.wall,
    homeX: def.x,
    homeY: def.y,
    range: def.range,
    grounded: false,
    cooldown: 0,
    // Foes start out of step with each other.
    span: 0.2 + (def.id % 7) * 0.15,
    dir: -1,
    target: null,
    lost: 0,
    done: false,
    rng: (Math.imul(def.id + 1, 2654435761) >>> 0) || 1,
    owner: '',
    flight: 0,
    phase: 0,
    fallFrom: null,
    fallBy: '',
    fallHits: [],
  };
}

function targetRect(t: FoeTarget): Rect {
  return { x: t.x, y: t.y, width: t.width, height: t.height };
}

function centerX(t: FoeTarget): number {
  return t.x + t.width / 2;
}

function centerY(t: FoeTarget): number {
  return t.y + t.height / 2;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
