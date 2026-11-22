import type { ServerMessage } from '@platformer/shared';

/**
 * Transport-agnostic view of a client connection. Rooms only see this interface, so they
 * never import `ws` and can be unit-tested with fake connections.
 */
export interface PlayerConnection {
  /** Unique per socket, for logs. */
  readonly id: string;
  readonly remoteAddress: string;
  readonly isOpen: boolean;
  send(message: ServerMessage): void;
  close(code: number, reason: string): void;
}

/** Classic token bucket for per-connection rate limiting. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.last = now();
  }

  take(count = 1): boolean {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.refillPerSecond);
    this.last = t;
    if (this.tokens < count) return false;
    this.tokens -= count;
    return true;
  }
}
