import { NET_CONFIG, PROTOCOL_VERSION, ROOM_CODE_ALPHABET, msToTicks, type ClientMessageOf } from '@platformer/shared';
import { describe, expect, it } from 'vitest';
import { silentLogger } from '../log';
import { FakeConnection, TEST_LEVELS, TEST_MANIFEST } from '../test/fakes';
import { RoomManager, type RoomManagerOptions } from './RoomManager';

function createManager(options: Partial<RoomManagerOptions> = {}): RoomManager {
  return new RoomManager({
    levels: TEST_LEVELS,
    manifest: TEST_MANIFEST,
    devCommands: false,
    maxRooms: 3,
    autoCreate: true,
    log: silentLogger,
    ...options,
  });
}

const joinMessage = (roomId: string, clientId = 'client-0000-0000'): ClientMessageOf<'join'> => ({
  t: 'join',
  protocol: PROTOCOL_VERSION,
  roomId,
  name: 'Ann',
  clientId,
});

describe('RoomManager', () => {
  it('creates rooms with unique codes from the unambiguous alphabet', () => {
    const manager = createManager({ maxRooms: 200 });
    const codes = Array.from({ length: 200 }, () => manager.create()!.id);
    expect(new Set(codes).size).toBe(200);
    const pattern = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${NET_CONFIG.room.codeLength}}$`);
    for (const code of codes) expect(code).toMatch(pattern);
    expect(manager.create()).toBeNull();
  });

  it('joins existing rooms by (normalized) code', () => {
    const manager = createManager();
    const room = manager.create()!;
    const outcome = manager.join(new FakeConnection(), joinMessage(` ${room.id.toLowerCase()} `));
    expect(outcome).toMatchObject({ ok: true, room, slot: 0, rejoined: false });
  });

  it('creates rooms on demand so invite links survive server restarts', () => {
    const manager = createManager();
    const outcome = manager.join(new FakeConnection(), joinMessage('abcd2'));
    expect(outcome.ok && outcome.room.id).toBe('ABCD2');
  });

  it('rejects malformed codes, unknown rooms (without auto-create) and a full server', () => {
    expect(createManager().join(new FakeConnection(), joinMessage('!!'))).toMatchObject({ ok: false, code: 'BAD_REQUEST' });
    expect(createManager({ autoCreate: false }).join(new FakeConnection(), joinMessage('ZZZZZ'))).toMatchObject({
      ok: false,
      code: 'ROOM_NOT_FOUND',
    });

    const full = createManager({ maxRooms: 1 });
    full.create();
    expect(full.join(new FakeConnection(), joinMessage('QQQQQ'))).toMatchObject({ ok: false, code: 'SERVER_FULL' });
  });

  it('ticks rooms and removes them once they have been empty long enough', () => {
    const manager = createManager();
    const outcome = manager.join(new FakeConnection(), joinMessage('ROOM1'));
    if (!outcome.ok) throw new Error(outcome.code);
    expect(manager.stats()).toEqual({ rooms: 1, players: 1, connected: 1 });

    outcome.room.handle(outcome.playerId, { t: 'leave' });
    for (let i = 0; i < msToTicks(NET_CONFIG.room.emptyRoomTtlMs); i++) manager.tick();
    expect(manager.list()).toEqual([]);
  });

  it('closes every room on shutdown', () => {
    const manager = createManager();
    const conn = new FakeConnection();
    manager.join(conn, joinMessage('ROOM1'));
    manager.shutdown();
    expect(conn.last('error')).toMatchObject({ code: 'SERVER_SHUTDOWN' });
    expect(manager.stats().rooms).toBe(0);
  });
});
