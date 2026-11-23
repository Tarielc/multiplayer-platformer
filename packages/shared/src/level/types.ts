import type { FoeDef } from '../sim/foes/types';
import type { TrapDef } from '../sim/traps/types';
import type { Rect } from '../util/math';
import type { PropertyValue } from './tiled';

/** Per-cell collision flags derived from tile properties / collision layers. */
export const CellFlag = {
  EMPTY: 0,
  SOLID: 1,
  ONE_WAY: 2,
  HAZARD: 4,
} as const;

export interface LevelSpawn {
  slot: number;
  /** Feet position: bottom-center of the player's hitbox. */
  x: number;
  y: number;
}

export interface LevelZone extends Rect {
  id: number;
  name: string;
  properties: Record<string, PropertyValue>;
}

export interface LevelCollectible {
  id: number;
  kind: string;
  /** Center position. */
  x: number;
  y: number;
  value: number;
  radius: number;
}

/** Objects whose class the engine does not know. Kept for custom game code. */
export interface LevelObject extends Rect {
  id: number;
  kind: string;
  name: string;
  properties: Record<string, PropertyValue>;
}

/**
 * Engine-neutral level description shared by the server simulation, client prediction
 * and client rendering of entities. Built from Tiled JSON by `parseTiledLevel`.
 */
export interface LevelData {
  id: string;
  name: string;
  tileSize: number;
  widthTiles: number;
  heightTiles: number;
  widthPx: number;
  heightPx: number;
  /** Row-major `CellFlag` bitfield, length widthTiles * heightTiles. */
  cells: Uint8Array;
  /** Sorted by slot, unique slots. */
  spawns: LevelSpawn[];
  checkpoints: LevelZone[];
  exits: LevelZone[];
  hazards: LevelZone[];
  collectibles: LevelCollectible[];
  /** Traps and interactive entities (sorted by id). See `sim/traps`. */
  traps: TrapDef[];
  /** Foes, where they start (sorted by id). See `sim/foes`. */
  foes: FoeDef[];
  extraObjects: LevelObject[];
  backgroundColor: string | null;
  properties: Record<string, PropertyValue>;
}

export interface LevelIssue {
  severity: 'error' | 'warning';
  message: string;
}
