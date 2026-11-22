import type { MovementBody } from '@platformer/shared';
import type { RemoteSample } from '@/net/Interpolator';

/**
 * What the presentation layer needs to know about a player each frame. The same shape comes
 * from the local predicted body and from interpolated remote samples, so one state machine
 * drives both. Everything is replicated *state* (not one-off events), which keeps late joiners
 * and interpolated players correct.
 */
/** Special-ability state (see `MovementBody`); timers in seconds. */
export interface AbilitySignals {
  phase: number;
  phaseTime: number;
  specialCooldown: number;
  /** Special presses so far (the drone pilot's grab attempts show as claw lunges). */
  specialSeq: number;
  aim: number;
  reach: number;
  giant: number;
  droneX: number;
  droneY: number;
  droneVx: number;
  droneVy: number;
  cargo: number;
  held: number;
  flight: number;
}

export function abilitySignals(s: Readonly<AbilitySignals>): AbilitySignals {
  return {
    phase: s.phase,
    phaseTime: s.phaseTime,
    specialCooldown: s.specialCooldown,
    specialSeq: s.specialSeq,
    aim: s.aim,
    reach: s.reach,
    giant: s.giant,
    droneX: s.droneX,
    droneY: s.droneY,
    droneVx: s.droneVx,
    droneVy: s.droneVy,
    cargo: s.cargo,
    held: s.held,
    flight: s.flight,
  };
}

export interface PlayerSignals extends AbilitySignals {
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
  /** Mid-air jumps left; a decrease while airborne means a double jump. */
  airJumpsLeft: number;
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
    airJumpsLeft: body.airJumpsLeft,
    tp,
    ...abilitySignals(body),
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
    airJumpsLeft: sample.airJumpsLeft,
    tp: sample.tp,
    ...abilitySignals(sample),
  };
}
