import type { MovementBody } from '@platformer/shared';
import type { RemoteSample } from '@/net/Interpolator';

/**
 * What the presentation layer needs to know about a player each frame. The same shape comes
 * from the local predicted body and from interpolated remote samples, so one state machine
 * drives both. Everything is replicated *state* (not one-off events), which keeps late joiners
 * and interpolated players correct.
 */
export interface PlayerSignals {
  alive: boolean;
  grounded: boolean;
  vx: number;
  vy: number;
  /** Seconds left in the current swing. */
  attack: number;
  /** Swings started so far; an increase means a new swing. */
  attackSeq: number;
  /** Seconds of hit stun left; an increase means a new hit. */
  hurt: number;
  /** Teleport counter (respawns); a change re-seeds edge detection. */
  tp: number;
}

export function signalsFromBody(body: Readonly<MovementBody>, tp: number): PlayerSignals {
  return {
    alive: body.alive,
    grounded: body.grounded,
    vx: body.vx,
    vy: body.vy,
    attack: body.attack,
    attackSeq: body.attackSeq,
    hurt: body.hurt,
    tp,
  };
}

export function signalsFromSample(sample: Readonly<RemoteSample>): PlayerSignals {
  return {
    alive: sample.alive,
    grounded: sample.grounded,
    vx: sample.vx,
    vy: sample.vy,
    attack: sample.attack,
    attackSeq: sample.attackSeq,
    hurt: sample.hurt,
    tp: sample.tp,
  };
}
