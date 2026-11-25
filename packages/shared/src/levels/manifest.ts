import type { GameMode } from '../config/modes';
import type { MovementTuning } from '../config/movement';

/**
 * The level manifest: one campaign per game mode. To add a level:
 *   1. Save a Tiled JSON map in `packages/shared/data/maps/` (see docs/level-authoring.md).
 *   2. Add an entry below with its `mode`, and point the previous level of that campaign's
 *      `next` at it.
 * Both the server (reads from disk) and the client (fetches /assets/<map>) use this list.
 */
export interface LevelManifestEntry {
  /** Stable id used on the wire and in URLs. */
  id: string;
  /** Display name for the lobby and HUD. */
  name: string;
  /** The campaign it belongs to: only played in this game mode. */
  mode: GameMode;
  /** Tiled JSON path relative to the shared data directory. */
  map: string;
  /** Level that follows this one in its campaign, or `null` to finish the campaign. */
  next: string | null;
  /** Optional per-level movement overrides (e.g. a low-gravity level). */
  tuning?: Partial<MovementTuning>;
  /** Used when the Tiled map has no background color. */
  backgroundColor?: string;
  /**
   * Endless scrolling background tile (`BACKGROUND_TILES`, file in `data/backgrounds/`).
   * Presentation only. Defaults to the first tile.
   */
  background?: string;
}

/** Seamless 64×64 tiles in `packages/shared/data/backgrounds/`, by name. */
export const BACKGROUND_TILES = ['blue', 'peach', 'gray', 'green', 'pink', 'lavender', 'yellow'] as const;
export type BackgroundTile = (typeof BACKGROUND_TILES)[number];

export interface LevelManifest {
  readonly entries: readonly LevelManifestEntry[];
  /** The first entry's id (the first campaign's start). */
  readonly firstLevelId: string;
  get(id: string): LevelManifestEntry | undefined;
  require(id: string): LevelManifestEntry;
  has(id: string): boolean;
  /** The campaign of `mode`, in play order (empty if it has none). */
  campaign(mode: GameMode): readonly LevelManifestEntry[];
  /** Where `mode`'s campaign starts, or `null` if it has none. */
  firstLevelFor(mode: GameMode): string | null;
  /** 0-based position of a level in its campaign, or -1. */
  indexInCampaign(id: string): number;
}

export function defineLevels(entries: readonly LevelManifestEntry[]): LevelManifest {
  if (entries.length === 0) throw new Error('Level manifest is empty');
  const byId = new Map<string, LevelManifestEntry>();
  for (const entry of entries) {
    if (!/^[a-z0-9][a-z0-9-_]*$/i.test(entry.id)) throw new Error(`Invalid level id "${entry.id}"`);
    if (byId.has(entry.id)) throw new Error(`Duplicate level id "${entry.id}"`);
    if (!entry.map.endsWith('.json')) throw new Error(`Level "${entry.id}": map must be a Tiled .json file`);
    byId.set(entry.id, entry);
  }
  const pointedAt = new Set<string>();
  for (const entry of entries) {
    if (entry.next === null) continue;
    const next = byId.get(entry.next);
    if (!next) throw new Error(`Level "${entry.id}": next level "${entry.next}" is not in the manifest`);
    if (next.mode !== entry.mode) {
      throw new Error(`Level "${entry.id}" (${entry.mode}): next level "${entry.next}" belongs to the ${next.mode} campaign`);
    }
    if (pointedAt.has(entry.next)) throw new Error(`Level "${entry.next}" follows more than one level`);
    pointedAt.add(entry.next);
  }
  // Each mode: exactly one start (a level nothing leads to), and its chain reaches every level.
  const campaigns = new Map<GameMode, LevelManifestEntry[]>();
  const modes = [...new Set(entries.map((e) => e.mode))];
  for (const mode of modes) {
    const starts = entries.filter((e) => e.mode === mode && !pointedAt.has(e.id));
    if (starts.length !== 1) {
      throw new Error(`The ${mode} campaign needs exactly one first level (found ${starts.map((e) => `"${e.id}"`).join(', ') || 'none: it loops'})`);
    }
    const chain: LevelManifestEntry[] = [];
    for (let at: LevelManifestEntry | undefined = starts[0]; at; at = at.next ? byId.get(at.next) : undefined) {
      if (chain.includes(at)) throw new Error(`The ${mode} campaign loops back to "${at.id}"`);
      chain.push(at);
    }
    const left = entries.filter((e) => e.mode === mode && !chain.includes(e));
    if (left.length > 0) throw new Error(`The ${mode} campaign never reaches ${left.map((e) => `"${e.id}"`).join(', ')}`);
    campaigns.set(mode, chain);
  }
  return {
    entries,
    firstLevelId: entries[0]!.id,
    get: (id) => byId.get(id),
    has: (id) => byId.has(id),
    require(id) {
      const entry = byId.get(id);
      if (!entry) throw new Error(`Unknown level "${id}"`);
      return entry;
    },
    campaign: (mode) => campaigns.get(mode) ?? [],
    firstLevelFor: (mode) => campaigns.get(mode)?.[0]?.id ?? null,
    indexInCampaign(id) {
      const entry = byId.get(id);
      return entry ? (campaigns.get(entry.mode) ?? []).indexOf(entry) : -1;
    },
  };
}

/**
 * Co-op: three levels built around 2-player button puzzles, then the rhino. Race (and solo
 * play): three levels with several routes to the trophy, every one passable alone.
 */
export const LEVELS = defineLevels([
  { id: 'coop-1', name: 'Meadow Gate', mode: 'coop', map: 'maps/coop-1.json', next: 'coop-2', background: 'green' },
  { id: 'coop-2', name: 'Rust Canyon', mode: 'coop', map: 'maps/coop-2.json', next: 'coop-3', background: 'peach' },
  { id: 'coop-3', name: 'Jade Citadel', mode: 'coop', map: 'maps/coop-3.json', next: 'coop-4', background: 'lavender' },
  { id: 'coop-4', name: 'Rhino Coliseum', mode: 'coop', map: 'maps/coop-4.json', next: null, background: 'gray' },
  { id: 'race-1', name: 'Sunny Sprint', mode: 'race', map: 'maps/race-1.json', next: 'race-2', background: 'yellow' },
  { id: 'race-2', name: 'Ember Gorge', mode: 'race', map: 'maps/race-2.json', next: 'race-3', background: 'blue' },
  { id: 'race-3', name: 'Candy Spire', mode: 'race', map: 'maps/race-3.json', next: null, background: 'pink' },
]);
