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
  /** Last input sequence number the server applied for this player. */
  ack: number;
}

export interface NetWorldState {
  tick: number;
  players: NetPlayerState[];
  /** Ids of collectibles picked up so far this run (sorted). */
  collected: number[];
  /** Traps whose state changed (box hits, falling platforms), sorted by id. */
  traps: NetTrapState[];
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
    alive: state.alive,
    attackHeld: state.attackHeld,
    attack: state.attack,
    attackCooldown: state.attackCooldown,
    attackSeq: state.attackSeq,
    hurt: state.hurt,
    stepTick: state.stepTick,
  };
}
