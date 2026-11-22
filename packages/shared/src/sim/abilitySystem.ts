import { Ability, Cargo, Held, Phase, type CompiledAbilities } from '../config/abilities';
import { CellFlag } from '../level/types';
import type { NetPropState, PropState } from '../protocol/state';
import { circleOverlapsRect, rectsOverlap, type Rect, type Vec2 } from '../util/math';
import {
  abilityConfig,
  CARRIED_FEET_BELOW_GRIP,
  droneBox,
  droneGrip,
  feetOf,
  interruptAbility,
  isTonguePhase,
  giantActive,
  rectHitsSolid,
  tongueOrigin,
  tongueTip,
} from './abilities';
import { cellAt } from './collision';
import type { GameEvent } from './events';
import type { MovementBody, MovementContext } from './movement';
import type { TrapField } from './traps/TrapField';
import type { WorldPlayer } from './world';

/** What an ability is holding. */
export type Grab = { kind: 'player'; id: string } | { kind: 'box'; id: number };

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
  /** Flying: seconds left before it drops; slots already hit. */
  life: number;
  hitSlots: number;
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
  listPlayers(): WorldPlayer[];
  getPlayer(id: string): WorldPlayer | undefined;
  emit(event: GameEvent): void;
  maxHp(player: WorldPlayer): number;
  /** Ability damage (hearts + stun + knockback, or death). */
  hurt(target: WorldPlayer, hit: AbilityHit): void;
  /** `count` hits on a box in the level, credited to `by` (may be null). */
  hitBox(by: WorldPlayer | null, boxId: number, count: number): void;
  /** Ticks of trap immunity for `seconds`. */
  ticksFor(seconds: number): number;
}

/** Fields the ability rules keep on each world player (server-only, not replicated). */
export interface AbilityPlayerState {
  grab: Grab | null;
  /** Feet of the grabbed player when the heal grabbed them (start of the pull). */
  grabFrom: Vec2;
  /** `body.specialSeq` already handled. */
  specialSeen: number;
  /** The current heal already landed. */
  healed: boolean;
  /** Spat by this player and still flying. */
  thrownBy: string | null;
  /** Slots this flight already hit. */
  flightHits: number;
  flightBoxes: Set<number>;
}

export function newAbilityPlayerState(): AbilityPlayerState {
  return { grab: null, grabFrom: { x: 0, y: 0 }, specialSeen: 0, healed: false, thrownBy: null, flightHits: 0, flightBoxes: new Set() };
}

export function cloneAbilityPlayerState(s: AbilityPlayerState): AbilityPlayerState {
  return { ...s, grabFrom: { ...s.grabFrom }, flightBoxes: new Set(s.flightBoxes) };
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
 *  2. moves whatever each ability holds (pulled, hugged, carried, swallowed) and releases it
 *     when the owner's phase says so (a spit launches it as a projectile);
 *  3. resolves spat players and boxes flying into others, and drops / lands loose boxes.
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
    for (const [id, prop] of this.props) copy.props.set(id, { ...prop });
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
    this.updateFlights(players);
    this.updateProps();
    for (const p of players) p.hp = Math.min(p.hp, this.host.maxHp(p));
  }

  /** The player died: let go of everything, stop flying, drop the ability. */
  onDeath(p: WorldPlayer): void {
    if (p.ability.grab) this.release(p, false);
    const b = p.body;
    b.phase = Phase.NONE;
    b.phaseTime = 0;
    b.reach = 0;
    b.cargo = Cargo.NONE;
    b.held = Held.NONE;
    b.flight = 0;
    b.giant = 0;
    p.ability.thrownBy = null;
  }

  /** The player left the world. */
  onRemove(p: WorldPlayer): void {
    if (p.ability.grab) this.release(p, false);
  }

  // --- presses ---------------------------------------------------------------------------------

  private onPress(p: WorldPlayer): void {
    const b = p.body;
    switch (b.phase) {
      case Phase.HEAL:
        this.startHeal(p);
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
      case Phase.HEAL:
        this.updateHeal(p);
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
    if (b.phase === Phase.TONGUE_PULL || b.phase === Phase.TONGUE_GULP || b.phase === Phase.TONGUE_HOLD || b.phase === Phase.TONGUE_SPIT) {
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
          prop.state = 'falling';
          prop.vx = carryVx;
          prop.vy = carryVy;
        }
        at = { x: prop.x + prop.width / 2, y: prop.y + prop.height / 2 };
      }
    }
    this.host.emit({ type: 'release', playerId: p.id, spit, x: at.x, y: at.y });
  }

  // --- heal ------------------------------------------------------------------------------------

  private startHeal(p: WorldPlayer): void {
    const c = this.c.heal;
    const b = p.body;
    const hitbox = this.host.ctx.hitbox;
    const me = feetOf(b, hitbox);
    p.ability.healed = false;
    let best: WorldPlayer | null = null;
    let bestDist = Infinity;
    for (const other of this.host.listPlayers()) {
      const o = other.body;
      if (other === p || !o.alive || o.held !== Held.NONE || o.flight > 0) continue;
      const f = feetOf(o, hitbox);
      const dx = f.x - me.x;
      const dy = f.y - me.y;
      if (Math.abs(dx) > c.rangeX || Math.abs(dy) > c.rangeY) continue;
      const dist = Math.hypot(dx, dy);
      if (dist < bestDist) {
        best = other;
        bestDist = dist;
      }
    }
    if (!best) return;
    const f = feetOf(best.body, hitbox);
    if (f.x !== me.x) b.facing = f.x > me.x ? 1 : -1;
    this.seize(best, Held.PULLED);
    best.body.facing = b.facing > 0 ? -1 : 1;
    p.ability.grab = { kind: 'player', id: best.id };
    p.ability.grabFrom = f;
    this.host.emit({ type: 'grab', playerId: p.id, targetId: best.id, boxId: null });
  }

  private updateHeal(p: WorldPlayer): void {
    const c = this.c.heal;
    const b = p.body;
    const t = b.phaseTime;
    const hitbox = this.host.ctx.hitbox;
    const grab = p.ability.grab;
    const target = grab?.kind === 'player' ? this.host.getPlayer(grab.id) : undefined;
    if (target) {
      const me = feetOf(b, hitbox);
      const spot = healSpot(c.track, Math.max(t, c.pullTo));
      const goal = { x: me.x + b.facing * spot.dx, y: me.y + spot.dy };
      let feet: Vec2;
      if (t < c.pullFrom) feet = p.ability.grabFrom;
      else if (t < c.pullTo) {
        const k = smoothstep((t - c.pullFrom) / (c.pullTo - c.pullFrom));
        const from = p.ability.grabFrom;
        feet = { x: from.x + (goal.x - from.x) * k, y: from.y + (goal.y - from.y) * k - 10 * Math.sin(Math.PI * k) };
      } else feet = goal;
      this.placeFeet(target.body, feet, true);
      target.body.held = t < c.pullTo ? Held.PULLED : Held.HUGGED;
      target.body.facing = b.facing > 0 ? -1 : 1;
    }
    if (!p.ability.healed && t >= c.healAt) {
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
    const c = this.c.drone;
    const hitbox = this.host.ctx.hitbox;
    const grip = droneGrip(b, this.c);
    const zone: Rect = { x: grip.x - c.grab.width / 2, y: grip.y - 4, width: c.grab.width, height: c.grab.height + 4 };
    const dist = (r: Rect) => Math.hypot(r.x + r.width / 2 - grip.x, r.y - grip.y);
    let best: { target: WorldPlayer | null; box: number | null; d: number } | null = null;
    for (const other of this.host.listPlayers()) {
      const o = other.body;
      if (other === p || !this.grabbable(other)) continue;
      const r = { x: o.x, y: o.y, width: hitbox.width, height: hitbox.height };
      if (!rectsOverlap(zone, r)) continue;
      const d = dist(r);
      if (!best || d < best.d) best = { target: other, box: null, d };
    }
    if (!best) {
      for (const box of this.host.traps.boxes()) {
        if (!rectsOverlap(zone, box.rect)) continue;
        const d = dist(box.rect);
        if (!best || d < best.d) best = { target: null, box: box.id, d };
      }
    }
    if (!best) return;
    // The cargo has to fit where it will hang: the drone hops up a little to lift it off the
    // ground, and the grab fails if there is no room.
    const cargo = best.target ? Cargo.PLAYER : Cargo.BOX;
    const lift = this.liftFor(b.droneX, b.droneY, cargo);
    if (lift === null) return;
    b.droneY -= lift;
    if (lift > 0) b.droneVy = Math.min(0, b.droneVy);

    if (best.target) {
      this.seize(best.target, Held.CARRIED);
      p.ability.grab = { kind: 'player', id: best.target.id };
    } else {
      const prop = this.takeBox(best.box!, p.id);
      if (!prop) return;
      p.ability.grab = { kind: 'box', id: prop.id };
    }
    b.cargo = cargo;
    this.placeCargo(p);
    this.host.emit({ type: 'grab', playerId: p.id, targetId: best.target?.id ?? null, boxId: best.box });
  }

  /** Smallest upward shift (px) that makes the drone with `cargo` fit, or null. */
  private liftFor(droneX: number, droneY: number, cargo: number): number | null {
    const max = this.c.drone.grab.height + 8;
    for (let lift = 0; lift <= max; lift++) {
      if (!rectHitsSolid(droneBox({ droneX, droneY: droneY - lift, cargo }, this.host.ctx), this.host.ctx)) return lift;
    }
    return null;
  }

  private placeCargo(p: WorldPlayer): void {
    const b = p.body;
    const grip = droneGrip(b, this.c);
    const grab = p.ability.grab!;
    if (grab.kind === 'player') {
      const target = this.host.getPlayer(grab.id);
      if (target) this.placeFeet(target.body, { x: grip.x, y: grip.y + CARRIED_FEET_BELOW_GRIP }, false);
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
    let boxId: number | null = null;
    if (target) {
      this.seize(target, Held.PULLED);
      target.body.facing = b.facing > 0 ? -1 : 1;
      p.ability.grab = { kind: 'player', id: target.id };
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
    this.host.emit({ type: 'grab', playerId: p.id, targetId: target?.id ?? null, boxId });
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
    const hitbox = this.host.ctx.hitbox;
    for (const f of players) {
      const state = f.ability;
      if (!state.thrownBy) continue;
      if (!f.body.alive || f.body.flight <= 0) {
        state.thrownBy = null;
        continue;
      }
      const fb = f.body;
      const rect = { x: fb.x, y: fb.y, width: hitbox.width, height: hitbox.height };
      const dirX = fb.vx !== 0 ? Math.sign(fb.vx) : fb.facing;
      for (const other of players) {
        const o = other.body;
        if (other === f || !o.alive || o.held !== Held.NONE || state.flightHits & bit(other.slot)) continue;
        if (!rectsOverlap(rect, { x: o.x, y: o.y, width: hitbox.width, height: hitbox.height })) continue;
        state.flightHits |= bit(other.slot);
        this.host.hurt(other, { damage: c.damage, dirX, knockbackX: c.knockbackX, knockbackY: c.knockbackY, by: state.thrownBy });
      }
      const grown = { x: rect.x - 2, y: rect.y - 2, width: rect.width + 4, height: rect.height + 4 };
      for (const box of this.host.traps.boxes()) {
        if (state.flightBoxes.has(box.id) || !rectsOverlap(grown, box.rect)) continue;
        state.flightBoxes.add(box.id);
        this.host.hitBox(this.host.getPlayer(state.thrownBy) ?? null, box.id, 99);
      }
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
    };
    this.props.set(boxId, prop);
    return prop;
  }

  private placeCenter(grab: Grab, center: Vec2, propState: PropState): void {
    const hitbox = this.host.ctx.hitbox;
    if (grab.kind === 'player') {
      const target = this.host.getPlayer(grab.id);
      if (target) {
        target.body.x = center.x - hitbox.width / 2;
        target.body.y = center.y - hitbox.height / 2;
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
          if (!owner || grab?.kind !== 'box' || grab.id !== prop.id) {
            prop.state = 'falling';
            prop.owner = '';
          }
          break;
        }
        case 'falling': {
          prop.vy = Math.min(prop.vy + m.fallGravity * dt, m.maxFallSpeed);
          prop.vx *= Math.max(0, 1 - 4 * dt);
          const nx = prop.x + prop.vx * dt;
          if (!this.solidAt({ ...prop, x: nx })) prop.x = nx;
          else prop.vx = 0;
          const landY = this.landing(prop, prop.vy * dt);
          if (landY !== null) {
            this.host.traps.placeBox(prop.id, prop.x, landY);
            this.props.delete(prop.id);
          } else if (prop.y > ctx.level.heightPx + PROP_FALL_MARGIN) {
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
    const hitbox = ctx.hitbox;
    prop.life -= ctx.dt;
    prop.x += prop.vx * ctx.dt;
    prop.y += prop.vy * ctx.dt;
    const thrower = this.host.getPlayer(prop.owner) ?? null;
    let hit = this.solidAt(prop);
    for (const other of this.host.listPlayers()) {
      const o = other.body;
      if (!o.alive || o.held !== Held.NONE || prop.hitSlots & bit(other.slot)) continue;
      if (!rectsOverlap(prop, { x: o.x, y: o.y, width: hitbox.width, height: hitbox.height })) continue;
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
    if (hit) {
      this.host.traps.destroyBox(prop.id);
      this.props.delete(prop.id);
      this.host.emit({ type: 'propBreak', boxId: prop.id, variant: prop.variant, x: prop.x + prop.width / 2, y: prop.y + prop.height / 2 });
    } else if (prop.life <= 0) {
      prop.state = 'falling';
      prop.vx *= 0.4;
      prop.vy = Math.max(0, prop.vy * 0.4);
      prop.owner = '';
    }
  }

  /** Moves a falling prop down by `dy`; returns its resting top if it landed on something. */
  private landing(prop: WorldProp, dy: number): number | null {
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
    for (const c of this.host.traps.colliders(this.host.tick)) {
      if (c.id === prop.id || prop.x >= c.x + c.width - eps || prop.x + prop.width <= c.x + eps) continue;
      if (c.y >= prevBottom - eps && c.y < nextBottom && c.y < stop) stop = c.y;
    }
    if (stop === Infinity) {
      prop.y += dy;
      return null;
    }
    prop.y = stop - prop.height;
    return prop.y;
  }

  // --- helpers ---------------------------------------------------------------------------------

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
    const hitbox = this.host.ctx.hitbox;
    const x = feet.x - hitbox.width / 2;
    const y = feet.y - hitbox.height;
    if (safe && this.solidAt({ x, y, width: hitbox.width, height: hitbox.height })) return;
    body.x = x;
    body.y = y;
  }
}

function smoothstep(k: number): number {
  const t = Math.min(1, Math.max(0, k));
  return t * t * (3 - 2 * t);
}

/** The heal track's hug spot at time `t` (relative to the healer's feet, facing right). */
export function healSpot(track: readonly (readonly [number, number, number])[], t: number): { dx: number; dy: number } {
  let spot = track[0] ?? [0, 0, 0];
  for (const entry of track) {
    if (entry[0] <= t) spot = entry;
    else break;
  }
  return { dx: spot[1], dy: spot[2] };
}

/** Whether a phase can hold something with a tongue (for the renderer). */
export function tongueHolds(phase: number): boolean {
  return isTonguePhase(phase) && phase >= Phase.TONGUE_PULL && phase !== Phase.TONGUE_RETRACT && phase !== Phase.TONGUE_SPIT_RECOVER;
}
