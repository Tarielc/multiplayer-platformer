import type { MovementTuning } from '../config/movement';

/**
 * The level manifest. To add a level:
 *   1. Save a Tiled JSON map in `packages/shared/data/maps/` (see docs/level-authoring.md).
 *   2. Add an entry below and point the previous level's `next` at it.
 * Both the server (reads from disk) and the client (fetches /assets/<map>) use this list.
 */
export interface LevelManifestEntry {
  /** Stable id used on the wire and in URLs. */
  id: string;
  /** Display name for the lobby and HUD. */
  name: string;
  /** Tiled JSON path relative to the shared data directory. */
  map: string;
  /** Level that follows this one, or `null` to finish the campaign. */
  next: string | null;
  /** Optional per-level movement overrides (e.g. a low-gravity level). */
  tuning?: Partial<MovementTuning>;
  /** Used when the Tiled map has no background color. */
  backgroundColor?: string;
}

export interface LevelManifest {
  readonly entries: readonly LevelManifestEntry[];
  readonly firstLevelId: string;
  get(id: string): LevelManifestEntry | undefined;
  require(id: string): LevelManifestEntry;
  has(id: string): boolean;
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
  for (const entry of entries) {
    if (entry.next !== null && !byId.has(entry.next)) {
      throw new Error(`Level "${entry.id}": next level "${entry.next}" is not in the manifest`);
    }
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
  };
}

export const LEVELS = defineLevels([
  {
    id: 'level-1',
    name: 'Green Hills',
    map: 'maps/level-1.json',
    next: 'level-2',
  },
  {
    id: 'level-2',
    name: 'Sky Steps',
    map: 'maps/level-2.json',
    next: null,
    // Example of a per-level override: slightly floatier jumps up the tower.
    tuning: { timeToApex: 0.42 },
  },
]);

export const DEFAULT_LEVEL_ID = LEVELS.firstLevelId;
