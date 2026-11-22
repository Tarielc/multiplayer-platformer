import { describe, expect, it } from 'vitest';
import { resolveCombat } from '../config/combat';
import { MOVEMENT_TUNING, compileMovement, resolveMovement, type MovementTuning } from '../config/movement';
import { TICK_DT } from '../config/net';
import { PLAYER_CONFIG } from '../config/players';
import { asciiToLevel } from '../dev/asciiMap';
import { mulberry32 } from '../util/math';
import { Button, NEUTRAL_INPUT } from './input';
import { cloneBody, createBody, stepPlayerMovement, type MovementBody, type MovementContext } from './movement';

const HITBOX = PLAYER_CONFIG.hitbox;

function makeCtx(rows: string[], tuning?: Partial<MovementTuning>): MovementContext {
  return {
    level: asciiToLevel({ rows }),
    movement: resolveMovement(MOVEMENT_TUNING, tuning),
    hitbox: HITBOX,
    combat: resolveCombat(),
    dt: TICK_DT,
  };
}

function spawnBody(ctx: MovementContext, slot = 0): MovementBody {
  const spawn = ctx.level.spawns.find((s) => s.slot === slot);
  if (!spawn) throw new Error(`no spawn for slot ${slot}`);
  return createBody(spawn.x, spawn.y, ctx.hitbox);
}

function run(body: MovementBody, ctx: MovementContext, buttons: number, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepPlayerMovement(body, buttons, ctx);
}

/** Spawned and standing on the ground. */
function grounded(ctx: MovementContext, slot = 0): MovementBody {
  const body = spawnBody(ctx, slot);
  run(body, ctx, NEUTRAL_INPUT, 3);
  expect(body.grounded).toBe(true);
  return body;
}

const feet = (body: MovementBody) => body.y + HITBOX.height;

// Floor top at y = 224 (row 7); spawn feet at (48, 224).
const FLAT = [
  '                    ',
  '                    ',
  '                    ',
  '                    ',
  '                    ',
  '                    ',
  ' 1                  ',
  '####################',
];

describe('compileMovement', () => {
  it('derives gravity and launch velocity from jump height and time to apex', () => {
    const m = compileMovement({ ...MOVEMENT_TUNING, jumpHeight: 100, timeToApex: 0.5 });
    expect(m.gravity).toBeCloseTo(800); // 2h / t²
    expect(m.jumpVelocity).toBeCloseTo(400); // 2h / t
    expect(m.fallGravity).toBeCloseTo(800 * MOVEMENT_TUNING.fallGravityMultiplier);
    expect(m.coyoteTime).toBeCloseTo(MOVEMENT_TUNING.coyoteTimeMs / 1000);
  });

  it('applies per-level overrides on top of the base tuning', () => {
    const m = resolveMovement(MOVEMENT_TUNING, { maxRunSpeed: 300 });
    expect(m.maxRunSpeed).toBe(300);
    expect(m.groundAcceleration).toBe(MOVEMENT_TUNING.groundAcceleration);
  });

  it('rejects non-positive jump values', () => {
    expect(() => compileMovement({ ...MOVEMENT_TUNING, timeToApex: 0 })).toThrow();
  });
});

describe('stepPlayerMovement: running', () => {
  it('accelerates to max run speed and decelerates back to rest', () => {
    const ctx = makeCtx(FLAT);
    const body = grounded(ctx);
    const { maxRunSpeed, groundAcceleration, groundDeceleration } = ctx.movement;

    let ticks = 0;
    while (body.vx < maxRunSpeed) {
      stepPlayerMovement(body, Button.RIGHT, ctx);
      ticks += 1;
      expect(ticks).toBeLessThan(60);
    }
    expect(ticks).toBeLessThanOrEqual(Math.ceil(maxRunSpeed / (groundAcceleration * TICK_DT)) + 1);
    expect(body.vx).toBe(maxRunSpeed);
    expect(body.facing).toBe(1);

    let stopTicks = 0;
    while (body.vx > 0) {
      stepPlayerMovement(body, NEUTRAL_INPUT, ctx);
      stopTicks += 1;
      expect(stopTicks).toBeLessThan(60);
    }
    expect(stopTicks).toBeLessThanOrEqual(Math.ceil(maxRunSpeed / (groundDeceleration * TICK_DT)) + 1);
    expect(body.grounded).toBe(true);
  });

  it('turns around faster than it coasts to a stop', () => {
    const ctx = makeCtx(FLAT);
    const ticksUntilStopped = (buttons: number) => {
      const body = grounded(ctx);
      run(body, ctx, Button.RIGHT, 30);
      let ticks = 0;
      while (body.vx > 0) {
        stepPlayerMovement(body, buttons, ctx);
        ticks += 1;
      }
      return ticks;
    };
    expect(ticksUntilStopped(Button.LEFT)).toBeLessThan(ticksUntilStopped(NEUTRAL_INPUT));
  });

  it('stops at walls even at extreme speeds (no tunnelling)', () => {
    const ctx = makeCtx(
      [
        '                    ',
        '                    ',
        '                    ',
        '                    ',
        '                    ',
        '          #         ',
        ' 1        #         ',
        '####################',
      ],
      { maxRunSpeed: 4000, groundAcceleration: 1e6 }, // ~67 px per tick, more than two tiles
    );
    const body = grounded(ctx);
    run(body, ctx, Button.RIGHT, 30);
    expect(body.x + HITBOX.width).toBe(10 * 32);
  });

  it('lands on a one-tile floor after a long, fast fall (no tunnelling)', () => {
    const rows = [' 1   ', ...Array.from({ length: 10 }, () => '     '), '#####'];
    const ctx = makeCtx(rows, { maxFallSpeed: 1900, fallGravityMultiplier: 4 });
    const body = spawnBody(ctx);
    run(body, ctx, NEUTRAL_INPUT, 120);
    expect(body.grounded).toBe(true);
    expect(feet(body)).toBe(11 * 32);
  });
});

describe('stepPlayerMovement: jumping', () => {
  /** Apex height reached when jump is held for `holdTicks` (Infinity = held throughout). */
  function apexHeight(ctx: MovementContext, holdTicks: number): { height: number; ticks: number } {
    const body = grounded(ctx);
    const startY = body.y;
    let minY = body.y;
    let ticks = 0;
    do {
      stepPlayerMovement(body, ticks < holdTicks ? Button.JUMP : NEUTRAL_INPUT, ctx);
      minY = Math.min(minY, body.y);
      ticks += 1;
    } while (body.vy < 0 && ticks < 240);
    return { height: startY - minY, ticks };
  }

  it('peaks at the configured jump height after the configured time', () => {
    const ctx = makeCtx(FLAT);
    const { height, ticks } = apexHeight(ctx, Infinity);
    expect(height).toBeCloseTo(MOVEMENT_TUNING.jumpHeight, 0);
    expect(ticks * TICK_DT).toBeCloseTo(MOVEMENT_TUNING.timeToApex, 1);
  });

  it('respects per-level jump tuning', () => {
    const ctx = makeCtx(FLAT, { jumpHeight: 80, timeToApex: 0.3 });
    expect(apexHeight(ctx, Infinity).height).toBeCloseTo(80, 0);
  });

  it('cuts the jump short when the button is released early (variable jump height)', () => {
    const ctx = makeCtx(FLAT);
    const full = apexHeight(ctx, Infinity).height;
    const tap = apexHeight(ctx, 3).height;
    expect(tap).toBeGreaterThan(0);
    expect(tap).toBeLessThan(full * 0.6);
  });

  it('does not re-jump while the button stays held after landing', () => {
    const ctx = makeCtx(FLAT);
    const body = grounded(ctx);
    run(body, ctx, Button.JUMP, 90); // one jump, then landed with jump still held
    expect(body.grounded).toBe(true);
    stepPlayerMovement(body, Button.JUMP, ctx);
    expect(body.grounded).toBe(true);
    expect(body.vy).toBe(0);
  });

  describe('coyote time', () => {
    // The floor ends at x = 160; to the right is a bottomless pit.
    const LEDGE = [
      '                    ',
      '                    ',
      '                    ',
      '                    ',
      '                    ',
      '                    ',
      ' 1                  ',
      '#####               ',
    ];

    function walkOffLedge(ctx: MovementContext): MovementBody {
      const body = grounded(ctx);
      let guard = 0;
      while (body.grounded) {
        stepPlayerMovement(body, Button.RIGHT, ctx);
        if (++guard > 120) throw new Error('never left the ledge');
      }
      return body;
    }

    it('still allows a jump shortly after walking off a ledge', () => {
      const ctx = makeCtx(LEDGE);
      const body = walkOffLedge(ctx);
      run(body, ctx, Button.RIGHT, 2); // ~33 ms in the air, inside the 100 ms window
      stepPlayerMovement(body, Button.RIGHT | Button.JUMP, ctx);
      expect(body.vy).toBeLessThan(0);
      expect(body.jumping).toBe(true);
    });

    it('refuses the jump once the window has passed', () => {
      const ctx = makeCtx(LEDGE);
      const body = walkOffLedge(ctx);
      run(body, ctx, Button.RIGHT, 10); // ~167 ms in the air
      stepPlayerMovement(body, Button.RIGHT | Button.JUMP, ctx);
      expect(body.vy).toBeGreaterThan(0);
      expect(body.jumping).toBe(false);
    });
  });

  describe('jump buffering', () => {
    // Spawned in the air, falling 192 px onto the floor.
    const DROP = [
      ' 1                  ',
      '                    ',
      '                    ',
      '                    ',
      '                    ',
      '                    ',
      '                    ',
      '####################',
    ];

    function landingTick(ctx: MovementContext): number {
      const body = spawnBody(ctx);
      for (let tick = 1; tick < 240; tick++) {
        stepPlayerMovement(body, NEUTRAL_INPUT, ctx);
        if (body.grounded) return tick;
      }
      throw new Error('never landed');
    }

    /** Presses (and holds) jump `early` ticks before landing; returns the body one tick after landing. */
    function pressBeforeLanding(ctx: MovementContext, early: number): MovementBody {
      const land = landingTick(ctx);
      const body = spawnBody(ctx);
      for (let tick = 1; tick <= land + 1; tick++) {
        stepPlayerMovement(body, tick >= land - early ? Button.JUMP : NEUTRAL_INPUT, ctx);
      }
      return body;
    }

    it('jumps on touchdown when pressed shortly before landing', () => {
      const body = pressBeforeLanding(makeCtx(DROP), 3); // 50 ms early, buffer is 120 ms
      expect(body.vy).toBeLessThan(0);
      expect(body.grounded).toBe(false);
    });

    it('ignores presses that came too early', () => {
      const body = pressBeforeLanding(makeCtx(DROP), 12); // 200 ms early
      expect(body.grounded).toBe(true);
      expect(body.vy).toBe(0);
    });
  });
});

describe('stepPlayerMovement: one-way platforms', () => {
  // Planks at row 4 (top y = 128) above the spawn; floor top at y = 224.
  const ONE_WAY = [
    '                    ',
    '                    ',
    '                    ',
    '                    ',
    '   ------           ',
    '                    ',
    '    1               ',
    '####################',
  ];

  function onPlatform(ctx: MovementContext): MovementBody {
    const body = grounded(ctx);
    let highestFeet = feet(body);
    for (let i = 0; i < 90; i++) {
      stepPlayerMovement(body, Button.JUMP, ctx);
      highestFeet = Math.min(highestFeet, feet(body));
    }
    expect(highestFeet).toBeLessThan(128); // passed up through the planks
    return body;
  }

  it('lets players jump up through them and land on top', () => {
    const ctx = makeCtx(ONE_WAY);
    const body = onPlatform(ctx);
    expect(body.grounded).toBe(true);
    expect(feet(body)).toBe(128);
  });

  it('holds players that only press down', () => {
    const ctx = makeCtx(ONE_WAY);
    const body = onPlatform(ctx);
    run(body, ctx, Button.DOWN, 30);
    expect(feet(body)).toBe(128);
  });

  it('drops players through on down + jump', () => {
    const ctx = makeCtx(ONE_WAY);
    const body = onPlatform(ctx);
    run(body, ctx, NEUTRAL_INPUT, 1); // release jump so the next press is a fresh edge
    stepPlayerMovement(body, Button.DOWN | Button.JUMP, ctx);
    run(body, ctx, NEUTRAL_INPUT, 60);
    expect(body.grounded).toBe(true);
    expect(feet(body)).toBe(224);
  });

  it('does not drop through solid ground', () => {
    const ctx = makeCtx(ONE_WAY);
    const body = grounded(ctx);
    stepPlayerMovement(body, Button.DOWN | Button.JUMP, ctx);
    expect(body.vy).toBeLessThan(0); // a normal jump instead
  });
});

describe('stepPlayerMovement: determinism', () => {
  const ctx = makeCtx([
    '                    ',
    '                    ',
    '        ----        ',
    '                    ',
    '   ---        ^     ',
    '                    ',
    ' 1    #        ##   ',
    '####################',
  ]);
  const random = mulberry32(1234);
  const inputs = Array.from({ length: 900 }, () => Math.floor(random() * 16));

  it('produces identical states for identical inputs', () => {
    const a = spawnBody(ctx);
    const b = spawnBody(ctx);
    for (const buttons of inputs) stepPlayerMovement(a, buttons, ctx);
    for (const buttons of inputs) stepPlayerMovement(b, buttons, ctx);
    expect(b).toEqual(a);
  });

  it('replays exactly from a mid-run copy (what client reconciliation relies on)', () => {
    const body = spawnBody(ctx);
    for (const buttons of inputs.slice(0, 450)) stepPlayerMovement(body, buttons, ctx);
    const replay = cloneBody(body);
    for (const buttons of inputs.slice(450)) stepPlayerMovement(body, buttons, ctx);
    for (const buttons of inputs.slice(450)) stepPlayerMovement(replay, buttons, ctx);
    expect(replay).toEqual(body);
  });

  it('leaves dead bodies in place but keeps tracking the jump button', () => {
    const body = grounded(ctx);
    body.alive = false;
    const before = cloneBody(body);
    stepPlayerMovement(body, Button.RIGHT | Button.JUMP, ctx);
    expect(body).toEqual({ ...before, jumpHeld: true });
  });
});
