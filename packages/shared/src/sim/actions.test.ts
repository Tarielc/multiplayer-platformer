import { describe, expect, it } from 'vitest';
import { resolveCombat } from '../config/combat';
import { resolveMovement } from '../config/movement';
import { msToTicks, NET_CONFIG, TICK_DT } from '../config/net';
import { PLAYER_CONFIG } from '../config/players';
import { asciiToLevel } from '../dev/asciiMap';
import { mulberry32 } from '../util/math';
import { attackReachBox, isAttackActive, stepPlayerBody } from './actions';
import { Button, NEUTRAL_INPUT } from './input';
import { cloneBody, createBody, type MovementBody, type MovementContext } from './movement';

const HITBOX = PLAYER_CONFIG.hitbox;
const COMBAT = resolveCombat();
const FLAT = ['                    ', '                    ', ' 1                  ', '####################'];

function makeCtx(): MovementContext {
  return { level: asciiToLevel({ rows: FLAT }), movement: resolveMovement(), hitbox: HITBOX, combat: COMBAT, dt: TICK_DT };
}

function standing(ctx: MovementContext): MovementBody {
  const spawn = ctx.level.spawns[0]!;
  const body = createBody(spawn.x, spawn.y, HITBOX);
  run(body, ctx, NEUTRAL_INPUT, 3);
  expect(body.grounded).toBe(true);
  return body;
}

function run(body: MovementBody, ctx: MovementContext, buttons: number, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepPlayerBody(body, buttons, ctx);
}

describe('stepPlayerBody: attacks', () => {
  it('starts a swing on the press edge only', () => {
    const ctx = makeCtx();
    const body = standing(ctx);
    stepPlayerBody(body, Button.ATTACK, ctx);
    expect(body.attackSeq).toBe(1);
    expect(body.attack).toBeCloseTo(COMBAT.attackDuration);
    // Holding the button through the cooldown does not start another swing.
    run(body, ctx, Button.ATTACK, msToTicks(COMBAT_COOLDOWN_MS) + 10);
    expect(body.attackSeq).toBe(1);
    expect(body.attack).toBe(0);
  });

  it('respects the cooldown, then accepts a new press', () => {
    const ctx = makeCtx();
    const body = standing(ctx);
    stepPlayerBody(body, Button.ATTACK, ctx);
    stepPlayerBody(body, NEUTRAL_INPUT, ctx);
    stepPlayerBody(body, Button.ATTACK, ctx); // too early
    expect(body.attackSeq).toBe(1);
    run(body, ctx, NEUTRAL_INPUT, msToTicks(COMBAT_COOLDOWN_MS));
    stepPlayerBody(body, Button.ATTACK, ctx);
    expect(body.attackSeq).toBe(2);
  });

  it('opens the hit window only inside the active part of the swing', () => {
    const ctx = makeCtx();
    const body = standing(ctx);
    stepPlayerBody(body, Button.ATTACK, ctx);
    const active: boolean[] = [isAttackActive(body, COMBAT)];
    for (let i = 0; i < msToTicks(COMBAT.attackDuration * 1000) + 2; i++) {
      stepPlayerBody(body, NEUTRAL_INPUT, ctx);
      active.push(isAttackActive(body, COMBAT));
    }
    const first = active.indexOf(true);
    const last = active.lastIndexOf(true);
    expect(first * TICK_DT).toBeCloseTo(COMBAT.activeFrom, 1);
    expect(last * TICK_DT).toBeCloseTo(COMBAT.activeTo, 1);
    expect(active.slice(first, last + 1).every(Boolean)).toBe(true);
  });

  it('locks facing while swinging but still moves', () => {
    const ctx = makeCtx();
    const body = standing(ctx);
    expect(body.facing).toBe(1);
    stepPlayerBody(body, Button.ATTACK, ctx);
    const x = body.x;
    run(body, ctx, Button.ATTACK | Button.LEFT, 5);
    expect(body.facing).toBe(1);
    expect(body.x).toBeLessThan(x);
    run(body, ctx, Button.LEFT, msToTicks(COMBAT.attackDuration * 1000));
    expect(body.facing).toBe(-1);
  });

  it('turns on the step a swing starts (Left + Attack together swings left)', () => {
    const ctx = makeCtx();
    const body = standing(ctx);
    expect(body.facing).toBe(1);
    stepPlayerBody(body, Button.ATTACK | Button.LEFT, ctx);
    expect(body.attackSeq).toBe(1);
    expect(body.facing).toBe(-1);
  });

  it('keeps the hit window longer than one catch-up burst, so it cannot be skipped', () => {
    const windowTicks = Math.floor((COMBAT.activeTo - COMBAT.activeFrom) / TICK_DT) + 1;
    expect(windowTicks).toBeGreaterThan(NET_CONFIG.input.maxPerTick);
  });

  it('reaches from the body centre to past the edge it faces', () => {
    const ctx = makeCtx();
    const body = standing(ctx);
    const half = HITBOX.width / 2;
    const right = attackReachBox(body, HITBOX, COMBAT);
    expect(right.x).toBe(body.x + half);
    expect(right.x + right.width).toBe(body.x + HITBOX.width + COMBAT.reach.width);
    expect(right.y + right.height).toBe(body.y + HITBOX.height - COMBAT.reach.offsetY);
    body.facing = -1;
    const left = attackReachBox(body, HITBOX, COMBAT);
    expect(left.x).toBe(body.x - COMBAT.reach.width);
    expect(left.x + left.width).toBe(body.x + half);
  });
});

describe('stepPlayerBody: hit stun', () => {
  it('ignores movement and attack input while stunned and lets knockback carry the body', () => {
    const ctx = makeCtx();
    const body = standing(ctx);
    body.hurt = COMBAT.stun;
    body.vx = 200;
    body.vy = -200;
    body.grounded = false;
    const x = body.x;
    stepPlayerBody(body, Button.LEFT | Button.ATTACK, ctx);
    expect(body.x).toBeGreaterThan(x);
    expect(body.facing).toBe(1);
    expect(body.attackSeq).toBe(0);
  });

  it('does not turn a jump held through the stun into a fresh press', () => {
    const ctx = makeCtx();
    const body = standing(ctx);
    body.hurt = 0.1;
    run(body, ctx, Button.JUMP, msToTicks(100) + 20);
    expect(body.hurt).toBe(0);
    expect(body.grounded).toBe(true);
    expect(body.vy).toBe(0);
  });

  it('recovers control when the stun ends', () => {
    const ctx = makeCtx();
    const body = standing(ctx);
    body.hurt = COMBAT.stun;
    run(body, ctx, NEUTRAL_INPUT, msToTicks(COMBAT.stun * 1000) + 1);
    const x = body.x;
    run(body, ctx, Button.RIGHT, 10);
    expect(body.x).toBeGreaterThan(x);
  });

  it('only records button edges while dead', () => {
    const ctx = makeCtx();
    const body = standing(ctx);
    body.alive = false;
    stepPlayerBody(body, Button.ATTACK | Button.JUMP, ctx);
    expect(body.attackHeld).toBe(true);
    expect(body.jumpHeld).toBe(true);
    expect(body.attackSeq).toBe(0);
  });
});

describe('stepPlayerBody: determinism', () => {
  it('replays a random input stream to the identical state', () => {
    const ctx = makeCtx();
    const random = mulberry32(99);
    const inputs = Array.from({ length: 600 }, () => {
      let b = 0;
      if (random() < 0.4) b |= Button.RIGHT;
      if (random() < 0.2) b |= Button.LEFT;
      if (random() < 0.2) b |= Button.JUMP;
      if (random() < 0.15) b |= Button.ATTACK;
      return b;
    });
    const a = standing(ctx);
    const start = cloneBody(a);
    const b = cloneBody(start);
    for (const input of inputs) stepPlayerBody(a, input, ctx);
    for (const input of inputs) stepPlayerBody(b, input, ctx);
    expect(b).toEqual(a);
    expect(a.attackSeq).toBeGreaterThan(3);
  });
});

const COMBAT_COOLDOWN_MS = COMBAT.attackCooldown * 1000;
