import { resolveCombat, type CompiledCombat } from './combat';
import { ENTITY_CONFIG, type EntityConfig } from './entities';
import { FOE_TUNING, type FoeCommon, type FoeTuning } from './foes';

/**
 * Game modes, picked by the host in the lobby and kept for the whole campaign:
 *
 *  - `coop`: play together. Shared checkpoints, everyone has to reach the trophy, and swings
 *    still shove teammates around, but nothing another player does costs hearts. Foes get
 *    tougher for every player after the first (see `CoopScaling`).
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

/**
 * Co-op difficulty: every player after the first makes the foes tougher. The team is counted
 * when a level starts, so someone dropping in mid-level makes the next level harder, not this
 * one. Traps and player hearts never change.
 */
export interface CoopScaling {
  /** Foe health grows by this share of its tuned value per extra player (rounded, never below it). */
  foeHpPerPlayer: number;
  /** The same for bosses. */
  bossHpPerPlayer: number;
  /** Foes attack this much more often per extra player (attack cooldowns are divided by 1 + this × extra players). */
  attackRatePerPlayer: number;
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
  /** How foes scale with the team; `null`: always as tuned. */
  scaling: CoopScaling | null;
}

export const MODE_CONFIG: Readonly<Record<GameMode, Readonly<ModeConfig>>> = {
  coop: {
    name: 'Co-op',
    summary: 'Play together: shared checkpoints, everyone reaches the trophy, no friendly damage. Foes toughen up for bigger teams.',
    checkpointScope: 'team',
    playerHits: true,
    playerDamage: false,
    race: null,
    // Two players: chickens, monkeys and bulls take a hit more, the rhino 19 instead of 12.
    // Four: mushrooms and wasps take two hits, the rhino 34 (about two dazes for four
    // players, as 12 is for one).
    scaling: { foeHpPerPlayer: 0.4, bossHpPerPlayer: 0.6, attackRatePerPlayer: 0.15 },
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
    // Rivals share the same foes, so a bigger field doesn't need tougher ones.
    scaling: null,
  },
};

/** Campaign points for a race place (1-based); `null` (did not finish) or co-op: 0. */
export function racePoints(place: number | null, mode: GameMode = 'race'): number {
  const race = MODE_CONFIG[mode].race;
  if (!race || place === null || place < 1) return 0;
  return race.placePoints[place - 1] ?? 0;
}

/**
 * Foe tuning for `players` under `scaling`: health and attack cooldowns change, nothing else
 * (sizes, speeds and reach stay, so the art still lines up). One player, or no scaling: `base`.
 */
export function scaleFoes(
  players: number,
  scaling: Readonly<CoopScaling> | null,
  base: Readonly<FoeTuning> = FOE_TUNING,
): Readonly<FoeTuning> {
  const extra = Math.max(0, Math.floor(players) - 1);
  if (!scaling || extra === 0) return base;
  const health = <T extends FoeCommon>(c: T, perPlayer: number): T => ({
    ...c,
    hp: Math.max(c.hp, Math.round(c.hp * (1 + perPlayer * extra))),
  });
  const foe = <T extends FoeCommon>(c: T): T => health(c, scaling.foeHpPerPlayer);
  const rate = 1 + scaling.attackRatePerPlayer * extra;
  const cooldown = (ms: number): number => Math.round(ms / rate);
  const span = ([min, max]: readonly [number, number]): [number, number] => [cooldown(min), cooldown(max)];
  const attack = <T extends { cooldownMs: number }>(a: T): T => ({ ...a, cooldownMs: cooldown(a.cooldownMs) });
  const { chicken, wasp, monkey, bull, rhino } = base;
  return {
    ...base,
    mushroom: foe(base.mushroom),
    chicken: { ...foe(chicken), peck: attack(chicken.peck) },
    wasp: { ...foe(wasp), shoot: attack(wasp.shoot) },
    monkey: {
      ...foe(monkey),
      throw: attack(monkey.throw),
      wallThrow: attack(monkey.wallThrow),
      melee: attack(monkey.melee),
      wallSwipe: attack(monkey.wallSwipe),
    },
    bull: { ...foe(bull), cooldownMs: cooldown(bull.cooldownMs) },
    rhino: {
      ...health(rhino, scaling.bossHpPerPlayer),
      thinkMs: span(rhino.thinkMs),
      rage: { ...rhino.rage, thinkMs: span(rhino.rage.thinkMs) },
      hornSwipe: attack(rhino.hornSwipe),
    },
  };
}

/** The foe tuning a level runs with in `mode` for a team of `players` (what server and client agree on). */
export function modeFoes(mode: GameMode, players: number): Readonly<FoeTuning> {
  return scaleFoes(players, MODE_CONFIG[mode].scaling);
}

/**
 * One line on how much tougher the foes are, e.g. "Foes scaled for 3 players: 80% more health
 * (boss 120%), attacks 30% more often." `null` when nothing is scaled.
 */
export function scalingSummary(mode: GameMode, players: number): string | null {
  const scaling = MODE_CONFIG[mode].scaling;
  const extra = Math.max(0, Math.floor(players) - 1);
  if (!scaling || extra === 0) return null;
  const pct = (perPlayer: number) => `${Math.round(perPlayer * extra * 100)}%`;
  return (
    `Foes scaled for ${players} players: ${pct(scaling.foeHpPerPlayer)} more health ` +
    `(boss ${pct(scaling.bossHpPerPlayer)}), attacks ${pct(scaling.attackRatePerPlayer)} more often.`
  );
}

/** The `GameWorldOptions` a mode overrides (spread into the options). */
export interface ModeWorldOptions {
  entities: EntityConfig;
  combat: CompiledCombat;
  playerDamage: boolean;
  race: { finishWindowMs: number } | null;
  foes: Readonly<FoeTuning>;
}

/** `players`: the team a level starts with (co-op scales its foes to it). */
export function modeWorldOptions(
  mode: GameMode,
  players = 1,
  entities: Readonly<EntityConfig> = ENTITY_CONFIG,
): ModeWorldOptions {
  const config = MODE_CONFIG[mode];
  return {
    entities: { ...entities, checkpointScope: config.checkpointScope },
    combat: resolveCombat(undefined, { playerHits: config.playerHits }),
    playerDamage: config.playerDamage,
    race: config.race ? { finishWindowMs: config.race.finishWindowMs } : null,
    foes: modeFoes(mode, players),
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
