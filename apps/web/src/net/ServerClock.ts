import { TICK_MS } from '@platformer/shared';

/**
 * Maps server simulation ticks onto local time, for interpolating remote players.
 *
 * Each world update yields a sample `localNow - tick * tickMs`. Late packets make the sample
 * larger, so the estimate follows decreases quickly and increases slowly (tracks the
 * low-latency envelope). Large jumps (pause, countdown, tab sleep, reconnect) reset it.
 */
export class ServerClock {
  private offset: number | null = null;

  constructor(
    private readonly tickMs: number = TICK_MS,
    private readonly resetThresholdMs = 250,
  ) {}

  get ready(): boolean {
    return this.offset !== null;
  }

  reset(): void {
    this.offset = null;
  }

  observe(tick: number, localNow: number): void {
    const sample = localNow - tick * this.tickMs;
    if (this.offset === null || Math.abs(sample - this.offset) > this.resetThresholdMs) {
      this.offset = sample;
      return;
    }
    const rate = sample < this.offset ? 0.25 : 0.02;
    this.offset += (sample - this.offset) * rate;
  }

  /** Estimated (fractional) server tick at `localNow`. */
  tickAt(localNow: number): number {
    return this.offset === null ? 0 : (localNow - this.offset) / this.tickMs;
  }
}
