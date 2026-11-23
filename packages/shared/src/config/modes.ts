import { resolveCombat, type CompiledCombat } from './combat';
import { ENTITY_CONFIG, type EntityConfig } from './entities';

/**
 * Game modes, picked by the host in the lobby and kept for the whole campaign:
 *
 *  - `coop`: play together. Shared checkpoints, everyone has to reach the trophy, and swings
 *    still shove teammates around, but nothing another player does costs hearts.
 *  - `race`: first to the trophy. Checkpoints are your own. The first finish starts a short
 *    countdown for everyone else; each finisher gets a place and leaves play. Placement points
 *    plus score (fruit, foes) decide the campaign.
 */
export type GameMode = 'coop' | 'race';

export const GAME_MODES: readonly GameMode[] = ['coop', 'race'];

/** Solo play auto-readies past the lobby, so it always runs in this mode. */
export const DEFAULT_GAME_MODE: GameMode = 'coop';

export function isGameMode(value: unknown): value is GameMode {
  return typeof value === 'string' && (GAME_MODES as readonly string[]).includes(value);
}

export interface RaceRules {
  /** After the first player finishes, everyone else has this long to reach the trophy. */
  finishWindowMs: number;
  /** Campaign points for 1st, 2nd, … place (on top of the level score). No place: 0. */
  placePoints: readonly number[];
}

export interface ModeConfig {
  name: string;
  /** One line for the lobby picker. */
  summary: string;
  /** `team`: one touch moves everyone's respawn point. `player`: only yours. */
  checkpointScope: EntityConfig['checkpointScope'];
  /** Swings shove other players. */
  playerHits: boolean;
  /** Giant swings and spat projectiles cost other players hearts (otherwise they only shove). */
  playerDamage: boolean;
  /** Race rules; `null`: everyone has to reach the trophy together. */
  race: RaceRules | null;
}

export const MODE_CONFIG: Readonly<Record<GameMode, Readonly<ModeConfig>>> = {
  coop: {
    name: 'Co-op',
    summary: 'Play together: shared checkpoints, everyone reaches the trophy, no friendly damage.',
    checkpointScope: 'team',
    playerHits: true,
    playerDamage: false,
    race: null,
  },
  race: {
    name: 'Race',
    summary: 'First to the trophy wins. Shove, grab and spit your rivals out of the way.',
    checkpointScope: 'player',
    playerHits: true,
    playerDamage: true,
    // Fruit is worth 10-50 a piece (a level holds up to ~1700), so places weigh about as much
    // as a good haul.
    race: { finishWindowMs: 20_000, placePoints: [300, 200, 100, 50] },
  },
};

/** Campaign points for a race place (1-based); `null` (did not finish) or co-op: 0. */
export function racePoints(place: number | null, mode: GameMode = 'race'): number {
  const race = MODE_CONFIG[mode].race;
  if (!race || place === null || place < 1) return 0;
  return race.placePoints[place - 1] ?? 0;
}

/** The `GameWorldOptions` a mode overrides (spread into the options). */
export interface ModeWorldOptions {
  entities: EntityConfig;
  combat: CompiledCombat;
  playerDamage: boolean;
  race: { finishWindowMs: number } | null;
}

export function modeWorldOptions(mode: GameMode, entities: Readonly<EntityConfig> = ENTITY_CONFIG): ModeWorldOptions {
  const config = MODE_CONFIG[mode];
  return {
    entities: { ...entities, checkpointScope: config.checkpointScope },
    combat: resolveCombat(undefined, { playerHits: config.playerHits }),
    playerDamage: config.playerDamage,
    race: config.race ? { finishWindowMs: config.race.finishWindowMs } : null,
  };
}

/** 1 → "1st", 2 → "2nd", 11 → "11th", … */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
