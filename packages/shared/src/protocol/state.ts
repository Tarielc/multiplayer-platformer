import type { MovementBody } from '../sim/movement';
import type { NetTrapState } from '../sim/traps/types';

/**
 * Network view of one player. Carries the *full* movement state (timers included) so the
 * owning client can reconcile exactly, plus gameplay state for rendering and the HUD.
 */
export interface NetPlayerState {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  grounded: boolean;
  jumpHeld: boolean;
  jumping: boolean;
  coyote: number;
  buffer: number;
  drop: number;
  /** Mid-air jumps left (a decrease while airborne is a double jump). */
  airJumpsLeft: number;
  alive: boolean;
  /** Ticks until respawn while dead. */
  respawnIn: number;
  score: number;
  deaths: number;
  atExit: boolean;
  checkpointId: number | null;
  /** Teleport counter: increments on respawn so clients snap instead of interpolating. */
  tp: number;
  /** Combat state (see `MovementBody`): swing/stun timers in seconds, swing counter. */
  attackHeld: boolean;
  attack: number;
  attackCooldown: number;
  attackSeq: number;
  hurt: number;
  /** Tick of the last step (trap positions follow from ticks; prediction continues from here). */
  stepTick: number;
  /** Hearts left. */
  hp: number;
  /** Traps can't hurt the player before this server tick (they blink until then). */
  invulnUntil: number;
  /** Special ability state (see `MovementBody` and config/abilities.ts). */
  ability: number;
  specialHeld: boolean;
  phase: number;
  phaseTime: number;
  specialCooldown: number;
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
  /** What this player's ability holds: `p:<playerId>`, `b:<boxId>` or ''. */
  grab: string;
  /** Hearts when full (more while in giant form). */
  maxHp: number;
  /** Last input sequence number the server applied for this player. */
  ack: number;
}

/**
 * A box an ability has picked up (it is `taken` in the trap state while it exists here):
 * held by a claw or a tongue, swallowed, falling after a drop, or flying after a spit.
 */
export interface NetPropState {
  /** The box's trap id. */
  id: number;
  variant: 1 | 2 | 3;
  /** Top-left, px. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  state: PropState;
  /** Player holding it ('' when loose). */
  owner: string;
}

export type PropState = 'held' | 'swallowed' | 'falling' | 'flying';

export interface NetWorldState {
  tick: number;
  players: NetPlayerState[];
  /** Ids of collectibles picked up so far this run (sorted). */
  collected: number[];
  /** Traps whose state changed (box hits, falling platforms), sorted by id. */
  traps: NetTrapState[];
  /** Boxes moved by abilities (sorted by id). */
  props: NetPropState[];
}

export type NetPlayerPatch = Partial<NetPlayerState> & { id: string };

export function bodyFromNetState(state: NetPlayerState): MovementBody {
  return {
    x: state.x,
    y: state.y,
    vx: state.vx,
    vy: state.vy,
    facing: state.facing,
    grounded: state.grounded,
    jumpHeld: state.jumpHeld,
    jumping: state.jumping,
    coyote: state.coyote,
    buffer: state.buffer,
    drop: state.drop,
    airJumpsLeft: state.airJumpsLeft,
    alive: state.alive,
    attackHeld: state.attackHeld,
    attack: state.attack,
    attackCooldown: state.attackCooldown,
    attackSeq: state.attackSeq,
    hurt: state.hurt,
    stepTick: state.stepTick,
    ability: state.ability,
    specialHeld: state.specialHeld,
    phase: state.phase,
    phaseTime: state.phaseTime,
    specialCooldown: state.specialCooldown,
    specialSeq: state.specialSeq,
    aim: state.aim,
    reach: state.reach,
    giant: state.giant,
    droneX: state.droneX,
    droneY: state.droneY,
    droneVx: state.droneVx,
    droneVy: state.droneVy,
    cargo: state.cargo,
    held: state.held,
    flight: state.flight,
  };
}
