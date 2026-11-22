import type { CharacterId } from '@platformer/shared';
import type { PlayerCue } from './player/PlayerStateMachine';

/** Player-level presentation moments: state-machine cues plus animation frame events. */
export type PlayerCueName = PlayerCue | 'step' | AbilityCueName;

/** Moments of a special ability, emitted by the owner's view as its phase changes. */
export type AbilityCueName = 'healStart' | 'kiss' | 'drone' | 'grow' | 'shrink' | 'tongue' | 'gulp' | 'spit';

export interface PlayerCueEvent {
  cue: PlayerCueName;
  playerId: string;
  characterId: CharacterId;
  isSelf: boolean;
  /** World position (feet). */
  x: number;
  y: number;
}

/** World-level moments from server game events and trap views. */
export type WorldCueName = 'coin' | 'gem' | 'checkpoint' | 'levelComplete' | 'bounce' | 'boxHit' | 'boxBreak' | 'thud' | 'shake' | 'heal' | 'grab' | 'drop' | 'splat';

export interface WorldCueEvent {
  cue: WorldCueName;
  x: number;
  y: number;
  /** The player who caused it is the local player. */
  isSelf: boolean;
}

/**
 * The level scene's presentation bus. Views publish what happened; listeners (sound, effects,
 * camera) react. Nothing on this bus affects gameplay.
 */
export type PresentationEvents = {
  player: PlayerCueEvent;
  world: WorldCueEvent;
};
