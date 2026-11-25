import { describe, expect, it } from 'vitest';
import { ABILITIES, Ability, abilityForCharacter, fullCooldown } from '../config/abilities';
import { CHARACTER_IDS } from '../config/characters';
import { resolveCombat, type CompiledCombat } from '../config/combat';
import { ENTITY_CONFIG, type EntityConfig } from '../config/entities';
import { FALL_DAMAGE, fallDamageFor } from '../config/fall';
import { resolveMovement } from '../config/movement';
import { modeWorldOptions, type GameMode } from '../config/modes';
import { msToTicks } from '../config/net';
import { PLAYER_CONFIG, respawnDelayMs } from '../config/players';
import { asciiToLevel } from '../dev/asciiMap';
import type { GameEvent } from './events';
import { Button } from './input';
import { GameWorld } from './world';

const HITBOX = PLAYER_CONFIG.hitbox;
const RESPAWN_TICKS = msToTicks(PLAYER_CONFIG.respawnDelaysMs[0]!);

function makeWorld(rows: string[], entities: Partial<EntityConfig> = {}, combat?: CompiledCombat): GameWorld {
  return new GameWorld({
    level: asciiToLevel({ rows }),
    movement: resolveMovement(),
    entities: { ...ENTITY_CONFIG, ...entities },
    combat,
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

describe('GameWorld: fruit recharges special abilities', () => {
  // Coin (10 pts) at (144, 80), gem (50 pts) at (240, 80).
  const COINS = ['            ', '            ', ' 1  o  g    ', '############'];
  const share = (points: number) => ABILITIES.fruitRecharge.perPoint * points;
  const recharges = (events: GameEvent[]) => events.flatMap((e) => (e.type === 'collect' ? [e.recharged] : []));

  it('maps every ability to its full cooldown', () => {
    expect(fullCooldown(Ability.HEAL)).toBe(ABILITIES.heal.cooldown);
    expect(fullCooldown(Ability.DRONE)).toBe(ABILITIES.drone.cooldown);
    expect(fullCooldown(Ability.GIANT)).toBe(ABILITIES.giant.cooldown);
    expect(fullCooldown(Ability.TONGUE)).toBe(ABILITIES.tongue.spitCooldown);
    expect(fullCooldown(Ability.NONE)).toBe(0);
  });

  it('takes a share of the full cooldown off, by the pickup value, for every ability', () => {
    for (const character of CHARACTER_IDS) {
      const world = makeWorld(COINS);
      const a = world.addPlayer('a', 0, character);
      const full = fullCooldown(abilityForCharacter(character));
      a.body.specialCooldown = full;
      const got = recharges(ticks(world, 60, { a: Button.RIGHT }));
      expect(got).toHaveLength(2);
      expect(got[0]).toBeCloseTo(share(10) * full, 3); // the coin: 10%
      expect(got[1]).toBeCloseTo(share(50) * full, 3); // the gem: half
      // About 1 s went by on its own, on top of the 60% the pickups took off.
      expect(a.body.specialCooldown).toBeCloseTo(full * (1 - share(60)) - 1, 1);
    }
  });

  it('never takes the cooldown below zero, and does nothing once the ability is ready', () => {
    const world = makeWorld(COINS);
    const a = world.addPlayer('a', 0, 'mask-dude');
    a.body.specialCooldown = 0.5;
    const got = recharges(ticks(world, 60, { a: Button.RIGHT }));
    // The coin finished it off; the gem found it ready.
    expect(got[0]).toBeGreaterThan(0);
    expect(got[0]).toBeLessThanOrEqual(0.5);
    expect(got[1]).toBe(0);
    expect(a.body.specialCooldown).toBe(0);
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

  it('waits longer after each death in the level: 5 s, 10 s, 20 s, then 30 s', () => {
    expect(PLAYER_CONFIG.respawnDelaysMs).toEqual([5000, 10000, 20000, 30000]);
    const world = makeWorld(HAZARDS);
    const player = world.addPlayer('a', 0);
    world.addPlayer('b', 1);
    for (const seconds of [5, 10, 20, 30, 30]) {
      world.killPlayer('a', 'dev');
      world.drainEvents();
      expect(world.toNetState(() => 0).players[0]!.respawnIn).toBe(msToTicks(seconds * 1000));
      expect(ticks(world, msToTicks(seconds * 1000) - 1)).toEqual([]);
      expect(player.body.alive).toBe(false);
      expect(tick(world)).toEqual([{ type: 'respawn', playerId: 'a' }]);
    }
    expect(player.deaths).toBe(5);
  });

  it('respawnDelayMs picks the delay for the nth death, capped when solo', () => {
    expect([1, 2, 3, 4, 5, 12].map((n) => respawnDelayMs(n))).toEqual([5000, 10000, 20000, 30000, 30000, 30000]);
    expect([1, 2, 3, 4].map((n) => respawnDelayMs(n, true))).toEqual([5000, 5000, 5000, 5000]);
  });

  it('never waits longer than 5 s when playing alone', () => {
    expect(PLAYER_CONFIG.soloMaxRespawnDelayMs).toBe(5000);
    const world = makeWorld(HAZARDS);
    const player = world.addPlayer('a', 0);
    for (let i = 0; i < 4; i++) {
      world.killPlayer('a', 'dev');
      world.drainEvents();
      expect(world.toNetState(() => 0).players[0]!.respawnIn).toBe(msToTicks(5000));
      ticks(world, msToTicks(5000));
      expect(player.body.alive).toBe(true);
    }
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

describe('GameWorld: fall damage', () => {
  // A tall empty shaft (32 px tiles) with the floor's top at y = 23 * 32.
  const SHAFT = [...Array.from({ length: 22 }, () => '      '), ' 1    ', '######'];
  const FLOOR = 23 * 32;
  const { safeDrop, step: pxPerHeart } = FALL_DAMAGE.players;

  /** Drops player `a` from `drop` px above the floor; returns the events until they land (or die). */
  function dropFrom(world: GameWorld, drop: number, buttons: (body: MovementBodyView) => number = () => 0): GameEvent[] {
    const player = world.getPlayer('a')!;
    ticks(world, 2); // settle on the floor first, like a real player
    place(world, 'a', 96, FLOOR - drop);
    const events: GameEvent[] = [];
    for (let i = 0; i < 400; i++) {
      events.push(...tick(world, { a: buttons(player.body) }));
      if (!player.body.alive || (player.body.grounded && player.body.y + HITBOX.height === FLOOR)) break;
    }
    return events;
  }
  type MovementBodyView = { y: number; vy: number };

  it('costs nothing within the safe drop', () => {
    const world = makeWorld(SHAFT);
    const player = world.addPlayer('a', 0);
    const events = dropFrom(world, safeDrop - 8);
    expect(events.filter((e) => e.type === 'fallHit')).toEqual([]);
    expect(player.hp).toBe(PLAYER_CONFIG.maxHp);
    expect(player.body.grounded).toBe(true);
  });

  it('costs a heart past the safe drop, with a short stun and a moment of invulnerability', () => {
    const world = makeWorld(SHAFT);
    const player = world.addPlayer('a', 0);
    const events = dropFrom(world, safeDrop + 32);
    expect(events).toMatchObject([{ type: 'fallHit', playerId: 'a', damage: 1, hp: PLAYER_CONFIG.maxHp - 1, x: 96, y: FLOOR }]);
    expect(player.hp).toBe(PLAYER_CONFIG.maxHp - 1);
    expect(player.body.alive).toBe(true);
    expect(player.body.hurt).toBeGreaterThan(0);
    expect(player.invulnUntil).toBeGreaterThan(world.tick);
    // Standing still afterwards costs nothing more.
    expect(ticks(world, 30).filter((e) => e.type === 'fallHit')).toEqual([]);
  });

  it('costs another heart for every further step and kills from high enough', () => {
    expect([0, safeDrop, safeDrop + 1, safeDrop + pxPerHeart, safeDrop + 2 * pxPerHeart].map((d) => fallDamageFor(d))).toEqual([0, 0, 1, 2, 3]);
    const world = makeWorld(SHAFT);
    const player = world.addPlayer('a', 0);
    world.addPlayer('b', 1); // someone else in the level, so the death isn't the end
    const events = dropFrom(world, safeDrop + 2 * pxPerHeart + 32);
    expect(events).toMatchObject([
      { type: 'fallHit', playerId: 'a', damage: 3, hp: 0 },
      { type: 'death', playerId: 'a', cause: 'fall' },
    ]);
    expect(player.body.alive).toBe(false);
  });

  it('a double jump near the ground breaks the fall', () => {
    const world = makeWorld(SHAFT);
    const player = world.addPlayer('a', 0);
    let jumped = false;
    const events = dropFrom(world, safeDrop + 96, (body) => {
      if (jumped || body.vy <= 0 || FLOOR - (body.y + HITBOX.height) > 64) return 0;
      jumped = true;
      return Button.JUMP;
    });
    expect(jumped).toBe(true);
    expect(events.filter((e) => e.type === 'fallHit')).toEqual([]);
    expect(player.hp).toBe(PLAYER_CONFIG.maxHp);
  });

  it('respawning does not count as a fall', () => {
    const world = makeWorld(SHAFT);
    const player = world.addPlayer('a', 0);
    ticks(world, 2);
    place(world, 'a', 96, FLOOR - safeDrop - 64);
    tick(world); // airborne, high up
    world.killPlayer('a');
    world.drainEvents();
    const events = ticks(world, RESPAWN_TICKS + 10);
    expect(events.filter((e) => e.type === 'fallHit')).toEqual([]);
    expect(player.hp).toBe(PLAYER_CONFIG.maxHp);
  });

  it('can be turned off', () => {
    const world = new GameWorld({ level: asciiToLevel({ rows: SHAFT }), movement: resolveMovement(), fallDamage: null });
    const player = world.addPlayer('a', 0);
    const events = dropFrom(world, safeDrop + 3 * pxPerHeart);
    expect(events.filter((e) => e.type === 'fallHit' || e.type === 'death')).toEqual([]);
    expect(player.hp).toBe(PLAYER_CONFIG.maxHp);
  });
});

describe('GameWorld: players stand on each other', () => {
  // 32 px tiles; the floor's top is at y = 7 * 32, with plenty of headroom.
  const ROOM = [...Array.from({ length: 6 }, () => '                    '), ' 1234               ', '####################'];
  const FLOOR = 7 * 32;
  const H = HITBOX.height;

  /**
   * Players `ids` settled on the floor apart (heads registered), then each dropped onto the one
   * before at x = 200. (Teleporting someone who stood under another would carry that one along.)
   */
  function stack(...ids: string[]): GameWorld {
    const world = makeWorld(ROOM);
    ids.forEach((id, slot) => world.addPlayer(id, slot));
    ids.forEach((id, i) => place(world, id, 200 + 100 * i, FLOOR));
    ticks(world, 3);
    ids.forEach((id, i) => {
      if (i === 0) return;
      place(world, id, 200, FLOOR - H * i - 24);
      world.getPlayer(id)!.body.grounded = false;
      for (let t = 0; t < 60 && !world.getPlayer(id)!.body.grounded; t++) tick(world);
    });
    return world;
  }

  const feet = (world: GameWorld, id: string) => world.getPlayer(id)!.body.y + H;
  const top = (world: GameWorld, id: string) => world.getPlayer(id)!.body.y;

  it('lands on another player\'s head and stands there', () => {
    const world = stack('a', 'b');
    const b = world.getPlayer('b')!.body;
    expect(b.grounded).toBe(true);
    expect(feet(world, 'b')).toBe(top(world, 'a'));
    expect(top(world, 'a')).toBe(FLOOR - H);
    ticks(world, 30);
    expect(feet(world, 'b')).toBe(top(world, 'a'));
  });

  it('is not carried along: the one underneath walks out from under them', () => {
    const world = stack('a', 'b');
    const a = world.getPlayer('a')!.body;
    const b = world.getPlayer('b')!.body;
    const x = b.x;
    const ax = a.x;
    tick(world, { a: Button.RIGHT });
    expect(a.x).toBeGreaterThan(ax);
    expect(b.x).toBe(x); // still standing there, on a's head
    expect(feet(world, 'b')).toBe(top(world, 'a'));
    ticks(world, 30, { a: Button.RIGHT });
    expect(a.x).toBeGreaterThan(x + HITBOX.width);
    expect(b.x).toBe(x); // a walked away, b dropped down where it stood
    expect(feet(world, 'b')).toBe(FLOOR);
    expect(world.getPlayer('b')!.hp).toBe(PLAYER_CONFIG.maxHp);
  });

  it('a jump pushes the one on top up, but does not pull them back down', () => {
    const world = stack('a', 'b');
    const a = world.getPlayer('a')!.body;
    const b = world.getPlayer('b')!.body;
    const x = b.x;
    let rising = true;
    let pushed = false;
    for (let i = 0; i < 90; i++) {
      const was = a.y;
      tick(world, { a: i < 15 ? Button.JUMP : 0 });
      expect(b.x).toBe(x);
      if (rising && a.y < was) {
        expect(feet(world, 'b')).toBeCloseTo(top(world, 'a'), 6); // never inside a
        pushed = pushed || top(world, 'a') < FLOOR - H - 60;
      } else rising = false;
    }
    expect(pushed).toBe(true); // a really jumped, lifting b
    expect(feet(world, 'b')).toBe(top(world, 'a')); // both fell back, b landed on a again
    expect(world.getPlayer('b')!.hp).toBe(PLAYER_CONFIG.maxHp);
  });

  it('is not pulled down when the one underneath drops through a plank', () => {
    // a stands on a one-way plank with b on top, then drops through it (down + jump).
    const PLANK = [...Array.from({ length: 5 }, () => '                    '), '    ------          ', '                    ', '####################'];
    const world = makeWorld(PLANK);
    world.addPlayer('a', 0);
    world.addPlayer('b', 1);
    place(world, 'a', 200, 5 * 32 - 4);
    place(world, 'b', 100, FLOOR);
    world.getPlayer('a')!.body.grounded = false;
    ticks(world, 20);
    const plank = feet(world, 'a');
    expect(plank).toBeLessThan(FLOOR);
    place(world, 'b', 200, plank - H - 24);
    world.getPlayer('b')!.body.grounded = false;
    ticks(world, 40);
    expect(feet(world, 'b')).toBe(top(world, 'a'));
    const b = world.getPlayer('b')!.body;
    const x = b.x;
    tick(world, { a: Button.DOWN | Button.JUMP });
    ticks(world, 8);
    expect(top(world, 'a')).toBeGreaterThan(plank - H + 16); // a is falling through the plank...
    expect(feet(world, 'b')).toBeLessThan(top(world, 'a') - 8); // ...and b is not stuck to a's head
    ticks(world, 60);
    expect(feet(world, 'a')).toBe(FLOOR);
    expect(feet(world, 'b')).toBe(plank); // b didn't drop, so the plank caught it
    expect(b.x).toBe(x);
  });

  it('heads are one-way: a player jumps up through another and lands on top', () => {
    const world = makeWorld(ROOM);
    world.addPlayer('a', 0);
    world.addPlayer('b', 1);
    place(world, 'a', 200, FLOOR);
    place(world, 'b', 200, FLOOR); // overlapping, both on the floor: neither is in the way
    ticks(world, 3);
    expect(feet(world, 'a')).toBe(FLOOR);
    expect(feet(world, 'b')).toBe(FLOOR);
    ticks(world, 15, { a: Button.JUMP });
    ticks(world, 60);
    expect(feet(world, 'a')).toBe(top(world, 'b'));
    expect(feet(world, 'b')).toBe(FLOOR);
  });

  it('down + jump drops off a head', () => {
    const world = stack('a', 'b');
    tick(world, { b: Button.DOWN | Button.JUMP });
    ticks(world, 60);
    expect(feet(world, 'b')).toBe(FLOOR);
  });

  it('stacks: a tower of three, pushed up all the way by a jump at the bottom', () => {
    const world = stack('a', 'b', 'c');
    expect(feet(world, 'b')).toBe(top(world, 'a'));
    expect(feet(world, 'c')).toBe(top(world, 'b'));
    const a = world.getPlayer('a')!.body;
    for (let i = 0; i < 6; i++) {
      tick(world, { a: Button.JUMP });
      expect(top(world, 'a')).toBeLessThan(FLOOR - H);
      expect(feet(world, 'b')).toBeCloseTo(top(world, 'a'), 6);
      expect(feet(world, 'c')).toBeCloseTo(top(world, 'b'), 6);
    }
    expect(a.vy).toBeLessThan(0);
  });

  it('a player who dies is no longer a platform', () => {
    const world = stack('a', 'b');
    world.killPlayer('a');
    world.drainEvents();
    ticks(world, 60);
    expect(feet(world, 'b')).toBe(FLOOR);
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

describe('GameWorld: co-op team wipe', () => {
  const FLAT = ['            ', '            ', ' 1          ', '############'];
  function coop(players: number, mode: GameMode = 'coop') {
    const world = new GameWorld({ level: asciiToLevel({ rows: FLAT }), movement: resolveMovement(), ...modeWorldOptions(mode, players) });
    for (let i = 0; i < players; i++) world.addPlayer(String.fromCharCode(97 + i), i);
    tick(world);
    return world;
  }
  const kill = (world: GameWorld, id: string) => {
    world.killPlayer(id, 'dev');
    return tick(world);
  };

  it('fails the level when everyone is down at once', () => {
    const world = coop(3);
    expect(kill(world, 'a')).not.toContainEqual({ type: 'teamWipe' });
    expect(kill(world, 'b')).not.toContainEqual({ type: 'teamWipe' });
    expect(world.failed).toBe(false);
    expect(kill(world, 'c')).toContainEqual({ type: 'teamWipe' });
    expect(world.failed).toBe(true);
    expect(world.completed).toBe(false);
    // Once only.
    expect(ticks(world, 5)).not.toContainEqual({ type: 'teamWipe' });
  });

  it('a teammate who respawned in time saves the level', () => {
    const world = coop(2);
    kill(world, 'a');
    ticks(world, RESPAWN_TICKS);
    expect(world.getPlayer('a')!.body.alive).toBe(true);
    kill(world, 'b');
    expect(world.failed).toBe(false);
  });

  it('never fails alone, with only reconnecting teammates left, or in a race', () => {
    const solo = coop(1);
    kill(solo, 'a');
    expect(solo.failed).toBe(false);

    const away = coop(2);
    away.setPresent('b', false);
    kill(away, 'a');
    expect(away.failed).toBe(false);

    const race = coop(2, 'race');
    kill(race, 'a');
    kill(race, 'b');
    expect(race.failed).toBe(false);
  });
});

describe('GameWorld: race', () => {
  // Spawns 1-3 at columns 1-3, exit zone at x 224..256 (column 7).
  const TRACK = ['          ', '          ', ' 123   E  ', '##########'];
  const enterExit = (world: GameWorld, id: string) => place(world, id, 7 * 32 + 16, 96);

  function race(finishWindowMs = 2000) {
    const world = new GameWorld({
      level: asciiToLevel({ rows: TRACK }),
      movement: resolveMovement(),
      race: { finishWindowMs },
    });
    const a = world.addPlayer('a', 0);
    const b = world.addPlayer('b', 1);
    const c = world.addPlayer('c', 2);
    ticks(world, 5);
    return { world, a, b, c };
  }

  it('gives places in arrival order and takes finishers out of play', () => {
    const { world, a, b } = race();
    expect(world.isRace).toBe(true);
    expect(world.raceEndsInTicks).toBeNull();

    enterExit(world, 'a');
    const first = tick(world);
    expect(first).toContainEqual(expect.objectContaining({ type: 'finish', playerId: 'a', place: 1 }));
    expect(first.some((e) => e.type === 'death')).toBe(false);
    expect(a.place).toBe(1);
    expect(a.body.alive).toBe(false);
    expect(world.completed).toBe(false);
    expect(world.raceEndsInTicks).toBe(msToTicks(2000) - 1);

    // Finished players never respawn (no respawn timer) and don't count as deaths.
    const later = ticks(world, msToTicks(1500));
    expect(later.some((e) => e.type === 'respawn')).toBe(false);
    expect(world.toNetState(() => 0).players[0]!.respawnIn).toBe(0);
    expect(a.body.alive).toBe(false);
    expect(a.deaths).toBe(0);

    enterExit(world, 'b');
    expect(tick(world)).toContainEqual(expect.objectContaining({ type: 'finish', playerId: 'b', place: 2 }));
    expect(b.place).toBe(2);
    expect(world.toNetState(() => 0).players.map((p) => p.place)).toEqual([1, 2, 0]);
    expect(world.completed).toBe(false); // c is still racing
  });

  it('completes as soon as every present player has finished', () => {
    const { world } = race();
    world.setPresent('c', false); // reconnecting players don't hold the race up
    enterExit(world, 'a');
    tick(world);
    enterExit(world, 'b');
    expect(tick(world)).toContainEqual({ type: 'levelComplete' });
    expect(world.raceEndsInTicks).toBeNull();
  });

  it('gives same-tick arrivals consecutive places in slot order', () => {
    const { world, a, b } = race();
    enterExit(world, 'b');
    enterExit(world, 'a');
    tick(world);
    expect([a.place, b.place]).toEqual([1, 2]);
  });

  it('ends the level when the finish window runs out', () => {
    const { world, b, c } = race(500);
    enterExit(world, 'a');
    tick(world);
    ticks(world, msToTicks(500) - 2);
    expect(world.completed).toBe(false);
    expect(tick(world)).toContainEqual({ type: 'levelComplete' });
    expect([b.place, c.place]).toEqual([0, 0]);
  });

  it('keeps dead racers in the race; a dead player in the exit does not finish', () => {
    const { world, b } = race();
    enterExit(world, 'b');
    world.killPlayer('b');
    tick(world);
    expect(b.place).toBe(0);
    ticks(world, RESPAWN_TICKS + 1);
    expect(b.body.alive).toBe(true);
  });

  it('finished players can no longer be hit', () => {
    const { world, a, b } = race();
    enterExit(world, 'a');
    tick(world);
    place(world, 'b', 7 * 32 + 16 - 20, 96);
    b.body.facing = 1;
    tick(world, { b: Button.ATTACK });
    ticks(world, 30);
    expect(a.body.hurt).toBe(0);
    expect(a.body.vx).toBe(0);
  });

  it('maps each mode to its world options', () => {
    const options = modeWorldOptions('race');
    expect(options.entities.checkpointScope).toBe('player');
    expect(options.race).not.toBeNull();
    expect(options.playerDamage).toBe(true);
    expect(modeWorldOptions('coop')).toMatchObject({ race: null, playerDamage: false, entities: { checkpointScope: 'team' } });
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

describe('GameWorld: combat', () => {
  // Spawn feet at x = 48 (slot 0) and x = 80 (slot 1): 32 px apart, inside one swing's reach.
  const NEAR = ['        ', '        ', ' 12     ', '########'];
  // Slot 1 at x = 176: out of reach.
  const FAR = ['        ', '        ', ' 1    2 ', '########'];
  const COMBAT = resolveCombat();
  const SWING_TICKS = msToTicks(COMBAT.attackDuration * 1000) + 2;

  function setup(rows = NEAR, combat?: CompiledCombat) {
    const world = makeWorld(rows, {}, combat);
    const a = world.addPlayer('a', 0);
    const b = world.addPlayer('b', 1);
    ticks(world, 5);
    return { world, a, b };
  }

  /** `a` presses attack once; returns the ticks (after the press) at which `b` got hit. */
  function swing(world: GameWorld, buttons: Record<string, number> = { a: Button.ATTACK }): number[] {
    const b = world.getPlayer('b')!.body;
    const hits: number[] = [];
    let prevHurt = b.hurt;
    for (let i = 0; i < SWING_TICKS; i++) {
      tick(world, i === 0 ? buttons : {});
      if (b.hurt > prevHurt) hits.push(i);
      prevHurt = b.hurt;
    }
    return hits;
  }

  it('hits a player in reach: stun, knockback away from the attacker, facing the hit', () => {
    const { world, a, b } = setup();
    const x = b.body.x;
    const hits = swing(world);
    expect(hits).toHaveLength(1);
    expect(hits[0]! * (1 / 60)).toBeGreaterThanOrEqual(COMBAT.activeFrom - 1 / 60);
    expect(b.body.x).toBeGreaterThan(x + 10);
    expect(b.body.facing).toBe(-1);
    expect(a.body.hurt).toBe(0);
  });

  it('sets stun and launch velocity on the hit tick', () => {
    const { world, b } = setup();
    tick(world, { a: Button.ATTACK });
    while (b.body.hurt === 0) tick(world);
    expect(b.body.hurt).toBeCloseTo(COMBAT.stun);
    expect(b.body.vx).toBe(COMBAT.knockbackX);
    expect(b.body.vy).toBe(-COMBAT.knockbackY);
    expect(b.body.grounded).toBe(false);
  });

  it('hits a player standing inside the attacker (players do not collide)', () => {
    const { world, a, b } = setup();
    place(world, 'b', a.body.x + HITBOX.width / 2 + 2, a.body.y + HITBOX.height);
    expect(swing(world)).toHaveLength(1);
    expect(b.body.vx).toBeGreaterThan(0);
  });

  it('misses when facing away, out of reach, or when the target is dead', () => {
    const away = setup();
    away.a.body.facing = -1;
    expect(swing(away.world)).toEqual([]);

    const far = setup(FAR);
    expect(swing(far.world)).toEqual([]);

    const dead = setup();
    dead.world.killPlayer('b');
    tick(dead.world);
    expect(swing(dead.world)).toEqual([]);
  });

  it('keeps swings cosmetic when playerHits is off', () => {
    const { world, a, b } = setup(NEAR, resolveCombat(undefined, { playerHits: false }));
    expect(swing(world)).toEqual([]);
    expect(a.body.attackSeq).toBe(1);
    expect(b.body.vx).toBe(0);
  });

  it('hits each target at most once per swing (even with no stun or immunity)', () => {
    const { world, b } = setup(NEAR, resolveCombat(undefined, { hurt: { stunMs: 0, immunityMs: 0 } }));
    let launches = 0;
    tick(world, { a: Button.ATTACK });
    for (let i = 0; i < SWING_TICKS; i++) {
      tick(world);
      if (b.body.vy === -COMBAT.knockbackY) launches += 1;
    }
    expect(launches).toBe(1);
  });

  it('trades simultaneous swings: both players are hit and both swings are cancelled', () => {
    const { world, a, b } = setup();
    b.body.facing = -1;
    tick(world, { a: Button.ATTACK, b: Button.ATTACK });
    expect(b.body.attack).toBeGreaterThan(0);
    while (b.body.hurt === 0) tick(world);
    expect(a.body.hurt).toBeCloseTo(COMBAT.stun);
    expect(a.body.attack).toBe(0);
    expect(b.body.attack).toBe(0);
    expect(a.body.vx).toBeLessThan(0);
    expect(b.body.vx).toBeGreaterThan(0);
  });

  it('cancels the target swing when only the attacker connects', () => {
    const { world, a, b } = setup();
    tick(world, { a: Button.ATTACK, b: Button.ATTACK }); // b faces right, away from a
    while (b.body.hurt === 0) tick(world);
    expect(b.body.attack).toBe(0);
    expect(a.body.hurt).toBe(0);
  });

  it('gives a hit player a short immunity after the stun (no stun-lock)', () => {
    const { world, b } = setup();
    const spawn = world.level.spawns[1]!;
    const immuneTicks = msToTicks((COMBAT.stun + COMBAT.immunity) * 1000);
    const hits: number[] = [];
    let prevHurt = 0;
    for (let i = 0; i < 150; i++) {
      place(world, 'b', spawn.x, spawn.y); // hold the target in reach
      tick(world, { a: i % 2 === 0 ? Button.ATTACK : 0 }); // mash attack
      if (b.body.hurt > prevHurt) hits.push(i);
      prevHurt = b.body.hurt;
    }
    expect(hits.length).toBeGreaterThan(2);
    for (let i = 1; i < hits.length; i++) expect(hits[i]! - hits[i - 1]!).toBeGreaterThanOrEqual(immuneTicks);
  });

  it('clears swing and stun timers on death and keeps them clear after respawn', () => {
    const { world, a } = setup();
    tick(world, { a: Button.ATTACK });
    a.body.hurt = 0.2;
    world.killPlayer('a');
    expect(a.body.attack).toBe(0);
    expect(a.body.attackCooldown).toBe(0);
    expect(a.body.hurt).toBe(0);
    ticks(world, RESPAWN_TICKS + 1);
    expect(a.body.alive).toBe(true);
    expect(a.body.attack).toBe(0);
    expect(a.body.attackSeq).toBe(1);
  });

  it('replicates combat state', () => {
    const { world } = setup();
    tick(world, { a: Button.ATTACK });
    const net = world.toNetState(() => 0).players[0]!;
    expect(net).toMatchObject({ attackSeq: 1, attackHeld: true, hurt: 0 });
    expect(net.attack).toBeGreaterThan(0);
  });
});
