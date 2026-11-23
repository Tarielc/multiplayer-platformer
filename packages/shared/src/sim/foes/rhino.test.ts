import { describe, expect, it } from 'vitest';
import { FOE_TUNING } from '../../config/foes';
import { resolveMovement } from '../../config/movement';
import { msToTicks } from '../../config/net';
import { PLAYER_CONFIG } from '../../config/players';
import { asciiToLevel } from '../../dev/asciiMap';
import type { TiledObject } from '../../level/tiled';
import type { GameEvent } from '../events';
import { Button } from '../input';
import { GameWorld } from '../world';
import type { Foe } from './FoeField';

const HITBOX = PLAYER_CONFIG.hitbox;
const R = FOE_TUNING.rhino;

/** 32 px debug tiles: a closed arena, floor top at y = 160, ceiling bottom at y = 32, walls at x < 32 and x >= 928. */
const ARENA = [
  '##############################',
  '#                            #',
  '#                            #',
  '#                            #',
  '#1E                          #',
  '##############################',
];

function rhinoAt(x: number, facing: 'left' | 'right' = 'left'): Omit<TiledObject, 'id'> {
  return {
    name: 'rhino',
    type: 'rhino',
    x,
    y: 160,
    width: 0,
    height: 0,
    point: true,
    properties: [{ name: 'facing', type: 'string', value: facing }],
  };
}

function arena(x = 700, facing: 'left' | 'right' = 'left'): GameWorld {
  const world = new GameWorld({ level: asciiToLevel({ rows: ARENA, objects: [rhinoAt(x, facing)] }), movement: resolveMovement() });
  world.addPlayer('a', 0);
  return world;
}

function tick(world: GameWorld, buttons = 0): GameEvent[] {
  for (const p of world.listPlayers()) world.stepPlayer(p.id, buttons);
  world.endTick();
  return world.drainEvents();
}

function ticks(world: GameWorld, count: number, buttons = 0): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < count; i++) out.push(...tick(world, buttons));
  return out;
}

const only = <T extends GameEvent['type']>(events: GameEvent[], type: T) => events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

/** Puts the player's feet at (x, 160), out of harm's way for `ms`. */
function place(world: GameWorld, x: number, safeMs = 0): void {
  const player = world.getPlayer('a')!;
  player.body.x = x - HITBOX.width / 2;
  player.body.y = 160 - HITBOX.height;
  player.body.vx = 0;
  player.body.vy = 0;
  if (safeMs > 0) player.invulnUntil = world.tick + msToTicks(safeMs);
}

function rhino(world: GameWorld): Foe {
  return world.foeField.foes[0]!;
}

/** Skips the roar: the rhino is fighting, standing at `x`. */
function awake(world: GameWorld, x: number): Foe {
  const foe = rhino(world);
  foe.phase = 1;
  foe.state = 'idle';
  foe.t = 0;
  foe.x = x;
  foe.target = 'a';
  return foe;
}

describe('the rhino boss', () => {
  it('sleeps until it sees a player, then roars before it fights', () => {
    const world = arena(700);
    place(world, 48);
    ticks(world, 30);
    expect(rhino(world).state).toBe('idle');
    expect(rhino(world).phase).toBe(0);
    place(world, 520);
    tick(world);
    expect(rhino(world).state).toBe('roar');
    ticks(world, msToTicks(R.roarMs) + 2);
    expect(rhino(world).phase).toBe(1);
    expect(['idle', 'walk', 'attack']).toContain(rhino(world).state);
  });

  it('is armoured: a swing is blocked unless it is dazed', () => {
    const world = arena();
    const foe = awake(world, 400);
    foe.facing = -1;
    foe.span = 10; // not about to charge or stomp
    place(world, 400 - R.width / 2 - 16, 2000);
    world.getPlayer('a')!.body.facing = 1;
    const events = ticks(world, 20, Button.ATTACK);
    const hurts = only(events, 'foeHurt');
    expect(hurts.length).toBeGreaterThan(0);
    expect(hurts.every((e) => e.blocked && e.hp === R.hp)).toBe(true);
    expect(foe.hp).toBe(R.hp);
  });

  it('charges into a wall: rocks fall from the ceiling, and it can be hurt while dazed', () => {
    const world = arena();
    const foe = awake(world, 700);
    foe.state = 'charge';
    foe.facing = 1;
    place(world, 300, 60_000);
    const states: string[] = [];
    for (let i = 0; i < 120 && rhino(world).state !== 'stunned'; i++) {
      tick(world);
      if (states.at(-1) !== foe.state) states.push(foe.state);
    }
    expect(states).toEqual(['charge', 'crash', 'stunned']);
    const rocks = world.foeField.shots.filter((s) => s.kind === 'rock');
    expect(rocks).toHaveLength(R.rocks);
    // One over the player, all hanging from the ceiling.
    expect(rocks.some((r) => Math.abs(r.x - 300) < 1)).toBe(true);
    expect(rocks.every((r) => r.y === 32 + FOE_TUNING.rock.height / 2 && r.vy === 0)).toBe(true);

    // Dazed: walk up and hit it.
    place(world, foe.x - R.width / 2 - 16, 60_000);
    world.getPlayer('a')!.body.facing = 1;
    const events = ticks(world, 20, Button.ATTACK);
    const hurts = only(events, 'foeHurt').filter((e) => !e.blocked);
    expect(hurts.length).toBeGreaterThan(0);
    expect(foe.hp).toBeLessThan(R.hp);
    // It stays dazed between hits for the rest of its daze.
    expect(['hurt', 'stunned']).toContain(foe.state);
  });

  it('a falling rock hurts the player under it', () => {
    const world = arena();
    const foe = awake(world, 700);
    foe.state = 'charge';
    foe.facing = 1;
    place(world, 300);
    let hit = false;
    for (let i = 0; i < msToTicks(R.crashMs + FOE_TUNING.rock.warnMs) + 60 && !hit; i++) {
      place(world, 300);
      const events = tick(world);
      // Not the rhino's horns: it is far away.
      if (only(events, 'foeHit').length > 0) hit = true;
    }
    expect(hit).toBe(true);
    expect(world.getPlayer('a')!.hp).toBeLessThan(PLAYER_CONFIG.maxHp);
  });

  it('stomps: a shockwave runs along the floor both ways, until the walls', () => {
    const world = arena();
    const foe = awake(world, 480);
    foe.state = 'stomp';
    place(world, 200, 60_000);
    ticks(world, msToTicks(R.stomp.impactAtMs) + 1);
    const waves = world.foeField.shots.filter((s) => s.kind === 'shockwave');
    expect(waves.map((w) => Math.sign(w.vx)).sort()).toEqual([-1, 1]);
    expect(waves.every((w) => w.y === 160 - FOE_TUNING.shockwave.height / 2)).toBe(true);
    // The arena is 900 px wide: they reach the walls and break there.
    ticks(world, msToTicks(3000));
    expect(world.foeField.shots.filter((s) => s.kind === 'shockwave')).toEqual([]);
  });

  it('a shockwave hurts a player standing on the floor', () => {
    const world = arena();
    const foe = awake(world, 480);
    foe.state = 'stomp';
    place(world, 250);
    let hit = false;
    for (let i = 0; i < msToTicks(2500) && !hit; i++) {
      place(world, 250);
      if (only(tick(world), 'foeHit').length > 0) hit = true;
    }
    expect(hit).toBe(true);
  });

  it('flies into a rage at half health', () => {
    const world = arena();
    const foe = awake(world, 600);
    foe.hp = Math.floor(R.hp / 2);
    place(world, 100, 60_000);
    tick(world);
    expect(foe.state).toBe('enrage');
    ticks(world, msToTicks(R.enrageMs) + 2);
    expect(foe.phase).toBe(2);
  });

  it("can't be caught by a tongue or a claw", () => {
    const world = arena();
    const foe = awake(world, 600);
    expect(world.foeField.catchable(foe)).toBe(true);
    expect(world.foeField.grabbable(foe)).toBe(false);
  });

  it('keeps the exit shut while it is alive', () => {
    const world = arena();
    // The player stands in the exit.
    place(world, 80);
    ticks(world, 5);
    expect(world.getPlayer('a')!.atExit).toBe(false);
    expect(world.completed).toBe(false);
    rhino(world).hp = 1;
    rhino(world).state = 'stunned';
    rhino(world).span = 5;
    world.foeField.hurt(rhino(world), 1, 1, 'a');
    expect(world.foeField.bossAlive).toBe(false);
    ticks(world, 2);
    expect(world.completed).toBe(true);
  });
});
