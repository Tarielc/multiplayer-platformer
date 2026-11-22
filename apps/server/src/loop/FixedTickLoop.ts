import { performance } from 'node:perf_hooks';

export interface FixedTickLoopOptions {
  /** Upper bound of ticks run in one pump before the backlog is dropped. */
  maxCatchUpTicks?: number;
  onLag?: (droppedMs: number) => void;
}

/**
 * Fixed-timestep driver. Node timers are imprecise (≈15.6 ms granularity on Windows), so the
 * loop pumps at half the tick period and runs as many whole ticks as real time demands:
 * the *average* rate is exact even though individual ticks are bursty. Clients absorb the
 * jitter with their interpolation buffer.
 */
export class FixedTickLoop {
  private timer: NodeJS.Timeout | null = null;
  private last = 0;
  private accumulator = 0;
  ticks = 0;

  constructor(
    private readonly tickMs: number,
    private readonly onTick: () => void,
    private readonly options: FixedTickLoopOptions = {},
  ) {}

  get running(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer) return;
    this.last = performance.now();
    this.accumulator = 0;
    this.timer = setInterval(() => this.pump(), Math.max(1, Math.floor(this.tickMs / 2)));
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private pump(): void {
    const now = performance.now();
    this.accumulator += now - this.last;
    this.last = now;
    const max = this.options.maxCatchUpTicks ?? 10;
    let steps = 0;
    while (this.accumulator >= this.tickMs) {
      if (steps >= max) {
        this.options.onLag?.(this.accumulator);
        this.accumulator = 0;
        break;
      }
      this.accumulator -= this.tickMs;
      this.ticks += 1;
      steps += 1;
      this.onTick();
    }
  }
}
