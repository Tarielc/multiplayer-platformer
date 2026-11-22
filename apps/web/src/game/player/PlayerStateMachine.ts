import { StateMachine, type StateChange } from '../fsm/StateMachine';
import type { PlayerSignals } from './playerSignals';

export const PLAYER_STATES = ['idle', 'run', 'jump', 'fall', 'attack', 'hurt', 'dead'] as const;
export type PlayerState = (typeof PLAYER_STATES)[number];

/** One-shot presentation moments (sounds, effects). Derived from signal edges. */
export type PlayerCue = 'jump' | 'doubleJump' | 'land' | 'attack' | 'hurt' | 'death' | 'respawn';

export interface PlayerStateTuning {
  /** Grounded speed (px/s) at which idle becomes run … */
  runEnterSpeed: number;
  /** … and below which run becomes idle again (hysteresis avoids flicker while braking). */
  runExitSpeed: number;
}

export const DEFAULT_PLAYER_STATE_TUNING: Readonly<PlayerStateTuning> = { runEnterSpeed: 20, runExitSpeed: 10 };

interface Frame {
  s: PlayerSignals;
  newSwing: boolean;
  newHit: boolean;
  newAirJump: boolean;
}

const NO_EDGES = { newSwing: false, newHit: false, newAirJump: false } as const;

/**
 * Presentation state machine for one player: turns per-frame `PlayerSignals` into an animation
 * state (idle, run, jump, fall, attack, hurt, dead) and a list of cues.
 *
 * Priority (checked every frame, "any state"): dead > new hit > new swing > new air jump. Attack
 * and Hurt hold while their timers run, then fall back to locomotion; an air jump restarts the
 * Jump clip unless one of them is showing. New swings/hits are detected as *increases* of
 * `attackSeq`/`hurt`, so a misprediction that is rolled back never replays one; air jumps as a
 * *decrease* of `airJumpsLeft` while airborne (landing and bounces refill it).
 *
 * Phaser-free, so it is unit-tested in node.
 */
export class PlayerStateMachine {
  private readonly machine: StateMachine<PlayerState, Frame>;
  private prev: PlayerSignals | null = null;
  private suppressLand = false;

  constructor(private readonly tuning: Readonly<PlayerStateTuning> = DEFAULT_PLAYER_STATE_TUNING) {
    const locomotion = (f: Frame) => this.locomotion(f.s);
    this.machine = new StateMachine<PlayerState, Frame>({
      initial: 'idle',
      anyState: ({ s, newHit, newSwing, newAirJump }, current) => {
        if (!s.alive) return 'dead';
        if (newHit) return { to: 'hurt', reenter: true };
        if (newSwing) return { to: 'attack', reenter: true };
        if (newAirJump && current !== 'attack' && current !== 'hurt') return { to: 'jump', reenter: true };
      },
      states: {
        idle: { update: locomotion },
        run: { update: locomotion },
        jump: { update: locomotion },
        fall: { update: locomotion },
        attack: { update: (f) => (f.s.attack > 0 ? 'attack' : this.locomotion(f.s)) },
        hurt: { update: (f) => (f.s.hurt > 0 ? 'hurt' : this.locomotion(f.s)) },
        dead: { update: (f) => (f.s.alive ? this.locomotion(f.s) : 'dead') },
      },
    });
  }

  get state(): PlayerState {
    return this.machine.state;
  }

  get timeInState(): number {
    return this.machine.timeInState;
  }

  onChange(listener: (change: StateChange<PlayerState>) => void): () => void {
    return this.machine.onChange(listener);
  }

  /**
   * Advances with this frame's signals. Returns the cues that fired. The first call only seeds
   * edge detection (no cues), so a player that appears mid-swing or mid-air doesn't replay it.
   */
  update(s: PlayerSignals, dtMs: number): PlayerCue[] {
    const prev = this.prev;
    this.prev = { ...s };
    if (!prev) {
      this.machine.update({ s, ...NO_EDGES }, dtMs);
      return [];
    }

    const cues: PlayerCue[] = [];
    const respawned = s.alive && (!prev.alive || s.tp !== prev.tp);
    const newHit = s.alive && s.hurt > prev.hurt + 1e-6;
    const newSwing = s.alive && s.attackSeq > prev.attackSeq;

    if (prev.alive && !s.alive) cues.push('death');
    if (respawned) {
      cues.push('respawn');
      this.suppressLand = true; // respawned bodies drop onto the spawn point
    }
    if (newHit) cues.push('hurt');
    if (newSwing) cues.push('attack');
    const newAirJump = s.alive && !respawned && !s.grounded && s.airJumpsLeft < prev.airJumpsLeft;
    if (s.alive && !respawned) {
      // A real jump: velocity turns upward without being knocked back. A remote player's jump
      // and air jump can land in one update; the air jump's cue covers both.
      if (newAirJump) cues.push('doubleJump');
      else if (s.vy < 0 && prev.vy >= 0 && s.hurt <= 0 && !newHit) cues.push('jump');
      if (s.grounded && !prev.grounded) {
        if (this.suppressLand) this.suppressLand = false;
        else cues.push('land');
      }
    }

    this.machine.update({ s, newSwing, newHit, newAirJump }, dtMs);
    return cues;
  }

  private locomotion(s: PlayerSignals): PlayerState {
    if (!s.grounded) return s.vy < 0 ? 'jump' : 'fall';
    const speed = Math.abs(s.vx);
    if (this.machine.state === 'run') return speed < this.tuning.runExitSpeed ? 'idle' : 'run';
    return speed >= this.tuning.runEnterSpeed ? 'run' : 'idle';
  }
}
