import { describe, expect, it } from 'vitest';
import { ABILITIES, Ability, Cargo, Held, Phase } from '../config/abilities';
import { resolveMovement } from '../config/movement';
import { msToTicks } from '../config/net';
import { PLAYER_CONFIG } from '../config/players';
import { asciiToLevel } from '../dev/asciiMap';
import type { TiledObject } from '../level/tiled';
import { bodyFromNetState } from '../protocol/state';
import { diffWorld } from '../protocol/delta';
import { droneGrip, tongueTip } from './abilities';
import { stepPlayerBody } from './actions';
import type { GameEvent } from './events';
import { aimFromButtons, Button, sanitizeButtons, withAim } from './input';
import { GameWorld } from './world';

const HITBOX = PLAYER_CONFIG.hitbox;
/** 32 px tiles, 30 columns of open sky over a floor whose top is at y = 160. */
const FLOOR = ['                              ', '                              ', '                              ', '                              ', ' 1                            ', '##############################'];
const GROUND = 160;

function box(x: number, variant = 1): Omit<TiledObject, 'id'> {
  // A point object at the box's bottom-centre.
  return { name: 'box', type: 'box', x, y: GROUND, width: 0, height: 0, point: true, properties: [{ name: 'variant', type: 'int', value: variant }] };
}

function makeWorld(objects: Array<Omit<TiledObject, 'id'>> = []): GameWorld {
  return new GameWorld({ level: asciiToLevel({ rows: FLOOR, objects }), movement: resolveMovement() });
}

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

/** A one-tick press of `buttons` for `id`, then a release tick. */
function press(world: GameWorld, id: string, buttons = Button.SPECIAL): GameEvent[] {
  return [...tick(world, { [id]: buttons }), ...tick(world)];
}

function place(world: GameWorld, id: string, feetX: number, feetY = GROUND): void {
  const body = world.getPlayer(id)!.body;
  body.x = feetX - HITBOX.width / 2;
  body.y = feetY - HITBOX.height;
  body.vx = body.vy = 0;
}

const seconds = (s: number) => msToTicks(s * 1000);

describe('input: special + aim', () => {
  it('round-trips the aim through the button mask in 64 steps', () => {
    for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 4, 2.2]) {
      const buttons = withAim(Button.SPECIAL | Button.LEFT, angle);
      expect(sanitizeButtons(buttons)).toBe(buttons);
      const back = aimFromButtons(buttons, 1);
      const diff = Math.atan2(Math.sin(back - angle), Math.cos(back - angle));
      expect(Math.abs(diff)).toBeLessThanOrEqual(Math.PI / 64 + 1e-9);
      expect(buttons & (Button.SPECIAL | Button.LEFT)).toBe(Button.SPECIAL | Button.LEFT);
    }
  });

  it('aims straight ahead without an aim', () => {
    expect(aimFromButtons(Button.SPECIAL, 1)).toBe(0);
    expect(aimFromButtons(Button.SPECIAL, -1)).toBe(Math.PI);
  });
});

describe('heal (Bunny Man)', () => {
  function healWorld(bX: number) {
    const world = makeWorld();
    world.addPlayer('a', 0, 'bunny-man');
    world.addPlayer('b', 1, 'virtual-guy');
    ticks(world, 5);
    place(world, 'a', 100);
    place(world, 'b', bX);
    ticks(world, 5);
    return { world, a: world.getPlayer('a')!, b: world.getPlayer('b')! };
  }

  /** Ticks until `done` holds (at most `max` ticks), collecting events. */
  function until(world: GameWorld, done: () => boolean, max = 300): GameEvent[] {
    const events: GameEvent[] = [];
    for (let i = 0; i < max && !done(); i++) events.push(...tick(world));
    return events;
  }

  it('stretches the arms along the aim, yanks the player in, hugs them and restores hearts', () => {
    const { world, a, b } = healWorld(170);
    b.hp = 1;
    a.hp = 1;
    const events = press(world, 'a', withAim(Button.SPECIAL, 0));
    expect(a.body.phase).toBe(Phase.HEAL_WINDUP);
    events.push(...until(world, () => a.body.phase !== Phase.HEAL_WINDUP && a.body.phase !== Phase.HEAL_REACH));
    expect(events).toContainEqual({ type: 'grab', playerId: 'a', targetId: 'b', boxId: null });
    expect(a.body.phase).toBe(Phase.HEAL_PULL);
    expect(b.body.held).toBe(Held.PULLED);
    // Inputs are ignored while held.
    const x0 = b.body.x;
    tick(world, { b: Button.RIGHT | Button.JUMP });
    expect(b.body.x).toBeLessThan(x0);

    until(world, () => a.body.phase === Phase.HEAL_HUG);
    tick(world);
    expect(b.body.held).toBe(Held.HUGGED);
    expect(b.body.x + HITBOX.width / 2).toBeCloseTo(a.body.x + HITBOX.width / 2 + ABILITIES.heal.hugTrack[0]![1], 5);

    const rest = ticks(world, seconds(ABILITIES.heal.hug) + 2);
    expect(rest.some((e) => e.type === 'heal' && e.targetId === 'b')).toBe(true);
    expect(b.hp).toBe(Math.min(PLAYER_CONFIG.maxHp, 1 + ABILITIES.heal.amount));
    expect(a.hp).toBe(1 + ABILITIES.heal.selfAmount);
    expect(b.body.held).toBe(Held.NONE);
    expect(a.body.phase).toBe(Phase.NONE);
    expect(a.body.specialCooldown).toBeCloseTo(ABILITIES.heal.cooldown - 1 / 60, 1);
  });

  it('turns around to aim behind', () => {
    const { world, a, b } = healWorld(40);
    const events = [...press(world, 'a', withAim(Button.SPECIAL, Math.PI)), ...ticks(world, 30)];
    expect(a.body.facing).toBe(-1);
    expect(events).toContainEqual({ type: 'grab', playerId: 'a', targetId: 'b', boxId: null });
    expect(b.body.held).not.toBe(Held.NONE);
  });

  it('misses when aimed away: the arms snap back, nobody is healed, and the cooldown is short', () => {
    const { world, a, b } = healWorld(170);
    a.hp = 1;
    const events = [...press(world, 'a', withAim(Button.SPECIAL, -Math.PI / 2))];
    events.push(...until(world, () => a.body.phase === Phase.HEAL_RETRACT));
    expect(a.body.reach).toBeGreaterThan(ABILITIES.heal.maxLength - 20);
    events.push(...until(world, () => a.body.phase === Phase.NONE));
    expect(events.some((e) => e.type === 'grab' || e.type === 'heal')).toBe(false);
    expect(b.body.held).toBe(Held.NONE);
    expect(a.hp).toBe(1);
    expect(a.body.specialCooldown).toBeGreaterThan(0);
    expect(a.body.specialCooldown).toBeLessThanOrEqual(ABILITIES.heal.missCooldown);
  });

  it('stops the arms at walls', () => {
    const world = new GameWorld({
      level: asciiToLevel({ rows: ['        ', '        ', '        ', '        ', ' 1  #   ', '########'], objects: [] }),
      movement: resolveMovement(),
    });
    world.addPlayer('a', 0, 'bunny-man');
    ticks(world, 5);
    place(world, 'a', 100);
    ticks(world, 5);
    const a = world.getPlayer('a')!.body;
    press(world, 'a', withAim(Button.SPECIAL, 0));
    until(world, () => a.phase === Phase.HEAL_RETRACT);
    // The wall starts at x = 128; the shoulder sits 5 px in front of the feet.
    expect(a.reach).toBeLessThan(128 - 100 - ABILITIES.heal.shoulder.x + 10);
  });

  it('needs the ground and respects the cooldown', () => {
    const world = makeWorld();
    world.addPlayer('a', 0, 'bunny-man');
    ticks(world, 5);
    const a = world.getPlayer('a')!.body;
    tick(world, { a: Button.JUMP });
    ticks(world, 3);
    press(world, 'a');
    expect(a.phase).toBe(Phase.NONE);
    ticks(world, 60);
    press(world, 'a');
    expect(a.phase).toBe(Phase.HEAL_WINDUP);
    ticks(world, 120);
    expect(a.phase).toBe(Phase.NONE);
    press(world, 'a');
    expect(a.phase).toBe(Phase.NONE);
  });
});

describe('drone (Virtual Guy)', () => {
  function pilotWorld(objects: Array<Omit<TiledObject, 'id'>> = []) {
    const world = makeWorld(objects);
    world.addPlayer('a', 0, 'virtual-guy');
    world.addPlayer('b', 1, 'bunny-man');
    ticks(world, 5);
    place(world, 'a', 100);
    place(world, 'b', 400);
    ticks(world, 5);
    press(world, 'a');
    ticks(world, seconds(ABILITIES.drone.deploy + ABILITIES.drone.sit) + 2);
    expect(world.getPlayer('a')!.body.phase).toBe(Phase.DRONE_PILOT);
    return world;
  }

  /** Flies the drone until its grip is right above (x, y). */
  function flyTo(world: GameWorld, x: number, y: number): void {
    const a = world.getPlayer('a')!.body;
    for (let i = 0; i < 600; i++) {
      const grip = droneGrip(a);
      const dx = x - grip.x;
      const dy = y - grip.y;
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      let buttons = 0;
      if (dx > 2) buttons |= Button.RIGHT;
      if (dx < -2) buttons |= Button.LEFT;
      if (dy > 2) buttons |= Button.DOWN;
      if (dy < -2) buttons |= Button.JUMP;
      tick(world, { a: buttons });
    }
  }

  it('sits the pilot down and flies the drone with the movement keys', () => {
    const world = pilotWorld();
    const a = world.getPlayer('a')!.body;
    const pilotX = a.x;
    const droneX = a.droneX;
    ticks(world, 30, { a: Button.RIGHT });
    expect(a.x).toBe(pilotX);
    expect(a.droneX).toBeGreaterThan(droneX + 40);
    // Attack recalls the drone; the pilot gets up afterwards.
    press(world, 'a', Button.ATTACK);
    expect(a.phase).toBe(Phase.DRONE_RECALL);
    ticks(world, seconds(ABILITIES.drone.recall + ABILITIES.drone.return + ABILITIES.drone.catch + ABILITIES.drone.stand) + 3);
    expect(a.phase).toBe(Phase.NONE);
    expect(a.specialCooldown).toBeGreaterThan(0);
  });

  it('picks a player up with the claw, carries them and drops them', () => {
    const world = pilotWorld();
    const a = world.getPlayer('a')!.body;
    const b = world.getPlayer('b')!.body;
    flyTo(world, 400, GROUND - HITBOX.height + 4);
    const events = press(world, 'a');
    expect(events).toContainEqual({ type: 'grab', playerId: 'a', targetId: 'b', boxId: null });
    expect(b.held).toBe(Held.CARRIED);
    expect(a.cargo).toBe(Cargo.PLAYER);
    ticks(world, 30, { a: Button.JUMP | Button.LEFT });
    expect(b.y + HITBOX.height).toBeCloseTo(droneGrip(a).y + 26, 5);
    expect(b.y + HITBOX.height).toBeLessThan(GROUND - 20);

    const dropped = press(world, 'a');
    expect(dropped.some((e) => e.type === 'release' && !e.spit)).toBe(true);
    expect(b.held).toBe(Held.NONE);
    ticks(world, 60);
    expect(b.grounded).toBe(true);
  });

  it('carries a box and puts it back into the level where it lands', () => {
    const world = pilotWorld([box(300)]);
    const boxId = world.level.traps[0]!.id;
    const a = world.getPlayer('a')!.body;
    flyTo(world, 300, GROUND - 20 + 2);
    press(world, 'a');
    expect(world.trapField.isTaken(boxId)).toBe(true);
    expect(world.toNetState(() => 0).props).toEqual([expect.objectContaining({ id: boxId, state: 'held', owner: 'a' })]);
    expect(a.cargo).toBe(Cargo.BOX);

    ticks(world, 25, { a: Button.JUMP | Button.RIGHT });
    const before = world.toNetState(() => 0);
    press(world, 'a');
    ticks(world, 90);
    expect(world.trapField.isTaken(boxId)).toBe(false);
    const rect = world.trapField.boxRect(boxId)!;
    expect(rect.x).toBeGreaterThan(310);
    expect(rect.y + rect.height).toBe(GROUND);
    const after = world.toNetState(() => 0);
    expect(after.props).toEqual([]);
    expect(diffWorld(before, after).traps).toEqual([{ id: boxId, x: rect.x, y: rect.y }]);
  });
});

describe('giant (Mask Dude)', () => {
  it('grows: bonus hearts, heart-costing swings, then shrinks back', () => {
    const world = makeWorld([box(300, 3)]);
    world.addPlayer('a', 0, 'mask-dude');
    world.addPlayer('b', 1);
    ticks(world, 5);
    place(world, 'a', 100);
    place(world, 'b', 125);
    ticks(world, 5);
    const a = world.getPlayer('a')!;
    const b = world.getPlayer('b')!;

    const events = press(world, 'a');
    expect(events).toContainEqual({ type: 'special', playerId: 'a', ability: Ability.GIANT });
    expect(a.hp).toBe(PLAYER_CONFIG.maxHp + ABILITIES.giant.bonusHp);
    expect(world.toNetState(() => 0).players[0]!.maxHp).toBe(PLAYER_CONFIG.maxHp + ABILITIES.giant.bonusHp);
    ticks(world, seconds(ABILITIES.giant.grow) + 2);
    expect(a.body.giant).toBeGreaterThan(0);

    a.body.facing = 1;
    const hits = [...press(world, 'a', Button.ATTACK), ...ticks(world, 20)];
    expect(hits).toContainEqual(expect.objectContaining({ type: 'abilityHit', playerId: 'b', by: 'a' }));
    expect(b.hp).toBe(PLAYER_CONFIG.maxHp - ABILITIES.giant.swingDamage);
    expect(Math.abs(b.body.vx)).toBeGreaterThan(0);

    // One giant swing breaks even the sturdiest box.
    place(world, 'a', 270);
    a.body.facing = 1;
    ticks(world, 30);
    const boxEvents = [...press(world, 'a', Button.ATTACK), ...ticks(world, 20)];
    expect(boxEvents).toContainEqual(expect.objectContaining({ type: 'boxHit', broken: true }));

    ticks(world, seconds(ABILITIES.giant.duration + ABILITIES.giant.shrink) + 5);
    expect(a.body.giant).toBe(0);
    expect(a.body.phase).toBe(Phase.NONE);
    expect(a.hp).toBeLessThanOrEqual(PLAYER_CONFIG.maxHp);
  });
});

describe('tongue (Ninja Frog)', () => {
  function frogWorld(objects: Array<Omit<TiledObject, 'id'>> = []) {
    const world = makeWorld(objects);
    world.addPlayer('a', 0, 'ninja-frog');
    world.addPlayer('b', 1);
    world.addPlayer('c', 2);
    ticks(world, 5);
    place(world, 'a', 100);
    place(world, 'b', 190);
    place(world, 'c', 360);
    ticks(world, 5);
    return world;
  }

  it('grabs, swallows and spits a player along the aim, hurting whoever is in the way', () => {
    const world = frogWorld();
    const a = world.getPlayer('a')!;
    const b = world.getPlayer('b')!;
    const c = world.getPlayer('c')!;
    const shoot = withAim(Button.SPECIAL, 0);
    const events = [...tick(world, { a: shoot }), ...ticks(world, 30)];
    expect(events).toContainEqual({ type: 'grab', playerId: 'a', targetId: 'b', boxId: null });
    expect([Phase.TONGUE_GULP, Phase.TONGUE_HOLD]).toContain(a.body.phase);
    expect(b.body.held).toBe(Held.SWALLOWED);

    // Walk while holding, then spit to the right.
    ticks(world, seconds(ABILITIES.tongue.gulp) + 2);
    expect(a.body.phase).toBe(Phase.TONGUE_HOLD);
    ticks(world, 10, { a: Button.RIGHT });
    expect(a.body.x).toBeGreaterThan(100 - HITBOX.width / 2);
    const spit = [...tick(world, { a: withAim(Button.SPECIAL, 0) }), ...ticks(world, 60)];
    expect(spit).toContainEqual(expect.objectContaining({ type: 'release', playerId: 'a', spit: true }));
    expect(spit).toContainEqual(expect.objectContaining({ type: 'abilityHit', playerId: 'c', by: 'a' }));
    expect(c.hp).toBe(PLAYER_CONFIG.maxHp - ABILITIES.tongue.damage);
    expect(b.body.held).toBe(Held.NONE);
    expect(b.body.x).toBeGreaterThan(300);
    expect(a.body.phase).toBe(Phase.NONE);
  });

  it('follows the free aim and retracts when it hits nothing', () => {
    const world = frogWorld();
    const a = world.getPlayer('a')!.body;
    tick(world, { a: withAim(Button.SPECIAL, -Math.PI / 2) });
    ticks(world, seconds(ABILITIES.tongue.windup) + 6);
    expect(a.phase).toBe(Phase.TONGUE_SHOOT);
    const tip = tongueTip(a, HITBOX);
    expect(tip.y).toBeLessThan(a.y);
    ticks(world, 60);
    expect(a.phase).toBe(Phase.NONE);
    expect(a.specialCooldown).toBeGreaterThan(0);
    expect(world.getPlayer('b')!.body.held).toBe(Held.NONE);
  });

  it('turns towards an aim behind it', () => {
    const world = frogWorld();
    const a = world.getPlayer('a')!.body;
    a.facing = 1;
    tick(world, { a: withAim(Button.SPECIAL, Math.PI) });
    expect(a.facing).toBe(-1);
  });

  it('spits a box that shatters on the first player it hits', () => {
    const world = frogWorld([box(160)]);
    const boxId = world.level.traps[0]!.id;
    place(world, 'b', 600);
    ticks(world, 3);
    const a = world.getPlayer('a')!;
    // Aim at the box's centre from the mouth.
    tick(world, { a: withAim(Button.SPECIAL, 0.25) });
    const grabbed = ticks(world, 40);
    expect(grabbed).toContainEqual({ type: 'grab', playerId: 'a', targetId: null, boxId });
    expect(world.toNetState(() => 0).props[0]).toMatchObject({ id: boxId, state: 'swallowed' });

    const out = [...tick(world, { a: withAim(Button.SPECIAL, 0) }), ...ticks(world, 60)];
    expect(out).toContainEqual(expect.objectContaining({ type: 'propBreak', boxId }));
    expect(out).toContainEqual(expect.objectContaining({ type: 'abilityHit', playerId: 'c', by: 'a' }));
    expect(world.trapField.isBroken(boxId)).toBe(true);
    expect(world.toNetState(() => 0).props).toEqual([]);
    expect(a.body.phase).toBe(Phase.NONE);
  });
});

describe('prediction', () => {
  it('replaying the owner from replicated state matches the server', () => {
    const world = makeWorld();
    world.addPlayer('a', 0, 'virtual-guy');
    ticks(world, 5);
    press(world, 'a');
    ticks(world, 10);
    const inputs = [Button.RIGHT, Button.RIGHT | Button.JUMP, Button.JUMP, Button.DOWN | Button.LEFT, 0, Button.ATTACK, 0];
    const start = world.toNetState(() => 0).players[0]!;
    const replay = bodyFromNetState(start);
    for (let i = 0; i < 40; i++) {
      const buttons = inputs[i % inputs.length]!;
      tick(world, { a: buttons });
      stepPlayerBody(replay, buttons, world.movementContext);
    }
    expect(replay).toEqual(bodyFromNetState(world.toNetState(() => 0).players[0]!));
  });
});
