import { Button, NET_CONFIG, NEUTRAL_INPUT } from '@platformer/shared';
import { describe, expect, it } from 'vitest';
import { InputQueue } from './InputQueue';

const CONFIG = { maxQueue: 30, burstBudget: 6, maxPerTick: 3, stallTicks: 15 } satisfies typeof NET_CONFIG.input;

function drainAll(queue: InputQueue): number[] {
  const applied: number[] = [];
  queue.drain((buttons) => applied.push(buttons));
  return applied;
}

describe('InputQueue', () => {
  it('applies one frame per tick in steady state', () => {
    const queue = new InputQueue(CONFIG);
    for (let seq = 1; seq <= 10; seq++) {
      queue.push(seq, Button.RIGHT);
      expect(drainAll(queue)).toEqual([Button.RIGHT]);
    }
    expect(queue.lastProcessedSeq).toBe(10);
  });

  it('drops duplicate and out-of-order frames', () => {
    const queue = new InputQueue(CONFIG);
    expect(queue.push(2, 0)).toBe(true);
    expect(queue.push(2, 0)).toBe(false);
    expect(queue.push(1, 0)).toBe(false);
    expect(queue.size).toBe(1);
  });

  it('strips unknown button bits', () => {
    const queue = new InputQueue(CONFIG);
    queue.push(1, 0xff);
    expect(drainAll(queue)).toEqual([Button.LEFT | Button.RIGHT | Button.JUMP | Button.DOWN]);
  });

  it('catches up after a burst of late frames, at most maxPerTick per tick', () => {
    const queue = new InputQueue(CONFIG);
    for (let i = 0; i < 4; i++) expect(drainAll(queue)).toEqual([]); // network hiccup: budget builds up
    for (let seq = 1; seq <= 5; seq++) queue.push(seq, Button.JUMP);
    expect(drainAll(queue)).toHaveLength(3);
    expect(drainAll(queue)).toHaveLength(2);
    expect(queue.lastProcessedSeq).toBe(5);
  });

  it('never simulates a client faster than real time', () => {
    const queue = new InputQueue(CONFIG);
    let seq = 0;
    let applied = 0;
    for (let tick = 0; tick < 300; tick++) {
      queue.push(++seq, Button.RIGHT); // a speed-hacking client sends two frames per tick
      queue.push(++seq, Button.RIGHT);
      applied += drainAll(queue).length;
    }
    expect(applied).toBeLessThanOrEqual(300);
    expect(queue.size).toBeLessThanOrEqual(CONFIG.maxQueue);
    expect(queue.dropped).toBeGreaterThan(0);
  });

  it('freezes a silent player, then steps them with neutral input after stallTicks', () => {
    const queue = new InputQueue(CONFIG);
    queue.push(1, Button.RIGHT);
    drainAll(queue);
    for (let i = 0; i < CONFIG.stallTicks; i++) expect(drainAll(queue)).toEqual([]);
    expect(drainAll(queue)).toEqual([NEUTRAL_INPUT]);
    queue.push(2, Button.LEFT);
    expect(drainAll(queue)).toEqual([Button.LEFT]);
  });

  it('forgets everything on reset (new level run or reconnect)', () => {
    const queue = new InputQueue(CONFIG);
    queue.push(50, 0);
    queue.reset();
    expect(queue.size).toBe(0);
    expect(queue.push(1, 0)).toBe(true);
  });

  it('uses sane defaults', () => {
    const { maxPerTick, burstBudget, stallTicks, maxQueue } = NET_CONFIG.input;
    expect(maxPerTick).toBeGreaterThan(1);
    expect(burstBudget).toBeGreaterThanOrEqual(maxPerTick);
    expect(maxQueue).toBeGreaterThan(burstBudget);
    expect(stallTicks).toBeGreaterThan(0);
  });
});
