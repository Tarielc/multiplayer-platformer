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

/** Pictures a hint can show (property `image`); each is drawn by the client. */
export const HINT_IMAGES = [
  // Abilities getting a teammate up to a ledge.
  'giant-boost',
  'frog-spit',
  'drone-lift',
  // Controls: a keycap that lights up as a small player does what it does.
  'key-move',
  'key-jump',
  'key-double-jump',
  'key-attack',
  'key-ability',
] as const;
export type HintImage = (typeof HINT_IMAGES)[number];

export function isHintImage(value: unknown): value is HintImage {
  return typeof value === 'string' && (HINT_IMAGES as readonly string[]).includes(value);
}

/**
 * Advice shown in the level (class "hint"): a line of text (property `text`), a picture (property
 * `image`, one of `HINT_IMAGES`), or both. Pure decoration.
 */
export interface LevelHint {
  id: number;
  /** Bottom-centre of the sign, px. */
  x: number;
  y: number;
  text: string;
  /** The picture to show, or null for text only; an unknown name is kept so validation can flag it. */
  image: string | null;
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
  /** Advice drawn in the level by clients; the simulation ignores it. */
  hints: LevelHint[];
  extraObjects: LevelObject[];
  backgroundColor: string | null;
  properties: Record<string, PropertyValue>;
}

export interface LevelIssue {
  severity: 'error' | 'warning';
  message: string;
}
