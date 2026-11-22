import type { CompiledCombat } from '../config/combat';
import type { Rect } from '../util/math';
import { Button, NEUTRAL_INPUT } from './input';
import {
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
  if (!body.alive) {
    body.attackHeld = attackDown;
    stepPlayerMovement(body, buttons, ctx, tick, contacts); // records the jump edge only
    return contacts;
  }
  const c = ctx.combat;
  const dt = ctx.dt;
  const attackPressed = attackDown && !body.attackHeld;
  body.attackHeld = attackDown;

  body.attack = Math.max(0, body.attack - dt);
  body.attackCooldown = Math.max(0, body.attackCooldown - dt);
  body.hurt = Math.max(0, body.hurt - dt);

  const started = attackPressed && body.attackCooldown <= 0 && body.hurt <= 0;
  if (started) {
    body.attack = c.attackDuration;
    body.attackCooldown = c.attackCooldown;
    body.attackSeq += 1;
  }

  if (body.hurt > 0) {
    // Stunned: no control, knockback carries the body. Keep tracking the real jump button so a
    // jump held through the stun is not treated as a fresh press when control returns.
    stepPlayerMovement(body, NEUTRAL_INPUT, ctx, tick, contacts);
    body.jumpHeld = (buttons & Button.JUMP) !== 0;
    return contacts;
  }

  const facing = body.facing;
  stepPlayerMovement(body, buttons, ctx, tick, contacts);
  // Turning still works on the step a swing starts (Left + Attack together swings left).
  if (body.attack > 0 && c.lockFacing && !started) body.facing = facing;
  return contacts;
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
): Rect {
  const { width: reach, height, offsetY } = combat.reach;
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
