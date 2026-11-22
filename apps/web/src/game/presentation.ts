import type { CharacterId } from '@platformer/shared';
import type { PlayerCue } from './player/PlayerStateMachine';

/** Player-level presentation moments: state-machine cues plus animation frame events. */
export type PlayerCueName = PlayerCue | 'step';

export interface PlayerCueEvent {
  cue: PlayerCueName;
  playerId: string;
  characterId: CharacterId;
  isSelf: boolean;
  /** World position (feet). */
  x: number;
  y: number;
}

/** World-level moments from server game events. */
export type WorldCueName = 'coin' | 'gem' | 'checkpoint' | 'levelComplete';

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
