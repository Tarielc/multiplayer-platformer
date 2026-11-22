import type { CompiledCombat } from '../config/combat';
import type { Rect } from '../util/math';
import { Button, NEUTRAL_INPUT } from './input';
import { Phase } from '../config/abilities';
import { stepAbility } from './abilities';
import {
  moveAndCollide,
  noContacts,
  stepPlayerMovement,
  type HitboxSize,
  type MovementBody,
  type MovementContext,
  type StepContacts,
} from './movement';

/**
 * One full player step at `tick`: action timers (swing, cooldown, stun) + movement physics.
 * The server passes its current tick; clients predict with the default (the tick after the
 * body's last step). Returns what the step touched (see `StepContacts`).
 *
 * This is the single per-tick entry point for a player. The server runs it authoritatively and
 * clients run the exact same function for prediction and replay, so a swing the local player
 * starts is visible immediately and matches the server bit for bit.
 *
 * Hits are *not* resolved here: they need every player and are decided by the server
 * (`GameWorld.resolveAttacks`), then replicated as the target's `hurt` timer + knockback.
 */
export function stepPlayerBody(
  body: MovementBody,
  buttons: number,
  ctx: MovementContext,
  tick = body.stepTick + 1,
): StepContacts {
  const contacts = noContacts();
  const attackDown = (buttons & Button.ATTACK) !== 0;
  const specialDown = (buttons & Button.SPECIAL) !== 0;
  const jumpDown = (buttons & Button.JUMP) !== 0;
  if (!body.alive) {
    body.attackHeld = attackDown;
    body.specialHeld = specialDown;
    stepPlayerMovement(body, buttons, ctx, tick, contacts); // records the jump edge only
    return contacts;
  }
  const c = ctx.combat;
  const dt = ctx.dt;
  const attackPressed = attackDown && !body.attackHeld;
  body.attackHeld = attackDown;
  const specialPressed = specialDown && !body.specialHeld;
  body.specialHeld = specialDown;

  body.attack = Math.max(0, body.attack - dt);
  body.attackCooldown = Math.max(0, body.attackCooldown - dt);
  body.hurt = Math.max(0, body.hurt - dt);

  if (body.held > 0) {
    // Held by someone's ability: the server places the body every tick.
    body.attack = 0;
    body.vx = body.vy = 0;
    body.grounded = body.jumping = false;
    body.coyote = body.buffer = 0;
    body.jumpHeld = jumpDown;
    body.stepTick = tick;
    return contacts;
  }
  if (body.flight > 0) {
    stepFlight(body, ctx, tick, contacts);
    body.jumpHeld = jumpDown;
    return contacts;
  }

  const control = stepAbility(body, buttons, ctx, specialPressed, attackPressed);
  const busy = body.phase !== Phase.NONE; // no swings while the ability is going (mouth full, sitting, ...)
  const started = control === 'free' && !busy && attackPressed && body.attackCooldown <= 0 && body.hurt <= 0;
  if (started) {
    body.attack = c.attackDuration;
    body.attackCooldown = c.attackCooldown;
    body.attackSeq += 1;
  }

  if (body.hurt > 0 || control === 'locked') {
    // Stunned or busy with the ability: no control, momentum and gravity carry the body. Keep
    // tracking the real jump button so a jump held through it is not a fresh press afterwards.
    stepPlayerMovement(body, NEUTRAL_INPUT, ctx, tick, contacts);
    body.jumpHeld = jumpDown;
    return contacts;
  }

  const facing = body.facing;
  stepPlayerMovement(body, buttons, ctx, tick, contacts);
  // Turning still works on the step a swing starts (Left + Attack together swings left).
  if (body.attack > 0 && c.lockFacing && !started) body.facing = facing;
  return contacts;
}

/**
 * Spat by the frog: a straight, uncontrolled flight along the launch velocity. Hitting a wall,
 * floor or ceiling (or running out of time) ends it with a short stun.
 */
function stepFlight(body: MovementBody, ctx: MovementContext, tick: number, contacts: StepContacts): void {
  const vx = body.vx;
  const vy = body.vy;
  body.flight = Math.max(0, body.flight - ctx.dt);
  const colliders = ctx.traps ? ctx.traps.colliders(tick) : [];
  moveAndCollide(body, vx * ctx.dt, vy * ctx.dt, ctx, colliders, contacts);
  const hit = body.vx !== vx || body.vy !== vy;
  if (hit || body.flight <= 0) {
    body.flight = 0;
    if (hit) {
      body.vx = 0;
      if (body.vy < 0 && vy >= 0) body.vy = 0; // no trampoline launch out of a flight
    } else {
      body.vx *= 0.35;
      body.vy *= 0.35;
    }
    body.hurt = Math.max(body.hurt, ctx.combat.stun);
  } else {
    body.grounded = false;
  }
  body.stepTick = tick;
}

/** Whether the body's current swing is inside its hit window. */
export function isAttackActive(body: Pick<MovementBody, 'alive' | 'attack'>, combat: CompiledCombat): boolean {
  if (!body.alive || body.attack <= 0) return false;
  const elapsed = combat.attackDuration - body.attack;
  // Small epsilon: timers are decremented in float steps of 1/60 s.
  return elapsed >= combat.activeFrom - 1e-9 && elapsed <= combat.activeTo + 1e-9;
}

/**
 * World-space box an active swing hits: from the body's centre to `reach.width` px past the
 * hitbox edge it faces. Starting at the centre means players standing inside each other
 * (players don't collide) can still be hit.
 */
export function attackReachBox(
  body: Pick<MovementBody, 'x' | 'y' | 'facing'>,
  hitbox: HitboxSize,
  combat: CompiledCombat,
  /** Giants reach further (width) and a little higher. */
  scale = 1,
): Rect {
  const reach = combat.reach.width * scale;
  const height = combat.reach.height * (1 + (scale - 1) / 2);
  const offsetY = combat.reach.offsetY;
  const half = hitbox.width / 2;
  const width = half + reach;
  const feetY = body.y + hitbox.height;
  return {
    x: body.facing > 0 ? body.x + half : body.x + half - width,
    y: feetY - offsetY - height,
    width,
    height,
  };
}
