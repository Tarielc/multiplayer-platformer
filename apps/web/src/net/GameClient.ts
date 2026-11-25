import {
  CloseCode,
  MODE_CONFIG,
  NET_CONFIG,
  PROTOCOL_VERSION,
  SOLO_GAME_MODE,
  TypedEmitter,
  jsonCodec,
  type CharacterId,
  type ClientMessage,
  type DevCommand,
  type ErrorCode,
  type GameEvent,
  type GameMode,
  type MessageCodec,
  type NetConfig,
  type NetWorldState,
  type RoomInfo,
  type ServerMessage,
  type ServerMessageOf,
} from '@platformer/shared';
import { ServerClock } from './ServerClock';
import { WorldStateStore } from './WorldStateStore';

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface FatalError {
  code: ErrorCode | 'UNREACHABLE';
  message: string;
}

export interface WorldUpdate {
  run: number;
  state: NetWorldState;
  events: GameEvent[];
  keyframe: boolean;
  receivedAt: number;
}

export type GameClientEvents = {
  status: ConnectionStatus;
  welcome: ServerMessageOf<'welcome'>;
  room: RoomInfo;
  world: WorldUpdate;
  /** Non-fatal server error (e.g. NOT_ALLOWED). */
  notice: { code: ErrorCode; message: string };
  fatal: FatalError;
  rtt: number;
};

/** The subset of the browser WebSocket the client uses (lets tests inject a fake). */
export interface SocketLike {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface GameClientOptions {
  roomId: string;
  /** Read lazily on connect (localStorage is browser-only). */
  name: () => string;
  clientId: () => Promise<string> | string;
  /** Preferred character, read on every (re)connect; `null` lets the server use the slot default. */
  character?: () => CharacterId | null;
  url: () => string;
  /**
   * Ready up automatically right after joining a room that is in its lobby (solo play). Alone,
   * the host first switches the room to Race (`SOLO_GAME_MODE`): co-op needs a team.
   * Rejoins and later returns to the lobby (campaign complete) are left to the player.
   */
  autoReady?: boolean;
  createSocket?: (url: string) => SocketLike;
  codec?: MessageCodec;
  net?: Readonly<NetConfig>;
  now?: () => number;
}

const OPEN = 1;
/** Server errors after which reconnecting is pointless. */
const FATAL_CODES: ReadonlySet<string> = new Set<ErrorCode>([
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'ROOM_IN_PROGRESS',
  'PROTOCOL_MISMATCH',
  'REPLACED',
  'SERVER_FULL',
]);
const FATAL_CLOSE_CODES: ReadonlySet<number> = new Set([
  CloseCode.REPLACED,
  CloseCode.REJECTED,
  CloseCode.PROTOCOL,
  CloseCode.ABUSE,
]);

let openSockets = 0;
/** Live socket count (dev hook / Strict Mode checks). */
export function liveSocketCount(): number {
  return openSockets;
}

/**
 * Owns the WebSocket for one room: join handshake, auto-reconnect with backoff, ping/RTT,
 * keyframe/delta reconstruction, and typed events for React (RoomStore) and Phaser (scenes).
 *
 * React creates exactly one instance per room screen and calls `connect()`/`disconnect()` from
 * an effect. The socket opens on a zero-delay timer that `disconnect()` cancels, so React Strict
 * Mode's mount -> unmount -> mount opens a single socket.
 */
export class GameClient {
  readonly events = new TypedEmitter<GameClientEvents>();
  readonly worldStore = new WorldStateStore();
  readonly clock = new ServerClock();

  status: ConnectionStatus = 'idle';
  room: RoomInfo | null = null;
  playerId: string | null = null;
  slot: number | null = null;
  fatal: FatalError | null = null;
  rttMs: number | null = null;

  private socket: SocketLike | null = null;
  private wanted = false;
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private openToken = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private attempts = 0;
  private seq = 0;
  private pingId = 0;
  private menuOpen = false;
  private autoReadyPending = false;
  private lastError: { code: ErrorCode; message: string } | null = null;
  private resyncAt = -Infinity;

  private readonly codec: MessageCodec;
  private readonly net: Readonly<NetConfig>;
  private readonly now: () => number;

  constructor(private readonly options: GameClientOptions) {
    this.codec = options.codec ?? jsonCodec;
    this.net = options.net ?? NET_CONFIG;
    this.now = options.now ?? (() => performance.now());
  }

  get roomId(): string {
    return this.options.roomId;
  }

  get latestWorld(): NetWorldState | null {
    return this.worldStore.latest;
  }

  get isOpen(): boolean {
    return this.status === 'open';
  }

  // --- lifecycle -----------------------------------------------------------------------------

  connect(): void {
    this.wanted = true;
    if (this.socket || this.openTimer || this.reconnectTimer || this.fatal) return;
    this.openTimer = setTimeout(() => {
      this.openTimer = null;
      void this.open(++this.openToken);
    }, 0);
  }

  /** Closes the socket without leaving the room (the server holds the slot for a while). */
  disconnect(): void {
    this.wanted = false;
    this.openToken += 1;
    if (this.openTimer) clearTimeout(this.openTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.openTimer = this.reconnectTimer = null;
    this.stopPing();
    this.dropSocket(CloseCode.NORMAL, 'client disconnect');
    this.setStatus('idle');
  }

  /** Explicitly leaves the room (frees the slot immediately) and stops reconnecting. */
  leave(): void {
    this.send({ t: 'leave' });
    this.disconnect();
    this.setStatus('closed');
  }

  /** Manual retry after giving up (UNREACHABLE). */
  retry(): void {
    if (this.fatal?.code !== 'UNREACHABLE') return;
    this.fatal = null;
    this.attempts = 0;
    this.connect();
  }

  // --- commands ------------------------------------------------------------------------------

  /** Sends one input frame; returns its sequence number (used by the predictor). */
  sendInput(buttons: number): number {
    this.seq += 1;
    this.send({ t: 'input', seq: this.seq, buttons });
    return this.seq;
  }

  setReady(ready: boolean): void {
    this.send({ t: 'ready', ready });
  }

  selectLevel(levelId: string): void {
    this.send({ t: 'selectLevel', levelId });
  }

  /** Host only, in the lobby. */
  selectMode(mode: GameMode): void {
    this.send({ t: 'selectMode', mode });
  }

  /** Lobby only; the server answers with a room update, or a notice if someone else has it. */
  selectCharacter(characterId: CharacterId): void {
    this.send({ t: 'selectCharacter', characterId });
  }

  /** The pause rule is server-side: the room pauses when every connected player has it open. */
  setMenuOpen(open: boolean): void {
    this.menuOpen = open;
    this.send({ t: 'menu', open });
  }

  dev(cmd: DevCommand): void {
    this.send({ t: 'dev', cmd });
  }

  requestResync(): void {
    const now = this.now();
    if (now - this.resyncAt < 500) return;
    this.resyncAt = now;
    this.send({ t: 'resync' });
  }

  // --- internals -----------------------------------------------------------------------------

  private async open(token: number): Promise<void> {
    let clientId: string;
    try {
      clientId = await this.options.clientId();
    } catch {
      clientId = `anon-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    }
    if (token !== this.openToken || !this.wanted || this.socket) return;

    this.setStatus(this.attempts > 0 ? 'reconnecting' : 'connecting');
    let socket: SocketLike;
    try {
      const url = this.options.url();
      socket = this.options.createSocket ? this.options.createSocket(url) : (new WebSocket(url) as unknown as SocketLike);
    } catch (error) {
      this.fail('UNREACHABLE', `Invalid game server URL: ${String(error)}`);
      return;
    }
    this.socket = socket;
    openSockets += 1;
    socket.onopen = () => {
      const characterId = this.options.character?.() ?? null;
      this.send({
        t: 'join',
        protocol: PROTOCOL_VERSION,
        roomId: this.options.roomId,
        name: this.options.name(),
        clientId,
        ...(characterId ? { characterId } : {}),
      });
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      const message = this.codec.decode(event.data) as ServerMessage | undefined;
      if (message && typeof message === 'object' && 't' in message) this.onMessage(message);
    };
    socket.onclose = (event) => this.onClose(socket, event.code);
    socket.onerror = () => {
      // A close event always follows; reconnect logic lives there.
    };
  }

  private onMessage(message: ServerMessage): void {
    switch (message.t) {
      case 'welcome':
        this.attempts = 0;
        this.playerId = message.playerId;
        this.slot = message.slot;
        this.autoReadyPending = !message.rejoined && (this.options.autoReady ?? false);
        this.setStatus('open');
        this.startPing();
        if (this.menuOpen) this.send({ t: 'menu', open: true });
        this.events.emit('welcome', message);
        break;
      case 'room': {
        this.room = message.room;
        const run = message.room.level?.run ?? 0;
        if (!message.room.level) this.worldStore.reset(0);
        else if (run > this.worldStore.run) this.worldStore.reset(run);
        this.maybeAutoReady(message.room);
        this.events.emit('room', message.room);
        break;
      }
      case 'snapshot': {
        const state = this.worldStore.applySnapshot(message);
        if (!state) break;
        const receivedAt = this.now();
        this.clock.observe(state.tick, receivedAt);
        this.events.emit('world', { run: message.run, state, events: message.events, keyframe: true, receivedAt });
        break;
      }
      case 'delta': {
        const result = this.worldStore.applyDelta(message);
        if (result.kind === 'gap') {
          this.requestResync();
          break;
        }
        if (result.kind === 'stale') break;
        const receivedAt = this.now();
        this.clock.observe(result.state.tick, receivedAt);
        this.events.emit('world', {
          run: message.run,
          state: result.state,
          events: message.events,
          keyframe: false,
          receivedAt,
        });
        break;
      }
      case 'pong': {
        const rtt = Math.max(0, this.now() - message.at);
        this.rttMs = this.rttMs === null ? rtt : this.rttMs + (rtt - this.rttMs) * 0.3;
        this.events.emit('rtt', this.rttMs);
        break;
      }
      case 'error':
        this.lastError = { code: message.code, message: message.message };
        if (FATAL_CODES.has(message.code)) this.fail(message.code, message.message);
        else if (message.code !== 'SERVER_SHUTDOWN') this.events.emit('notice', this.lastError);
        break;
    }
  }

  /** Only the first room update after a fresh join counts (the server sends it right after `welcome`). */
  private maybeAutoReady(room: RoomInfo): void {
    if (!this.autoReadyPending) return;
    this.autoReadyPending = false;
    if (room.phase !== 'lobby') return;
    const me = room.players.find((p) => p.id === this.playerId);
    // Alone, the room has to run the race campaign: co-op needs a team.
    if (me?.isHost && room.mode !== SOLO_GAME_MODE && room.players.length < MODE_CONFIG[room.mode].minPlayers) {
      this.selectMode(SOLO_GAME_MODE);
    }
    if (me && !me.ready) this.setReady(true);
  }

  private onClose(socket: SocketLike, code: number): void {
    if (socket !== this.socket) return;
    this.socket = null;
    openSockets = Math.max(0, openSockets - 1);
    this.stopPing();
    if (!this.wanted) return this.setStatus('idle');
    if (this.fatal) return this.setStatus('closed');
    if (FATAL_CLOSE_CODES.has(code)) {
      const reason = this.lastError ?? { code: 'BAD_REQUEST' as const, message: `Connection rejected (${code}).` };
      this.fail(reason.code, reason.message);
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.attempts += 1;
    if (this.attempts > this.net.client.reconnectAttempts) {
      this.fail('UNREACHABLE', 'Lost connection to the game server.');
      return;
    }
    this.setStatus('reconnecting');
    const delay = Math.min(5000, 300 * 2 ** (this.attempts - 1));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.wanted) void this.open(++this.openToken);
    }, delay);
  }

  private fail(code: FatalError['code'], message: string): void {
    if (this.fatal) return;
    this.fatal = { code, message };
    this.events.emit('fatal', this.fatal);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (!this.socket) this.setStatus('closed');
  }

  private dropSocket(code: number, reason: string): void {
    const socket = this.socket;
    if (!socket) return;
    this.socket = null;
    openSockets = Math.max(0, openSockets - 1);
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    try {
      socket.close(code, reason);
    } catch {
      // already closed
    }
  }

  private send(message: ClientMessage): void {
    const socket = this.socket;
    if (socket && socket.readyState === OPEN) socket.send(this.codec.encode(message));
  }

  private startPing(): void {
    this.stopPing();
    const ping = () => this.send({ t: 'ping', id: ++this.pingId, at: this.now() });
    ping();
    this.pingTimer = setInterval(ping, this.net.client.pingIntervalMs);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.events.emit('status', status);
  }
}
