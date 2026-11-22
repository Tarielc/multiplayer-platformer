import { describe, expect, it } from 'vitest';
import { ENTITY_CONFIG, type EntityConfig } from '../config/entities';
import { resolveMovement } from '../config/movement';
import { msToTicks } from '../config/net';
import { PLAYER_CONFIG } from '../config/players';
import { asciiToLevel } from '../dev/asciiMap';
import type { GameEvent } from './events';
import { Button } from './input';
import { GameWorld } from './world';

const HITBOX = PLAYER_CONFIG.hitbox;
const RESPAWN_TICKS = msToTicks(PLAYER_CONFIG.respawnDelayMs);

function makeWorld(rows: string[], entities: Partial<EntityConfig> = {}): GameWorld {
  return new GameWorld({
    level: asciiToLevel({ rows }),
    movement: resolveMovement(),
    entities: { ...ENTITY_CONFIG, ...entities },
  });
}

/** One server tick: every player steps once (with the given buttons), then world rules run. */
function tick(world: GameWorld, buttons: Record<string, number> = {}): GameEvent[] {
  for (const player of world.listPlayers()) world.stepPlayer(player.id, buttons[player.id] ?? 0);
  world.endTick();
  return world.drainEvents();
}

function ticks(world: GameWorld, count: number, buttons: Record<string, number> = {}): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < count; i++) events.push(...tick(world, buttons));
  return events;
}

/** Teleports a player so their feet stand at (feetX, feetY). */
function place(world: GameWorld, id: string, feetX: number, feetY: number): void {
  const body = world.getPlayer(id)!.body;
  body.x = feetX - HITBOX.width / 2;
  body.y = feetY - HITBOX.height;
  body.vx = body.vy = 0;
}

describe('GameWorld: players', () => {
  it('spawns each slot at its spawn point, standing on the ground', () => {
    const world = makeWorld(['            ', ' 1 2 3 4    ', '############']);
    for (let slot = 0; slot < 4; slot++) world.addPlayer(`p${slot}`, slot);
    ticks(world, 10);
    for (const player of world.listPlayers()) {
      const spawn = world.level.spawns[player.slot]!;
      expect(player.body.x + HITBOX.width / 2).toBe(spawn.x);
      expect(player.body.y + HITBOX.height).toBe(spawn.y);
      expect(player.body.grounded).toBe(true);
    }
  });

  it('shares spawn points when a level has fewer spawns than players', () => {
    const world = makeWorld(['      ', ' 1    ', '######']);
    const a = world.addPlayer('a', 0);
    const d = world.addPlayer('d', 3);
    expect(d.body.x).toBe(a.body.x);
  });

  it('adding an existing player id is a no-op', () => {
    const world = makeWorld(['      ', ' 12   ', '######']);
    const first = world.addPlayer('a', 0);
    expect(world.addPlayer('a', 1)).toBe(first);
    expect(world.playerCount).toBe(1);
  });
});

describe('GameWorld: collectibles', () => {
  // Coin at (144, 80) and gem at (240, 80): both at body height for players on the floor.
  const COINS = ['            ', '            ', ' 12 o  g    ', '############'];

  it('awards score once per item and reports collect events', () => {
    const world = makeWorld(COINS);
    world.addPlayer('a', 0);
    world.addPlayer('b', 1);
    const events = ticks(world, 60, { a: Button.RIGHT });

    const collects = events.filter((e) => e.type === 'collect');
    expect(collects).toMatchObject([
      { playerId: 'a', kind: 'coin', value: ENTITY_CONFIG.collectibles.coin!.value },
      { playerId: 'a', kind: 'gem', value: ENTITY_CONFIG.collectibles.gem!.value },
    ]);
    const a = world.getPlayer('a')!;
    expect(a.score).toBe(60);
    expect(a.collected).toBe(2);
    for (const item of world.level.collectibles) expect(world.isCollected(item.id)).toBe(true);

    // A second player walking over the same spots gets nothing.
    expect(ticks(world, 90, { b: Button.RIGHT }).filter((e) => e.type === 'collect')).toEqual([]);
    expect(world.getPlayer('b')!.score).toBe(0);
    expect(world.toNetState(() => 0).collected).toEqual(world.level.collectibles.map((c) => c.id).sort((x, y) => x - y));
  });
});

describe('GameWorld: deaths and respawns', () => {
  // Spike tile at column 4, lava zone over columns 8-9, everything else is floor.
  const HAZARDS = ['              ', '              ', ' 1  ^   LL    ', '##############'];

  it('kills players touching hazard tiles', () => {
    const world = makeWorld(HAZARDS);
    world.addPlayer('a', 0);
    place(world, 'a', 4 * 32 + 16, 96);
    expect(tick(world)).toMatchObject([{ type: 'death', playerId: 'a', cause: 'hazard' }]);
    expect(world.getPlayer('a')!.body.alive).toBe(false);
  });

  it('kills players inside hazard zones', () => {
    const world = makeWorld(HAZARDS);
    world.addPlayer('a', 0);
    place(world, 'a', 9 * 32, 96);
    expect(tick(world)).toMatchObject([{ type: 'death', cause: 'hazard' }]);
  });

  it('kills players who fall out of the map', () => {
    const world = makeWorld(HAZARDS);
    world.addPlayer('a', 0);
    place(world, 'a', 200, world.level.heightPx + ENTITY_CONFIG.killPlaneMargin + 64);
    expect(tick(world)).toMatchObject([{ type: 'death', cause: 'fall' }]);
  });

  it('respawns after the respawn delay and bumps the teleport counter', () => {
    const world = makeWorld(HAZARDS);
    const player = world.addPlayer('a', 0);
    const spawn = world.level.spawns[0]!;
    world.killPlayer('a', 'dev');
    world.drainEvents();

    expect(ticks(world, RESPAWN_TICKS - 1)).toEqual([]);
    expect(player.body.alive).toBe(false);
    expect(tick(world)).toEqual([{ type: 'respawn', playerId: 'a' }]);
    expect(player.body.alive).toBe(true);
    expect(player.tp).toBe(1);
    expect(player.deaths).toBe(1);
    expect(player.body.x + HITBOX.width / 2).toBe(spawn.x);
    expect(player.body.y + HITBOX.height).toBe(spawn.y);
  });

  it('ignores input while dead', () => {
    const world = makeWorld(HAZARDS);
    const player = world.addPlayer('a', 0);
    world.killPlayer('a');
    const x = player.body.x;
    ticks(world, 10, { a: Button.RIGHT });
    expect(player.body.x).toBe(x);
  });
});

describe('GameWorld: checkpoints', () => {
  // Checkpoint zone at x 192..224 (column 6).
  const CHECKPOINT = ['          ', '          ', ' 12   C   ', '##########'];
  const respawnX = (slot: number) => 6 * 32 + 16 + (slot - 1.5) * 6;

  it('moves the whole team’s respawn point (team scope)', () => {
    const world = makeWorld(CHECKPOINT, { checkpointScope: 'team' });
    world.addPlayer('a', 0);
    const b = world.addPlayer('b', 1);
    const zone = world.level.checkpoints[0]!;

    const events = ticks(world, 60, { a: Button.RIGHT });
    expect(events.filter((e) => e.type === 'checkpoint')).toEqual([{ type: 'checkpoint', playerId: 'a', checkpointId: zone.id }]);

    world.killPlayer('b');
    ticks(world, RESPAWN_TICKS);
    expect(b.body.alive).toBe(true);
    expect(b.checkpointId).toBe(zone.id);
    expect(b.body.x + HITBOX.width / 2).toBeCloseTo(respawnX(1));

    // Drop-in players start at the team checkpoint too.
    const late = world.addPlayer('c', 2);
    expect(late.body.x + HITBOX.width / 2).toBeCloseTo(respawnX(2));
  });

  it('only moves the activating player’s respawn point (player scope)', () => {
    const world = makeWorld(CHECKPOINT, { checkpointScope: 'player' });
    const a = world.addPlayer('a', 0);
    const b = world.addPlayer('b', 1);
    ticks(world, 60, { a: Button.RIGHT });
    expect(a.checkpointId).not.toBeNull();
    expect(b.checkpointId).toBeNull();

    world.killPlayer('b');
    ticks(world, RESPAWN_TICKS);
    expect(b.body.x + HITBOX.width / 2).toBe(world.level.spawns[1]!.x);
  });
});

describe('GameWorld: exit rule', () => {
  // Exit zone at x 224..256 (column 7).
  const EXIT = ['          ', '          ', ' 12    E  ', '##########'];
  const enterExit = (world: GameWorld, id: string) => place(world, id, 7 * 32 + 16, 96);

  it('"all": completes only when every present player stands in the exit', () => {
    const world = makeWorld(EXIT, { exitRule: 'all' });
    world.addPlayer('a', 0);
    world.addPlayer('b', 1);
    enterExit(world, 'a');
    tick(world);
    expect(world.getPlayer('a')!.atExit).toBe(true);
    expect(world.completed).toBe(false);

    enterExit(world, 'b');
    expect(tick(world)).toContainEqual({ type: 'levelComplete' });
    expect(world.completed).toBe(true);
  });

  it('"all": disconnected (absent) players do not block completion', () => {
    const world = makeWorld(EXIT, { exitRule: 'all' });
    world.addPlayer('a', 0);
    world.addPlayer('b', 1);
    world.setPresent('b', false);
    enterExit(world, 'a');
    tick(world);
    expect(world.completed).toBe(true);
  });

  it('"any": the first player to arrive completes the level', () => {
    const world = makeWorld(EXIT, { exitRule: 'any' });
    world.addPlayer('a', 0);
    world.addPlayer('b', 1);
    enterExit(world, 'b');
    tick(world);
    expect(world.completed).toBe(true);
  });

  it('dead players in the exit do not count', () => {
    const world = makeWorld(EXIT, { exitRule: 'any' });
    world.addPlayer('a', 0);
    enterExit(world, 'a');
    world.killPlayer('a');
    tick(world);
    expect(world.completed).toBe(false);
  });

  it('emits levelComplete only once', () => {
    const world = makeWorld(EXIT);
    world.addPlayer('a', 0);
    world.complete();
    world.complete();
    expect(world.drainEvents()).toEqual([{ type: 'levelComplete' }]);
  });
});

describe('GameWorld: network state', () => {
  it('lists players by slot with their acknowledged input sequence', () => {
    const world = makeWorld(['      ', ' 12   ', '######']);
    world.addPlayer('second', 1);
    world.addPlayer('first', 0);
    tick(world);
    const state = world.toNetState((id) => (id === 'first' ? 7 : 3));
    expect(state.tick).toBe(1);
    expect(state.players.map((p) => [p.id, p.ack])).toEqual([
      ['first', 7],
      ['second', 3],
    ]);
    expect(state.players[0]).toMatchObject({ alive: true, grounded: true, tp: 0, score: 0, checkpointId: null });
  });
});
