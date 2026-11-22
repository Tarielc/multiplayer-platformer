import { ABILITIES, Ability, Cargo, Phase, type CompiledAbilities } from '../config/abilities';
import { clamp, approach, type Rect, type Vec2 } from '../util/math';
import { cellAt, isSolidCell } from './collision';
import { CellFlag } from '../level/types';
import { aimFromButtons, Button } from './input';
import type { HitboxSize, MovementBody, MovementContext } from './movement';

/**
 * Owner-side ability logic: the part of every special ability that only depends on the owner's
 * own body and input (timers, phases, the drone's flight, the tongue's length). It runs inside
 * `stepPlayerBody`, so the owner's client predicts it exactly like movement and swings.
 *
 * Anything involving other players or boxes (who gets grabbed, healed, carried or hit) is
 * decided by the server in `AbilitySystem` and replicated: the server may move a body to
 * another phase (a tongue that caught something switches to `TONGUE_PULL`), which the owner's
 * client picks up on the next reconcile.
 */

/** How the body itself moves this step. */
export type AbilityControl = 'free' | 'locked';

/** Height (px) of the carried player's feet below the claw grip (`carried` reaction art). */
export const CARRIED_FEET_BELOW_GRIP = 26;
/** Default box size when no trap config is at hand. */
const DEFAULT_BOX = 20;
/** The tongue counts as swallowed once it is this short. */
const SWALLOW_REACH = 6;

export function abilityConfig(ctx: Pick<MovementContext, 'abilities'>): Readonly<CompiledAbilities> {
  return ctx.abilities ?? ABILITIES;
}

/** Phases during which the owner can't walk, jump or swing. */
export function isLockedPhase(phase: number): boolean {
  return phase !== Phase.NONE && phase !== Phase.TONGUE_HOLD;
}

export function isDronePhase(phase: number): boolean {
  return phase >= Phase.DRONE_DEPLOY && phase <= Phase.DRONE_STAND;
}

export function isTonguePhase(phase: number): boolean {
  return phase >= Phase.TONGUE_WINDUP && phase <= Phase.TONGUE_SPIT_RECOVER;
}

/** The drone is out (drawn and colliding) from the moment it leaves the pilot's hands until it is caught. */
export function isDroneOut(body: Pick<MovementBody, 'phase' | 'phaseTime'>, c: Readonly<CompiledAbilities> = ABILITIES): boolean {
  if (body.phase === Phase.DRONE_DEPLOY) return body.phaseTime >= c.drone.spawnAt;
  return body.phase >= Phase.DRONE_SIT && body.phase <= Phase.DRONE_RECALL;
}

export function feetOf(body: Pick<MovementBody, 'x' | 'y'>, hitbox: HitboxSize): Vec2 {
  return { x: body.x + hitbox.width / 2, y: body.y + hitbox.height };
}

/** World position the tongue leaves from. */
export function tongueOrigin(
  body: Pick<MovementBody, 'x' | 'y' | 'facing'>,
  hitbox: HitboxSize,
  c: Readonly<CompiledAbilities> = ABILITIES,
): Vec2 {
  const feet = feetOf(body, hitbox);
  return { x: feet.x + body.facing * c.tongue.mouth.x, y: feet.y + c.tongue.mouth.y };
}

/** World position of the tongue tip (the origin when the tongue is in). */
export function tongueTip(
  body: Pick<MovementBody, 'x' | 'y' | 'facing' | 'aim' | 'reach'>,
  hitbox: HitboxSize,
  c: Readonly<CompiledAbilities> = ABILITIES,
): Vec2 {
  const o = tongueOrigin(body, hitbox, c);
  return { x: o.x + Math.cos(body.aim) * body.reach, y: o.y + Math.sin(body.aim) * body.reach };
}

/** Facing that looks along `angle` (keeps `facing` for straight up/down). */
export function facingForAim(angle: number, facing: 1 | -1): 1 | -1 {
  const cos = Math.cos(angle);
  return cos > 1e-3 ? 1 : cos < -1e-3 ? -1 : facing;
}

/** Height of the drone's cargo below the claw grip. */
export function cargoHeight(cargo: number, ctx: Pick<MovementContext, 'traps'>): number {
  if (cargo === Cargo.PLAYER) return CARRIED_FEET_BELOW_GRIP;
  if (cargo === Cargo.BOX) return ctx.traps?.config.box.height ?? DEFAULT_BOX;
  return 0;
}

/** The drone's collision box, cargo included (cargo can't be dragged through walls). */
export function droneBox(
  body: Pick<MovementBody, 'droneX' | 'droneY' | 'cargo'>,
  ctx: Pick<MovementContext, 'traps' | 'hitbox' | 'abilities'>,
): Rect {
  const d = abilityConfig(ctx).drone;
  const cargoWidth = body.cargo === Cargo.PLAYER ? ctx.hitbox.width : body.cargo === Cargo.BOX ? (ctx.traps?.config.box.width ?? DEFAULT_BOX) : 0;
  const width = Math.max(d.size.width, cargoWidth);
  const top = body.droneY - d.size.height / 2;
  const bottom = body.cargo === Cargo.NONE ? body.droneY + d.size.height / 2 : body.droneY + d.gripY + cargoHeight(body.cargo, ctx);
  return { x: body.droneX - width / 2, y: top, width, height: bottom - top };
}

/** Where the claw grips, in world px. */
export function droneGrip(body: Pick<MovementBody, 'droneX' | 'droneY'>, c: Readonly<CompiledAbilities> = ABILITIES): Vec2 {
  return { x: body.droneX, y: body.droneY + c.drone.gripY };
}

/** Where the drone goes back to when recalled (the pilot's hands). */
export function droneHome(body: Pick<MovementBody, 'x' | 'y' | 'facing'>, hitbox: HitboxSize, c: Readonly<CompiledAbilities> = ABILITIES): Vec2 {
  const feet = feetOf(body, hitbox);
  return { x: feet.x + body.facing * c.drone.spawnOffset.x, y: feet.y + c.drone.spawnOffset.y };
}

/** Giant form is on (growing, big, or shrinking back): the bonus hearts count. */
export function giantActive(body: Pick<MovementBody, 'giant' | 'phase'>): boolean {
  return body.giant > 0 || body.phase === Phase.GIANT_GROW || body.phase === Phase.GIANT_SHRINK;
}

function enter(body: MovementBody, phase: number): void {
  body.phase = phase;
  body.phaseTime = 0;
}

function finish(body: MovementBody, cooldown: number): void {
  enter(body, Phase.NONE);
  body.specialCooldown = cooldown;
  body.reach = 0;
  body.cargo = Cargo.NONE;
}

/**
 * Stops whatever the ability is doing because its owner was hit, grabbed or killed. The drone
 * flies home; everything else just ends (on cooldown). Giant form keeps going.
 */
export function interruptAbility(body: MovementBody, c: Readonly<CompiledAbilities> = ABILITIES): void {
  switch (body.phase) {
    case Phase.NONE:
    case Phase.GIANT_SHRINK:
    case Phase.DRONE_RECALL:
    case Phase.DRONE_CATCH:
    case Phase.DRONE_STAND:
    case Phase.TONGUE_RETRACT:
      return;
    case Phase.GIANT_GROW:
      enter(body, Phase.NONE);
      body.giant = c.giant.duration;
      return;
    case Phase.HEAL:
      finish(body, c.heal.cooldown);
      return;
    case Phase.DRONE_DEPLOY:
    case Phase.DRONE_SIT:
      finish(body, c.drone.cooldown);
      return;
    case Phase.DRONE_PILOT:
      enter(body, Phase.DRONE_RECALL);
      body.cargo = Cargo.NONE;
      return;
    case Phase.TONGUE_WINDUP:
    case Phase.TONGUE_SHOOT:
    case Phase.TONGUE_PULL:
      if (body.reach > 0) enter(body, Phase.TONGUE_RETRACT);
      else finish(body, c.tongue.missCooldown);
      return;
    default:
      // Swallowed something / mid-spit: it comes out (the server releases it), no projectile.
      finish(body, c.tongue.missCooldown);
  }
}

/**
 * One step of the owner's ability. Returns whether the body may move on its own this step.
 * `specialPressed` / `attackPressed` are this step's fresh presses.
 */
export function stepAbility(
  body: MovementBody,
  buttons: number,
  ctx: MovementContext,
  specialPressed: boolean,
  attackPressed: boolean,
): AbilityControl {
  if (body.ability === Ability.NONE) return 'free';
  const c = abilityConfig(ctx);
  const dt = ctx.dt;
  const before = body.phaseTime;

  if (body.phase === Phase.NONE) {
    if (body.giant > 0) {
      body.giant = Math.max(0, body.giant - dt);
      if (body.giant === 0) enter(body, Phase.GIANT_SHRINK);
    } else {
      body.specialCooldown = Math.max(0, body.specialCooldown - dt);
    }
  } else {
    body.phaseTime += dt;
  }
  if (body.hurt > 0) interruptAbility(body, c);

  if (body.phase === Phase.NONE) {
    if (specialPressed && body.specialCooldown <= 0 && body.hurt <= 0 && body.attack <= 0 && body.giant <= 0) {
      start(body, buttons);
    }
    return isLockedPhase(body.phase) ? 'locked' : 'free';
  }

  const t = body.phaseTime;
  switch (body.phase) {
    case Phase.HEAL:
      if (t >= c.heal.duration) finish(body, c.heal.cooldown);
      break;

    case Phase.DRONE_DEPLOY:
      // Compare with the time before this step (t - dt can round to either side of spawnAt).
      if (t >= c.drone.spawnAt && before < c.drone.spawnAt) {
        const home = droneHome(body, ctx.hitbox, c);
        body.droneX = home.x;
        body.droneY = home.y;
        body.droneVx = 0;
        body.droneVy = -c.drone.maxSpeed * 0.5;
      }
      if (t >= c.drone.spawnAt) stepDrone(body, 0, ctx, c);
      if (t >= c.drone.deploy) enter(body, Phase.DRONE_SIT);
      break;
    case Phase.DRONE_SIT:
      stepDrone(body, 0, ctx, c);
      if (t >= c.drone.sit) enter(body, Phase.DRONE_PILOT);
      break;
    case Phase.DRONE_PILOT:
      if (attackPressed || t >= c.drone.battery) {
        enter(body, Phase.DRONE_RECALL);
        body.cargo = Cargo.NONE; // the server drops whatever the claw held
        body.droneVx = body.droneVy = 0;
        break;
      }
      if (specialPressed) body.specialSeq += 1; // grab / drop, decided by the server
      stepDrone(body, buttons, ctx, c);
      break;
    case Phase.DRONE_RECALL: {
      if (t >= c.drone.recall) {
        const home = droneHome(body, ctx.hitbox, c);
        const left = c.drone.recall + c.drone.return - t;
        const k = left <= 0 ? 1 : Math.min(1, dt / (left + dt));
        body.droneX += (home.x - body.droneX) * k;
        body.droneY += (home.y - body.droneY) * k;
      }
      if (t >= c.drone.recall + c.drone.return) enter(body, Phase.DRONE_CATCH);
      break;
    }
    case Phase.DRONE_CATCH:
      if (t >= c.drone.catch) enter(body, Phase.DRONE_STAND);
      break;
    case Phase.DRONE_STAND:
      if (t >= c.drone.stand) finish(body, c.drone.cooldown);
      break;

    case Phase.GIANT_GROW:
      if (t >= c.giant.grow) {
        enter(body, Phase.NONE);
        body.giant = c.giant.duration;
      }
      break;
    case Phase.GIANT_SHRINK:
      if (t >= c.giant.shrink) finish(body, c.giant.cooldown);
      break;

    case Phase.TONGUE_WINDUP:
      if (t >= c.tongue.windup) enter(body, Phase.TONGUE_SHOOT);
      break;
    case Phase.TONGUE_SHOOT: {
      body.reach = Math.min(c.tongue.maxLength, body.reach + c.tongue.speed * dt);
      const tip = tongueTip(body, ctx.hitbox, c);
      const ts = ctx.level.tileSize;
      const blocked = isSolidCell(ctx.level, Math.floor(tip.x / ts), Math.floor(tip.y / ts));
      if (blocked || body.reach >= c.tongue.maxLength) enter(body, Phase.TONGUE_RETRACT);
      break;
    }
    case Phase.TONGUE_RETRACT:
      body.reach = Math.max(0, body.reach - c.tongue.retractSpeed * dt);
      if (body.reach <= 0) finish(body, c.tongue.missCooldown);
      break;
    case Phase.TONGUE_PULL:
      body.reach = Math.max(0, body.reach - c.tongue.pullSpeed * dt);
      if (body.reach <= SWALLOW_REACH) {
        body.reach = 0;
        enter(body, Phase.TONGUE_GULP);
      }
      break;
    case Phase.TONGUE_GULP:
      if (t >= c.tongue.gulp) enter(body, Phase.TONGUE_HOLD);
      break;
    case Phase.TONGUE_HOLD:
      body.aim = aimFromButtons(buttons, body.facing);
      if (specialPressed || t >= c.tongue.holdMax) {
        if (specialPressed) body.specialSeq += 1;
        body.facing = facingForAim(body.aim, body.facing);
        enter(body, Phase.TONGUE_SPIT);
      }
      break;
    case Phase.TONGUE_SPIT:
      if (t >= c.tongue.spit) enter(body, Phase.TONGUE_SPIT_RECOVER);
      break;
    case Phase.TONGUE_SPIT_RECOVER:
      if (t >= c.tongue.spitRecover) finish(body, c.tongue.spitCooldown);
      break;
  }
  return isLockedPhase(body.phase) ? 'locked' : 'free';
}

function start(body: MovementBody, buttons: number): void {
  switch (body.ability) {
    case Ability.HEAL:
      if (!body.grounded) return;
      enter(body, Phase.HEAL);
      break;
    case Ability.DRONE:
      if (!body.grounded) return;
      enter(body, Phase.DRONE_DEPLOY);
      body.cargo = Cargo.NONE;
      break;
    case Ability.GIANT:
      enter(body, Phase.GIANT_GROW);
      break;
    case Ability.TONGUE:
      body.aim = aimFromButtons(buttons, body.facing);
      body.facing = facingForAim(body.aim, body.facing);
      body.reach = 0;
      enter(body, Phase.TONGUE_WINDUP);
      break;
    default:
      return;
  }
  body.specialSeq += 1;
}

/** Drone flight: 8-way thrust from the pilot's input, tile collision, a leash to the pilot. */
function stepDrone(body: MovementBody, buttons: number, ctx: MovementContext, c: Readonly<CompiledAbilities>): void {
  const d = c.drone;
  const dt = ctx.dt;
  let dx = ((buttons & Button.RIGHT) !== 0 ? 1 : 0) - ((buttons & Button.LEFT) !== 0 ? 1 : 0);
  let dy = ((buttons & Button.DOWN) !== 0 ? 1 : 0) - ((buttons & Button.JUMP) !== 0 ? 1 : 0);
  const max = body.cargo === Cargo.NONE ? d.maxSpeed : d.carrySpeed;
  if (dx !== 0 && dy !== 0) {
    dx *= Math.SQRT1_2;
    dy *= Math.SQRT1_2;
  }
  body.droneVx = approach(body.droneVx, dx * max, (dx !== 0 ? d.acceleration : d.deceleration) * dt);
  body.droneVy = approach(body.droneVy, dy * max, (dy !== 0 ? d.acceleration : d.deceleration) * dt);

  moveDroneAxis(body, body.droneVx * dt, 0, ctx);
  moveDroneAxis(body, 0, body.droneVy * dt, ctx);

  // Leash: stay within reach of the pilot's signal.
  const feet = feetOf(body, ctx.hitbox);
  const ox = body.droneX - feet.x;
  const oy = body.droneY - (feet.y - ctx.hitbox.height / 2);
  const dist = Math.hypot(ox, oy);
  if (dist > d.leash) {
    const k = d.leash / dist;
    const nx = ox / dist;
    const ny = oy / dist;
    body.droneX = feet.x + ox * k;
    body.droneY = feet.y - ctx.hitbox.height / 2 + oy * k;
    const outward = body.droneVx * nx + body.droneVy * ny;
    if (outward > 0) {
      body.droneVx -= outward * nx;
      body.droneVy -= outward * ny;
    }
  }
  // Never above the top of the level or below its bottom (the claw has to be reachable).
  body.droneY = clamp(body.droneY, d.size.height / 2, Math.max(d.size.height / 2, ctx.level.heightPx - d.size.height / 2));
}

/** Moves the drone (with its cargo) along one axis and stops it at solid tiles. */
function moveDroneAxis(body: MovementBody, mx: number, my: number, ctx: MovementContext): void {
  if (mx === 0 && my === 0) return;
  const ts = ctx.level.tileSize;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(mx), Math.abs(my)) / (ts * 0.5)));
  for (let i = 0; i < steps; i++) {
    const px = body.droneX;
    const py = body.droneY;
    body.droneX += mx / steps;
    body.droneY += my / steps;
    if (boxHitsSolid(droneBox(body, ctx), ctx)) {
      body.droneX = px;
      body.droneY = py;
      if (mx !== 0) body.droneVx = 0;
      if (my !== 0) body.droneVy = 0;
      return;
    }
  }
}

function boxHitsSolid(r: Rect, ctx: MovementContext): boolean {
  const { level } = ctx;
  const ts = level.tileSize;
  const eps = 1e-6;
  const c0 = Math.floor(r.x / ts);
  const c1 = Math.floor((r.x + r.width - eps) / ts);
  const r0 = Math.floor(r.y / ts);
  const r1 = Math.floor((r.y + r.height - eps) / ts);
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) if (cellAt(level, col, row) & CellFlag.SOLID) return true;
  }
  return false;
}

/** Exposed for the server's rules (cargo placement checks). */
export function rectHitsSolid(r: Rect, ctx: MovementContext): boolean {
  return boxHitsSolid(r, ctx);
}
