import { ENTITY_CONFIG, type EntityConfig } from '../config/entities';
import {
  flattenLayers,
  objectKind,
  propertiesToRecord,
  tileGid,
  type TiledMap,
  type TiledObject,
  type TiledTileLayer,
  type TiledTileset,
} from './tiled';
import {
  CellFlag,
  type LevelCollectible,
  type LevelData,
  type LevelObject,
  type LevelSpawn,
  type LevelZone,
} from './types';

export class LevelFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LevelFormatError';
  }
}

export interface ParseLevelOptions {
  id: string;
  name?: string;
  entities?: Readonly<EntityConfig>;
  /** Used when the map has no `backgroundcolor`. */
  backgroundColor?: string;
}

/** Throws a descriptive LevelFormatError if `json` cannot be a Tiled map we support. */
export function assertTiledMap(json: unknown): asserts json is TiledMap {
  if (typeof json !== 'object' || json === null) throw new LevelFormatError('Map JSON is not an object');
  const map = json as Partial<TiledMap>;
  if (!Array.isArray(map.layers)) throw new LevelFormatError('Map has no "layers" array. Is this a Tiled JSON map?');
  if (!Array.isArray(map.tilesets)) throw new LevelFormatError('Map has no "tilesets" array');
  for (const key of ['width', 'height', 'tilewidth', 'tileheight'] as const) {
    if (typeof map[key] !== 'number' || !(map[key]! > 0)) throw new LevelFormatError(`Map "${key}" must be a positive number`);
  }
}

/** Tile gid -> collision flags, from tileset tile properties `collides` / `oneWay` / `hazard`. */
function buildTileFlags(tilesets: readonly TiledTileset[]): Map<number, number> {
  const flags = new Map<number, number>();
  for (const tileset of tilesets) {
    if (tileset.source) {
      throw new LevelFormatError(
        `Tileset "${tileset.source}" is external. Embed it in the map (Tiled: Map > Embed Tilesets); Phaser cannot load external tilesets.`,
      );
    }
    for (const tile of tileset.tiles ?? []) {
      const props = propertiesToRecord(tile.properties);
      let f: number = CellFlag.EMPTY;
      if (props.collides === true || props.solid === true) f |= CellFlag.SOLID;
      if (props.oneWay === true) f |= CellFlag.ONE_WAY;
      if (props.hazard === true) f |= CellFlag.HAZARD;
      if (f !== CellFlag.EMPTY) flags.set(tileset.firstgid + tile.id, f);
    }
  }
  return flags;
}

function readTileData(layer: TiledTileLayer, expected: number): number[] {
  if (layer.chunks) throw new LevelFormatError(`Layer "${layer.name}" uses chunks (infinite map). Disable "Infinite" in map properties.`);
  if (!Array.isArray(layer.data)) {
    throw new LevelFormatError(
      `Layer "${layer.name}" is ${layer.encoding ?? 'encoded'}${layer.compression ? `/${layer.compression}` : ''}. Set "Tile Layer Format" to CSV in Tiled map properties.`,
    );
  }
  if (layer.data.length !== expected) {
    throw new LevelFormatError(`Layer "${layer.name}" has ${layer.data.length} tiles, expected ${expected}`);
  }
  return layer.data;
}

/** Tile objects (with a gid) are anchored bottom-left; everything else top-left. */
function objectTopLeft(obj: TiledObject): { x: number; y: number } {
  return obj.gid ? { x: obj.x, y: obj.y - obj.height } : { x: obj.x, y: obj.y };
}

function toZone(obj: TiledObject, defaults: EntityConfig['zoneDefaults']): LevelZone {
  const { x, y } = objectTopLeft(obj);
  const isPoint = obj.point === true || (obj.width === 0 && obj.height === 0);
  if (isPoint) {
    // A point marks the bottom-center of a default-sized zone (like standing on the ground).
    return {
      id: obj.id,
      name: obj.name,
      x: x - defaults.width / 2,
      y: y - defaults.height,
      width: defaults.width,
      height: defaults.height,
      properties: propertiesToRecord(obj.properties),
    };
  }
  return { id: obj.id, name: obj.name, x, y, width: obj.width, height: obj.height, properties: propertiesToRecord(obj.properties) };
}

export function parseTiledLevel(json: unknown, options: ParseLevelOptions): LevelData {
  assertTiledMap(json);
  const map = json;
  const entities = options.entities ?? ENTITY_CONFIG;

  if (map.infinite) throw new LevelFormatError('Infinite maps are not supported. Disable "Infinite" in Tiled map properties.');
  if (map.orientation !== 'orthogonal') throw new LevelFormatError(`Only orthogonal maps are supported (got "${map.orientation}")`);
  if (map.tilewidth !== map.tileheight) {
    throw new LevelFormatError(`Tiles must be square (got ${map.tilewidth}x${map.tileheight})`);
  }

  const widthTiles = map.width;
  const heightTiles = map.height;
  const tileSize = map.tilewidth;
  const cells = new Uint8Array(widthTiles * heightTiles);
  const tileFlags = buildTileFlags(map.tilesets);

  const spawns: LevelSpawn[] = [];
  const checkpoints: LevelZone[] = [];
  const exits: LevelZone[] = [];
  const hazards: LevelZone[] = [];
  const collectibles: LevelCollectible[] = [];
  const extraObjects: LevelObject[] = [];
  const pendingSpawns: Array<{ slot: number | null; x: number; y: number }> = [];

  for (const { layer } of flattenLayers(map.layers)) {
    if (layer.type === 'tilelayer') {
      const data = readTileData(layer, widthTiles * heightTiles);
      const layerProps = propertiesToRecord(layer.properties);
      // A layer flagged `collision` (or named "collision") makes every painted cell solid.
      const forceSolid = layerProps.collision === true || layer.name.toLowerCase() === 'collision';
      for (let i = 0; i < data.length; i++) {
        const gid = tileGid(data[i] ?? 0);
        if (gid === 0) continue;
        let f = tileFlags.get(gid) ?? CellFlag.EMPTY;
        if (forceSolid && (f & (CellFlag.ONE_WAY | CellFlag.HAZARD)) === 0) f |= CellFlag.SOLID;
        cells[i] = (cells[i] ?? 0) | f;
      }
    } else if (layer.type === 'objectgroup') {
      for (const obj of layer.objects ?? []) {
        const kind = objectKind(obj) || obj.name.trim().toLowerCase();
        const props = propertiesToRecord(obj.properties);
        switch (kind) {
          case 'spawn': {
            const { x, y } = objectTopLeft(obj);
            const isPoint = obj.point === true || (obj.width === 0 && obj.height === 0);
            pendingSpawns.push({
              slot: typeof props.slot === 'number' ? Math.trunc(props.slot) : null,
              x: isPoint ? x : x + obj.width / 2,
              y: isPoint ? y : y + obj.height,
            });
            break;
          }
          case 'checkpoint':
            checkpoints.push(toZone(obj, entities.zoneDefaults));
            break;
          case 'exit':
            exits.push(toZone(obj, entities.zoneDefaults));
            break;
          case 'hazard':
            hazards.push(toZone(obj, entities.zoneDefaults));
            break;
          case 'collectible': {
            const { x, y } = objectTopLeft(obj);
            const itemKind = typeof props.kind === 'string' && props.kind ? props.kind : entities.defaultCollectibleKind;
            const def = entities.collectibles[itemKind] ?? entities.collectibles[entities.defaultCollectibleKind];
            collectibles.push({
              id: obj.id,
              kind: itemKind,
              x: x + obj.width / 2,
              y: y + obj.height / 2,
              value: typeof props.value === 'number' ? props.value : (def?.value ?? 0),
              radius: def?.radius ?? tileSize / 3,
            });
            break;
          }
          default: {
            const { x, y } = objectTopLeft(obj);
            extraObjects.push({ id: obj.id, kind, name: obj.name, x, y, width: obj.width, height: obj.height, properties: props });
          }
        }
      }
    }
  }

  // Explicit `slot` properties win (first one per slot); the rest fill free slots in authoring order.
  const usedSlots = new Set<number>();
  const assigned = pendingSpawns.map(() => false);
  pendingSpawns.forEach((s, i) => {
    if (s.slot !== null && s.slot >= 0 && !usedSlots.has(s.slot)) {
      usedSlots.add(s.slot);
      assigned[i] = true;
      spawns.push({ slot: s.slot, x: s.x, y: s.y });
    }
  });
  let nextSlot = 0;
  pendingSpawns.forEach((s, i) => {
    if (assigned[i]) return;
    while (usedSlots.has(nextSlot)) nextSlot++;
    usedSlots.add(nextSlot);
    spawns.push({ slot: nextSlot, x: s.x, y: s.y });
  });
  spawns.sort((a, b) => a.slot - b.slot);
  checkpoints.sort((a, b) => a.x - b.x);

  const mapProps = propertiesToRecord(map.properties);
  return {
    id: options.id,
    name: options.name ?? options.id,
    tileSize,
    widthTiles,
    heightTiles,
    widthPx: widthTiles * tileSize,
    heightPx: heightTiles * tileSize,
    cells,
    spawns,
    checkpoints,
    exits,
    hazards,
    collectibles,
    extraObjects,
    backgroundColor: map.backgroundcolor ?? (typeof mapProps.backgroundColor === 'string' ? mapProps.backgroundColor : null) ?? options.backgroundColor ?? null,
    properties: mapProps,
  };
}
