import { describe, expect, it } from 'vitest';
import { resolveMovement } from '../config/movement';
import { SNAPSHOT_EVERY_TICKS } from '../config/net';
import { asciiToLevel } from '../dev/asciiMap';
import { ALL_BUTTONS, Button } from '../sim/input';
import { GameWorld } from '../sim/world';
import { jsonCodec } from './codec';
import { applyWorldDelta, diffWorld, isDeltaEmpty } from './delta';
import type { NetPlayerState, NetWorldState } from './state';
import { isRoomCode, normalizeRoomCode, parseClientMessage, sanitizePlayerName } from './validate';

function player(id: string, overrides: Partial<NetPlayerState> = {}): NetPlayerState {
  return {
    id,
    x: 10,
    y: 20,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: true,
    jumpHeld: false,
    jumping: false,
    coyote: 0.1,
    buffer: 0,
    drop: 0,
    alive: true,
    respawnIn: 0,
    score: 0,
    deaths: 0,
    atExit: false,
    checkpointId: null,
    tp: 0,
    ack: 0,
    ...overrides,
  };
}

describe('world deltas', () => {
  const prev: NetWorldState = { tick: 10, players: [player('a'), player('b'), player('c')], collected: [3] };
  const next: NetWorldState = {
    tick: 13,
    players: [player('a', { x: 14, vx: 220, ack: 3 }), player('c'), player('d', { x: 99 })],
    collected: [3, 7],
  };

  it('contains only what changed', () => {
    const delta = diffWorld(prev, next);
    expect(delta.upserts).toEqual([{ id: 'a', x: 14, vx: 220, ack: 3 }, player('d', { x: 99 })]);
    expect(delta.removed).toEqual(['b']);
    expect(delta.collected).toEqual([7]);
  });

  it('round-trips: applying the diff to the base rebuilds the new state', () => {
    expect(applyWorldDelta(prev, next.tick, diffWorld(prev, next))).toEqual(next);
  });

  it('is empty for identical states and survives JSON encoding', () => {
    expect(isDeltaEmpty(diffWorld(next, next))).toBe(true);
    const wire = jsonCodec.decode(jsonCodec.encode({ t: 'delta', run: 1, tick: 13, baseTick: 10, ...diffWorld(prev, next), events: [] }));
    expect(applyWorldDelta(prev, 13, wire as ReturnType<typeof diffWorld>)).toEqual(next);
  });

  it('reconstructs a long simulated stream exactly (keyframes + deltas)', () => {
    const world = new GameWorld({
      level: asciiToLevel({
        rows: ['                    ', '  o  o  o  o  o  o  ', ' 1 2 3 4  --   ^    ', '####################'],
      }),
      movement: resolveMovement(),
    });
    const ids = ['a', 'b', 'c', 'd'];
    ids.forEach((id, slot) => world.addPlayer(id, slot));
    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const acks = new Map(ids.map((id) => [id, 0]));

    let serverBase: NetWorldState | null = null;
    let client: NetWorldState | null = null;
    let sent = 0;
    for (let tick = 1; tick <= 1200; tick++) {
      for (const id of ids) {
        world.stepPlayer(id, Math.floor(random() * (ALL_BUTTONS + 1)) | (random() < 0.3 ? Button.RIGHT : 0));
        acks.set(id, acks.get(id)! + 1);
      }
      world.endTick();
      if (tick % SNAPSHOT_EVERY_TICKS !== 0) continue;
      const state = world.toNetState((id) => acks.get(id)!);
      if (serverBase === null || sent % 20 === 0) {
        client = JSON.parse(JSON.stringify(state)) as NetWorldState;
      } else {
        const wire = JSON.parse(jsonCodec.encode({ t: 'delta', run: 1, tick: state.tick, baseTick: serverBase.tick, ...diffWorld(serverBase, state), events: [] })) as ReturnType<typeof diffWorld>;
        client = applyWorldDelta(client!, state.tick, wire);
      }
      serverBase = state;
      sent += 1;
      expect(client).toEqual(state);
    }
    expect(world.toNetState(() => 0).collected.length).toBeGreaterThan(0);
  });
});

describe('parseClientMessage', () => {
  it.each([
    { t: 'join', protocol: 1, roomId: 'ABCDE', name: 'Ann', clientId: '0123456789abcdef' },
    { t: 'ready', ready: true },
    { t: 'selectLevel', levelId: 'level-2' },
    { t: 'input', seq: 42, buttons: Button.LEFT | Button.JUMP },
    { t: 'menu', open: false },
    { t: 'ping', id: 3, at: 1234.5 },
    { t: 'leave' },
    { t: 'resync' },
    { t: 'dev', cmd: 'skipLevel' },
  ])('accepts $t', (message) => {
    expect(parseClientMessage(message)).toEqual(message);
  });

  it('strips unknown fields', () => {
    expect(parseClientMessage({ t: 'ready', ready: false, admin: true })).toEqual({ t: 'ready', ready: false });
  });

  it.each([
    ['non-objects', 'ready'],
    ['arrays', [{ t: 'leave' }]],
    ['unknown types', { t: 'teleport', x: 1 }],
    ['unknown button bits', { t: 'input', seq: 1, buttons: 16 }],
    ['negative sequence numbers', { t: 'input', seq: -1, buttons: 0 }],
    ['fractional sequence numbers', { t: 'input', seq: 1.5, buttons: 0 }],
    ['wrong field types', { t: 'ready', ready: 'yes' }],
    ['unknown dev commands', { t: 'dev', cmd: 'godMode' }],
    ['short client ids', { t: 'join', protocol: 1, roomId: 'ABCDE', name: 'x', clientId: 'abc' }],
    ['non-finite ping times', { t: 'ping', id: 1, at: Number.POSITIVE_INFINITY }],
  ])('rejects %s', (_name, message) => {
    expect(parseClientMessage(message)).toBeNull();
  });
});

describe('player names and room codes', () => {
  it('sanitizes names', () => {
    expect(sanitizePlayerName('  Ann   the\tGreat  ')).toBe('Ann the Great');
    expect(sanitizePlayerName('a\u0000b​c‮d')).toBe('abcd');
    expect(sanitizePlayerName('x'.repeat(40))).toHaveLength(16);
    expect(sanitizePlayerName('🙂'.repeat(20))).toBe('🙂'.repeat(16)); // counts characters, not UTF-16 units
    expect(sanitizePlayerName('   ')).toBe('Player');
    expect(sanitizePlayerName(42)).toBe('Player');
  });

  it('normalizes and validates room codes', () => {
    expect(normalizeRoomCode(' ab-cd9 ')).toBe('ABCD9');
    expect(isRoomCode('ABCD9')).toBe(true);
    expect(isRoomCode('AB')).toBe(false);
    expect(isRoomCode('abcde')).toBe(false);
  });

  it('decodes garbage without throwing', () => {
    expect(jsonCodec.decode('{not json')).toBeUndefined();
  });
});
