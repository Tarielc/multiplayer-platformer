import { DEBUG_TILES, debugTilesetDefinition } from '../art/debugTileset';
import { parseTiledLevel, type ParseLevelOptions } from '../level/parse';
import type { TiledMap, TiledObject, TiledProperty, TiledTileLayer, TiledTileset } from '../level/tiled';
import type { LevelData } from '../level/types';

/**
 * Dev tool: turns an ASCII sketch into a valid Tiled JSON map. Used to bootstrap the sample
 * levels and to build compact test fixtures. Real levels should be authored in Tiled.
 */
export type AsciiPropertyValue = string | number | boolean;

export interface AsciiCellContext {
  char: string;
  col: number;
  row: number;
  /** Rows padded to equal width. */
  rows: readonly string[];
}

export interface AsciiObjectSpec {
  type: string;
  /**
   * `feet`: point at the bottom-center of the cell (spawns).
   * `center`: point at the cell center (collectibles).
   * `zone`: rectangle whose bottom edge matches the bottom of the cell.
   */
  anchor: 'feet' | 'center' | 'zone';
  widthTiles?: number;
  heightTiles?: number;
  /** Merge horizontal runs of the same character into one zone. */
  mergeRow?: boolean;
  name?: string;
  properties?: Record<string, AsciiPropertyValue> | ((ctx: AsciiCellContext) => Record<string, AsciiPropertyValue>);
}

export interface AsciiLegendEntry {
  /** Local tile id (or auto-tiling function) painted on `layer`. */
  tile?: number | ((ctx: AsciiCellContext) => number);
  layer?: 'terrain' | 'decor' | 'foreground';
  object?: AsciiObjectSpec;
}

export interface AsciiMapSpec {
  rows: readonly string[];
  /** Legend the `legend` entries are merged over (default: `DEFAULT_ASCII_LEGEND`, debug tiles). */
  baseLegend?: Record<string, AsciiLegendEntry>;
  legend?: Record<string, AsciiLegendEntry>;
  tileSize?: number;
  backgroundColor?: string;
  properties?: Record<string, AsciiPropertyValue>;
  tileset?: TiledTileset;
  /**
   * Extra objects (in pixels) appended to the entities layer after the legend's, for things a
   * character can't express (saw tracks, rock-heads, boxes…). Ids are assigned automatically.
   */
  objects?: ReadonlyArray<Omit<TiledObject, 'id'>>;
}

/** Solid ground: grass on exposed tops, dirt underneath. */
const autoGround = ({ rows, row, col }: AsciiCellContext): number =>
  row > 0 && rows[row - 1]?.[col] === '#' ? DEBUG_TILES.DIRT : DEBUG_TILES.GRASS;

const spawn = (slot: number): AsciiLegendEntry => ({
  object: { type: 'spawn', anchor: 'feet', name: `spawn-${slot + 1}`, properties: { slot } },
});

export const DEFAULT_ASCII_LEGEND: Record<string, AsciiLegendEntry> = {
  '#': { tile: autoGround },
  '=': { tile: DEBUG_TILES.DIRT },
  B: { tile: DEBUG_TILES.BRICK },
  S: { tile: DEBUG_TILES.STONE },
  X: { tile: DEBUG_TILES.CRATE },
  I: { tile: DEBUG_TILES.ICE },
  '-': { tile: DEBUG_TILES.PLANK },
  '^': { tile: DEBUG_TILES.SPIKES },
  ',': { tile: DEBUG_TILES.TUFT, layer: 'decor' },
  '*': { tile: DEBUG_TILES.FLOWER, layer: 'decor' },
  '>': { tile: DEBUG_TILES.SIGN, layer: 'decor' },
  w: { tile: DEBUG_TILES.BG_BRICK, layer: 'decor' },
  c: { tile: DEBUG_TILES.CLOUD, layer: 'decor' },
  '1': spawn(0),
  '2': spawn(1),
  '3': spawn(2),
  '4': spawn(3),
  o: { object: { type: 'collectible', anchor: 'center', name: 'coin', properties: { kind: 'coin' } } },
  g: { object: { type: 'collectible', anchor: 'center', name: 'gem', properties: { kind: 'gem' } } },
  C: { object: { type: 'checkpoint', anchor: 'zone', name: 'checkpoint', widthTiles: 1, heightTiles: 2 } },
  E: { object: { type: 'exit', anchor: 'zone', name: 'exit', widthTiles: 1, heightTiles: 2 } },
  L: { object: { type: 'hazard', anchor: 'zone', name: 'lava', heightTiles: 1, mergeRow: true, properties: { style: 'lava' } } },
};

function toProperties(values: Record<string, AsciiPropertyValue> | undefined): TiledProperty[] | undefined {
  if (!values) return undefined;
  const props = Object.entries(values).map(([name, value]): TiledProperty => ({
    name,
    type: typeof value === 'boolean' ? 'bool' : typeof value === 'number' ? (Number.isInteger(value) ? 'int' : 'float') : 'string',
    value,
  }));
  return props.length ? props : undefined;
}

function tileLayer(id: number, name: string, width: number, height: number, data: number[]): TiledTileLayer {
  return { data, height, id, name, opacity: 1, type: 'tilelayer', visible: true, width, x: 0, y: 0 };
}

export function asciiToTiledMap(spec: AsciiMapSpec): TiledMap {
  const ts = spec.tileSize ?? 32;
  const width = Math.max(...spec.rows.map((r) => r.length));
  const height = spec.rows.length;
  const rows = spec.rows.map((r) => r.padEnd(width, ' '));
  const legend = { ...(spec.baseLegend ?? DEFAULT_ASCII_LEGEND), ...spec.legend };
  const tileset = spec.tileset ?? debugTilesetDefinition(1);
  const data = {
    terrain: new Array<number>(width * height).fill(0),
    decor: new Array<number>(width * height).fill(0),
    foreground: new Array<number>(width * height).fill(0),
  };
  const objects: TiledObject[] = [];
  let nextObjectId = 1;

  for (let row = 0; row < height; row++) {
    const line = rows[row]!;
    for (let col = 0; col < width; col++) {
      const char = line[col]!;
      if (char === ' ' || char === '.') continue;
      const entry = legend[char];
      if (!entry) throw new Error(`asciiToTiledMap: unknown character "${char}" at row ${row}, col ${col}`);
      const ctx: AsciiCellContext = { char, col, row, rows };
      if (entry.tile !== undefined) {
        const id = typeof entry.tile === 'function' ? entry.tile(ctx) : entry.tile;
        data[entry.layer ?? 'terrain'][row * width + col] = tileset.firstgid + id;
      }
      const obj = entry.object;
      if (!obj) continue;
      // Skip cells already covered by a merged zone to the left.
      if (obj.mergeRow && col > 0 && line[col - 1] === char) continue;
      const properties = toProperties(typeof obj.properties === 'function' ? obj.properties(ctx) : obj.properties);
      const base = { id: nextObjectId++, name: obj.name ?? obj.type, type: obj.type, rotation: 0, visible: true };
      if (obj.anchor === 'zone') {
        let w = obj.widthTiles ?? 1;
        if (obj.mergeRow) {
          w = 0;
          while (col + w < width && line[col + w] === char) w++;
        }
        const h = obj.heightTiles ?? 1;
        objects.push({ ...base, x: col * ts, y: (row + 1) * ts - h * ts, width: w * ts, height: h * ts, ...(properties ? { properties } : {}) });
      } else {
        const x = (col + 0.5) * ts;
        const y = obj.anchor === 'feet' ? (row + 1) * ts : (row + 0.5) * ts;
        objects.push({ ...base, x, y, width: 0, height: 0, point: true, ...(properties ? { properties } : {}) });
      }
    }
  }

  for (const obj of spec.objects ?? []) objects.push({ rotation: 0, visible: true, ...obj, id: nextObjectId++ });

  const layers: TiledMap['layers'] = [tileLayer(1, 'terrain', width, height, data.terrain)];
  if (data.decor.some(Boolean)) layers.unshift(tileLayer(2, 'decor', width, height, data.decor));
  if (data.foreground.some(Boolean)) {
    layers.push({
      ...tileLayer(3, 'foreground', width, height, data.foreground),
      properties: [{ name: 'foreground', type: 'bool', value: true }],
    });
  }
  layers.push({ draworder: 'topdown', id: 4, name: 'entities', objects, opacity: 1, type: 'objectgroup', visible: true, x: 0, y: 0 });

  const map: TiledMap = {
    compressionlevel: -1,
    height,
    infinite: false,
    layers,
    nextlayerid: 5,
    nextobjectid: nextObjectId,
    orientation: 'orthogonal',
    renderorder: 'right-down',
    tiledversion: '1.11.2',
    tileheight: ts,
    tilesets: [tileset],
    tilewidth: ts,
    type: 'map',
    version: '1.10',
    width,
  };
  if (spec.backgroundColor) map.backgroundcolor = spec.backgroundColor;
  const props = toProperties(spec.properties);
  if (props) map.properties = props;
  return map;
}

/** ASCII sketch straight to parsed `LevelData`, for unit tests and quick experiments. */
export function asciiToLevel(spec: AsciiMapSpec, options: Partial<ParseLevelOptions> = {}): LevelData {
  return parseTiledLevel(asciiToTiledMap(spec), { id: 'ascii-level', ...options });
}
