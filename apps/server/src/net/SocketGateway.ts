import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  CloseCode,
  NET_CONFIG,
  PROTOCOL_VERSION,
  jsonCodec,
  parseClientMessage,
  type ClientMessageOf,
  type MessageCodec,
  type NetConfig,
} from '@platformer/shared';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { Logger } from '../log';
import type { Room } from '../rooms/Room';
import type { RoomManager } from '../rooms/RoomManager';
import { TokenBucket } from './connection';
import { WsConnection } from './WsConnection';

export interface SocketGatewayOptions {
  rooms: RoomManager;
  log: Logger;
  /** Browser origins allowed to open sockets; `null` allows any. Non-browser clients send none. */
  allowedOrigins: string[] | null;
  path?: string;
  codec?: MessageCodec;
  limits?: NetConfig['limits'];
  tickRate?: number;
}

interface Session {
  readonly conn: WsConnection;
  room: Room | null;
  playerId: string | null;
  strikes: number;
  readonly control: TokenBucket;
  readonly inputs: TokenBucket;
  joinTimer: NodeJS.Timeout | null;
}

const JOIN_TIMEOUT_MS = 10_000;

/**
 * WebSocket edge: origin check, decoding + validation of untrusted messages, rate limits,
 * heartbeats, and routing of valid messages to the player's room.
 */
export class SocketGateway {
  private readonly wss: WebSocketServer;
  private readonly sessions = new Set<Session>();
  private readonly heartbeat: NodeJS.Timeout;
  private readonly codec: MessageCodec;
  private readonly limits: NetConfig['limits'];
  private readonly path: string;
  private readonly tickRate: number;
  private counter = 0;

  constructor(private readonly options: SocketGatewayOptions) {
    this.codec = options.codec ?? jsonCodec;
    this.limits = options.limits ?? NET_CONFIG.limits;
    this.path = options.path ?? '/ws';
    this.tickRate = options.tickRate ?? NET_CONFIG.tickRate;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: this.limits.maxMessageBytes, perMessageDeflate: false });
    this.wss.on('connection', (socket: WebSocket, req: IncomingMessage) => this.onConnection(socket, req));
    this.heartbeat = setInterval(() => {
      for (const session of this.sessions) session.conn.heartbeat();
    }, this.limits.heartbeatIntervalMs);
  }

  get connectionCount(): number {
    return this.sessions.size;
  }

  /** Attach with `httpServer.on('upgrade', gateway.handleUpgrade)`. */
  readonly handleUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== this.path) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    const origin = req.headers.origin;
    if (origin && this.options.allowedOrigins && !this.options.allowedOrigins.includes(origin)) {
      this.options.log.warn(`rejected WebSocket from origin ${origin}`);
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req));
  };

  close(): void {
    clearInterval(this.heartbeat);
    for (const session of this.sessions) session.conn.close(CloseCode.SHUTDOWN, 'server shutting down');
    this.wss.close();
  }

  private onConnection(socket: WebSocket, req: IncomingMessage): void {
    const conn = new WsConnection(socket, `c${++this.counter}`, req.socket.remoteAddress ?? 'unknown', this.codec);
    const session: Session = {
      conn,
      room: null,
      playerId: null,
      strikes: 0,
      control: new TokenBucket(this.limits.messagesPerSecond, this.limits.messagesPerSecond),
      // One input per tick plus headroom for bursts after network hiccups.
      inputs: new TokenBucket(this.tickRate * 2, this.tickRate * 1.5),
      joinTimer: setTimeout(() => conn.close(CloseCode.PROTOCOL, 'join timeout'), JOIN_TIMEOUT_MS),
    };
    this.sessions.add(session);
    socket.on('pong', () => {
      conn.alive = true;
    });
    socket.on('message', (data, isBinary) => this.onMessage(session, data, isBinary));
    socket.on('close', () => this.onClose(session));
    socket.on('error', (error) => this.options.log.debug(`${conn.id} socket error: ${error.message}`));
  }

  private onMessage(session: Session, data: RawData, isBinary: boolean): void {
    if (isBinary) return this.strike(session, 'binary frame');
    const message = parseClientMessage(this.codec.decode(rawToString(data)));
    if (!message) return this.strike(session, 'malformed message');
    const bucket = message.t === 'input' ? session.inputs : session.control;
    if (!bucket.take()) return this.strike(session, `rate limit (${message.t})`);

    if (message.t === 'join') return this.join(session, message);
    if (!session.room || !session.playerId) {
      if (message.t === 'ping') {
        session.conn.send({ t: 'pong', id: message.id, at: message.at, serverTick: 0 });
        return;
      }
      return this.strike(session, `"${message.t}" before join`);
    }
    session.room.handle(session.playerId, message);
    if (message.t === 'leave') {
      session.room = null;
      session.playerId = null;
      session.conn.close(CloseCode.NORMAL, 'left');
    }
  }

  private join(session: Session, message: ClientMessageOf<'join'>): void {
    const { conn } = session;
    if (session.room) return this.strike(session, 'duplicate join');
    if (message.protocol !== PROTOCOL_VERSION) {
      conn.send({
        t: 'error',
        code: 'PROTOCOL_MISMATCH',
        message: `Client protocol ${message.protocol} does not match server protocol ${PROTOCOL_VERSION}. Reload the page.`,
      });
      conn.close(CloseCode.PROTOCOL, 'protocol mismatch');
      return;
    }
    const outcome = this.options.rooms.join(conn, message);
    if (!outcome.ok) {
      conn.send({ t: 'error', code: outcome.code, message: outcome.message });
      conn.close(CloseCode.REJECTED, outcome.code);
      return;
    }
    if (session.joinTimer) clearTimeout(session.joinTimer);
    session.joinTimer = null;
    session.room = outcome.room;
    session.playerId = outcome.playerId;
  }

  private onClose(session: Session): void {
    this.sessions.delete(session);
    if (session.joinTimer) clearTimeout(session.joinTimer);
    if (session.room && session.playerId) session.room.disconnect(session.playerId, session.conn);
  }

  private strike(session: Session, reason: string): void {
    session.strikes += 1;
    this.options.log.debug(`${session.conn.id} strike ${session.strikes}: ${reason}`);
    if (session.strikes > this.limits.maxInvalidMessages) {
      this.options.log.warn(`${session.conn.id} (${session.conn.remoteAddress}) dropped: too many invalid messages`);
      session.conn.send({ t: 'error', code: 'BAD_REQUEST', message: 'Too many invalid messages.' });
      session.conn.close(CloseCode.ABUSE, 'abuse');
    }
  }
}

function rawToString(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}
