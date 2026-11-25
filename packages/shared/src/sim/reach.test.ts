import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../config/abilities';
import { resolveMovement } from '../config/movement';
import { msToTicks } from '../config/net';
import { PLAYER_CONFIG } from '../config/players';
import { asciiToLevel } from '../dev/asciiMap';
import type { TiledObject } from '../level/tiled';
import { Button, withAim } from './input';
import { GameWorld } from './world';

/**
 * Reach calibration: how high (and how far) players get with each move, measured in the real
 * simulation. The co-op puzzles in `scripts/generate-samples.ts` are sized from these numbers
 * (a shelf just out of one move's reach and inside another's), so a tuning change that moves
 * them fails here first. Heights are of the feet above the floor, in px; level tiles are 16 px.
 */

const HITBOX = PLAYER_CONFIG.hitbox;
const TILE = 16;
const COLS = 60;
/** 32 px tiles: 30 rows of open air over a floor whose top is at y = 960. */
const ROOM = [...Array.from({ length: 30 }, (_, i) => (i === 29 ? ' 1 2 3 4'.padEnd(COLS) : ' '.repeat(COLS))), '#'.repeat(COLS)];
const GROUND = 30 * 32;
const seconds = (s: number) => msToTicks(s * 1000);

function makeWorld(objects: Array<Omit<TiledObject, 'id'>> = []): GameWorld {
  return new GameWorld({ level: asciiToLevel({ rows: ROOM, objects }), movement: resolveMovement(), fallDamage: null });
}

function place(world: GameWorld, id: string, feetX: number, feetY = GROUND): void {
  const body = world.getPlayer(id)!.body;
  body.x = feetX - HITBOX.width / 2;
  body.y = feetY - HITBOX.height;
  body.vx = body.vy = 0;
}

const feet = (world: GameWorld, id: string) => {
  const b = world.getPlayer(id)!.body;
  return b.y + HITBOX.height;
};

/**
 * Drives each player with a tiny script: `jump` presses jump, holds it to the apex, then does
 * the air jump and holds it to its apex too. `wait` does nothing. Returns the lowest feet y
 * (highest point) each player reached while the script ran.
 */
type Plan = { jumpAt?: (world: GameWorld) => boolean; hold?: number; double?: boolean };

function run(world: GameWorld, plans: Record<string, Plan>, maxTicks = 240): Record<string, number> {
  const best: Record<string, number> = {};
  const stage: Record<string, number> = {};
  for (const id of Object.keys(plans)) {
    best[id] = feet(world, id);
    stage[id] = 0;
  }
  for (let t = 0; t < maxTicks; t++) {
    const buttons: Record<string, number> = {};
    for (const [id, plan] of Object.entries(plans)) {
      const b = world.getPlayer(id)!.body;
      const hold = plan.hold ?? 0;
      switch (stage[id]) {
        case 0: // waiting to take off
          if (plan.jumpAt ? plan.jumpAt(world) : true) {
            buttons[id] = Button.JUMP | hold;
            stage[id] = 1;
          } else buttons[id] = hold;
          break;
        case 1: // rising on the first jump
          if (b.vy >= 0 && t > 0) {
            buttons[id] = hold;
            stage[id] = plan.double === false ? 4 : 2;
          } else buttons[id] = Button.JUMP | hold;
          break;
        case 2: // air jump
          buttons[id] = Button.JUMP | hold;
          stage[id] = 3;
          break;
        case 3:
          buttons[id] = b.vy < 0 ? Button.JUMP | hold : hold;
          if (b.vy >= 0) stage[id] = 4;
          break;
        default:
          buttons[id] = hold;
      }
    }
    for (const p of world.listPlayers()) world.stepPlayer(p.id, buttons[p.id] ?? 0);
    world.endTick();
    world.drainEvents();
    for (const id of Object.keys(plans)) best[id] = Math.min(best[id]!, feet(world, id));
  }
  const out: Record<string, number> = {};
  for (const id of Object.keys(plans)) out[id] = GROUND - best[id]!;
  return out;
}

function settle(world: GameWorld, count = 20): void {
  for (let i = 0; i < count; i++) {
    for (const p of world.listPlayers()) world.stepPlayer(p.id, 0);
    world.endTick();
    world.drainEvents();
  }
}

/** b standing on a's head, a on the floor at x = 300. */
function stack(aCharacter?: 'mask-dude', giant = false): GameWorld {
  const world = makeWorld();
  world.addPlayer('a', 0, aCharacter);
  world.addPlayer('b', 1, 'bunny-man');
  settle(world, 5);
  place(world, 'a', 300);
  place(world, 'b', 600);
  settle(world, 5);
  if (giant) {
    world.stepPlayer('a', Button.SPECIAL);
    world.stepPlayer('b', 0);
    world.endTick();
    settle(world, seconds(ABILITIES.giant.grow) + 4);
  }
  const top = world.getPlayer('a')!.body.y;
  place(world, 'b', 300, top - 8);
  world.getPlayer('b')!.body.grounded = false;
  settle(world, 30);
  expect(feet(world, 'b')).toBeCloseTo(top, 3);
  return world;
}

const tiles = (px: number) => px / TILE;

describe('reach calibration (16 px tiles)', () => {
  it('a jump and the double jump: 12 tiles', () => {
    const world = makeWorld();
    world.addPlayer('a', 0);
    settle(world);
    const { a } = run(world, { a: {} });
    expect(tiles(a!)).toBeGreaterThan(11.8);
    expect(tiles(a!)).toBeLessThan(12.1);
  });

  it('a trampoline bounce and the double jump: about 20 tiles', () => {
    const world = makeWorld([{ name: 'trampoline 1', type: 'trampoline', x: 300, y: GROUND, width: 0, height: 0, point: true }]);
    world.addPlayer('a', 0);
    settle(world);
    place(world, 'a', 300, GROUND - 40);
    world.getPlayer('a')!.body.grounded = false;
    // Fall onto it, ride the launch to its apex, then the air jump.
    let peakA = 0;
    let stage = 0;
    for (let t = 0; t < 300; t++) {
      const b = world.getPlayer('a')!.body;
      let buttons = 0;
      if (stage === 0 && b.vy < -100) stage = 1; // launched
      if (stage === 1 && b.vy >= 0) {
        buttons = Button.JUMP;
        stage = 2;
      } else if (stage === 2) {
        buttons = b.vy < 0 ? Button.JUMP : 0;
        if (b.vy >= 0) stage = 3;
      }
      world.stepPlayer('a', buttons);
      world.endTick();
      world.drainEvents();
      peakA = Math.max(peakA, GROUND - feet(world, 'a'));
    }
    expect(tiles(peakA)).toBeGreaterThan(19.5);
    expect(tiles(peakA)).toBeLessThan(20.2);
  });

  it('jumping off a teammate: 12 + 1.75 tiles', () => {
    const world = stack();
    const { b } = run(world, { b: {} });
    expect(tiles(b!)).toBeGreaterThan(13.5);
    expect(tiles(b!)).toBeLessThan(13.8);
  });

  it('a rider jumping at the top of the carrier’s jump: under 21 tiles', () => {
    const world = stack();
    const a = world.getPlayer('a')!.body;
    const { b } = run(world, { a: { double: false }, b: { jumpAt: () => a.vy >= 0 && a.y < GROUND - HITBOX.height - 50 } });
    expect(tiles(b!)).toBeGreaterThan(19.5);
    expect(tiles(b!)).toBeLessThan(21);
  });

  it('jumping off giant Mask Dude’s springy head: about 30 tiles', () => {
    const world = stack('mask-dude', true);
    const { b } = run(world, { b: {} });
    expect(tiles(b!)).toBeGreaterThan(26);
    expect(tiles(b!)).toBeLessThan(31);
  });

  it('a frog spits a teammate straight up about 19 tiles', () => {
    const world = makeWorld();
    world.addPlayer('a', 0, 'ninja-frog');
    world.addPlayer('b', 1, 'bunny-man');
    settle(world, 5);
    place(world, 'a', 300);
    place(world, 'b', 390);
    settle(world, 5);
    world.stepPlayer('a', withAim(Button.SPECIAL, 0));
    world.stepPlayer('b', 0);
    world.endTick();
    settle(world, seconds(ABILITIES.tongue.gulp) + 40);
    expect(world.getPlayer('b')!.body.held).not.toBe(0);
    let peak = 0;
    world.stepPlayer('a', withAim(Button.SPECIAL, -Math.PI / 2));
    world.stepPlayer('b', 0);
    world.endTick();
    for (let t = 0; t < 120; t++) {
      settle(world, 1);
      peak = Math.max(peak, GROUND - feet(world, 'b'));
    }
    expect(tiles(peak)).toBeGreaterThan(17);
    expect(tiles(peak)).toBeLessThan(21);
  });

  it('a running jump with the double jump crosses about 16 tiles, and more off an 8-tile drop', () => {
    const across = (dropTiles: number): number => {
      const rows = [...ROOM];
      // A raised start ledge (32 px rows) for the drop version.
      const ledgeRows = (dropTiles * TILE) / 32;
      for (let r = 0; r < ledgeRows; r++) rows[29 - r] = '#'.repeat(10).padEnd(COLS);
      const world = new GameWorld({ level: asciiToLevel({ rows }), movement: resolveMovement(), fallDamage: null });
      world.addPlayer('a', 0);
      const top = GROUND - dropTiles * TILE;
      place(world, 'a', 40, top);
      settle(world, 5);
      const b = world.getPlayer('a')!.body;
      const edge = 10 * 32;
      let takeoff = 0;
      let stage = 0;
      for (let t = 0; t < 400; t++) {
        let buttons = Button.RIGHT;
        const cx = b.x + HITBOX.width / 2;
        if (stage === 0 && b.x + HITBOX.width >= edge - 1) {
          buttons |= Button.JUMP;
          takeoff = cx;
          stage = 1;
        } else if (stage === 1) {
          if (b.vy >= 0) stage = 2;
          else buttons |= Button.JUMP;
        } else if (stage === 2) {
          buttons |= Button.JUMP;
          stage = 3;
        } else if (stage === 3) {
          if (b.vy < 0) buttons |= Button.JUMP;
          else stage = 4;
        } else if (stage === 4 && b.grounded) {
          return tiles(cx - takeoff);
        }
        world.stepPlayer('a', buttons);
        world.endTick();
        world.drainEvents();
      }
      throw new Error('never landed');
    };
    const flat = across(0);
    const downhill = across(8);
    expect(flat).toBeGreaterThan(15);
    expect(flat).toBeLessThan(18.5);
    expect(downhill).toBeGreaterThan(flat + 1.5);
  });
});
