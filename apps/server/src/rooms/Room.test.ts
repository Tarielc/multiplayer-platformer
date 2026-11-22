import { Button, CloseCode, NET_CONFIG, NEUTRAL_INPUT, applyWorldDelta, msToTicks, type NetWorldState } from '@platformer/shared';
import { describe, expect, it } from 'vitest';
import { silentLogger } from '../log';
import { FakeConnection, TEST_LEVELS, TEST_MANIFEST } from '../test/fakes';
import { Room } from './Room';

const COUNTDOWN_TICKS = msToTicks(NET_CONFIG.room.countdownMs);
const GRACE_TICKS = msToTicks(NET_CONFIG.room.reconnectGraceMs);

interface TestClient {
  conn: FakeConnection;
  id: string;
  slot: number;
}

function createRoom(devCommands = true): Room {
  let n = 0;
  return new Room({
    id: 'TEST1',
    levels: TEST_LEVELS,
    manifest: TEST_MANIFEST,
    devCommands,
    log: silentLogger,
    createPlayerId: () => `p${++n}`,
  });
}

function join(room: Room, name: string, clientId = `client-${name}-secret`): TestClient {
  const conn = new FakeConnection();
  const result = room.join(conn, { name, clientId });
  if (!result.ok) throw new Error(`join failed: ${result.code}`);
  return { conn, id: result.playerId, slot: result.slot };
}

function ticks(room: Room, count: number): void {
  for (let i = 0; i < count; i++) room.tick();
}

/** Ticks until `done()` holds; returns how many ticks that took. */
function tickUntil(room: Room, done: () => boolean, max = 5000): number {
  let count = 0;
  while (!done()) {
    room.tick();
    if (++count > max) throw new Error('condition never reached');
  }
  return count;
}

function startPlaying(room: Room, clients: TestClient[]): void {
  for (const client of clients) room.handle(client.id, { t: 'ready', ready: true });
  tickUntil(room, () => room.currentPhase === 'playing');
}

/** Rebuilds the world exactly as a client would from the snapshots and deltas it received. */
function clientWorld(conn: FakeConnection, run: number): NetWorldState | null {
  let state: NetWorldState | null = null;
  for (const message of conn.sent) {
    if (message.t === 'snapshot' && message.run === run) state = message.state;
    if (message.t === 'delta' && message.run === run) {
      expect(state?.tick).toBe(message.baseTick);
      state = applyWorldDelta(state!, message.tick, message);
    }
  }
  return state;
}

describe('Room: joining', () => {
  it('assigns the lowest free slot and rejects a fifth player', () => {
    const room = createRoom();
    const clients = ['A', 'B', 'C', 'D'].map((name) => join(room, name));
    expect(clients.map((c) => c.slot)).toEqual([0, 1, 2, 3]);
    expect(clients[0]!.conn.last('welcome')).toMatchObject({ playerId: clients[0]!.id, slot: 0, rejoined: false });

    expect(room.join(new FakeConnection(), { name: 'E', clientId: 'client-E-secret' })).toMatchObject({ ok: false, code: 'ROOM_FULL' });

    room.handle(clients[1]!.id, { t: 'leave' });
    expect(join(room, 'F').slot).toBe(1);
  });

  it('makes the first player host and hands it on when the host leaves', () => {
    const room = createRoom();
    const a = join(room, 'A');
    const b = join(room, 'B');
    const c = join(room, 'C');
    expect(room.info().hostId).toBe(a.id);
    room.handle(a.id, { t: 'leave' });
    expect(room.info().hostId).toBe(b.id);
    expect(c.conn.last('room')?.room.hostId).toBe(b.id);
  });

  it('lets only the host choose the level', () => {
    const room = createRoom();
    const host = join(room, 'A');
    const guest = join(room, 'B');
    room.handle(guest.id, { t: 'selectLevel', levelId: 'second' });
    expect(guest.conn.last('error')).toMatchObject({ code: 'NOT_ALLOWED' });
    room.handle(host.id, { t: 'selectLevel', levelId: 'missing' });
    expect(host.conn.last('error')).toMatchObject({ code: 'BAD_REQUEST' });
    room.handle(host.id, { t: 'selectLevel', levelId: 'second' });
    expect(guest.conn.last('room')?.room.selectedLevelId).toBe('second');
  });

  it('sanitizes player names', () => {
    const room = createRoom();
    join(room, '  Ann​   Lee  ');
    expect(room.info().players[0]!.name).toBe('Ann Lee');
  });
});

describe('Room: lobby and countdown', () => {
  it('counts down once every connected player is ready, then plays', () => {
    const room = createRoom();
    const a = join(room, 'A');
    const b = join(room, 'B');
    room.handle(a.id, { t: 'ready', ready: true });
    room.tick();
    expect(room.currentPhase).toBe('lobby');

    room.handle(b.id, { t: 'ready', ready: true });
    room.tick();
    expect(room.currentPhase).toBe('countdown');
    expect(room.info().level).toMatchObject({ id: 'first', run: 1 });
    expect(b.conn.last('snapshot')).toMatchObject({ run: 1 });
    expect(tickUntil(room, () => room.currentPhase === 'playing')).toBe(COUNTDOWN_TICKS);
  });

  it('cancels the countdown when someone un-readies or a new player joins', () => {
    const room = createRoom();
    const a = join(room, 'A');
    room.handle(a.id, { t: 'ready', ready: true });
    room.tick();
    expect(room.currentPhase).toBe('countdown');
    room.handle(a.id, { t: 'ready', ready: false });
    room.tick();
    expect(room.currentPhase).toBe('lobby');

    room.handle(a.id, { t: 'ready', ready: true });
    room.tick();
    join(room, 'B');
    room.tick();
    expect(room.currentPhase).toBe('lobby');
  });

  it('ignores disconnected players when checking readiness', () => {
    const room = createRoom();
    const a = join(room, 'A');
    const b = join(room, 'B');
    room.disconnect(b.id, b.conn);
    room.handle(a.id, { t: 'ready', ready: true });
    room.tick();
    expect(room.currentPhase).toBe('countdown');
  });
});

describe('Room: simulation', () => {
  it('simulates queued inputs while playing and acknowledges them', () => {
    const room = createRoom();
    const a = join(room, 'A');
    room.handle(a.id, { t: 'input', seq: 1, buttons: Button.RIGHT }); // ignored: not playing yet
    startPlaying(room, [a]);

    const body = room.gameWorld!.getPlayer(a.id)!.body;
    const startX = body.x;
    for (let seq = 1; seq <= 30; seq++) {
      room.handle(a.id, { t: 'input', seq, buttons: Button.RIGHT });
      room.tick();
    }
    expect(body.x).toBeGreaterThan(startX + 50);
    ticks(room, 3);
    const state = clientWorld(a.conn, 1)!;
    expect(state.players.find((p) => p.id === a.id)).toMatchObject({ ack: 30, x: body.x, y: body.y });
  });

  it('streams keyframes and deltas that rebuild the authoritative state', () => {
    const room = createRoom();
    const a = join(room, 'A');
    const b = join(room, 'B');
    startPlaying(room, [a, b]);
    for (let seq = 1; seq <= 200; seq++) {
      room.handle(a.id, { t: 'input', seq, buttons: seq % 40 < 20 ? Button.RIGHT : Button.LEFT | Button.JUMP });
      room.handle(b.id, { t: 'input', seq, buttons: seq % 25 < 5 ? Button.JUMP : NEUTRAL_INPUT });
      room.tick();
    }
    ticks(room, 3); // inputs stop: players freeze and the last broadcast catches up

    expect(b.conn.all('delta').length).toBeGreaterThan(50);
    for (const conn of [a.conn, b.conn]) {
      const state = clientWorld(conn, 1)!;
      for (const net of state.players) {
        const player = room.gameWorld!.getPlayer(net.id)!;
        expect(net).toMatchObject({ x: player.body.x, y: player.body.y, vy: player.body.vy, score: player.score });
      }
    }
  });

  it('pauses only while every connected player has the menu open', () => {
    const room = createRoom();
    const a = join(room, 'A');
    const b = join(room, 'B');
    startPlaying(room, [a, b]);
    const world = room.gameWorld!;

    room.handle(a.id, { t: 'menu', open: true });
    let tick = world.tick;
    ticks(room, 5);
    expect(world.tick).toBe(tick + 5);

    room.handle(b.id, { t: 'menu', open: true });
    tick = world.tick;
    ticks(room, 5);
    expect(world.tick).toBe(tick);
    expect(b.conn.last('room')?.room.paused).toBe(true);

    room.handle(b.id, { t: 'menu', open: false });
    room.disconnect(b.id, b.conn); // the remaining player still has the menu open
    ticks(room, 5);
    expect(world.tick).toBe(tick);

    room.handle(a.id, { t: 'menu', open: false });
    ticks(room, 5);
    expect(world.tick).toBe(tick + 5);
  });

  it('lets players drop into a running level', () => {
    const room = createRoom();
    const a = join(room, 'A');
    startPlaying(room, [a]);
    ticks(room, 10);

    const late = join(room, 'Late');
    expect(late.slot).toBe(1);
    expect(late.conn.last('snapshot')).toBeDefined(); // keyframe, so deltas apply right away
    ticks(room, 3);
    expect(clientWorld(late.conn, 1)!.players.map((p) => p.id)).toEqual([a.id, late.id]);
  });
});

describe('Room: reconnecting', () => {
  it('re-attaches a returning client to the same player and slot', () => {
    const room = createRoom();
    const a = join(room, 'A', 'client-a-secret');
    const b = join(room, 'B', 'client-b-secret');
    startPlaying(room, [a, b]);

    room.disconnect(b.id, b.conn);
    expect(room.connectedCount).toBe(1);
    expect(room.gameWorld!.getPlayer(b.id)!.present).toBe(false);
    ticks(room, 60);

    const back = join(room, 'B2', 'client-b-secret');
    expect(back).toMatchObject({ id: b.id, slot: b.slot });
    expect(back.conn.last('welcome')).toMatchObject({ rejoined: true });
    expect(back.conn.last('snapshot')).toBeDefined();
    expect(room.gameWorld!.getPlayer(b.id)!.present).toBe(true);
    expect(room.info().players[1]).toMatchObject({ id: b.id, connected: true, name: 'B2' });
  });

  it('replaces the old connection when the same client joins again', () => {
    const room = createRoom();
    const first = join(room, 'A', 'client-a-secret');
    const second = join(room, 'A', 'client-a-secret');
    expect(second.id).toBe(first.id);
    expect(first.conn.last('error')).toMatchObject({ code: 'REPLACED' });
    expect(first.conn.closed?.code).toBe(CloseCode.REPLACED);

    room.disconnect(first.id, first.conn); // the stale socket closing must not drop the new one
    expect(room.connectedCount).toBe(1);
  });

  it('releases the slot when a disconnected player does not return in time', () => {
    const room = createRoom();
    const a = join(room, 'A');
    const b = join(room, 'B');
    room.disconnect(a.id, a.conn);
    ticks(room, GRACE_TICKS - 1);
    expect(room.playerCount).toBe(2);
    room.tick();
    expect(room.playerCount).toBe(1);
    expect(room.info().hostId).toBe(b.id);
  });
});

describe('Room: level flow', () => {
  it('finishes a level when players reach the exit and keeps campaign scores', () => {
    const room = createRoom();
    const a = join(room, 'A');
    startPlaying(room, [a]);
    for (let seq = 1; seq <= 240 && room.currentPhase === 'playing'; seq++) {
      room.handle(a.id, { t: 'input', seq, buttons: Button.RIGHT });
      room.tick();
    }
    expect(room.currentPhase).toBe('levelComplete');
    expect(room.info().results).toEqual([{ playerId: a.id, name: 'A', slot: 0, score: 10, collected: 1, deaths: 0 }]);
    expect(room.info().players[0]!.campaignScore).toBe(10);
    expect(a.conn.sent.some((m) => (m.t === 'delta' || m.t === 'snapshot') && m.events.some((e) => e.type === 'levelComplete'))).toBe(true);
  });

  it('runs level complete -> next level -> campaign complete -> lobby', () => {
    const room = createRoom();
    const a = join(room, 'A');
    startPlaying(room, [a]);

    room.handle(a.id, { t: 'dev', cmd: 'skipLevel' });
    room.tick();
    expect(room.currentPhase).toBe('levelComplete');
    expect(room.info()).toMatchObject({ nextLevelId: 'second', results: [{ playerId: a.id }] });

    tickUntil(room, () => room.currentPhase === 'countdown');
    expect(room.info().level).toMatchObject({ id: 'second', run: 2 });
    tickUntil(room, () => room.currentPhase === 'playing');

    room.handle(a.id, { t: 'dev', cmd: 'skipLevel' });
    tickUntil(room, () => room.currentPhase === 'lobby');
    expect(room.info()).toMatchObject({ campaignComplete: true, level: null, nextLevelId: null });
    expect(room.info().results).not.toBeNull();
    expect(room.info().players[0]!.ready).toBe(false); // everyone readies up again for a new campaign
  });

  it('refuses dev commands when they are disabled', () => {
    const room = createRoom(false);
    const a = join(room, 'A');
    startPlaying(room, [a]);
    room.handle(a.id, { t: 'dev', cmd: 'skipLevel' });
    room.tick();
    expect(room.currentPhase).toBe('playing');
    expect(a.conn.last('error')).toMatchObject({ code: 'NOT_ALLOWED' });
  });
});

describe('Room: housekeeping', () => {
  it('answers pings with the current simulation tick', () => {
    const room = createRoom();
    const a = join(room, 'A');
    room.handle(a.id, { t: 'ping', id: 5, at: 123.5 });
    expect(a.conn.last('pong')).toEqual({ t: 'pong', id: 5, at: 123.5, serverTick: 0 });
  });

  it('expires after staying empty for the configured time', () => {
    const room = createRoom();
    const a = join(room, 'A');
    room.handle(a.id, { t: 'leave' });
    ticks(room, msToTicks(NET_CONFIG.room.emptyRoomTtlMs) - 1);
    expect(room.expired).toBe(false);
    room.tick();
    expect(room.expired).toBe(true);
  });

  it('disconnects everyone on close and refuses new joins', () => {
    const room = createRoom();
    const a = join(room, 'A');
    room.close('SERVER_SHUTDOWN', 'restarting');
    expect(a.conn.last('error')).toMatchObject({ code: 'SERVER_SHUTDOWN' });
    expect(a.conn.closed?.code).toBe(CloseCode.SHUTDOWN);
    expect(room.join(new FakeConnection(), { name: 'B', clientId: 'client-B-secret' })).toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
  });
});
