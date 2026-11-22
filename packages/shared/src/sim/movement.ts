import type { CompiledCombat } from '../config/combat';
import type { CompiledMovement } from '../config/movement';
import { CellFlag, type LevelData } from '../level/types';
import { approach, type Rect } from '../util/math';
import { cellAt } from './collision';
import { Button } from './input';
import type { TrapField } from './traps/TrapField';
import type { TrapCollider } from './traps/types';

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
  /** Mid-air jumps left before landing (refilled on the ground and by bounces). */
  airJumpsLeft: number;
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
  /**
   * Tick of the body's last step. Traps move as a function of the tick, so the next step needs
   * to know how far they moved since (riding a platform, being pushed).
   */
  stepTick: number;
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
  /** Traps and moving platforms. Without them, bodies only collide with tiles. */
  traps?: TrapField | null;
}

/**
 * What a step touched, for the game rules (server) and presentation (client). Trap ids, or -1.
 * The physical effects (landing, launches, pushes) are already applied to the body.
 */
export interface StepContacts {
  /** Trap the body stands on after the step (falling platforms, rock-heads…). */
  ground: number;
  /** Trampoline that launched the body. */
  bounced: number;
  /** Box the body landed on (and bounced off). */
  stomped: number;
  /** A moving solid pushed the body into something solid. */
  crushed: boolean;
}

export function noContacts(): StepContacts {
  return { ground: -1, bounced: -1, stomped: -1, crushed: false };
}

const EPS = 1e-6;
/** How close (px) feet must be to a moving platform's top to ride it. */
const RIDE_EPS = 0.5;
/** Overlap (px) tolerated before a pushed body counts as crushed. */
const CRUSH_TOLERANCE = 1;
const NO_COLLIDERS: readonly TrapCollider[] = [];

/**
 * Creates a body standing with its feet at (feetX, feetY). `stepTick` is the tick before its
 * first step.
 */
export function createBody(feetX: number, feetY: number, hitbox: HitboxSize, stepTick = -1, airJumps = 0): MovementBody {
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
    airJumpsLeft: airJumps,
    alive: true,
    attackHeld: false,
    attack: 0,
    attackCooldown: 0,
    attackSeq: 0,
    hurt: 0,
    stepTick,
  };
}

/**
 * Teleports a body to a new feet position and clears motion and action timers (respawn).
 * Keeps the button edges (`jumpHeld`, `attackHeld`), `attackSeq` and `stepTick`.
 */
export function resetBody(body: MovementBody, feetX: number, feetY: number, hitbox: HitboxSize, airJumps = 0): void {
  body.x = feetX - hitbox.width / 2;
  body.y = feetY - hitbox.height;
  body.vx = 0;
  body.vy = 0;
  body.grounded = false;
  body.jumping = false;
  body.coyote = 0;
  body.buffer = 0;
  body.drop = 0;
  body.airJumpsLeft = airJumps;
  body.alive = true;
  body.attack = 0;
  body.attackCooldown = 0;
  body.hurt = 0;
}

export function cloneBody(body: MovementBody): MovementBody {
  return { ...body };
}

/**
 * Physics only: advances one player's movement by one fixed step, at `tick`. Pure function of
 * (body, buttons, context, tick) plus the traps' replicated state. Game code calls
 * `stepPlayerBody` (sim/actions.ts), which wraps this with attack and stun handling.
 *
 * With traps: first the body rides the platform it stood on and is pushed by solids that moved
 * into it (since `body.stepTick`), then wind blows, then it moves and collides with tiles and
 * trap colliders at `tick`.
 */
export function stepPlayerMovement(
  body: MovementBody,
  buttons: number,
  ctx: MovementContext,
  tick = body.stepTick + 1,
  contacts: StepContacts = noContacts(),
): StepContacts {
  const jump = (buttons & Button.JUMP) !== 0;
  if (!body.alive) {
    body.jumpHeld = jump;
    body.stepTick = tick;
    return contacts;
  }
  const traps = ctx.traps ?? null;
  const colliders = traps ? traps.colliders(tick) : NO_COLLIDERS;
  // Several inputs applied on one server tick (catch-up) follow the platforms only once.
  if (traps && colliders.length > 0 && tick > body.stepTick) followColliders(body, ctx, traps, colliders, contacts);

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
  const dropping = down && jumpPressed && body.grounded && standingOnOneWayOnly(body, ctx, colliders);
  if (dropping) {
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
  } else if (jumpPressed && !dropping && body.airJumpsLeft > 0) {
    // Air jump: a fresh press in mid-air (coyote time over) relaunches at once, whatever the
    // current vertical speed, and can be cut short like a ground jump. With none left, the
    // press stays buffered for the landing as before.
    body.vy = -m.airJumpVelocity;
    body.jumping = true;
    body.buffer = 0;
    body.airJumpsLeft -= 1;
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

  if (traps && traps.fans.length > 0) applyWind(body, ctx, traps, tick);

  // Gravity (heavier on the way down), clamped to terminal velocity.
  const vyStart = body.vy;
  const gravity = vyStart > 0 ? m.fallGravity : m.gravity;
  body.vy = Math.min(vyStart + gravity * dt, m.maxFallSpeed);

  // Vertical position uses the average velocity over the step (trapezoidal rule). It is exact
  // under constant gravity, so a held jump peaks at precisely `jumpHeight` after `timeToApex`.
  moveAndCollide(body, body.vx * dt, (vyStart + body.vy) * 0.5 * dt, ctx, colliders, contacts);
  body.stepTick = tick;
  return contacts;
}

/**
 * Axis-separated AABB movement against the tile grid and trap colliders, sub-stepped so a step
 * never exceeds half a tile.
 */
function moveAndCollide(
  body: MovementBody,
  dx: number,
  dy: number,
  ctx: MovementContext,
  colliders: readonly TrapCollider[],
  contacts: StepContacts,
): void {
  const half = ctx.level.tileSize * 0.5;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / half));
  let sx = dx / steps;
  let sy = dy / steps;
  body.grounded = false;
  for (let i = 0; i < steps; i++) {
    if (sx !== 0 && moveX(body, sx, ctx, colliders)) sx = 0;
    if (sy !== 0 && moveY(body, sy, ctx, colliders, contacts)) sy = 0;
  }
}

function moveX(body: MovementBody, dx: number, ctx: MovementContext, colliders: readonly TrapCollider[]): boolean {
  const { level, hitbox } = ctx;
  const ts = level.tileSize;
  const w = hitbox.width;
  const h = hitbox.height;
  const startX = body.x;
  body.x += dx;
  const rowTop = Math.floor(body.y / ts);
  const rowBottom = Math.floor((body.y + h - EPS) / ts);
  let hit = false;
  if (dx > 0) {
    const col = Math.floor((body.x + w - EPS) / ts);
    for (let row = rowTop; row <= rowBottom; row++) {
      if (cellAt(level, col, row) & CellFlag.SOLID) {
        body.x = col * ts - w;
        hit = true;
        break;
      }
    }
    for (const c of colliders) {
      if (c.oneWay || body.y >= c.y + c.height - EPS || body.y + h <= c.y + EPS) continue;
      // Only edges crossed by this move block it (never snap out of something already overlapped).
      if (startX + w <= c.x + EPS && body.x + w > c.x + EPS) {
        body.x = c.x - w;
        hit = true;
      }
    }
  } else {
    const col = Math.floor(body.x / ts);
    for (let row = rowTop; row <= rowBottom; row++) {
      if (cellAt(level, col, row) & CellFlag.SOLID) {
        body.x = (col + 1) * ts;
        hit = true;
        break;
      }
    }
    for (const c of colliders) {
      if (c.oneWay || body.y >= c.y + c.height - EPS || body.y + h <= c.y + EPS) continue;
      const right = c.x + c.width;
      if (startX >= right - EPS && body.x < right - EPS) {
        body.x = right;
        hit = true;
      }
    }
  }
  if (hit) body.vx = 0;
  return hit;
}

function moveY(
  body: MovementBody,
  dy: number,
  ctx: MovementContext,
  colliders: readonly TrapCollider[],
  contacts: StepContacts,
): boolean {
  const { level, hitbox } = ctx;
  const ts = level.tileSize;
  const w = hitbox.width;
  const h = hitbox.height;
  const prevTop = body.y;
  const prevBottom = body.y + h;
  body.y += dy;
  const colLeft = Math.floor(body.x / ts);
  const colRight = Math.floor((body.x + w - EPS) / ts);
  const overlapsX = (c: Rect) => body.x < c.x + c.width - EPS && body.x + w > c.x + EPS;
  if (dy > 0) {
    const row = Math.floor((body.y + h - EPS) / ts);
    const top = row * ts;
    let stop = Infinity;
    for (let col = colLeft; col <= colRight; col++) {
      const cell = cellAt(level, col, row);
      const solid = (cell & CellFlag.SOLID) !== 0;
      // One-way platforms only stop bodies that were fully above them before this move.
      const oneWay = !solid && (cell & CellFlag.ONE_WAY) !== 0 && body.drop <= 0 && prevBottom <= top + EPS;
      if (solid || oneWay) {
        stop = top;
        break;
      }
    }
    let landedOn: TrapCollider | null = null;
    for (const c of colliders) {
      if (!overlapsX(c) || prevBottom > c.y + EPS || body.y + h <= c.y + EPS) continue;
      if (c.oneWay && body.drop > 0) continue;
      if (c.y < stop) {
        stop = c.y;
        landedOn = c;
      }
    }
    if (stop === Infinity) return false;
    body.y = stop - h;
    if (landedOn && landedOn.bounce > 0) {
      // Trampolines and boxes throw the body back up (no jump cut: it isn't a jump).
      body.vy = -landedOn.bounce;
      body.jumping = false;
      body.coyote = 0;
      body.airJumpsLeft = ctx.movement.airJumps;
      if (landedOn.kind === 'box') contacts.stomped = landedOn.id;
      else contacts.bounced = landedOn.id;
      return true;
    }
    body.vy = 0;
    body.grounded = true;
    body.airJumpsLeft = ctx.movement.airJumps;
    contacts.ground = landedOn ? landedOn.id : -1;
    return true;
  }
  const row = Math.floor(body.y / ts);
  let stop = -Infinity;
  for (let col = colLeft; col <= colRight; col++) {
    if (cellAt(level, col, row) & CellFlag.SOLID) {
      stop = (row + 1) * ts;
      break;
    }
  }
  for (const c of colliders) {
    const bottom = c.y + c.height;
    if (c.oneWay || !overlapsX(c) || prevTop < bottom - EPS || body.y >= bottom - EPS) continue;
    if (bottom > stop) stop = bottom;
  }
  if (stop === -Infinity) return false;
  body.y = stop;
  body.vy = 0;
  body.jumping = false;
  return true;
}

function standingOnOneWayOnly(body: MovementBody, ctx: MovementContext, colliders: readonly TrapCollider[]): boolean {
  const { level, hitbox } = ctx;
  const ts = level.tileSize;
  const feet = body.y + hitbox.height;
  const row = Math.floor((feet + 1) / ts);
  const colLeft = Math.floor(body.x / ts);
  const colRight = Math.floor((body.x + hitbox.width - EPS) / ts);
  let oneWay = false;
  for (let col = colLeft; col <= colRight; col++) {
    const cell = cellAt(level, col, row);
    if (cell & CellFlag.SOLID) return false;
    if (cell & CellFlag.ONE_WAY) oneWay = true;
  }
  for (const c of colliders) {
    if (Math.abs(c.y - feet) > RIDE_EPS || body.x >= c.x + c.width - EPS || body.x + hitbox.width <= c.x + EPS) continue;
    if (!c.oneWay) return false;
    oneWay = true;
  }
  return oneWay;
}

/**
 * Moving platforms, before the body's own movement:
 *  1. Ride: a body standing on a collider at its last step moves with it.
 *  2. Push: a solid that moved into the body shoves it out along its motion. If that leaves the
 *     body inside something solid, it is crushed.
 */
function followColliders(
  body: MovementBody,
  ctx: MovementContext,
  traps: TrapField,
  colliders: readonly TrapCollider[],
  contacts: StepContacts,
): void {
  const { width: w, height: h } = ctx.hitbox;
  const prevTick = body.stepTick;

  if (body.grounded) {
    const feet = body.y + h;
    for (const before of traps.colliders(prevTick)) {
      if (Math.abs(before.y - feet) > RIDE_EPS || body.x >= before.x + before.width - EPS || body.x + w <= before.x + EPS) continue;
      const now = colliders.find((c) => c.id === before.id);
      if (now) {
        const dx = now.x - before.x;
        const dy = now.y - before.y;
        // Sinking platforms carry the body down; rising ones lift it through the push below.
        if (dy > 0) carryDown(body, dy, ctx, colliders, contacts);
        if (dx !== 0) moveX(body, dx, ctx, colliders.filter((c) => c.id !== now.id));
      }
      break;
    }
  }

  for (const c of colliders) {
    if (c.oneWay || !overlaps(body.x, body.y, w, h, c, EPS)) continue;
    const before = traps.colliderRect(c.id, prevTick) ?? c;
    const mx = c.x - before.x;
    const my = c.y - before.y;
    if (mx === 0 && my === 0) {
      pushOutShallowest(body, w, h, c);
    } else if (Math.abs(mx) >= Math.abs(my)) {
      body.x = mx > 0 ? c.x + c.width : c.x - w;
    } else if (my > 0) {
      body.y = c.y + c.height;
      if (body.vy < 0) body.vy = 0;
      body.jumping = false;
    } else {
      body.y = c.y - h;
      if (body.vy > 0) body.vy = 0;
    }
    if (overlapsSolid(body, ctx, colliders, c.id)) contacts.crushed = true;
  }
}

/** Moves the body down with a sinking platform, stopping on tiles or the platform itself. */
function carryDown(
  body: MovementBody,
  dy: number,
  ctx: MovementContext,
  colliders: readonly TrapCollider[],
  contacts: StepContacts,
): void {
  const half = ctx.level.tileSize * 0.5;
  const steps = Math.max(1, Math.ceil(dy / half));
  for (let i = 0; i < steps; i++) if (moveY(body, dy / steps, ctx, colliders, contacts)) break;
}

function pushOutShallowest(body: MovementBody, w: number, h: number, c: Rect): void {
  const left = body.x + w - c.x;
  const right = c.x + c.width - body.x;
  const up = body.y + h - c.y;
  const down = c.y + c.height - body.y;
  const min = Math.min(left, right, up, down);
  if (min === up) body.y = c.y - h;
  else if (min === left) body.x = c.x - w;
  else if (min === right) body.x = c.x + c.width;
  else body.y = c.y + c.height;
}

function overlaps(x: number, y: number, w: number, h: number, c: Rect, margin: number): boolean {
  return x < c.x + c.width - margin && x + w > c.x + margin && y < c.y + c.height - margin && y + h > c.y + margin;
}

/** Whether the body (shrunk by the crush tolerance) is inside solid tiles or another solid collider. */
function overlapsSolid(body: MovementBody, ctx: MovementContext, colliders: readonly TrapCollider[], exceptId: number): boolean {
  const { level, hitbox } = ctx;
  const ts = level.tileSize;
  const t = CRUSH_TOLERANCE;
  const c0 = Math.floor((body.x + t) / ts);
  const c1 = Math.floor((body.x + hitbox.width - t) / ts);
  const r0 = Math.floor((body.y + t) / ts);
  const r1 = Math.floor((body.y + hitbox.height - t) / ts);
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) if (cellAt(level, col, row) & CellFlag.SOLID) return true;
  }
  for (const c of colliders) {
    if (c.id !== exceptId && !c.oneWay && overlaps(body.x, body.y, hitbox.width, hitbox.height, c, t)) return true;
  }
  return false;
}

/** Fans: accelerate the body along each active stream it is in, up to the wind speed. */
function applyWind(body: MovementBody, ctx: MovementContext, traps: TrapField, tick: number): void {
  const fans = traps.windAt({ x: body.x, y: body.y, width: ctx.hitbox.width, height: ctx.hitbox.height }, tick);
  if (fans.length === 0) return;
  const { accel, maxSpeed } = traps.config.fan;
  const dv = accel * ctx.dt;
  for (const fan of fans) {
    switch (fan.dir) {
      case 'up':
        if (body.vy > -maxSpeed) body.vy = Math.max(body.vy - dv, -maxSpeed);
        break;
      case 'down':
        if (body.vy < maxSpeed) body.vy = Math.min(body.vy + dv, maxSpeed);
        break;
      case 'left':
        if (body.vx > -maxSpeed) body.vx = Math.max(body.vx - dv, -maxSpeed);
        break;
      case 'right':
        if (body.vx < maxSpeed) body.vx = Math.min(body.vx + dv, maxSpeed);
        break;
    }
  }
}
