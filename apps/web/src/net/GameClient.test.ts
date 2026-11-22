import {
  CloseCode,
  PROTOCOL_VERSION,
  type ClientMessage,
  type RoomInfo,
  type RoomPlayerInfo,
  type ServerMessage,
} from '@platformer/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameClient, liveSocketCount, type GameClientOptions, type SocketLike } from './GameClient';

class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  readonly sent: ClientMessage[] = [];
  closedWith: { code: number | undefined; reason: string | undefined } | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ClientMessage);
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.closedWith = { code, reason };
  }

  // --- test controls ---
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  receive(message: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  serverClose(code: number): void {
    this.readyState = 3;
    this.onclose?.({ code, reason: '' });
  }

  sentOfType<T extends ClientMessage['t']>(type: T): Extract<ClientMessage, { t: T }>[] {
    return this.sent.filter((m): m is Extract<ClientMessage, { t: T }> => m.t === type);
  }
}

const ME = 'p-me';

function roomInfo(overrides: Partial<RoomInfo> = {}, me: Partial<RoomPlayerInfo> = {}): RoomInfo {
  return {
    roomId: 'ROOM1',
    phase: 'lobby',
    hostId: ME,
    maxPlayers: 4,
    players: [{ id: ME, name: 'Ann', slot: 0, ready: false, connected: true, isHost: true, menuOpen: false, campaignScore: 0, characterId: 'bunny-man', ...me }],
    selectedLevelId: 'level-1',
    level: null,
    paused: false,
    countdownMs: 0,
    results: null,
    nextLevelId: null,
    campaignComplete: false,
    devCommands: true,
    ...overrides,
  };
}

const welcome = (rejoined = false): ServerMessage => ({
  t: 'welcome',
  protocol: PROTOCOL_VERSION,
  roomId: 'ROOM1',
  playerId: ME,
  slot: 0,
  rejoined,
  tickRate: 60,
  snapshotRate: 20,
});

const clients: GameClient[] = [];

function createClient(options: Partial<GameClientOptions> = {}): GameClient {
  const client = new GameClient({
    roomId: 'ROOM1',
    name: () => 'Ann',
    clientId: () => 'client-secret-1',
    url: () => 'ws://game.test/ws',
    createSocket: (url) => new FakeSocket(url),
    now: () => Date.now(),
    ...options,
  });
  clients.push(client);
  return client;
}

/** Connects and completes the join handshake; returns the socket. */
async function connected(client: GameClient, rejoined = false): Promise<FakeSocket> {
  client.connect();
  await vi.advanceTimersByTimeAsync(0);
  const socket = FakeSocket.instances.at(-1)!;
  socket.open();
  socket.receive(welcome(rejoined));
  return socket;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
});

afterEach(() => {
  for (const client of clients.splice(0)) client.disconnect();
  vi.useRealTimers();
});

describe('GameClient: lifecycle', () => {
  it('opens a single socket across React Strict Mode mount/unmount/mount', async () => {
    const client = createClient();
    client.connect();
    client.disconnect();
    client.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(liveSocketCount()).toBe(1);

    client.disconnect();
    expect(liveSocketCount()).toBe(0);
    expect(FakeSocket.instances[0]!.closedWith?.code).toBe(CloseCode.NORMAL);
    expect(client.status).toBe('idle');
  });

  it('joins with protocol, room, name and client id, then pings', async () => {
    const client = createClient();
    const socket = await connected(client);
    expect(socket.url).toBe('ws://game.test/ws');
    expect(socket.sent[0]).toEqual({ t: 'join', protocol: PROTOCOL_VERSION, roomId: 'ROOM1', name: 'Ann', clientId: 'client-secret-1' });
    expect(client.status).toBe('open');
    expect(client.playerId).toBe(ME);
    expect(socket.sentOfType('ping')).toHaveLength(1);
  });

  it('sends a preferred character only when one is set', async () => {
    const socket = await connected(createClient({ character: () => 'ninja-frog' }));
    expect(socket.sent[0]).toMatchObject({ t: 'join', characterId: 'ninja-frog' });
    const none = await connected(createClient({ character: () => null }));
    expect(none.sent[0]).not.toHaveProperty('characterId');
  });

  it('reconnects with backoff after an unexpected close and restores the menu state', async () => {
    const client = createClient();
    const first = await connected(client);
    client.setMenuOpen(true);
    first.serverClose(1006);
    expect(client.status).toBe('reconnecting');

    await vi.advanceTimersByTimeAsync(299);
    expect(FakeSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    const second = FakeSocket.instances[1]!;
    second.open();
    expect(second.sent[0]).toMatchObject({ t: 'join', clientId: 'client-secret-1' });
    second.receive(welcome(true));
    expect(client.status).toBe('open');
    expect(second.sentOfType('menu')).toEqual([{ t: 'menu', open: true }]);
  });

  it('gives up on fatal errors instead of reconnecting', async () => {
    const client = createClient();
    const fatal = vi.fn();
    client.events.on('fatal', fatal);
    const socket = await connected(client);
    socket.receive({ t: 'error', code: 'ROOM_FULL', message: 'Room ROOM1 is full.' });
    socket.serverClose(CloseCode.REJECTED);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(client.status).toBe('closed');
    expect(fatal).toHaveBeenCalledWith({ code: 'ROOM_FULL', message: 'Room ROOM1 is full.' });
  });

  it('reports the server as unreachable after the last reconnect attempt', async () => {
    const client = createClient();
    client.connect();
    for (let attempt = 0; attempt < 20; attempt++) {
      await vi.advanceTimersByTimeAsync(5_000);
      FakeSocket.instances.at(-1)?.serverClose(1006);
    }
    expect(client.fatal?.code).toBe('UNREACHABLE');
    const sockets = FakeSocket.instances.length;
    client.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeSocket.instances.length).toBe(sockets + 1);
  });

  it('sends leave and stops when leaving', async () => {
    const client = createClient();
    const socket = await connected(client);
    client.leave();
    expect(socket.sentOfType('leave')).toHaveLength(1);
    expect(client.status).toBe('closed');
    expect(liveSocketCount()).toBe(0);
  });
});

describe('GameClient: auto-ready (solo play)', () => {
  it('readies once after a fresh join into the lobby', async () => {
    const socket = await connected(createClient({ autoReady: true }));
    socket.receive({ t: 'room', room: roomInfo() });
    socket.receive({ t: 'room', room: roomInfo() });
    expect(socket.sentOfType('ready')).toEqual([{ t: 'ready', ready: true }]);
  });

  it('does not ready again when the campaign returns to the lobby', async () => {
    const socket = await connected(createClient({ autoReady: true }));
    socket.receive({ t: 'room', room: roomInfo() });
    socket.receive({ t: 'room', room: roomInfo({ phase: 'playing' }, { ready: true }) });
    socket.receive({ t: 'room', room: roomInfo({ phase: 'lobby', campaignComplete: true }, { ready: false }) });
    expect(socket.sentOfType('ready')).toHaveLength(1);
  });

  it('does not ready on a rejoin or when joining a room that is already playing', async () => {
    const rejoin = await connected(createClient({ autoReady: true }), true);
    rejoin.receive({ t: 'room', room: roomInfo() });
    expect(rejoin.sentOfType('ready')).toEqual([]);

    const dropIn = await connected(createClient({ autoReady: true }));
    dropIn.receive({ t: 'room', room: roomInfo({ phase: 'playing' }) });
    dropIn.receive({ t: 'room', room: roomInfo({ phase: 'lobby' }) });
    expect(dropIn.sentOfType('ready')).toEqual([]);
  });
});

describe('GameClient: world state', () => {
  const level = { id: 'level-1', name: 'Green Hills', checksum: 'abcd1234', run: 1 };
  const player = { id: ME, x: 1, y: 2, vx: 0, vy: 0, facing: 1 as const, grounded: true, jumpHeld: false, jumping: false, coyote: 0, buffer: 0, drop: 0, airJumpsLeft: 1, alive: true, respawnIn: 0, score: 0, deaths: 0, atExit: false, checkpointId: null, tp: 0, attackHeld: false, attack: 0, attackCooldown: 0, attackSeq: 0, hurt: 0, stepTick: 0, hp: 3, invulnUntil: 0, ability: 0, specialHeld: false, phase: 0, phaseTime: 0, specialCooldown: 0, specialSeq: 0, aim: 0, reach: 0, giant: 0, droneX: 0, droneY: 0, droneVx: 0, droneVy: 0, cargo: 0, held: 0, flight: 0, grab: '', maxHp: 3, ack: 0 };

  it('emits keyframes and applied deltas, and asks for a resync on gaps', async () => {
    const client = createClient();
    const updates: Array<{ keyframe: boolean; tick: number }> = [];
    client.events.on('world', (u) => updates.push({ keyframe: u.keyframe, tick: u.state.tick }));
    const socket = await connected(client);
    socket.receive({ t: 'room', room: roomInfo({ phase: 'countdown', level }) });
    socket.receive({ t: 'snapshot', run: 1, tick: 3, state: { tick: 3, players: [player], collected: [], traps: [], props: [] }, events: [] });
    socket.receive({ t: 'delta', run: 1, tick: 6, baseTick: 3, upserts: [{ id: ME, x: 5 }], removed: [], collected: [], events: [] });
    expect(updates).toEqual([
      { keyframe: true, tick: 3 },
      { keyframe: false, tick: 6 },
    ]);
    expect(client.latestWorld?.players[0]?.x).toBe(5);

    socket.receive({ t: 'delta', run: 1, tick: 12, baseTick: 9, upserts: [], removed: [], collected: [], events: [] });
    expect(socket.sentOfType('resync')).toHaveLength(1);
    expect(updates).toHaveLength(2);
  });

  it('drops world state from a previous level run', async () => {
    const client = createClient();
    const socket = await connected(client);
    socket.receive({ t: 'room', room: roomInfo({ phase: 'countdown', level: { ...level, run: 2 } }) });
    socket.receive({ t: 'snapshot', run: 1, tick: 3, state: { tick: 3, players: [player], collected: [], traps: [], props: [] }, events: [] });
    expect(client.latestWorld).toBeNull();
  });
});
