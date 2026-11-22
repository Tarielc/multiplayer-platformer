import { describe, expect, it } from 'vitest';
import type { PlayerSignals } from './playerSignals';
import { PlayerStateMachine, type PlayerCue } from './PlayerStateMachine';

const GROUND: PlayerSignals = { alive: true, grounded: true, vx: 0, vy: 0, attack: 0, attackSeq: 0, hurt: 0, airJumpsLeft: 1, tp: 0 };
const DT = 16;

function run(fsm: PlayerStateMachine, signals: Partial<PlayerSignals>, frames = 1): PlayerCue[] {
  const cues: PlayerCue[] = [];
  for (let i = 0; i < frames; i++) cues.push(...fsm.update({ ...GROUND, ...signals }, DT));
  return cues;
}

function started(signals: Partial<PlayerSignals> = {}): PlayerStateMachine {
  const fsm = new PlayerStateMachine();
  expect(run(fsm, signals)).toEqual([]); // first update only seeds
  return fsm;
}

describe('PlayerStateMachine: locomotion', () => {
  it('maps ground speed and vertical velocity to idle, run, jump and fall', () => {
    const fsm = started();
    expect(fsm.state).toBe('idle');
    run(fsm, { vx: 120 });
    expect(fsm.state).toBe('run');
    run(fsm, { grounded: false, vy: -300, vx: 120 });
    expect(fsm.state).toBe('jump');
    run(fsm, { grounded: false, vy: 40 });
    expect(fsm.state).toBe('fall');
    run(fsm, {});
    expect(fsm.state).toBe('idle');
  });

  it('uses hysteresis between run and idle', () => {
    const fsm = started();
    run(fsm, { vx: 15 });
    expect(fsm.state).toBe('idle'); // below the enter speed
    run(fsm, { vx: 25 });
    expect(fsm.state).toBe('run');
    run(fsm, { vx: 15 });
    expect(fsm.state).toBe('run'); // above the exit speed
    run(fsm, { vx: 5 });
    expect(fsm.state).toBe('idle');
  });
});

describe('PlayerStateMachine: actions', () => {
  it('plays attack while the swing lasts and re-enters on a new swing', () => {
    const fsm = started();
    const entries: string[] = [];
    fsm.onChange((c) => entries.push(`${c.to}${c.reentered ? '!' : ''}`));
    expect(run(fsm, { attack: 0.35, attackSeq: 1 })).toEqual(['attack']);
    run(fsm, { attack: 0.2, attackSeq: 1, vx: 100 });
    expect(fsm.state).toBe('attack');
    expect(run(fsm, { attack: 0.35, attackSeq: 2 })).toEqual(['attack']);
    expect(entries).toEqual(['attack', 'attack!']);
    run(fsm, { attack: 0, attackSeq: 2, vx: 100 });
    expect(fsm.state).toBe('run');
  });

  it('does not replay a swing when a misprediction rolls attackSeq back', () => {
    const fsm = started({ attackSeq: 3 });
    run(fsm, { attackSeq: 2 });
    expect(run(fsm, { attackSeq: 3, attack: 0.3 })).toEqual(['attack']);
    expect(fsm.state).toBe('attack');
  });

  it('hurt interrupts an attack and holds while stunned', () => {
    const fsm = started();
    run(fsm, { attack: 0.35, attackSeq: 1 });
    expect(run(fsm, { attack: 0, attackSeq: 1, hurt: 0.3, grounded: false, vy: -300, vx: 260 })).toEqual(['hurt']);
    expect(fsm.state).toBe('hurt');
    run(fsm, { attackSeq: 1, hurt: 0.1, grounded: false, vy: -100 });
    expect(fsm.state).toBe('hurt');
    run(fsm, { attackSeq: 1, hurt: 0, grounded: false, vy: 50 });
    expect(fsm.state).toBe('fall');
  });

  it('does not cue a jump for knockback', () => {
    const fsm = started();
    const cues = run(fsm, { hurt: 0.3, grounded: false, vy: -300 });
    expect(cues).toEqual(['hurt']);
  });

  it('death beats everything; respawn returns to locomotion without a landing cue', () => {
    const fsm = started();
    expect(run(fsm, { alive: false, hurt: 0.3, attackSeq: 1 })).toEqual(['death']);
    expect(fsm.state).toBe('dead');
    run(fsm, { alive: false }, 10);
    expect(fsm.state).toBe('dead');
    expect(run(fsm, { alive: true, grounded: false, vy: 10, tp: 1 })).toEqual(['respawn']);
    expect(fsm.state).toBe('fall');
    expect(run(fsm, { tp: 1 })).toEqual([]); // settling onto the spawn is not a landing
    expect(run(fsm, { tp: 1, grounded: false, vy: -300 })).toEqual(['jump']);
    expect(run(fsm, { tp: 1 })).toEqual(['land']);
  });
});

describe('PlayerStateMachine: cues', () => {
  it('cues jump and land on the right edges, including coyote jumps', () => {
    const fsm = started();
    expect(run(fsm, { grounded: false, vy: -300 })).toEqual(['jump']);
    expect(run(fsm, { grounded: false, vy: -100 })).toEqual([]);
    expect(run(fsm, { grounded: false, vy: 100 })).toEqual([]);
    expect(run(fsm, {})).toEqual(['land']);
    // Walk off a ledge, then jump in the air during coyote time.
    expect(run(fsm, { grounded: false, vy: 20 })).toEqual([]);
    expect(run(fsm, { grounded: false, vy: -300 })).toEqual(['jump']);
  });

  it('cues a double jump and restarts the jump clip, rising or falling', () => {
    const fsm = started();
    const entries: string[] = [];
    fsm.onChange((c) => entries.push(`${c.to}${c.reentered ? '!' : ''}`));
    expect(run(fsm, { grounded: false, vy: -300 })).toEqual(['jump']);
    // Still rising, so only the spent air jump tells it apart from the first jump.
    expect(run(fsm, { grounded: false, vy: -470, airJumpsLeft: 0 })).toEqual(['doubleJump']);
    expect(fsm.state).toBe('jump');
    expect(run(fsm, { grounded: false, vy: 100, airJumpsLeft: 0 })).toEqual([]);
    expect(fsm.state).toBe('fall');
    expect(run(fsm, {})).toEqual(['land']); // landing refills it silently
    // Walk off a ledge and air jump on the way down.
    run(fsm, { grounded: false, vy: 200 });
    expect(run(fsm, { grounded: false, vy: -470, airJumpsLeft: 0 })).toEqual(['doubleJump']);
    expect(entries).toEqual(['jump', 'jump!', 'fall', 'idle', 'fall', 'jump']);
  });

  it('cues only the double jump when a jump and an air jump arrive in one update', () => {
    const fsm = started();
    expect(run(fsm, { grounded: false, vy: -470, airJumpsLeft: 0 })).toEqual(['doubleJump']);
    expect(fsm.state).toBe('jump');
  });

  it('does not cue a double jump for a refill in the air (trampoline) or a respawn', () => {
    const fsm = started({ grounded: false, vy: 100, airJumpsLeft: 0 });
    expect(run(fsm, { grounded: false, vy: -500, airJumpsLeft: 1 })).toEqual(['jump']); // bounce
    run(fsm, { alive: false, airJumpsLeft: 0 });
    expect(run(fsm, { grounded: false, vy: 10, tp: 1, airJumpsLeft: 1 })).toEqual(['respawn']);
  });

  it('keeps an attack or hurt clip showing through an air jump', () => {
    const fsm = started();
    expect(run(fsm, { attack: 0.35, attackSeq: 1, grounded: false, vy: -300 })).toEqual(['attack', 'jump']);
    expect(run(fsm, { attack: 0.3, attackSeq: 1, grounded: false, vy: -470, airJumpsLeft: 0 })).toEqual(['doubleJump']);
    expect(fsm.state).toBe('attack');
  });

  it('starts silently when a player first appears mid-action', () => {
    const fsm = new PlayerStateMachine();
    expect(run(fsm, { attackSeq: 5, attack: 0.2, grounded: false, vy: -100 })).toEqual([]);
    expect(fsm.state).toBe('jump');
    const dead = new PlayerStateMachine();
    expect(run(dead, { alive: false })).toEqual([]);
    expect(dead.state).toBe('dead');
  });
});
