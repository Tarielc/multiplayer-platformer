import { describe, expect, it } from 'vitest';
import { resolveMovement } from '../../config/movement';
import { PLAYER_CONFIG } from '../../config/players';
import { asciiToLevel } from '../../dev/asciiMap';
import { LevelFormatError } from '../../level/errors';
import type { TiledObject, TiledProperty } from '../../level/tiled';
import type { LevelData } from '../../level/types';
import type { GameEvent } from '../events';
import { Button } from '../input';
import { GameWorld } from '../world';
import { fanOn, sawCenter } from './motion';
import { TrapField } from './TrapField';
import type { TrapDef, TrapOf } from './types';

const HITBOX = PLAYER_CONFIG.hitbox;

/** 32 px debug tiles: open sky, spawn at (48, 160), floor top at y = 160. */
const FLOOR = ['                    ', '                    ', '                    ', '                    ', ' 1                  ', '####################'];

type Props = Record<string, string | number | boolean>;

/** A trap object in pixels; a point without a size. `ref` props become Tiled object references. */
function obj(type: string, x: number, y: number, opts: { name?: string; width?: number; height?: number; props?: Props; refs?: Record<string, number> } = {}): Omit<TiledObject, 'id'> {
  const { width = 0, height = 0 } = opts;
  const properties: TiledProperty[] = [
    ...Object.entries(opts.props ?? {}).map(
      ([name, value]): TiledProperty => ({ name, type: typeof value === 'number' ? 'float' : typeof value === 'boolean' ? 'bool' : 'string', value }),
    ),
    ...Object.entries(opts.refs ?? {}).map(([name, value]): TiledProperty => ({ name, type: 'object', value })),
  ];
  return {
    name: opts.name ?? type,
    type,
    x,
    y,
    width,
    height,
    ...(width === 0 && height === 0 ? { point: true } : {}),
    ...(properties.length ? { properties } : {}),
  };
}

const levelWith = (objects: Array<Omit<TiledObject, 'id'>>): LevelData => asciiToLevel({ rows: FLOOR, objects });

function worldWith(objects: Array<Omit<TiledObject, 'id'>>): GameWorld {
  const world = new GameWorld({ level: levelWith(objects), movement: resolveMovement() });
  world.addPlayer('a', 0);
  return world;
}

function ticks(world: GameWorld, count: number, buttons = 0): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < count; i++) {
    for (const player of world.listPlayers()) world.stepPlayer(player.id, buttons);
    world.endTick();
    out.push(...world.drainEvents());
  }
  return out;
}

function place(world: GameWorld, feetX: number, feetY: number): void {
  const body = world.getPlayer('a')!.body;
  body.x = feetX - HITBOX.width / 2;
  body.y = feetY - HITBOX.height;
  body.vx = body.vy = 0;
  body.grounded = false;
}

function find<K extends TrapDef['kind']>(level: LevelData, kind: K): TrapOf<K> {
  const found = level.traps.find((t) => t.kind === kind);
  expect(found).toBeDefined();
  return found as TrapOf<K>;
}

describe('buttons: parsing', () => {
  it('sits on the floor and links to traps by name, id or object reference', () => {
    const level = levelWith([
      obj('trampoline', 320, 160, { name: 'trampoline1' }),
      obj('fan', 400, 160, { name: 'blower' }),
      obj('fan', 450, 160, { name: 'blower' }),
      obj('saw', 500, 100),
      obj('button', 200, 160, { props: { target: 'trampoline1, blower' } }),
      obj('Pressure Plate', 100, 160, { refs: { target: 5 } }), // the saw (the spawn is id 1)
    ]);
    const buttons = level.traps.filter((t): t is TrapOf<'button'> => t.kind === 'button');
    const ids = (name: string) => level.traps.filter((t) => t.name === name).map((t) => t.id);
    expect(buttons[0]).toMatchObject({ x: 193, y: 157, width: 14, height: 3, targets: [...ids('trampoline1'), ...ids('blower')] });
    expect(buttons[1]!.targets).toEqual([find(level, 'saw').id]);
  });

  it('reads what pressing does: switch on (default) or off', () => {
    const level = levelWith([
      obj('trampoline', 320, 160, { name: 't1' }),
      obj('button', 200, 160, { props: { target: 't1' } }),
      obj('button', 100, 160, { props: { target: 't1', action: 'off' } }),
    ]);
    expect(level.traps.filter((t) => t.kind === 'button').map((t) => (t as TrapOf<'button'>).action)).toEqual(['on', 'off']);
    expect(() => levelWith([obj('trampoline', 320, 160, { name: 't1' }), obj('button', 200, 160, { props: { target: 't1', action: 'toggle' } })])).toThrow(
      /"action" must be one of on, off/,
    );
  });

  it('rejects buttons that cannot work', () => {
    expect(() => levelWith([obj('button', 200, 160)])).toThrow(/no "target"/);
    expect(() => levelWith([obj('button', 200, 160, { props: { target: 'nothing' } })])).toThrow(LevelFormatError);
    expect(() => levelWith([obj('box', 320, 160, { name: 'crate' }), obj('button', 200, 160, { props: { target: 'crate' } })])).toThrow(/can't switch box/);
  });
});

describe('buttons: pressing', () => {
  it('is pressed while a player stands on it, and switches its trampoline on', () => {
    const world = worldWith([obj('trampoline', 500, 160, { name: 't1' }), obj('button', 320, 160, { props: { target: 't1' } })]);
    const field = world.trapField;
    const button = find(world.level, 'button');
    const tramp = find(world.level, 'trampoline');
    expect(field.isActive(tramp.id)).toBe(false);

    place(world, 320, 160);
    ticks(world, 2);
    expect(field.isPressed(button.id)).toBe(true);
    expect(field.isActive(tramp.id)).toBe(true);
    expect(world.toNetState(() => 0).traps).toEqual([{ id: button.id, pressed: true }]);

    place(world, 160, 160);
    ticks(world, 2);
    expect(field.isPressed(button.id)).toBe(false);
    expect(field.isActive(tramp.id)).toBe(false);
  });

  it('is jumped up through from below, like a one-way platform', () => {
    // A plank (cols 9-10, top y = 96) with a button on it, right above the player.
    const rows = [...FLOOR];
    rows[3] = '         --         ';
    const level = asciiToLevel({ rows, objects: [obj('trampoline', 500, 160, { name: 't1' }), obj('button', 320, 96, { props: { target: 't1' } })] });
    const world = new GameWorld({ level, movement: resolveMovement() });
    world.addPlayer('a', 0);
    const button = find(level, 'button');
    const body = world.getPlayer('a')!.body;
    place(world, 320, 160);
    ticks(world, 2);
    let highest = Infinity;
    for (let i = 0; i < 30; i++) {
      ticks(world, 1, Button.JUMP);
      highest = Math.min(highest, body.y + HITBOX.height);
    }
    expect(highest).toBeLessThan(button.y); // feet rose above the cap: no head bump
    ticks(world, 60);
    expect(body.grounded).toBe(true);
    expect(body.y + HITBOX.height).toBe(button.y); // landed on top
    expect(world.trapField.isPressed(button.id)).toBe(true);
  });

  it('is walked up onto, and things on it stand on its cap', () => {
    const world = worldWith([obj('trampoline', 500, 160, { name: 't1' }), obj('button', 320, 160, { props: { target: 't1' } })]);
    const button = find(world.level, 'button');
    const body = world.getPlayer('a')!.body;
    place(world, 290, 160);
    ticks(world, 2);
    const feet = () => body.y + HITBOX.height;
    expect(feet()).toBe(160);
    // Walk right: no jump needed, the cap lifts the player.
    let stoodOn = false;
    for (let i = 0; i < 60 && body.x + HITBOX.width / 2 < 340; i++) {
      ticks(world, 1, Button.RIGHT);
      if (feet() === button.y && body.grounded) stoodOn = true;
    }
    expect(stoodOn).toBe(true);
    expect(body.x + HITBOX.width / 2).toBeGreaterThanOrEqual(340);
    // Standing still on it.
    place(world, 320, 140);
    ticks(world, 30);
    expect(feet()).toBe(button.y);
    expect(body.grounded).toBe(true);
    expect(world.trapField.isPressed(button.id)).toBe(true);
    // And off the other side, back down to the floor without falling.
    for (let i = 0; i < 20; i++) {
      ticks(world, 1, Button.RIGHT);
      expect(body.grounded).toBe(true);
    }
    ticks(world, 10);
    expect(feet()).toBe(160);
    expect(world.trapField.isPressed(button.id)).toBe(false);
  });

  it('only counts players standing on it, not jumping through', () => {
    const world = worldWith([obj('trampoline', 500, 160, { name: 't1' }), obj('button', 320, 160, { props: { target: 't1' } })]);
    place(world, 320, 158); // feet in the plate, in the air
    world.getPlayer('a')!.body.vy = -400;
    ticks(world, 1);
    expect(world.trapField.isPressed(find(world.level, 'button').id)).toBe(false);
  });

  it('switched off, a trampoline is just a ledge; a box on the button switches it on', () => {
    const off = worldWith([obj('trampoline', 320, 160, { name: 't1' }), obj('button', 560, 160, { props: { target: 't1' } })]);
    place(off, 320, 100);
    const events = ticks(off, 40);
    expect(events.filter((e) => e.type === 'bounce')).toEqual([]);
    const body = off.getPlayer('a')!.body;
    expect(body.grounded).toBe(true);
    expect(body.y + HITBOX.height).toBe(find(off.level, 'trampoline').y);

    // A box resting on the cap holds it down, as does one placed over it.
    for (const boxY of [157, 160]) {
      const on = worldWith([obj('trampoline', 320, 160, { name: 't1' }), obj('button', 560, 160, { props: { target: 't1' } }), obj('box', 560, boxY)]);
      place(on, 320, 100);
      expect(ticks(on, 40)).toContainEqual(expect.objectContaining({ type: 'bounce' }));
    }
  });

  it('switches spikes, fans and falling platforms off', () => {
    const world = worldWith([
      obj('spikes', 320, 160, { name: 'x' }),
      obj('fan', 400, 160, { name: 'x', props: { offMs: 0 } }),
      obj('fallingPlatform', 200, 100, { name: 'x' }),
      obj('button', 560, 160, { props: { target: 'x' } }),
    ]);
    const field = world.trapField;
    expect(field.hazards(10)).toEqual([]);
    expect(field.fanOn(find(world.level, 'fan'), 10)).toBe(false);
    expect(field.trigger(find(world.level, 'fallingPlatform').id, 10)).toBe(false);
    place(world, 560, 160);
    ticks(world, 2);
    expect(field.hazards(world.tick)).toHaveLength(1);
    expect(field.fanOn(find(world.level, 'fan'), world.tick)).toBe(true);
  });
});

describe('buttons: switching off', () => {
  it('an off button lets its traps work until it is pressed', () => {
    const world = worldWith([obj('trampoline', 500, 160, { name: 't1' }), obj('button', 320, 160, { props: { target: 't1', action: 'off' } })]);
    const field = world.trapField;
    const tramp = find(world.level, 'trampoline');
    expect(field.isActive(tramp.id)).toBe(true);
    place(world, 320, 160);
    ticks(world, 2);
    expect(field.isActive(tramp.id)).toBe(false);
    place(world, 160, 160);
    ticks(world, 2);
    expect(field.isActive(tramp.id)).toBe(true);
  });

  it('needs an on button pressed and no off button pressed when both link to a trap', () => {
    const level = levelWith([
      obj('spikes', 320, 160, { name: 'x' }),
      obj('button', 100, 160, { props: { target: 'x' } }),
      obj('button', 200, 160, { props: { target: 'x', action: 'off' } }),
    ]);
    const [on, off] = level.traps.filter((t): t is TrapOf<'button'> => t.kind === 'button');
    const spikes = find(level, 'spikes');
    const field = TrapField.forLevel(level);
    const cases: Array<[TrapOf<'button'>[], boolean]> = [
      [[], false],
      [[on!], true],
      [[off!], false],
      [[on!, off!], false],
    ];
    for (const [pressed, active] of cases) {
      field.updateButtons(1, pressed);
      expect(field.isActive(spikes.id), pressed.map((b) => b.action).join('+') || 'none').toBe(active);
    }
  });

  it('runs an off-switched saw on the level clock until pressed, then stops it there', () => {
    const level = levelWith([obj('saw', 200, 60, { name: 's', width: 200, height: 10 }), obj('button', 560, 160, { props: { target: 's', action: 'off' } })]);
    const saw = find(level, 'saw');
    const button = find(level, 'button');
    const field = TrapField.forLevel(level);
    expect(field.sawCenter(saw, 30)).toEqual(sawCenter(saw, 30));
    expect(field.hazards(30)).toHaveLength(1);
    field.updateButtons(40, [button]); // pressed: stops at tick 40
    expect(field.sawCenter(saw, 90)).toEqual(sawCenter(saw, 40));
    expect(field.hazards(90)).toEqual([]);
    field.updateButtons(100, []); // released: carries on from there
    expect(field.sawCenter(saw, 105)).toEqual(sawCenter(saw, 45));
    const client = TrapField.forLevel(level);
    client.applyNet(field.toNet());
    expect(client.trapTick(saw.id, 123)).toBe(field.trapTick(saw.id, 123));
  });
});

describe('buttons: switched clocks', () => {
  it('stops a saw where it is and carries on from there, on server and client alike', () => {
    const level = levelWith([obj('saw', 200, 60, { name: 's', width: 200, height: 10 }), obj('button', 560, 160, { props: { target: 's' } })]);
    const saw = find(level, 'saw');
    const button = find(level, 'button');
    const field = TrapField.forLevel(level);
    const plate = [{ x: button.x, y: button.y, width: button.width, height: button.height }];

    // Off from the start: parked at the start of its track, harmless.
    expect(field.sawCenter(saw, 50)).toEqual(sawCenter(saw, 0));
    expect(field.hazards(50)).toEqual([]);

    field.updateButtons(10, plate); // on at tick 10
    expect(field.sawCenter(saw, 30)).toEqual(sawCenter(saw, 20));
    expect(field.hazards(30)).toHaveLength(1);
    field.updateButtons(40, []); // off at tick 40, after 30 ticks of running
    expect(field.sawCenter(saw, 90)).toEqual(sawCenter(saw, 30));
    field.updateButtons(100, plate); // and on again
    expect(field.sawCenter(saw, 105)).toEqual(sawCenter(saw, 35));

    const client = TrapField.forLevel(level);
    client.applyNet(field.toNet());
    expect(client.trapTick(saw.id, 123)).toBe(field.trapTick(saw.id, 123));
    expect(client.isActive(saw.id)).toBe(true);
    const copy = field.clone();
    copy.updateButtons(110, []);
    expect(field.isActive(saw.id)).toBe(true);
  });

  it('pauses a fan cycle while off', () => {
    const level = levelWith([obj('fan', 400, 160, { name: 'f', props: { onMs: 1000, offMs: 1000 } }), obj('button', 560, 160, { props: { target: 'f' } })]);
    const fan = find(level, 'fan');
    const button = find(level, 'button');
    const field = TrapField.forLevel(level);
    field.updateButtons(500, [button]);
    expect(field.fanOn(fan, 510)).toBe(fanOn(fan, 10));
  });

  it('leaves unlinked traps on the level clock', () => {
    const world = worldWith([obj('saw', 200, 60, { width: 200, height: 10 })]);
    const saw = find(world.level, 'saw');
    expect(world.trapField.sawCenter(saw, 77)).toEqual(sawCenter(saw, 77));
    expect(world.trapField.isActive(saw.id)).toBe(true);
  });
});
