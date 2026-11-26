import { describe, expect, it } from 'vitest';
import { ABILITIES, fullCooldown } from '../../config/abilities';
import { FOE_TUNING } from '../../config/foes';
import { resolveMovement } from '../../config/movement';
import { msToTicks } from '../../config/net';
import { modeWorldOptions } from '../../config/modes';
import { PLAYER_CONFIG } from '../../config/players';
import { asciiToLevel } from '../../dev/asciiMap';
import { levelChecksum } from '../../level/checksum';
import { LevelFormatError } from '../../level/errors';
import type { TiledObject, TiledProperty } from '../../level/tiled';
import { diffWorld } from '../../protocol/delta';
import type { GameEvent } from '../events';
import { Button } from '../input';
import { GameWorld } from '../world';

const HITBOX = PLAYER_CONFIG.hitbox;

/** 32 px debug tiles: spawn at (48, 160), floor top at y = 160, solid side walls. */
const FLOOR = [
  '#                            #',
  '#                            #',
  '#                            #',
  '#                            #',
  '#1                           #',
  '##############################',
];

type Props = Record<string, string | number>;

/** A foe object: a point at its feet (a wasp's: its middle). */
function foe(type: string, x: number, y: number, props: Props = {}): Omit<TiledObject, 'id'> {
  const properties = Object.entries(props).map(
    ([name, value]): TiledProperty => ({ name, type: typeof value === 'number' ? 'float' : 'string', value }),
  );
  return { name: type, type, x, y, width: 0, height: 0, point: true, ...(properties.length ? { properties } : {}) };
}

function worldWith(objects: Array<Omit<TiledObject, 'id'>>, rows: string[] = FLOOR, player = true): GameWorld {
  const world = new GameWorld({ level: asciiToLevel({ rows, objects }), movement: resolveMovement() });
  if (player) world.addPlayer('a', 0);
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

/** Puts the player's feet at (x, y). */
function place(world: GameWorld, x: number, y = 160): void {
  const body = world.getPlayer('a')!.body;
  body.x = x - HITBOX.width / 2;
  body.y = y - HITBOX.height;
  body.vx = 0;
  body.vy = 0;
}

describe('foe parsing', () => {
  it('reads foes by class, or class "foe" with a kind', () => {
    const level = asciiToLevel({
      rows: FLOOR,
      objects: [foe('mushroom', 300, 160), foe('foe', 400, 160, { kind: 'Chicken', facing: 'right', range: 20 }), foe('wasp', 500, 80)],
    });
    expect(level.foes.map((f) => [f.kind, f.x, f.y, f.facing, f.range])).toEqual([
      ['mushroom', 300, 160, -1, FOE_TUNING.mushroom.range],
      ['chicken', 400, 160, 1, 20],
      // A wasp's point is the middle of its body; its position is its feet.
      ['wasp', 500, 80 + FOE_TUNING.wasp.height / 2, -1, FOE_TUNING.wasp.range],
    ]);
    expect(level.extraObjects).toEqual([]);
  });

  it('rejects a "foe" without a valid kind', () => {
    expect(() => asciiToLevel({ rows: FLOOR, objects: [foe('foe', 300, 160, { kind: 'dragon' })] })).toThrow(LevelFormatError);
  });

  it('puts a monkey on the wall beside it, looking away from it', () => {
    const level = asciiToLevel({ rows: FLOOR, objects: [foe('monkey', 50, 100), foe('monkey', 935, 100), foe('monkey', 400, 160)] });
    const [left, right, ground] = level.foes;
    expect(left).toMatchObject({ wall: -1, facing: 1, x: 32 + FOE_TUNING.monkey.width / 2 });
    expect(right).toMatchObject({ wall: 1, facing: -1, x: 29 * 32 - FOE_TUNING.monkey.width / 2 });
    expect(ground).toMatchObject({ wall: 0 });
  });

  it('is part of the level checksum', () => {
    const a = asciiToLevel({ rows: FLOOR, objects: [foe('mushroom', 300, 160)] });
    const b = asciiToLevel({ rows: FLOOR, objects: [foe('mushroom', 310, 160)] });
    expect(levelChecksum(a)).not.toBe(levelChecksum(b));
  });
});

describe('foes', () => {
  it('sleep while nobody is near', () => {
    const world = worldWith([foe('mushroom', 300, 160)], FLOOR, false);
    const before = world.foeField.toNetFoes();
    ticks(world, 60);
    expect(world.foeField.toNetFoes()).toEqual(before);
  });

  it('a mushroom patrols its beat and turns at walls', () => {
    const world = worldWith([foe('mushroom', 100, 160, { range: 0 })]);
    place(world, 500);
    const xs: number[] = [];
    for (let i = 0; i < 600; i++) {
      tick(world);
      xs.push(world.foeField.foes[0]!.x);
    }
    // Walked left to the wall (x = 32 + half its width), turned, and came back.
    expect(Math.min(...xs) - (32 + FOE_TUNING.mushroom.width / 2)).toBeLessThan(3);
    expect(xs.at(-1)!).toBeGreaterThan(Math.min(...xs) + 20);
    expect(world.foeField.foes[0]!.y).toBe(160);
  });

  it('touching a mushroom costs a heart, knocks you back and makes you invulnerable', () => {
    const world = worldWith([foe('mushroom', 300, 160)]);
    place(world, 290);
    const events = ticks(world, 2);
    const hits = only(events, 'foeHit');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ playerId: 'a', hp: PLAYER_CONFIG.maxHp - 1 });
    const player = world.getPlayer('a')!;
    expect(player.body.vx).toBeLessThan(0);
    expect(player.invulnUntil).toBeGreaterThan(world.tick);
    // No second heart while invulnerable.
    expect(only(ticks(world, 20), 'foeHit')).toEqual([]);
  });

  it('a swing beats a mushroom (once per swing), scores, and it is removed after its death clip', () => {
    const world = worldWith([foe('mushroom', 300, 160)]);
    place(world, 300 - 24);
    world.getPlayer('a')!.body.facing = 1;
    world.getPlayer('a')!.invulnUntil = world.tick + 1000;
    const events = ticks(world, 30, Button.ATTACK);
    const hurts = only(events, 'foeHurt');
    expect(hurts).toHaveLength(1);
    expect(hurts[0]).toMatchObject({ playerId: 'a', kind: 'mushroom', hp: 0, stomp: false, score: FOE_TUNING.mushroom.score });
    expect(world.getPlayer('a')!.score).toBe(FOE_TUNING.mushroom.score);
    expect(world.foeField.foes[0]!.state).toBe('dead');
    ticks(world, msToTicks(FOE_TUNING.mushroom.deathMs));
    expect(world.foeField.foes).toEqual([]);
    expect(world.toNetState(() => 0).foes).toEqual([]);
  });

  /** A world with one foe and the player (who has a special ability) facing it, in reach. */
  function swingAt(type: string, cooldown: number): { world: GameWorld; full: number } {
    const world = worldWith([foe(type, 300, 160)], FLOOR, false);
    const player = world.addPlayer('a', 0, 'mask-dude');
    place(world, 300 - 24);
    player.body.facing = 1;
    player.invulnUntil = world.tick + 1000;
    const full = fullCooldown(player.body.ability);
    player.body.specialCooldown = cooldown < 0 ? full : cooldown;
    return { world, full };
  }

  it("beating a foe recharges the killer's special ability by its score", () => {
    const { world, full } = swingAt('mushroom', -1);
    expect(full).toBeGreaterThan(0);
    const hurts = only(ticks(world, 30, Button.ATTACK), 'foeHurt');
    const expected = ABILITIES.foeRecharge.perPoint * FOE_TUNING.mushroom.score * full;
    expect(hurts[0]).toMatchObject({ hp: 0 });
    expect(hurts[0]!.recharged).toBeCloseTo(expected, 3);
    // Half a second went by on its own, on top of the kill's share.
    expect(world.getPlayer('a')!.body.specialCooldown).toBeCloseTo(full - expected - 0.5, 1);
  });

  it('a hit that does not beat the foe recharges nothing', () => {
    const { world } = swingAt('chicken', -1);
    const hurts = only(ticks(world, 30, Button.ATTACK), 'foeHurt');
    expect(hurts[0]).toMatchObject({ hp: FOE_TUNING.chicken.hp - 1, recharged: 0 });
  });

  it('a kill with the ability ready recharges nothing', () => {
    const { world } = swingAt('mushroom', 0);
    const hurts = only(ticks(world, 30, Button.ATTACK), 'foeHurt');
    expect(hurts[0]).toMatchObject({ hp: 0, recharged: 0 });
    expect(world.getPlayer('a')!.body.specialCooldown).toBe(0);
  });

  it('landing on a mushroom stomps it and bounces you up, without losing a heart', () => {
    const world = worldWith([foe('mushroom', 300, 160)]);
    place(world, 300, 160 - FOE_TUNING.mushroom.height - 30);
    const events: GameEvent[] = [];
    let bounced = false;
    for (let i = 0; i < 40 && !bounced; i++) {
      events.push(...tick(world));
      bounced = only(events, 'foeHurt').length > 0;
    }
    expect(only(events, 'foeHurt')[0]).toMatchObject({ stomp: true, hp: 0 });
    expect(world.getPlayer('a')!.body.vy).toBeLessThan(0);
    events.push(...ticks(world, 30));
    expect(only(events, 'foeHit')).toEqual([]);
    expect(world.getPlayer('a')!.hp).toBe(PLAYER_CONFIG.maxHp);
  });

  it('landing on a wasp kills it and bounces you up, without losing a heart', () => {
    const world = worldWith([foe('wasp', 300, 80)]);
    const wasp = world.foeField.foes[0]!;
    // Just above it and falling.
    place(world, wasp.x, wasp.y - FOE_TUNING.wasp.height - 6);
    world.getPlayer('a')!.body.vy = 200;
    const events: GameEvent[] = [];
    for (let i = 0; i < 20 && only(events, 'foeHurt').length === 0; i++) events.push(...tick(world));
    expect(only(events, 'foeHurt')[0]).toMatchObject({ kind: 'wasp', stomp: true, hp: 0 });
    expect(world.foeField.foes[0]!.state).toBe('dead');
    expect(world.getPlayer('a')!.body.vy).toBeLessThan(0);
    expect(only(events, 'foeHit')).toEqual([]);
    expect(world.getPlayer('a')!.hp).toBe(PLAYER_CONFIG.maxHp);
  });

  it('a chicken spots you, chases you and pecks', () => {
    const world = worldWith([foe('chicken', 500, 160)]);
    place(world, 400);
    const states = new Set<string>();
    const events: GameEvent[] = [];
    for (let i = 0; i < 180; i++) {
      events.push(...tick(world));
      states.add(world.foeField.foes[0]!.state);
    }
    expect([...states]).toEqual(expect.arrayContaining(['alert', 'chase', 'attack']));
    expect(only(events, 'foeHit').length).toBeGreaterThan(0);
  });

  it('a wasp keeps its distance and stings you from afar', () => {
    const world = worldWith([foe('wasp', 600, 60)]);
    place(world, 450);
    const events: GameEvent[] = [];
    let shot = false;
    for (let i = 0; i < 240; i++) {
      events.push(...tick(world));
      if (world.foeField.shots.some((s) => s.kind === 'stinger')) shot = true;
    }
    expect(shot).toBe(true);
    expect(only(events, 'foeHit').length).toBeGreaterThan(0);
    const wasp = world.foeField.foes[0]!;
    const body = world.getPlayer('a')!.body;
    expect(Math.abs(wasp.x - (body.x + HITBOX.width / 2))).toBeGreaterThan(40);
  });

  it('a wall monkey throws bananas, and swipes when you come close', () => {
    const world = worldWith([foe('monkey', 935, 150)]);
    place(world, 760);
    const events: GameEvent[] = [];
    let banana = false;
    for (let i = 0; i < 200; i++) {
      events.push(...tick(world));
      if (world.foeField.shots.some((s) => s.kind === 'banana')) banana = true;
    }
    expect(banana).toBe(true);
    expect(world.foeField.foes[0]!.wall).toBe(1);

    const close = worldWith([foe('monkey', 935, 160)]);
    place(close, 935 - 28);
    const states = new Set<string>();
    for (let i = 0; i < 60; i++) {
      tick(close);
      states.add(close.foeField.foes[0]!.state);
    }
    expect(states.has('attack')).toBe(true);
  });

  it('a bull winds up, charges, and crashes into a wall', () => {
    const world = worldWith([foe('bull', 400, 160, { facing: 'left' })]);
    place(world, 250);
    const states: string[] = [];
    let hit = false;
    for (let i = 0; i < 240; i++) {
      const events = tick(world);
      if (only(events, 'foeHit').length > 0) hit = true;
      const state = world.foeField.foes[0]!.state;
      if (states.at(-1) !== state) states.push(state);
    }
    expect(states).toEqual(expect.arrayContaining(['windup', 'charge', 'crash', 'stunned']));
    expect(states.indexOf('windup')).toBeLessThan(states.indexOf('charge'));
    expect(hit).toBe(true);
  });

  it('a swing knocks a stinger out of the air', () => {
    const world = worldWith([foe('wasp', 300, 120)]);
    place(world, 250);
    const field = world.foeField;
    // Fire one straight at the player's face, then swing at it.
    const body = world.getPlayer('a')!.body;
    body.facing = 1;
    world.getPlayer('a')!.invulnUntil = 10_000;
    ticks(world, 1);
    field.shots.push({ id: 99, kind: 'stinger', x: body.x + HITBOX.width + 14, y: body.y + 14, vx: -20, vy: 0, hit: false, t: 0, owner: 0 });
    const events = ticks(world, 12, Button.ATTACK);
    expect(only(events, 'parry')).toHaveLength(1);
    expect(field.shots.find((s) => s.id === 99)?.hit ?? true).toBe(true);
  });

  it('clones independently and replicates through deltas', () => {
    const world = worldWith([foe('chicken', 500, 160)]);
    place(world, 400);
    ticks(world, 30);
    const copy = world.clone();
    ticks(copy, 30);
    expect(copy.foeField.foes[0]!.t).not.toBe(world.foeField.foes[0]!.t);
    const a = world.toNetState(() => 0);
    ticks(world, 3);
    const b = world.toNetState(() => 0);
    expect(diffWorld(a, b).foes).toEqual(b.foes);
    expect(diffWorld(b, b).foes).toBeUndefined();
  });

  it('can be switched off (the level solver)', () => {
    const level = asciiToLevel({ rows: FLOOR, objects: [foe('mushroom', 300, 160)] });
    const world = new GameWorld({ level, movement: resolveMovement(), foes: null });
    expect(world.toNetState(() => 0).foes).toEqual([]);
  });
});

describe('foes: co-op scaling', () => {
  it('spawns tougher foes for a bigger co-op team', () => {
    const level = asciiToLevel({ rows: FLOOR, objects: [foe('bull', 400, 160), foe('mushroom', 600, 160)] });
    const health = (players: number) => {
      const world = new GameWorld({ level, movement: resolveMovement(), ...modeWorldOptions('coop', players) });
      return Object.fromEntries(world.foeField.toNetFoes().map((f) => [f.kind, f.hp]));
    };
    expect(health(1)).toEqual({ bull: FOE_TUNING.bull.hp, mushroom: FOE_TUNING.mushroom.hp });
    const four = modeWorldOptions('coop', 4).foes;
    expect(health(4)).toEqual({ bull: four.bull.hp, mushroom: four.mushroom.hp });
    expect(four.bull.hp).toBeGreaterThan(FOE_TUNING.bull.hp);
  });
});
