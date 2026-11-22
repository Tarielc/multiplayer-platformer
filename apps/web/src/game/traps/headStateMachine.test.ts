import type { Dir4 } from '@platformer/shared';
import { describe, expect, it } from 'vitest';
import { createHeadStateMachine, type HeadAnimator } from './headStateMachine';

/** Records what the machine asks for; a clip "plays" until `finish()`. */
function fakeAnimator() {
  const log: string[] = [];
  let playing = false;
  const animator: HeadAnimator = {
    idle: () => {
      log.push('idle');
      playing = false;
    },
    blink: () => {
      log.push('blink');
      playing = true;
    },
    impact: (side: Dir4) => {
      log.push(`impact ${side}`);
      playing = true;
    },
    playing: () => playing,
  };
  return { animator, log, finish: () => (playing = false) };
}

const TIMING = { blinkMinMs: 1000, blinkMaxMs: 2000 };

describe('head state machine', () => {
  it('blinks after a random pause, then goes back to idle when the clip ends', () => {
    const { animator, log, finish } = fakeAnimator();
    const fsm = createHeadStateMachine(animator, () => 0.5, TIMING); // pause = 1500 ms
    fsm.update({ impact: null }, 16);
    expect(fsm.state).toBe('idle');
    fsm.update({ impact: null }, 1400);
    expect(fsm.state).toBe('idle');
    fsm.update({ impact: null }, 100);
    expect(fsm.state).toBe('blink');
    fsm.update({ impact: null }, 50);
    expect(fsm.state).toBe('blink');
    finish();
    fsm.update({ impact: null }, 50);
    expect(fsm.state).toBe('idle');
    expect(log).toEqual(['idle', 'blink', 'idle']);
  });

  it('plays an impact from any state, restarting it on a new hit, with the side passed through', () => {
    const { animator, log, finish } = fakeAnimator();
    const fsm = createHeadStateMachine(animator, () => 0, TIMING);
    fsm.update({ impact: null }, 16);
    fsm.update({ impact: 'left' }, 16);
    expect(fsm.state).toBe('impact');
    // The clip is still playing on the very frame it started.
    fsm.update({ impact: null }, 16);
    expect(fsm.state).toBe('impact');
    fsm.update({ impact: 'up' }, 16);
    expect(log).toEqual(['idle', 'impact left', 'impact up']);
    finish();
    fsm.update({ impact: null }, 16);
    expect(fsm.state).toBe('idle');
    // An impact also cuts a blink short.
    fsm.update({ impact: null }, 1000);
    expect(fsm.state).toBe('blink');
    fsm.update({ impact: 'down' }, 16);
    expect(fsm.state).toBe('impact');
    expect(log.slice(-2)).toEqual(['blink', 'impact down']);
  });
});
