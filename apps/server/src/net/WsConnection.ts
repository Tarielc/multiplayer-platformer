import { jsonCodec, type MessageCodec, type ServerMessage } from '@platformer/shared';
import { WebSocket } from 'ws';
import type { PlayerConnection } from './connection';

/** Drop clients that can't keep up instead of buffering unbounded data for them. */
const MAX_BUFFERED_BYTES = 1024 * 1024;

export class WsConnection implements PlayerConnection {
  alive = true;

  constructor(
    private readonly socket: WebSocket,
    readonly id: string,
    readonly remoteAddress: string,
    private readonly codec: MessageCodec = jsonCodec,
  ) {}

  get isOpen(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  send(message: ServerMessage): void {
    if (!this.isOpen) return;
    if (this.socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.socket.terminate();
      return;
    }
    this.socket.send(this.codec.encode(message));
  }

  close(code: number, reason: string): void {
    if (this.socket.readyState === WebSocket.CLOSING || this.socket.readyState === WebSocket.CLOSED) return;
    this.socket.close(code, reason);
  }

  /** Heartbeat: returns false (and terminates) if the previous ping got no pong. */
  heartbeat(): boolean {
    if (!this.alive) {
      this.socket.terminate();
      return false;
    }
    this.alive = false;
    this.socket.ping();
    return true;
  }
}
