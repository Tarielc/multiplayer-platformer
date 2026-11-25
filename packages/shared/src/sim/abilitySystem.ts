import { Ability, Cargo, Held, Phase, type CompiledAbilities } from '../config/abilities';
import { fallDamageFor, type CompiledFallDamage } from '../config/fall';
import { CellFlag } from '../level/types';
import type { NetPropState, PropState } from '../protocol/state';
import { circleOverlapsRect, rectsOverlap, type Rect, type Vec2 } from '../util/math';
import {
  abilityConfig,
  CARRIED_FEET_BELOW_GRIP,
  cargoLift,
  clawZone,
  droneGrip,
  feetOf,
  foeCargo,
  interruptAbility,
  isTonguePhase,
  giantActive,
  healHands,
  healHugFeet,
  healPullCenter,
  rectHitsSolid,
  tongueOrigin,
  tongueTip,
} from './abilities';
import { cellAt } from './collision';
import type { GameEvent } from './events';
import type { Foe, FoeField } from './foes/FoeField';
import { bodyRect, hitboxOf, resizeBody, type MovementBody, type MovementContext } from './movement';
import type { TrapField } from './traps/TrapField';
import type { WorldPlayer } from './world';

/** What an ability is holding. */
export type Grab = { kind: 'player'; id: string } | { kind: 'box'; id: number } | { kind: 'foe'; id: number };

/** A box out of the level: carried, swallowed, dropped (falling) or spat (flying). */
interface WorldProp {
  id: number;
  variant: 1 | 2 | 3;
  x: number;
  y: number;
  width: number;
  height: number;
  vx: number;
  vy: number;
  state: PropState;
  owner: string;
  /** Flying: seconds left before it drops. Flying or falling: player slots already hit. */
  life: number;
  hitSlots: number;
  /** Falling: its `y` at the top of the fall, and who let it fall ('' nobody). */
  fallFrom: number;
  droppedBy: string;
  /** Falling: foes it already landed on, and boxes (as `-id - 1`) it already knocked. */
  hitFoes: number[];
  /** Falling: hits it took on the way down (heads and boxes it landed on), paid when it settles. */
  pending: number;
}

/** Where a falling box came to rest: its new top, and the box it rests on (null: terrain or a trap). */
interface PropLanding {
  y: number;
  boxId: number | null;
}

export interface AbilityHit {
  damage: number;
  /** Knockback direction (sign of x). */
  dirX: number;
  knockbackX: number;
  knockbackY: number;
  by: string;
}

/** What the ability rules need from the world. */
export interface AbilityHost {
  readonly tick: number;
  readonly ctx: MovementContext;
  readonly traps: TrapField;
  readonly foes: FoeField;
  listPlayers(): WorldPlayer[];
  getPlayer(id: string): WorldPlayer | undefined;
  emit(event: GameEvent): void;
  maxHp(player: WorldPlayer): number;
  /** Ability damage (hearts + stun + knockback, or death). */
  hurt(target: WorldPlayer, hit: AbilityHit): void;
  /** `count` hits on a box in the level, credited to `by` (may be null). */
  hitBox(by: WorldPlayer | null, boxId: number, count: number): void;
  /** A spat player, box or foe hurt a foe (`dir`: the way it is knocked), credited to `by`. */
  hurtFoe(by: WorldPlayer | null, foe: Foe, damage: number, dir: 1 | -1): void;
  /** Ticks of trap immunity for `seconds`. */
  ticksFor(seconds: number): number;
  /** Fall damage tuning (null: off). */
  readonly fall: Readonly<CompiledFallDamage> | null;
  /** A falling box landed on `target`'s head: hearts (unless invulnerable or reeling), stun, knockback. */
  crushPlayer(target: WorldPlayer, hit: AbilityHit): void;
  /** A falling box landed on `foe`, credited to `by` (who dropped it). */
  crushFoe(by: WorldPlayer | null, foe: Foe, damage: number, dir: 1 | -1): void;
}

/** Fields the ability rules keep on each world player (server-only, not replicated). */
export interface AbilityPlayerState {
  grab: Grab | null;
  /** `body.specialSeq` already handled. */
  specialSeen: number;
  /** The current heal already landed. */
  healed: boolean;
  /** Spat by this player and still flying. */
  thrownBy: string | null;
  /** Slots this flight already hit. */
  flightHits: number;
  flightBoxes: Set<number>;
  flightFoes: Set<number>;
  /**
   * The drone's deck as it was at the end of the last tick (null: not flown). Other players
   * land on it during the tick; `GameWorld` then carries them to where the deck went.
   */
  deck: Rect | null;
}

export function newAbilityPlayerState(): AbilityPlayerState {
  return {
    grab: null,
    specialSeen: 0,
    healed: false,
    thrownBy: null,
    flightHits: 0,
    flightBoxes: new Set(),
    flightFoes: new Set(),
    deck: null,
  };
}

export function cloneAbilityPlayerState(s: AbilityPlayerState): AbilityPlayerState {
  return { ...s, flightBoxes: new Set(s.flightBoxes), flightFoes: new Set(s.flightFoes) };
}

/** Distance (px) in front of the mouth where spat things appear. */
const SPIT_SPAWN = 14;
const PROP_FALL_MARGIN = 96;

const bit = (slot: number) => 1 << slot;

/**
 * Server-side rules of the special abilities: everything that involves somebody else. Runs
 * once per tick after every player stepped (`GameWorld.endTick`):
 *
 *  1. reacts to accepted Special presses (`body.specialSeq`): picks the heal target, grabs or
 *     drops with the claw, adds the giant's bonus hearts;
 *  2. moves whatever each ability holds (pulled, hugged, carried, swallowed: players, boxes,
 *     foes) and releases it when the owner's phase says so (a spit launches it as a projectile);
 *  3. resolves spat players, boxes and foes flying into others (foes they hit get hurt), and
 *     drops / lands loose boxes.
 */
export class AbilitySystem {
  private props = new Map<number, WorldProp>();

  constructor(private readonly host: AbilityHost) {}

  private get c(): Readonly<CompiledAbilities> {
    return abilityConfig(this.host.ctx);
  }

  /** Copy for a cloned world (props only; player state lives on the players). */
  cloneFor(host: AbilityHost): AbilitySystem {
    const copy = new AbilitySystem(host);
    for (const [id, prop] of this.props) copy.props.set(id, { ...prop, hitFoes: [...prop.hitFoes] });
    return copy;
  }

  toNet(): NetPropState[] {
    return [...this.props.values()]
      .sort((a, b) => a.id - b.id)
      .map((p) => ({ id: p.id, variant: p.variant, x: p.x, y: p.y, vx: p.vx, vy: p.vy, state: p.state, owner: p.owner }));
  }

  update(): void {
    const players = this.host.listPlayers();
    for (const p of players) {
      if (p.body.specialSeq === p.ability.specialSeen) continue;
      p.ability.specialSeen = p.body.specialSeq;
      if (p.body.alive) this.onPress(p);
    }
    for (const p of players) {
      if (p.body.alive) this.updateOwner(p);
      else if (p.ability.grab) this.release(p, false);
    }
    this.dropStrayFoes();
    this.updateFlights(players);
    this.updateFlyingFoes(players);
    this.updateProps();
    for (const p of players) p.hp = Math.min(p.hp, this.host.maxHp(p));
  }

  /** The player died: let go of everything, stop flying, drop the ability. */
  onDeath(p: WorldPlayer): void {
    if (p.ability.grab) this.release(p, false);
    const b = p.body;
    const size = hitboxOf(b, this.host.ctx);
    b.phase = Phase.NONE;
    b.phaseTime = 0;
    b.reach = 0;
    b.cargo = Cargo.NONE;
    b.held = Held.NONE;
    b.flight = 0;
    b.giant = 0;
    p.ability.thrownBy = null;
    resizeBody(b, size, hitboxOf(b, this.host.ctx)); // a giant dies back at normal size, feet in place
  }

  /** The player left the world. */
  onRemove(p: WorldPlayer): void {
    if (p.ability.grab) this.release(p, false);
  }

  // --- presses ---------------------------------------------------------------------------------

  private onPress(p: WorldPlayer): void {
    const b = p.body;
    switch (b.phase) {
      case Phase.HEAL_WINDUP:
        p.ability.healed = false;
        this.host.emit({ type: 'special', playerId: p.id, ability: Ability.HEAL });
        break;
      case Phase.DRONE_DEPLOY:
        this.host.emit({ type: 'special', playerId: p.id, ability: Ability.DRONE });
        break;
      case Phase.DRONE_PILOT:
        if (p.ability.grab) this.release(p, false);
        else this.clawGrab(p);
        break;
      case Phase.GIANT_GROW:
        p.hp = Math.min(p.hp + this.c.giant.bonusHp, this.host.maxHp(p));
        this.host.emit({ type: 'special', playerId: p.id, ability: Ability.GIANT });
        break;
      case Phase.TONGUE_WINDUP:
        this.host.emit({ type: 'special', playerId: p.id, ability: Ability.TONGUE });
        break;
      default:
        break;
    }
  }

  // --- per owner -------------------------------------------------------------------------------

  private updateOwner(p: WorldPlayer): void {
    const b = p.body;
    const grab = p.ability.grab;
    if (grab && !this.grabValid(p, grab)) this.lostGrab(p);

    switch (b.phase) {
      case Phase.HEAL_REACH:
        if (!p.ability.grab) this.healGrab(p);
        return;
      case Phase.HEAL_PULL:
        if (p.ability.grab) this.placeInArms(p);
        return;
      case Phase.HEAL_HUG:
        this.updateHug(p);
        return;
      case Phase.DRONE_PILOT:
        if (p.ability.grab) this.placeCargo(p);
        return;
      case Phase.TONGUE_SHOOT:
        if (!p.ability.grab) this.tongueGrab(p);
        return;
      case Phase.TONGUE_PULL:
        if (p.ability.grab) this.placeOnTongue(p);
        return;
      case Phase.TONGUE_GULP:
      case Phase.TONGUE_HOLD:
      case Phase.TONGUE_SPIT:
        if (p.ability.grab) this.placeInMouth(p);
        return;
      case Phase.TONGUE_SPIT_RECOVER:
        if (p.ability.grab) this.spit(p);
        return;
      default:
        if (p.ability.grab) this.release(p, false);
    }
  }

  private grabValid(p: WorldPlayer, grab: Grab): boolean {
    if (grab.kind === 'foe') {
      const foe = this.foe(grab.id);
      return foe !== undefined && foe.owner === p.id && (foe.state === 'held' || foe.state === 'swallowed');
    }
    if (grab.kind === 'box') {
      const prop = this.props.get(grab.id);
      return prop !== undefined && prop.owner === p.id && (prop.state === 'held' || prop.state === 'swallowed');
    }
    const t = this.host.getPlayer(grab.id);
    return t !== undefined && t.body.alive && t.body.held !== Held.NONE;
  }

  /** What we held is gone (died, left, was taken): forget it and adapt the ability. */
  private lostGrab(p: WorldPlayer): void {
    p.ability.grab = null;
    const b = p.body;
    b.cargo = Cargo.NONE;
    if (b.phase === Phase.HEAL_PULL || b.phase === Phase.TONGUE_PULL || b.phase === Phase.TONGUE_GULP || b.phase === Phase.TONGUE_HOLD || b.phase === Phase.TONGUE_SPIT) {
      interruptAbility(b, this.c);
    }
  }

  /** Takes `target` (a player) out of their own control for an ability. */
  private seize(target: WorldPlayer, held: number): void {
    if (target.ability.grab) this.release(target, false);
    const t = target.body;
    interruptAbility(t, this.c);
    t.held = held;
    t.attack = 0;
    t.flight = 0;
    t.hurt = 0;
    t.vx = t.vy = 0;
    target.ability.thrownBy = null;
  }

  /**
   * Lets go of what `p` holds. A spit launches it along the aim; otherwise it is simply let go
   * (falls from where it is, keeping the claw's motion).
   */
  private release(p: WorldPlayer, spit: boolean): void {
    const grab = p.ability.grab;
    p.ability.grab = null;
    const b = p.body;
    b.cargo = Cargo.NONE;
    if (!grab) return;
    const c = this.c;
    const hitbox = this.host.ctx.hitbox;
    const piloting = b.phase === Phase.DRONE_PILOT || b.phase === Phase.DRONE_RECALL;
    const carryVx = piloting ? b.droneVx : 0;
    const carryVy = piloting ? Math.max(0, b.droneVy) : 0;
    let at: Vec2 = feetOf(b, hitbox);

    if (grab.kind === 'player') {
      const target = this.host.getPlayer(grab.id);
      if (target && target.body.held !== Held.NONE) {
        const t = target.body;
        const wasHugged = t.held === Held.HUGGED || t.held === Held.PULLED;
        const wasSwallowed = t.held === Held.SWALLOWED;
        t.held = Held.NONE;
        t.vx = carryVx;
        t.vy = carryVy;
        if (wasSwallowed || this.solidAt({ x: t.x, y: t.y, width: hitbox.width, height: hitbox.height })) {
          t.x = b.x;
          t.y = b.y;
        }
        if (spit) this.launchPlayer(p, target);
        else if (wasHugged) target.invulnUntil = Math.max(target.invulnUntil, this.host.tick + this.host.ticksFor(c.heal.afterglow));
        at = { x: t.x + hitbox.width / 2, y: t.y + hitbox.height / 2 };
      }
    } else if (grab.kind === 'foe') {
      const foe = this.foe(grab.id);
      if (foe && foe.owner === p.id && (foe.state === 'held' || foe.state === 'swallowed')) {
        if (spit) this.launchFoe(p, foe);
        else if (foe.state === 'swallowed') this.host.foes.release(foe, at.x, at.y, carryVx, carryVy);
        else this.host.foes.release(foe, foe.x, foe.y, carryVx, carryVy);
        const box = this.host.foes.hitbox(foe);
        at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }
    } else {
      const prop = this.props.get(grab.id);
      if (prop) {
        if (prop.state === 'swallowed') {
          const center = { x: b.x + hitbox.width / 2, y: b.y + hitbox.height / 2 };
          prop.x = center.x - prop.width / 2;
          prop.y = center.y - prop.height / 2;
        }
        prop.owner = '';
        if (spit) this.launchProp(p, prop);
        else {
          this.startFalling(prop, p.id);
          prop.vx = carryVx;
          prop.vy = carryVy;
        }
        at = { x: prop.x + prop.width / 2, y: prop.y + prop.height / 2 };
      }
    }
    this.host.emit({ type: 'release', playerId: p.id, spit, x: at.x, y: at.y });
  }

  // --- heal ------------------------------------------------------------------------------------

  /** The stretching hands touch a player: catch them and start yanking them in. */
  private healGrab(p: WorldPlayer): void {
    const b = p.body;
    const c = this.c.heal;
    const hitbox = this.host.ctx.hitbox;
    const hands = healHands(b, hitbox, this.c);
    let target: WorldPlayer | null = null;
    for (const other of this.host.listPlayers()) {
      const o = other.body;
      if (other === p || !this.grabbable(other)) continue;
      if (circleOverlapsRect(hands.x, hands.y, c.handRadius, { x: o.x, y: o.y, width: hitbox.width, height: hitbox.height })) {
        target = other;
        break;
      }
    }
    if (!target) return;
    this.seize(target, Held.PULLED);
    target.body.facing = b.facing > 0 ? -1 : 1;
    p.ability.grab = { kind: 'player', id: target.id };
    p.ability.healed = false;
    b.phase = Phase.HEAL_PULL;
    b.phaseTime = 0;
    this.placeInArms(p);
    this.host.emit({ type: 'grab', playerId: p.id, targetId: target.id, boxId: null, foeId: null });
  }

  private placeInArms(p: WorldPlayer): void {
    const b = p.body;
    const grab = p.ability.grab!;
    this.placeCenter(grab, healPullCenter(b, this.host.ctx.hitbox, this.c), 'held');
    const target = grab.kind === 'player' ? this.host.getPlayer(grab.id) : undefined;
    if (target) target.body.facing = b.facing > 0 ? -1 : 1;
  }

  private updateHug(p: WorldPlayer): void {
    const c = this.c.heal;
    const b = p.body;
    const hitbox = this.host.ctx.hitbox;
    const grab = p.ability.grab;
    const target = grab?.kind === 'player' ? this.host.getPlayer(grab.id) : undefined;
    if (target) {
      this.placeFeet(target.body, healHugFeet(b, hitbox, b.phaseTime, this.c), true);
      target.body.held = Held.HUGGED;
      target.body.facing = b.facing > 0 ? -1 : 1;
    }
    if (!p.ability.healed && b.phaseTime >= c.healAt) {
      p.ability.healed = true;
      if (target) target.hp = Math.min(this.host.maxHp(target), target.hp + c.amount);
      p.hp = Math.min(this.host.maxHp(p), p.hp + c.selfAmount);
      const at = target ? target.body : b;
      this.host.emit({
        type: 'heal',
        playerId: p.id,
        targetId: target?.id ?? null,
        x: at.x + hitbox.width / 2,
        y: at.y,
      });
    }
  }

  // --- drone -----------------------------------------------------------------------------------

  private clawGrab(p: WorldPlayer): void {
    const b = p.body;
    const hitbox = this.host.ctx.hitbox;
    const grip = droneGrip(b, this.c);
    const zone = clawZone(b, this.c);
    const dist = (r: Rect) => Math.hypot(r.x + r.width / 2 - grip.x, r.y - grip.y);
    let best: { target: WorldPlayer | null; box: number | null; foe: Foe | null; d: number } | null = null;
    for (const other of this.host.listPlayers()) {
      const o = other.body;
      if (other === p || !this.grabbable(other)) continue;
      const r = { x: o.x, y: o.y, width: hitbox.width, height: hitbox.height };
      if (!rectsOverlap(zone, r)) continue;
      const d = dist(r);
      if (!best || d < best.d) best = { target: other, box: null, foe: null, d };
    }
    if (!best) {
      const field = this.host.foes;
      for (const foe of field.foes) {
        if (!field.grabbable(foe)) continue;
        const r = field.hitbox(foe);
        if (!rectsOverlap(zone, r)) continue;
        const d = dist(r);
        if (!best || d < best.d) best = { target: null, box: null, foe, d };
      }
      for (const box of this.host.traps.boxes()) {
        if (!rectsOverlap(zone, box.rect)) continue;
        const d = dist(box.rect);
        if (!best || d < best.d) best = { target: null, box: box.id, foe: null, d };
      }
    }
    if (!best) return;
    // The cargo has to fit where it will hang: the drone hops up a little to lift it off the
    // ground, and the grab fails if there is no room.
    const cargo = best.target ? Cargo.PLAYER : best.foe ? foeCargo(best.foe.kind) : Cargo.BOX;
    const lift = cargoLift(b.droneX, b.droneY, cargo, this.host.ctx);
    if (lift === null) return;
    b.droneY -= lift;
    if (lift > 0) b.droneVy = Math.min(0, b.droneVy);

    if (best.target) {
      this.seize(best.target, Held.CARRIED);
      p.ability.grab = { kind: 'player', id: best.target.id };
    } else if (best.foe) {
      this.host.foes.seize(best.foe, p.id);
      p.ability.grab = { kind: 'foe', id: best.foe.id };
    } else {
      const prop = this.takeBox(best.box!, p.id);
      if (!prop) return;
      p.ability.grab = { kind: 'box', id: prop.id };
    }
    b.cargo = cargo;
    this.placeCargo(p);
    this.host.emit({ type: 'grab', playerId: p.id, targetId: best.target?.id ?? null, boxId: best.box, foeId: best.foe?.id ?? null });
  }

  private placeCargo(p: WorldPlayer): void {
    const b = p.body;
    const grip = droneGrip(b, this.c);
    const grab = p.ability.grab!;
    if (grab.kind === 'player') {
      const target = this.host.getPlayer(grab.id);
      if (target) this.placeFeet(target.body, { x: grip.x, y: grip.y + CARRIED_FEET_BELOW_GRIP }, false);
    } else if (grab.kind === 'foe') {
      // Hangs from the claw by its top.
      const foe = this.foe(grab.id);
      if (foe) this.host.foes.carry(foe, grip.x, grip.y + this.host.foes.config[foe.kind].height, b.droneVx, b.droneVy, 'held');
    } else {
      const prop = this.props.get(grab.id);
      if (prop) {
        prop.x = grip.x - prop.width / 2;
        prop.y = grip.y;
        prop.vx = b.droneVx;
        prop.vy = b.droneVy;
      }
    }
  }

  // --- tongue ----------------------------------------------------------------------------------

  private tongueGrab(p: WorldPlayer): void {
    const b = p.body;
    const c = this.c.tongue;
    const hitbox = this.host.ctx.hitbox;
    const tip = tongueTip(b, hitbox, this.c);
    let target: WorldPlayer | null = null;
    for (const other of this.host.listPlayers()) {
      const o = other.body;
      if (other === p || !this.grabbable(other)) continue;
      if (circleOverlapsRect(tip.x, tip.y, c.tipRadius, { x: o.x, y: o.y, width: hitbox.width, height: hitbox.height })) {
        target = other;
        break;
      }
    }
    const field = this.host.foes;
    const foe = target ? undefined : field.foes.find((f) => field.grabbable(f) && circleOverlapsRect(tip.x, tip.y, c.tipRadius, field.hitbox(f)));
    let boxId: number | null = null;
    if (target) {
      this.seize(target, Held.PULLED);
      target.body.facing = b.facing > 0 ? -1 : 1;
      p.ability.grab = { kind: 'player', id: target.id };
    } else if (foe) {
      field.seize(foe, p.id);
      foe.facing = b.facing > 0 ? -1 : 1;
      p.ability.grab = { kind: 'foe', id: foe.id };
    } else {
      const box = this.host.traps.boxes().find((bx) => circleOverlapsRect(tip.x, tip.y, c.tipRadius, bx.rect));
      if (!box) return;
      const prop = this.takeBox(box.id, p.id);
      if (!prop) return;
      boxId = box.id;
      p.ability.grab = { kind: 'box', id: box.id };
    }
    b.phase = Phase.TONGUE_PULL;
    b.phaseTime = 0;
    this.placeOnTongue(p);
    this.host.emit({ type: 'grab', playerId: p.id, targetId: target?.id ?? null, boxId, foeId: foe?.id ?? null });
  }

  private placeOnTongue(p: WorldPlayer): void {
    const tip = tongueTip(p.body, this.host.ctx.hitbox, this.c);
    this.placeCenter(p.ability.grab!, tip, 'held');
  }

  private placeInMouth(p: WorldPlayer): void {
    const b = p.body;
    const hitbox = this.host.ctx.hitbox;
    const grab = p.ability.grab!;
    if (grab.kind === 'player') {
      const target = this.host.getPlayer(grab.id);
      if (target) {
        target.body.held = Held.SWALLOWED;
        target.body.x = b.x;
        target.body.y = b.y;
      }
    } else {
      this.placeCenter(grab, { x: b.x + hitbox.width / 2, y: b.y + hitbox.height / 2 }, 'swallowed');
    }
  }

  private spit(p: WorldPlayer): void {
    this.release(p, true);
  }

  private spitStart(p: WorldPlayer, width: number, height: number): { x: number; y: number; dx: number; dy: number } {
    const b = p.body;
    const o = tongueOrigin(b, this.host.ctx.hitbox, this.c);
    const dx = Math.cos(b.aim);
    const dy = Math.sin(b.aim);
    let x = o.x + dx * SPIT_SPAWN - width / 2;
    let y = o.y + dy * SPIT_SPAWN - height / 2;
    if (this.solidAt({ x, y, width, height })) {
      const hitbox = this.host.ctx.hitbox;
      x = b.x + hitbox.width / 2 - width / 2;
      y = b.y + hitbox.height - height;
    }
    return { x, y, dx, dy };
  }

  private launchPlayer(p: WorldPlayer, target: WorldPlayer): void {
    const c = this.c.tongue;
    const hitbox = this.host.ctx.hitbox;
    const s = this.spitStart(p, hitbox.width, hitbox.height);
    const t = target.body;
    t.x = s.x;
    t.y = s.y;
    t.vx = s.dx * c.spitSpeed;
    t.vy = s.dy * c.spitSpeed;
    t.flight = c.flight;
    t.hurt = 0;
    t.grounded = false;
    if (Math.abs(s.dx) > 1e-3) t.facing = s.dx > 0 ? 1 : -1;
    target.ability.thrownBy = p.id;
    target.ability.flightHits = bit(target.slot) | bit(p.slot);
    target.ability.flightBoxes.clear();
    target.ability.flightFoes.clear();
  }

  private launchFoe(p: WorldPlayer, foe: Foe): void {
    const c = this.c.tongue;
    const size = this.host.foes.config[foe.kind];
    const s = this.spitStart(p, size.width, size.height);
    this.host.foes.launch(foe, s.x + size.width / 2, s.y + size.height, s.dx * c.spitSpeed, s.dy * c.spitSpeed, c.flight, p.id);
  }

  private launchProp(p: WorldPlayer, prop: WorldProp): void {
    const c = this.c.tongue;
    const s = this.spitStart(p, prop.width, prop.height);
    prop.x = s.x;
    prop.y = s.y;
    prop.vx = s.dx * c.spitSpeed;
    prop.vy = s.dy * c.spitSpeed;
    prop.state = 'flying';
    prop.owner = p.id;
    prop.life = c.flight;
    prop.hitSlots = bit(p.slot);
  }

  // --- projectiles -----------------------------------------------------------------------------

  private updateFlights(players: WorldPlayer[]): void {
    const c = this.c.tongue;
    for (const f of players) {
      const state = f.ability;
      if (!state.thrownBy) continue;
      if (!f.body.alive || f.body.flight <= 0) {
        state.thrownBy = null;
        continue;
      }
      const fb = f.body;
      const rect = bodyRect(fb, this.host.ctx);
      const dirX = fb.vx !== 0 ? Math.sign(fb.vx) : fb.facing;
      for (const other of players) {
        const o = other.body;
        if (other === f || !o.alive || o.held !== Held.NONE || state.flightHits & bit(other.slot)) continue;
        if (!rectsOverlap(rect, bodyRect(o, this.host.ctx))) continue;
        state.flightHits |= bit(other.slot);
        this.host.hurt(other, { damage: c.damage, dirX, knockbackX: c.knockbackX, knockbackY: c.knockbackY, by: state.thrownBy });
      }
      const grown = { x: rect.x - 2, y: rect.y - 2, width: rect.width + 4, height: rect.height + 4 };
      const thrower = this.host.getPlayer(state.thrownBy) ?? null;
      for (const box of this.host.traps.boxes()) {
        if (state.flightBoxes.has(box.id) || !rectsOverlap(grown, box.rect)) continue;
        state.flightBoxes.add(box.id);
        this.host.hitBox(thrower, box.id, 99);
      }
      for (const foe of this.host.foes.live()) {
        if (state.flightFoes.has(foe.id) || !rectsOverlap(rect, this.host.foes.hitbox(foe))) continue;
        state.flightFoes.add(foe.id);
        this.host.hurtFoe(thrower, foe, c.damage, dirX > 0 ? 1 : -1);
      }
    }
  }

  /**
   * Spat foes fly straight until they hit a wall, a player (not the frog), another foe or a box:
   * whatever they hit gets the projectile's damage, and so do they, when the flight ends.
   */
  private updateFlyingFoes(players: WorldPlayer[]): void {
    const field = this.host.foes;
    const c = this.c.tongue;
    for (const foe of field.foes) {
      if (foe.state !== 'flying') continue;
      const thrower = this.host.getPlayer(foe.owner) ?? null;
      const dir: 1 | -1 = foe.vx > 0 ? 1 : foe.vx < 0 ? -1 : foe.facing;
      let hit = field.fly(foe);
      const rect = field.hitbox(foe);
      for (const other of players) {
        const o = other.body;
        if (other === thrower || !o.alive || o.held !== Held.NONE) continue;
        if (!rectsOverlap(rect, bodyRect(o, this.host.ctx))) continue;
        this.host.hurt(other, { damage: c.damage, dirX: dir, knockbackX: c.knockbackX, knockbackY: c.knockbackY, by: foe.owner });
        hit = true;
      }
      for (const other of field.live()) {
        if (other === foe || !rectsOverlap(rect, field.hitbox(other))) continue;
        this.host.hurtFoe(thrower, other, c.damage, dir);
        hit = true;
      }
      for (const box of this.host.traps.boxes()) {
        if (!rectsOverlap(rect, box.rect)) continue;
        this.host.hitBox(thrower, box.id, 99);
        hit = true;
      }
      if (!hit && foe.flight > 0) continue;
      // It slams into what it hit (or runs out of steam): it bounces back, hurt.
      field.land(foe);
      this.host.hurtFoe(thrower, foe, c.damage, dir > 0 ? -1 : 1);
    }
  }

  /** A foe whose captor no longer holds it (left, lost it) is let go. */
  private dropStrayFoes(): void {
    const field = this.host.foes;
    for (const foe of field.foes) {
      if (foe.state !== 'held' && foe.state !== 'swallowed') continue;
      const grab = this.host.getPlayer(foe.owner)?.ability.grab;
      if (grab?.kind !== 'foe' || grab.id !== foe.id) field.release(foe, foe.x, foe.y, 0, 0);
    }
  }

  // --- props -----------------------------------------------------------------------------------

  private takeBox(boxId: number, owner: string): WorldProp | null {
    const trap = this.host.traps.get(boxId);
    if (trap?.kind !== 'box') return null;
    const rect = this.host.traps.takeBox(boxId);
    if (!rect) return null;
    const prop: WorldProp = {
      id: boxId,
      variant: trap.variant,
      ...rect,
      vx: 0,
      vy: 0,
      state: 'held',
      owner,
      life: 0,
      hitSlots: 0,
      fallFrom: rect.y,
      droppedBy: '',
      hitFoes: [],
      pending: 0,
    };
    this.props.set(boxId, prop);
    return prop;
  }

  private placeCenter(grab: Grab, center: Vec2, propState: PropState): void {
    if (grab.kind === 'foe') {
      const foe = this.foe(grab.id);
      if (foe) {
        const half = this.host.foes.config[foe.kind].height / 2;
        this.host.foes.carry(foe, center.x, center.y + half, 0, 0, propState === 'swallowed' ? 'swallowed' : 'held');
      }
      return;
    }
    if (grab.kind === 'player') {
      const target = this.host.getPlayer(grab.id);
      if (target) {
        const size = hitboxOf(target.body, this.host.ctx);
        target.body.x = center.x - size.width / 2;
        target.body.y = center.y - size.height / 2;
      }
      return;
    }
    const prop = this.props.get(grab.id);
    if (!prop) return;
    prop.x = center.x - prop.width / 2;
    prop.y = center.y - prop.height / 2;
    prop.vx = prop.vy = 0;
    prop.state = propState;
  }

  private updateProps(): void {
    const { ctx } = this.host;
    const dt = ctx.dt;
    const m = ctx.movement;
    for (const prop of [...this.props.values()]) {
      switch (prop.state) {
        case 'held':
        case 'swallowed': {
          const owner = prop.owner ? this.host.getPlayer(prop.owner) : undefined;
          const grab = owner?.ability.grab;
          if (!owner || grab?.kind !== 'box' || grab.id !== prop.id) this.startFalling(prop, prop.owner);
          break;
        }
        case 'falling': {
          prop.vy = Math.min(prop.vy + m.fallGravity * dt, m.maxFallSpeed);
          prop.vx *= Math.max(0, 1 - 4 * dt);
          const nx = prop.x + prop.vx * dt;
          if (!this.solidAt({ ...prop, x: nx })) prop.x = nx;
          else prop.vx = 0;
          // Thrown back up (bounced off a head): the fall starts again from the top.
          if (prop.vy < 0) prop.fallFrom = prop.y;
          const top = prop.y;
          const landed = this.landing(prop, prop.vy * dt);
          if (prop.vy > 0 && this.crushBelow(prop, top)) break;
          if (landed !== null) this.settle(prop, landed);
          else if (prop.y > ctx.level.heightPx + PROP_FALL_MARGIN) {
            this.host.traps.destroyBox(prop.id);
            this.props.delete(prop.id);
          }
          break;
        }
        case 'flying':
          this.updateFlyingProp(prop);
          break;
      }
    }
  }

  private updateFlyingProp(prop: WorldProp): void {
    const { ctx } = this.host;
    const c = this.c.tongue;
    prop.life -= ctx.dt;
    prop.x += prop.vx * ctx.dt;
    prop.y += prop.vy * ctx.dt;
    const thrower = this.host.getPlayer(prop.owner) ?? null;
    let hit = this.solidAt(prop);
    for (const other of this.host.listPlayers()) {
      const o = other.body;
      if (!o.alive || o.held !== Held.NONE || prop.hitSlots & bit(other.slot)) continue;
      if (!rectsOverlap(prop, bodyRect(o, ctx))) continue;
      prop.hitSlots |= bit(other.slot);
      const dirX = prop.vx !== 0 ? Math.sign(prop.vx) : 1;
      this.host.hurt(other, { damage: c.damage, dirX, knockbackX: c.knockbackX, knockbackY: c.knockbackY, by: prop.owner });
      hit = true;
    }
    for (const box of this.host.traps.boxes()) {
      if (!rectsOverlap(prop, box.rect)) continue;
      this.host.hitBox(thrower, box.id, 99);
      hit = true;
    }
    for (const foe of this.host.foes.live()) {
      if (!rectsOverlap(prop, this.host.foes.hitbox(foe))) continue;
      this.host.hurtFoe(thrower, foe, c.damage, prop.vx < 0 ? -1 : 1);
      hit = true;
    }
    if (hit) {
      this.host.traps.destroyBox(prop.id);
      this.props.delete(prop.id);
      this.host.emit({ type: 'propBreak', boxId: prop.id, variant: prop.variant, x: prop.x + prop.width / 2, y: prop.y + prop.height / 2 });
    } else if (prop.life <= 0) {
      this.startFalling(prop, prop.owner);
      prop.vx *= 0.4;
      prop.vy = Math.max(0, prop.vy * 0.4);
    }
  }

  /** Moves a falling prop down by `dy`; returns where it rests if it landed on something. */
  private landing(prop: WorldProp, dy: number): PropLanding | null {
    const { ctx } = this.host;
    const { level } = ctx;
    const ts = level.tileSize;
    const eps = 1e-6;
    const prevBottom = prop.y + prop.height;
    const nextBottom = prevBottom + dy;
    let stop = Infinity;
    const c0 = Math.floor(prop.x / ts);
    const c1 = Math.floor((prop.x + prop.width - eps) / ts);
    const r0 = Math.floor((prevBottom - eps) / ts);
    const r1 = Math.floor((nextBottom - eps) / ts);
    for (let row = Math.max(r0, 0); row <= r1 && stop === Infinity; row++) {
      const top = row * ts;
      for (let col = c0; col <= c1; col++) {
        const cell = cellAt(level, col, row);
        if ((cell & (CellFlag.SOLID | CellFlag.ONE_WAY)) !== 0 && top >= prevBottom - eps) {
          stop = top;
          break;
        }
      }
    }
    let boxId: number | null = null;
    for (const c of this.host.traps.colliders(this.host.tick)) {
      if (c.id === prop.id || prop.x >= c.x + c.width - eps || prop.x + prop.width <= c.x + eps) continue;
      if (c.y >= prevBottom - eps && c.y < nextBottom && c.y < stop) {
        stop = c.y;
        boxId = c.kind === 'box' ? c.id : null;
      }
    }
    if (stop === Infinity) {
      prop.y += dy;
      return null;
    }
    prop.y = stop - prop.height;
    return { y: prop.y, boxId };
  }

  /** A box starts falling freely (let go, lost, or at the end of a spit's flight). */
  private startFalling(prop: WorldProp, by: string): void {
    prop.state = 'falling';
    prop.owner = '';
    prop.fallFrom = prop.y;
    prop.droppedBy = by;
    prop.hitSlots = 0;
    prop.hitFoes = [];
    prop.pending = 0;
  }

  /**
   * A falling box (whose top was at `top` before this tick's move) coming down on players' or
   * foes' heads hurts them, takes a hit itself and bounces off (or shatters). True when it hit.
   */
  private crushBelow(prop: WorldProp, top: number): boolean {
    const crush = this.host.fall?.crush;
    if (!crush || top - prop.fallFrom < crush.minDrop) return false;
    const { ctx } = this.host;
    const prevBottom = top + prop.height;
    const slack = Math.max(6, prop.vy * ctx.dt + 2);
    const by = prop.droppedBy ? (this.host.getPlayer(prop.droppedBy) ?? null) : null;
    const center = prop.x + prop.width / 2;
    let headTop = Infinity;
    let away = 0;
    for (const other of this.host.listPlayers()) {
      const o = other.body;
      if (!o.alive || o.held !== Held.NONE || prop.hitSlots & bit(other.slot)) continue;
      const rect = bodyRect(o, ctx);
      if (!rectsOverlap(prop, rect) || prevBottom > rect.y + slack) continue;
      prop.hitSlots |= bit(other.slot);
      const dirX = rect.x + rect.width / 2 >= center ? 1 : -1;
      this.host.crushPlayer(other, { damage: crush.damage, dirX, knockbackX: crush.knockbackX, knockbackY: crush.knockbackY, by: prop.droppedBy });
      headTop = Math.min(headTop, rect.y);
      away -= dirX;
    }
    for (const foe of this.host.foes.live()) {
      const rect = this.host.foes.hitbox(foe);
      if (prop.hitFoes.includes(foe.id) || !rectsOverlap(prop, rect) || prevBottom > rect.y + slack) continue;
      prop.hitFoes.push(foe.id);
      const dir = foe.x >= center ? 1 : -1;
      this.host.crushFoe(by, foe, crush.damage, dir);
      headTop = Math.min(headTop, rect.y);
      away -= dir;
    }
    if (headTop === Infinity) return false;
    prop.pending += 1;
    if (this.shatterIfSpent(prop)) return true;
    // Bounce off the heads, sideways away from them.
    prop.y = Math.min(prop.y, headTop - prop.height);
    prop.vy = -Math.min(180, prop.vy * 0.35);
    prop.vx = (away >= 0 ? 1 : -1) * 70;
    return true;
  }

  /**
   * A falling box came to rest. Landing hard on another box knocks that box too (and if that
   * breaks, it falls on through); otherwise it is back in the level, paying for the fall and any
   * knocks on the way down.
   */
  private settle(prop: WorldProp, landed: PropLanding): void {
    const fall = this.host.fall;
    const drop = landed.y - prop.fallFrom;
    const by = prop.droppedBy ? (this.host.getPlayer(prop.droppedBy) ?? null) : null;
    const knockKey = landed.boxId === null ? 0 : -landed.boxId - 1;
    if (fall && landed.boxId !== null && fall.crush.damage > 0 && drop >= fall.crush.minDrop && !prop.hitFoes.includes(knockKey)) {
      prop.hitFoes.push(knockKey);
      this.host.hitBox(by, landed.boxId, fall.crush.damage);
      prop.pending += 1;
      if (this.shatterIfSpent(prop)) return;
      if (this.host.traps.boxRect(landed.boxId) === null) return; // it broke underneath: keep falling
    }
    const hits = prop.pending + (fall ? fallDamageFor(drop, fall.boxes) : 0);
    this.host.traps.placeBox(prop.id, prop.x, landed.y);
    this.props.delete(prop.id);
    if (hits > 0) this.host.hitBox(by, prop.id, hits);
  }

  /** A falling box that took as many hits as it had left shatters where it is. True if it did. */
  private shatterIfSpent(prop: WorldProp): boolean {
    const trap = this.host.traps.get(prop.id);
    const left = trap?.kind === 'box' ? trap.maxHits - this.host.traps.boxHits(prop.id) : 1;
    if (prop.pending < left) return false;
    this.host.traps.destroyBox(prop.id);
    this.props.delete(prop.id);
    this.host.emit({ type: 'propBreak', boxId: prop.id, variant: prop.variant, x: prop.x + prop.width / 2, y: prop.y + prop.height / 2 });
    return true;
  }

  // --- helpers ---------------------------------------------------------------------------------

  private foe(id: number): Foe | undefined {
    return this.host.foes.foes.find((f) => f.id === id);
  }

  /** Players a claw or tongue can catch: free, alive, and not a giant (too heavy). */
  private grabbable(p: WorldPlayer): boolean {
    const o = p.body;
    return o.alive && o.held === Held.NONE && o.flight <= 0 && !giantActive(o);
  }

  private solidAt(r: Rect): boolean {
    return rectHitsSolid(r, this.host.ctx);
  }

  /** Puts a body's feet at `feet`; with `safe`, not into walls (it stays where it was). */
  private placeFeet(body: MovementBody, feet: Vec2, safe: boolean): void {
    const hitbox = hitboxOf(body, this.host.ctx);
    const x = feet.x - hitbox.width / 2;
    const y = feet.y - hitbox.height;
    if (safe && this.solidAt({ x, y, width: hitbox.width, height: hitbox.height })) return;
    body.x = x;
    body.y = y;
  }
}

/** Whether a phase can hold something with a tongue (for the renderer). */
export function tongueHolds(phase: number): boolean {
  return isTonguePhase(phase) && phase >= Phase.TONGUE_PULL && phase !== Phase.TONGUE_RETRACT && phase !== Phase.TONGUE_SPIT_RECOVER;
}
