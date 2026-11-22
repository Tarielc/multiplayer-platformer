import type { CompiledCombat } from '../config/combat';
import type { CompiledMovement } from '../config/movement';
import { CellFlag, type LevelData } from '../level/types';
import { approach } from '../util/math';
import { cellAt } from './collision';
import { Button } from './input';

/**
 * Complete movement state of one player. Everything that influences the next step lives
 * here (including timers), so the client can re-simulate from any server state exactly.
 */
export interface MovementBody {
  /** Top-left of the hitbox, px. */
  x: number;
  y: number;
  /** Velocity, px/s (+y is down). */
  vx: number;
  vy: number;
  facing: 1 | -1;
  grounded: boolean;
  /** Jump button state on the previous step (edge detection). */
  jumpHeld: boolean;
  /** Rising from a jump that can still be cut short by releasing the button. */
  jumping: boolean;
  /** Seconds of coyote time left. */
  coyote: number;
  /** Seconds left on a buffered jump press. */
  buffer: number;
  /** Seconds left ignoring one-way platforms (drop-through). */
  drop: number;
  alive: boolean;
  /** Attack button state on the previous step (edge detection). */
  attackHeld: boolean;
  /** Seconds left in the current swing (0 = not swinging). */
  attack: number;
  /** Seconds until another swing may start. */
  attackCooldown: number;
  /** Swings started so far; presentation detects a new swing when this increases. */
  attackSeq: number;
  /** Seconds of hit stun left (inputs ignored). Set by the server when hit. */
  hurt: number;
}

export interface HitboxSize {
  width: number;
  height: number;
}

export interface MovementContext {
  level: LevelData;
  movement: CompiledMovement;
  hitbox: HitboxSize;
  combat: CompiledCombat;
  /** Fixed step in seconds. */
  dt: number;
}

const EPS = 1e-6;

/** Creates a body standing with its feet at (feetX, feetY). */
export function createBody(feetX: number, feetY: number, hitbox: HitboxSize): MovementBody {
  return {
    x: feetX - hitbox.width / 2,
    y: feetY - hitbox.height,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: false,
    jumpHeld: false,
    jumping: false,
    coyote: 0,
    buffer: 0,
    drop: 0,
    alive: true,
    attackHeld: false,
    attack: 0,
    attackCooldown: 0,
    attackSeq: 0,
    hurt: 0,
  };
}

/**
 * Teleports a body to a new feet position and clears motion and action timers (respawn).
 * Keeps the button edges (`jumpHeld`, `attackHeld`) and `attackSeq`.
 */
export function resetBody(body: MovementBody, feetX: number, feetY: number, hitbox: HitboxSize): void {
  body.x = feetX - hitbox.width / 2;
  body.y = feetY - hitbox.height;
  body.vx = 0;
  body.vy = 0;
  body.grounded = false;
  body.jumping = false;
  body.coyote = 0;
  body.buffer = 0;
  body.drop = 0;
  body.alive = true;
  body.attack = 0;
  body.attackCooldown = 0;
  body.hurt = 0;
}

export function cloneBody(body: MovementBody): MovementBody {
  return { ...body };
}

/**
 * Physics only: advances one player's movement by one fixed step. Pure function of
 * (body, buttons, context). Game code calls `stepPlayerBody` (sim/actions.ts), which wraps this
 * with attack and stun handling.
 */
export function stepPlayerMovement(body: MovementBody, buttons: number, ctx: MovementContext): void {
  const jump = (buttons & Button.JUMP) !== 0;
  if (!body.alive) {
    body.jumpHeld = jump;
    return;
  }
  const m = ctx.movement;
  const dt = ctx.dt;
  const left = (buttons & Button.LEFT) !== 0;
  const right = (buttons & Button.RIGHT) !== 0;
  const down = (buttons & Button.DOWN) !== 0;
  const jumpPressed = jump && !body.jumpHeld;
  body.jumpHeld = jump;

  // Timers: coyote refills while grounded; a fresh press (re)starts the jump buffer.
  body.coyote = body.grounded ? m.coyoteTime : Math.max(0, body.coyote - dt);
  body.buffer = jumpPressed ? m.jumpBuffer : Math.max(0, body.buffer - dt);
  body.drop = Math.max(0, body.drop - dt);

  // Horizontal acceleration / deceleration, with a boost when reversing direction.
  const dir = (right ? 1 : 0) - (left ? 1 : 0);
  if (dir !== 0) {
    const accel = body.grounded ? m.groundAcceleration : m.airAcceleration;
    const turning = body.vx !== 0 && Math.sign(body.vx) !== dir;
    body.vx = approach(body.vx, dir * m.maxRunSpeed, accel * (turning ? m.turnMultiplier : 1) * dt);
    body.facing = dir > 0 ? 1 : -1;
  } else {
    const decel = body.grounded ? m.groundDeceleration : m.airDeceleration;
    body.vx = approach(body.vx, 0, decel * dt);
  }

  // Down + jump on a one-way platform drops through it instead of jumping.
  if (down && jumpPressed && body.grounded && standingOnOneWayOnly(body, ctx)) {
    body.drop = m.dropThroughTime;
    body.buffer = 0;
    body.coyote = 0;
    body.grounded = false;
  }

  // Jump: a buffered press + remaining coyote time (covers "pressed just before landing"
  // and "pressed just after walking off a ledge").
  if (body.buffer > 0 && body.coyote > 0) {
    body.vy = -m.jumpVelocity;
    body.jumping = true;
    body.grounded = false;
    body.buffer = 0;
    body.coyote = 0;
  }

  // Variable jump height: releasing early cuts the remaining upward velocity once.
  if (body.jumping) {
    if (!jump && body.vy < 0) {
      body.vy *= m.jumpCutMultiplier;
      body.jumping = false;
    } else if (body.vy >= 0) {
      body.jumping = false;
    }
  }

  // Gravity (heavier on the way down), clamped to terminal velocity.
  const vyStart = body.vy;
  const gravity = vyStart > 0 ? m.fallGravity : m.gravity;
  body.vy = Math.min(vyStart + gravity * dt, m.maxFallSpeed);

  // Vertical position uses the average velocity over the step (trapezoidal rule). It is exact
  // under constant gravity, so a held jump peaks at precisely `jumpHeight` after `timeToApex`.
  moveAndCollide(body, body.vx * dt, (vyStart + body.vy) * 0.5 * dt, ctx);
}

/** Axis-separated AABB vs tile-grid movement, sub-stepped so a step never exceeds half a tile. */
function moveAndCollide(body: MovementBody, dx: number, dy: number, ctx: MovementContext): void {
  const half = ctx.level.tileSize * 0.5;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / half));
  let sx = dx / steps;
  let sy = dy / steps;
  body.grounded = false;
  for (let i = 0; i < steps; i++) {
    if (sx !== 0 && moveX(body, sx, ctx)) sx = 0;
    if (sy !== 0 && moveY(body, sy, ctx)) sy = 0;
  }
}

function moveX(body: MovementBody, dx: number, ctx: MovementContext): boolean {
  const { level, hitbox } = ctx;
  const ts = level.tileSize;
  body.x += dx;
  const rowTop = Math.floor(body.y / ts);
  const rowBottom = Math.floor((body.y + hitbox.height - EPS) / ts);
  if (dx > 0) {
    const col = Math.floor((body.x + hitbox.width - EPS) / ts);
    for (let row = rowTop; row <= rowBottom; row++) {
      if (cellAt(level, col, row) & CellFlag.SOLID) {
        body.x = col * ts - hitbox.width;
        body.vx = 0;
        return true;
      }
    }
  } else {
    const col = Math.floor(body.x / ts);
    for (let row = rowTop; row <= rowBottom; row++) {
      if (cellAt(level, col, row) & CellFlag.SOLID) {
        body.x = (col + 1) * ts;
        body.vx = 0;
        return true;
      }
    }
  }
  return false;
}

function moveY(body: MovementBody, dy: number, ctx: MovementContext): boolean {
  const { level, hitbox } = ctx;
  const ts = level.tileSize;
  const prevBottom = body.y + hitbox.height;
  body.y += dy;
  const colLeft = Math.floor(body.x / ts);
  const colRight = Math.floor((body.x + hitbox.width - EPS) / ts);
  if (dy > 0) {
    const row = Math.floor((body.y + hitbox.height - EPS) / ts);
    const top = row * ts;
    for (let col = colLeft; col <= colRight; col++) {
      const cell = cellAt(level, col, row);
      const solid = (cell & CellFlag.SOLID) !== 0;
      // One-way platforms only stop bodies that were fully above them before this move.
      const oneWay = !solid && (cell & CellFlag.ONE_WAY) !== 0 && body.drop <= 0 && prevBottom <= top + EPS;
      if (solid || oneWay) {
        body.y = top - hitbox.height;
        body.vy = 0;
        body.grounded = true;
        return true;
      }
    }
  } else {
    const row = Math.floor(body.y / ts);
    for (let col = colLeft; col <= colRight; col++) {
      if (cellAt(level, col, row) & CellFlag.SOLID) {
        body.y = (row + 1) * ts;
        body.vy = 0;
        body.jumping = false;
        return true;
      }
    }
  }
  return false;
}

function standingOnOneWayOnly(body: MovementBody, ctx: MovementContext): boolean {
  const { level, hitbox } = ctx;
  const ts = level.tileSize;
  const row = Math.floor((body.y + hitbox.height + 1) / ts);
  const colLeft = Math.floor(body.x / ts);
  const colRight = Math.floor((body.x + hitbox.width - EPS) / ts);
  let oneWay = false;
  for (let col = colLeft; col <= colRight; col++) {
    const cell = cellAt(level, col, row);
    if (cell & CellFlag.SOLID) return false;
    if (cell & CellFlag.ONE_WAY) oneWay = true;
  }
  return oneWay;
}
