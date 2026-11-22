import { describe, expect, it } from 'vitest';
import { resolveMovement } from '../../config/movement';
import { msToTicks } from '../../config/net';
import { PLAYER_CONFIG } from '../../config/players';
import { TRAP_CONFIG } from '../../config/traps';
import { asciiToLevel } from '../../dev/asciiMap';
import { levelChecksum } from '../../level/checksum';
import { LevelFormatError } from '../../level/errors';
import type { TiledObject, TiledProperty } from '../../level/tiled';
import type { LevelData } from '../../level/types';
import type { GameEvent } from '../events';
import { Button } from '../input';
import { GameWorld } from '../world';
import { fallingPlatformState, fanOn, rockHeadImpacts, rockHeadOffset, sawCenter } from './motion';
import { trapKindOf } from './parseTraps';
import { TrapField } from './TrapField';
import type { TrapOf } from './types';

const HITBOX = PLAYER_CONFIG.hitbox;
const RESPAWN_TICKS = msToTicks(PLAYER_CONFIG.respawnDelayMs);

/** 32 px debug tiles: open sky, spawn at (48, 160), floor top at y = 160. */
const FLOOR = ['                    ', '                    ', '                    ', '                    ', ' 1                  ', '####################'];

type Props = Record<string, string | number | boolean>;

/** A trap object in pixels. Without a size it is a point (the body's bottom-centre). */
function trap(type: string, x: number, y: number, width = 0, height = 0, props: Props = {}): Omit<TiledObject, 'id'> {
  const properties = Object.entries(props).map(
    ([name, value]): TiledProperty => ({
      name,
      type: typeof value === 'number' ? 'float' : typeof value === 'boolean' ? 'bool' : 'string',
      value,
    }),
  );
  return { name: type, type, x, y, width, height, ...(width === 0 && height === 0 ? { point: true } : {}), ...(properties.length ? { properties } : {}) };
}

function levelWith(objects: Array<Omit<TiledObject, 'id'>>, rows: string[] = FLOOR): LevelData {
  return asciiToLevel({ rows, objects });
}

function worldWith(objects: Array<Omit<TiledObject, 'id'>>, rows: string[] = FLOOR): GameWorld {
  const world = new GameWorld({ level: levelWith(objects, rows), movement: resolveMovement() });
  world.addPlayer('a', 0);
  return world;
}

function tick(world: GameWorld, buttons = 0): GameEvent[] {
  for (const player of world.listPlayers()) world.stepPlayer(player.id, buttons);
  world.endTick();
  return world.drainEvents();
}

function ticks(world: GameWorld, count: number, buttons = 0): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < count; i++) out.push(...tick(world, buttons));
  return out;
}

function place(world: GameWorld, feetX: number, feetY: number): void {
  const body = world.getPlayer('a')!.body;
  body.x = feetX - HITBOX.width / 2;
  body.y = feetY - HITBOX.height;
  body.vx = body.vy = 0;
  body.grounded = false;
}

const only = <K extends TrapOf<never>['kind'] | string>(level: LevelData, kind: K) => {
  const found = level.traps.filter((t) => t.kind === kind);
  expect(found).toHaveLength(1);
  return found[0]!;
};

describe('trap parsing', () => {
  it('recognizes trap classes loosely and keeps other objects as extra objects', () => {
    expect(['Rock-Head', 'falling_platform', 'spike head', 'BOX', 'spikes'].map(trapKindOf)).toEqual([
      'rockHead',
      'fallingPlatform',
      'spikeHead',
      'box',
      'spikes',
    ]);
    const level = levelWith([trap('box', 320, 160), trap('npc', 100, 100)]);
    expect(level.traps.map((t) => t.kind)).toEqual(['box']);
    expect(level.extraObjects.map((o) => o.kind)).toEqual(['npc']);
  });

  it('places fixed-size bodies by their bottom-centre point and reads properties', () => {
    const level = levelWith([trap('box', 320, 160, 0, 0, { variant: 3 }), trap('trampoline', 100, 160, 0, 0, { launch: 900 })]);
    const box = only(level, 'box');
    expect(box).toMatchObject({ x: 310, y: 140, width: 20, height: 20, variant: 3, maxHits: TRAP_CONFIG.box.hits[2] });
    expect(only(level, 'trampoline')).toMatchObject({ x: 88, y: 149, launch: 900 });
  });

  it('rejects objects that cannot work', () => {
    expect(() => levelWith([trap('box', 320, 160, 0, 0, { variant: 4 })])).toThrow(LevelFormatError);
    expect(() => levelWith([trap('spikes', 320, 160, 0, 0, { dir: 'sideways' })])).toThrow(/dir/);
    // A vertical rock-head in open sky has nothing to slam into above it.
    expect(() => levelWith([trap('rockHead', 320, 100, 0, 0, { axis: 'y' })])).toThrow(/ceiling/);
  });

  it('includes traps in the level checksum', () => {
    const a = levelChecksum(levelWith([trap('box', 320, 160)]));
    expect(levelChecksum(levelWith([trap('box', 320, 160)]))).toBe(a);
    expect(levelChecksum(levelWith([trap('box', 352, 160)]))).not.toBe(a);
    expect(levelChecksum(levelWith([]))).not.toBe(a);
  });
});

describe('trap motion', () => {
  it('ping-pongs saws along their track', () => {
    const saw = only(levelWith([trap('saw', 100, 40, 200, 20)]), 'saw') as TrapOf<'saw'>;
    expect(saw).toMatchObject({ ax: 100, ay: 50, bx: 300, by: 50 });
    const p = saw.periodTicks;
    expect(sawCenter(saw, 0)).toEqual({ x: 100, y: 50 });
    expect(sawCenter(saw, p / 2).x).toBeCloseTo(300);
    expect(sawCenter(saw, p).x).toBeCloseTo(100);
    expect(sawCenter(saw, p / 4).x).toBeCloseTo(200);
  });

  // Corridor 32..288 px wide (walls in columns 0 and 9), two tiles tall.
  const CORRIDOR = ['##########', '#        #', '#       1#', '##########'];

  it('slides rock-heads between the walls they hit, starting where they were placed', () => {
    const rock = only(levelWith([trap('rockHead', 80, 96)], CORRIDOR), 'rockHead') as TrapOf<'rockHead'>;
    expect(rock).toMatchObject({ axis: 'x', from: 32, to: 256, y: 64 });
    expect(Math.abs(rockHeadOffset(rock, 0) - 64)).toBeLessThan(2);
    const [first, second] = rockHeadImpacts(rock, 0, 400);
    expect(first!.side).toBe('right');
    expect(rockHeadOffset(rock, first!.tick)).toBe(256);
    expect(rockHeadOffset(rock, first!.tick - 1)).toBeLessThan(256);
    expect(second!.side).toBe('left');
    expect(rockHeadOffset(rock, second!.tick)).toBe(32);
  });

  it('runs the falling platform timeline from its trigger tick', () => {
    const level = levelWith([trap('fallingPlatform', 320, 100)]);
    const platform = only(level, 'fallingPlatform') as TrapOf<'fallingPlatform'>;
    const c = TRAP_CONFIG.fallingPlatform;
    const at = (tick: number) => fallingPlatformState(platform, 10, tick, TRAP_CONFIG);
    expect(fallingPlatformState(platform, null, 50, TRAP_CONFIG).phase).toBe('idle');
    expect(at(10).phase).toBe('shaking');
    expect(at(10 + c.delayTicks + 20)).toMatchObject({ phase: 'falling' });
    expect(at(10 + c.delayTicks + 20).dy).toBeGreaterThan(0);
    expect(at(10 + c.delayTicks + c.fallTicks).phase).toBe('gone');
    expect(at(10 + c.delayTicks + c.fallTicks + c.respawnTicks).phase).toBe('idle');
  });

  it('cycles fans on and off', () => {
    const fan = only(levelWith([trap('fan', 320, 160, 0, 0, { onMs: 1000, offMs: 500 })]), 'fan') as TrapOf<'fan'>;
    expect(fanOn(fan, 0)).toBe(true);
    expect(fanOn(fan, 59)).toBe(true);
    expect(fanOn(fan, 60)).toBe(false);
    expect(fanOn(fan, 90)).toBe(true);
    expect(fan.stream).toMatchObject({ x: 304, y: 152 - TRAP_CONFIG.fan.range, height: TRAP_CONFIG.fan.range });
  });
});

describe('traps: health and damage', () => {
  // Spike strip on the floor, 2 tiles of 32 px wide.
  const SPIKES = [trap('spikes', 200, 144, 64, 16)];

  it('costs one heart with knockback and invulnerability, and kills at zero', () => {
    const world = worldWith(SPIKES);
    const player = world.getPlayer('a')!;
    expect(player.hp).toBe(PLAYER_CONFIG.maxHp);

    place(world, 232, 160);
    expect(tick(world)).toMatchObject([{ type: 'trapHit', playerId: 'a', hp: 2, side: 'up' }]);
    expect(player.body.hurt).toBeGreaterThan(0);
    expect(player.body.vy).toBeLessThan(0);
    expect(player.invulnUntil).toBe(world.tick - 1 + TRAP_CONFIG.damage.invulnerabilityTicks);

    // Still on the spikes, but invulnerable: no more damage until it wears off.
    const quiet: GameEvent[] = [];
    while (world.tick < player.invulnUntil) {
      place(world, 232, 160);
      player.body.hurt = 0;
      quiet.push(...tick(world));
    }
    expect(quiet).toEqual([]);
    place(world, 232, 160);
    expect(tick(world)).toMatchObject([{ type: 'trapHit', hp: 1 }]);

    world.getPlayer('a')!.invulnUntil = 0;
    player.body.hurt = 0;
    place(world, 232, 160);
    expect(tick(world)).toMatchObject([
      { type: 'trapHit', hp: 0 },
      { type: 'death', cause: 'trap' },
    ]);
    ticks(world, RESPAWN_TICKS);
    expect(player.body.alive).toBe(true);
    expect(player.hp).toBe(PLAYER_CONFIG.maxHp);
  });

  it('leaves lava an instant kill, whatever the hearts', () => {
    const rows = [...FLOOR.slice(0, 5), '#####LLLL###########', '####################'];
    const world = worldWith(SPIKES, rows);
    const player = world.getPlayer('a')!;
    expect(player.hp).toBe(PLAYER_CONFIG.maxHp);
    place(world, 192, 192);
    expect(ticks(world, 30)).toMatchObject([{ type: 'death', playerId: 'a', cause: 'hazard' }]);
    expect(player.hp).toBe(0);
  });

  it('hurts on saws and spike-head contact', () => {
    const saw = worldWith([trap('saw', 320, 140)]);
    place(saw, 320, 160);
    expect(tick(saw)).toMatchObject([{ type: 'trapHit', trapId: saw.level.traps[0]!.id }]);

    // Spike-head body: x 299..341, y 118..160. Walk into its left side.
    const world = worldWith([trap('spikeHead', 320, 160)]);
    place(world, 260, 160);
    const events = ticks(world, 40, Button.RIGHT);
    expect(events.find((e) => e.type === 'trapHit')).toMatchObject({ side: 'left', hp: 2 });
    expect(world.getPlayer('a')!.body.x + HITBOX.width).toBeLessThanOrEqual(299);
  });

  it('replicates hearts and invulnerability to clients', () => {
    const world = worldWith(SPIKES);
    place(world, 232, 160);
    tick(world);
    const me = world.toNetState(() => 0).players[0]!;
    expect(me).toMatchObject({ hp: 2, invulnUntil: world.getPlayer('a')!.invulnUntil });
  });
});

describe('traps: bouncing and boxes', () => {
  it('launches players off trampolines', () => {
    const world = worldWith([trap('trampoline', 320, 160)]);
    place(world, 320, 100);
    const events = ticks(world, 30);
    expect(events).toContainEqual({ type: 'bounce', playerId: 'a', trapId: world.level.traps[0]!.id });
    expect(world.getPlayer('a')!.body.y + HITBOX.height).toBeLessThan(100);
  });

  it('breaks boxes by stomping, bouncing each time, after their number of hits', () => {
    const world = worldWith([trap('box', 320, 160, 0, 0, { variant: 3 })]);
    const id = world.level.traps[0]!.id;
    place(world, 320, 100);
    const hits = ticks(world, 240).filter((e) => e.type === 'boxHit');
    expect(hits).toEqual([
      { type: 'boxHit', playerId: 'a', boxId: id, hits: 1, broken: false },
      { type: 'boxHit', playerId: 'a', boxId: id, hits: 2, broken: false },
      { type: 'boxHit', playerId: 'a', boxId: id, hits: 3, broken: true },
    ]);
    // Broken: the player fell through to the floor.
    expect(world.getPlayer('a')!.body.y + HITBOX.height).toBe(160);
    expect(world.toNetState(() => 0).traps).toEqual([{ id, hits: 3 }]);
  });

  it('breaks boxes with an attack, once per swing', () => {
    const world = worldWith([trap('box', 320, 160, 0, 0, { variant: 2 })]);
    place(world, 296, 160);
    ticks(world, 5);
    const first = ticks(world, 20, Button.ATTACK).filter((e) => e.type === 'boxHit');
    expect(first).toMatchObject([{ hits: 1, broken: false }]);
    ticks(world, 30);
    const second = ticks(world, 20, Button.ATTACK).filter((e) => e.type === 'boxHit');
    expect(second).toMatchObject([{ hits: 2, broken: true }]);
  });
});

describe('traps: moving platforms', () => {
  it('falling platforms carry riders down, vanish, and come back', () => {
    const world = worldWith([trap('fallingPlatform', 320, 100)]);
    const field = world.trapField;
    const id = world.level.traps[0]!.id;
    place(world, 320, 90);
    tick(world);
    expect(field.triggerTick(id)).toBe(0);
    const body = world.getPlayer('a')!.body;
    ticks(world, TRAP_CONFIG.fallingPlatform.delayTicks + 10);
    const platform = field.colliderRect(id, world.tick - 1)!;
    expect(platform.y).toBeGreaterThan(90);
    expect(body.y + HITBOX.height).toBeCloseTo(platform.y, 5);
    expect(body.grounded).toBe(true);

    // Catch-up: a second input on the same server tick does not ride the platform again.
    world.stepPlayer('a', 0);
    const y = body.y;
    world.stepPlayer('a', 0);
    expect(body.y).toBeCloseTo(y, 5);
    world.endTick();

    ticks(world, TRAP_CONFIG.fallingPlatform.fallTicks + TRAP_CONFIG.fallingPlatform.respawnTicks);
    expect(body.y + HITBOX.height).toBe(160); // stopped on the floor
    expect(field.triggerTick(id)).toBeNull(); // cycle over, state forgotten
    expect(field.colliderRect(id, world.tick)).toMatchObject({ y: 90 });
  });

  // Walls on both sides, floor at y = 96.
  const ROOM = ['#            #', '#            #', '#            #', '##############'];

  it('rock-heads carry riders and crush players against walls', () => {
    // Rock-head resting on the floor at the left wall, moving right; rider on top.
    const world = worldWith([trap('rockHead', 48, 96, 0, 0, { waitMs: 0 })], ROOM);
    const body = world.getPlayer('a')!.body;
    place(world, 48, 64);
    tick(world);
    const rock = () => world.trapField.colliderRect(world.level.traps[0]!.id, world.tick - 1)!;
    ticks(world, 10);
    const offset = body.x - rock().x;
    expect(rock().x).toBeGreaterThan(32);
    ticks(world, 5);
    expect(body.x - rock().x).toBeCloseTo(offset, 5);
    expect(body.y + HITBOX.height).toBe(rock().y);

    const crush = worldWith([trap('rockHead', 48, 96, 0, 0, { waitMs: 0 })], ROOM);
    place(crush, 13 * 32 - 12, 96); // standing against the right wall
    const events = ticks(crush, 120);
    expect(events).toContainEqual(expect.objectContaining({ type: 'death', cause: 'crush' }));
  });

  it('fans lift players', () => {
    const world = worldWith([trap('fan', 320, 160)]);
    place(world, 320, 160);
    ticks(world, 30);
    expect(world.getPlayer('a')!.body.y + HITBOX.height).toBeLessThan(140);
  });
});

describe('traps: replication', () => {
  it('rebuilds identical trap colliders on a client from the net state', () => {
    const world = worldWith([trap('box', 320, 160), trap('fallingPlatform', 500, 100)]);
    place(world, 320, 100);
    ticks(world, 40);
    const state = world.toNetState(() => 0);
    expect(state.traps.length).toBeGreaterThan(0);
    const client = TrapField.forLevel(world.level);
    client.applyNet(state.traps);
    expect(client.colliders(world.tick)).toEqual(world.trapField.colliders(world.tick));
  });

  it('clones worlds independently', () => {
    const world = worldWith([trap('box', 320, 160)]);
    place(world, 320, 100);
    const copy = world.clone();
    ticks(copy, 60);
    expect(copy.trapField.isBroken(copy.level.traps[0]!.id)).toBe(true);
    expect(world.trapField.isBroken(world.level.traps[0]!.id)).toBe(false);
    expect(world.getPlayer('a')!.body.y).not.toBe(copy.getPlayer('a')!.body.y);
    expect(world.tick).toBe(0);
  });
});
