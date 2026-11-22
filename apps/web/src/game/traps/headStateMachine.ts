import type { Dir4 } from '@platformer/shared';
import { StateMachine } from '../fsm/StateMachine';

/**
 * Animation state machine shared by the rock-head and the spike-head (same sheet layout):
 *
 *   idle ──(random timer)──▶ blink ──(clip done)──▶ idle
 *   any  ──(impact)────────▶ impact(side) ──(clip done)──▶ idle
 *
 * Phaser-free: the view supplies an animator and feeds signals every frame.
 */
export type HeadState = 'idle' | 'blink' | 'impact';

export interface HeadSignals {
  /** A wall (rock-head) or a player (spike-head) hit this side this frame. */
  impact: Dir4 | null;
}

export interface HeadAnimator {
  idle(): void;
  blink(): void;
  /** Left/right hits play the tall squash row, top/bottom hits the wide one. */
  impact(side: Dir4): void;
  /** Whether the clip started last is still playing (asked after a state is entered). */
  playing(): boolean;
}

export interface HeadTiming {
  /** Random pause between blinks, ms. */
  blinkMinMs: number;
  blinkMaxMs: number;
}

export const HEAD_TIMING: HeadTiming = { blinkMinMs: 1600, blinkMaxMs: 4200 };

export function createHeadStateMachine(
  animator: HeadAnimator,
  random: () => number = Math.random,
  timing: HeadTiming = HEAD_TIMING,
): StateMachine<HeadState, HeadSignals> {
  let nextBlinkMs = 0;
  const machine: StateMachine<HeadState, HeadSignals> = new StateMachine<HeadState, HeadSignals>({
    initial: 'idle',
    anyState: (signals) => (signals.impact ? { to: 'impact', reenter: true } : undefined),
    states: {
      idle: {
        enter: () => {
          animator.idle();
          nextBlinkMs = timing.blinkMinMs + random() * (timing.blinkMaxMs - timing.blinkMinMs);
        },
        update: () => (machine.timeInState >= nextBlinkMs ? 'blink' : undefined),
      },
      blink: {
        enter: () => animator.blink(),
        update: () => (animator.playing() ? undefined : 'idle'),
      },
      impact: {
        enter: (signals) => animator.impact(signals.impact ?? 'down'),
        update: () => (animator.playing() ? undefined : 'idle'),
      },
    },
  });
  return machine;
}
