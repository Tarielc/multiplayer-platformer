import { Button, NEUTRAL_INPUT, sanitizeButtons, type NetConfig } from '@platformer/shared';

interface InputFrame {
  seq: number;
  buttons: number;
}

/**
 * Buttons that act on a *press* (edge-detected by the simulation). Stall steps keep them as they
 * last were: releasing them would turn the same button, still held when input resumes, into a
 * fresh press, i.e. a phantom double jump, swing or special after every lag spike.
 */
const EDGE_BUTTONS = Button.JUMP | Button.ATTACK | Button.SPECIAL;

/**
 * Per-player input buffer consumed by the server's fixed tick.
 *
 * - Every client frame carries a sequence number; duplicates/out-of-order frames are dropped.
 * - Each tick refills a budget by 1 (capped at `burstBudget`) and consumes up to
 *   `maxPerTick` frames while budget remains. Late frames after jitter are caught up, but a
 *   client can never simulate faster than real time (speed-hack protection).
 * - With no input the player is frozen (keeps prediction exact). After `stallTicks` without
 *   input (tab hidden, network stall) the player is stepped without movement input so they
 *   still fall and don't hang in mid-air for everyone else. Jump and Attack stay as they last
 *   were (see `EDGE_BUTTONS`).
 */
export class InputQueue {
  private queue: InputFrame[] = [];
  private budget = 0;
  private idleTicks = 0;
  /** Buttons of the last applied frame. */
  private lastButtons = NEUTRAL_INPUT;
  lastReceivedSeq = 0;
  lastProcessedSeq = 0;
  dropped = 0;

  constructor(private readonly config: NetConfig['input']) {}

  get size(): number {
    return this.queue.length;
  }

  reset(): void {
    this.queue = [];
    this.budget = 0;
    this.idleTicks = 0;
    this.lastButtons = NEUTRAL_INPUT;
    this.lastReceivedSeq = 0;
    this.lastProcessedSeq = 0;
  }

  push(seq: number, buttons: number): boolean {
    if (seq <= this.lastReceivedSeq) return false;
    this.lastReceivedSeq = seq;
    this.queue.push({ seq, buttons: sanitizeButtons(buttons) });
    const overflow = this.queue.length - this.config.maxQueue;
    if (overflow > 0) {
      this.queue.splice(0, overflow);
      this.dropped += overflow;
    }
    return true;
  }

  /** Runs once per server tick. Calls `apply` for every frame to simulate; returns the step count. */
  drain(apply: (buttons: number) => void): number {
    this.budget = Math.min(this.budget + 1, this.config.burstBudget);
    let processed = 0;
    while (this.queue.length > 0 && this.budget >= 1 && processed < this.config.maxPerTick) {
      const frame = this.queue.shift()!;
      this.budget -= 1;
      processed += 1;
      this.lastProcessedSeq = frame.seq;
      this.lastButtons = frame.buttons;
      apply(frame.buttons);
    }
    if (processed > 0) {
      this.idleTicks = 0;
      return processed;
    }
    this.idleTicks += 1;
    if (this.idleTicks > this.config.stallTicks) {
      apply(this.lastButtons & EDGE_BUTTONS);
      return 1;
    }
    return 0;
  }
}
