import type { TiledProperty, TiledTileset } from '../level/tiled';
import type { AsciiCellContext, AsciiLegendEntry } from './asciiMap';

/**
 * `terrain-tileset.png`: 16×16 tiles on a 22×11 grid, with empty tiles between the sets.
 * Every tile is solid (`collides`) except the one-way platforms (`oneWay`).
 *
 *   cols 0-4    3 wall/frame sets (stone, wood, jade)          rows 0-2, 4-6, 8-10
 *   cols 6-10   3 ground sets (grass, autumn, candy)           rows 0-2, 4-6, 8-10
 *   cols 12-15  3 block sets (bronze, steel, copper)           rows 0-2, 4-6, 8-10
 *   cols 17-20  gold block set                                 rows 8-10
 *   cols 17-19  3 one-way platforms (gold, wood, metal)        rows 0, 1, 2
 *   cols 17-21  brick wall set                                 rows 4-6
 *
 * Edge sets (walls, ground, brick) are a 3×3 of corners/edges/center plus a 2×2 of inner
 * corners to its right. Block sets hold a 3×1 beam, a 1×3 pillar, a 1×1 block and a 2×2 block.
 * Platforms are a left end, a middle and a right end.
 */
export const TERRAIN_TILESET = {
  name: 'terrain',
  /** Path relative to the shared data directory. */
  file: 'tilesets/terrain-tileset.png',
  /** Path as referenced from a map in data/maps/. */
  imageFromMaps: '../tilesets/terrain-tileset.png',
  tileSize: 16,
  columns: 22,
  rows: 11,
} as const;

export type TerrainSetKind = 'edge' | 'block' | 'platform';

export interface TerrainSet {
  kind: TerrainSetKind;
  /** Top-left tile of the set in the tileset grid. */
  col: number;
  row: number;
}

export const TERRAIN_SETS = {
  stoneWall: { kind: 'edge', col: 0, row: 0 },
  woodWall: { kind: 'edge', col: 0, row: 4 },
  jadeWall: { kind: 'edge', col: 0, row: 8 },
  grass: { kind: 'edge', col: 6, row: 0 },
  autumn: { kind: 'edge', col: 6, row: 4 },
  candy: { kind: 'edge', col: 6, row: 8 },
  brick: { kind: 'edge', col: 17, row: 4 },
  bronzeBlock: { kind: 'block', col: 12, row: 0 },
  steelBlock: { kind: 'block', col: 12, row: 4 },
  copperBlock: { kind: 'block', col: 12, row: 8 },
  goldBlock: { kind: 'block', col: 17, row: 8 },
  goldPlatform: { kind: 'platform', col: 17, row: 0 },
  woodPlatform: { kind: 'platform', col: 17, row: 1 },
  metalPlatform: { kind: 'platform', col: 17, row: 2 },
} as const satisfies Record<string, TerrainSet>;

export type TerrainSetName = keyof typeof TERRAIN_SETS;

/** Local tile id of a tileset grid cell. */
export const terrainTileId = (col: number, row: number): number => row * TERRAIN_TILESET.columns + col;

/** Tileset cells (relative to the set's top-left) that hold art, per set kind. */
const SET_CELLS: Record<TerrainSetKind, ReadonlyArray<readonly [number, number]>> = {
  edge: [
    [0, 0], [1, 0], [2, 0], [3, 0], [4, 0],
    [0, 1], [1, 1], [2, 1], [3, 1], [4, 1],
    [0, 2], [1, 2], [2, 2],
  ],
  block: [
    [0, 0], [1, 0], [2, 0], [3, 0],
    [0, 1], [1, 1], [2, 1], [3, 1],
    [1, 2], [2, 2], [3, 2],
  ],
  platform: [[0, 0], [1, 0], [2, 0]],
};

/** Every local tile id that belongs to `set`. */
export function terrainSetTiles(set: TerrainSet): number[] {
  return SET_CELLS[set.kind].map(([dx, dy]) => terrainTileId(set.col + dx, set.row + dy));
}

/** Embedded Tiled tileset definition: `collides` on every tile, `oneWay` on platforms. */
export function terrainTilesetDefinition(firstgid = 1): TiledTileset {
  const { tileSize, columns, rows } = TERRAIN_TILESET;
  const tiles: NonNullable<TiledTileset['tiles']> = [];
  for (const [name, set] of Object.entries(TERRAIN_SETS) as Array<[TerrainSetName, TerrainSet]>) {
    const property: TiledProperty =
      set.kind === 'platform'
        ? { name: 'oneWay', type: 'bool', value: true }
        : { name: 'collides', type: 'bool', value: true };
    for (const id of terrainSetTiles(set)) tiles.push({ id, type: name, properties: [property] });
  }
  tiles.sort((a, b) => a.id - b.id);
  return {
    firstgid,
    name: TERRAIN_TILESET.name,
    image: TERRAIN_TILESET.imageFromMaps,
    imagewidth: columns * tileSize,
    imageheight: rows * tileSize,
    tilewidth: tileSize,
    tileheight: tileSize,
    tilecount: columns * rows,
    columns,
    margin: 0,
    spacing: 0,
    tiles,
  };
}

// --- auto-tiling -----------------------------------------------------------------------------

/** Whether each neighbor belongs to the same region (cells outside the map count as same). */
export interface Neighbors {
  n: boolean;
  s: boolean;
  e: boolean;
  w: boolean;
  ne: boolean;
  nw: boolean;
  se: boolean;
  sw: boolean;
}

/**
 * Edge sets: exposed sides pick the 3×3 border tile; fully enclosed cells next to an empty
 * diagonal pick the inner corner whose detail points at that diagonal. Regions should be at
 * least 2 tiles thick; a 1-tile strip falls back to the top row / middle column.
 */
export function edgeTile(set: TerrainSet, nb: Neighbors): number {
  const { col, row } = set;
  const top = !nb.n;
  const bottom = !nb.s;
  const left = !nb.w;
  const right = !nb.e;
  if (top || bottom || left || right) {
    const dx = left && !right ? 0 : right && !left ? 2 : 1;
    const dy = top ? 0 : 2 - Number(!bottom);
    return terrainTileId(col + dx, row + dy);
  }
  if (!nb.nw) return terrainTileId(col + 4, row + 1);
  if (!nb.ne) return terrainTileId(col + 3, row + 1);
  if (!nb.sw) return terrainTileId(col + 4, row);
  if (!nb.se) return terrainTileId(col + 3, row);
  return terrainTileId(col + 1, row + 1);
}

/** Size of the same-material run through a cell, and the cell's offset inside it. */
export interface BlockRun {
  width: number;
  height: number;
  /** Offset from the left / top end of the run. */
  dx: number;
  dy: number;
}

/**
 * Block sets, from the rectangle a block occupies: 1×1 small block, a 1-tall run is a beam
 * (ends + repeated middle), a 1-wide run is a pillar, and anything larger repeats the 2×2 block
 * (use even sizes). Keep separate blocks of the same material apart, or they merge.
 */
export function blockTile(set: TerrainSet, run: BlockRun): number {
  const { col, row } = set;
  const end = (offset: number, size: number) => (offset === 0 ? 0 : offset === size - 1 ? 2 : 1);
  if (run.width === 1 && run.height === 1) return terrainTileId(col, row + 1);
  if (run.height === 1) return terrainTileId(col + end(run.dx, run.width), row);
  if (run.width === 1) return terrainTileId(col + 3, row + end(run.dy, run.height));
  return terrainTileId(col + 1 + (run.dx % 2), row + 1 + (run.dy % 2));
}

/** One-way platforms: left end, repeated middle, right end. */
export function platformTile(set: TerrainSet, dx: number, length: number): number {
  const part = length < 2 ? 1 : dx === 0 ? 0 : dx === length - 1 ? 2 : 1;
  return terrainTileId(set.col + part, set.row);
}

// --- ASCII legend --------------------------------------------------------------------------

/** ASCII character for each terrain set, used by `TERRAIN_ASCII_LEGEND`. */
export const TERRAIN_CHARS: Readonly<Record<TerrainSetName, string>> = {
  grass: '#',
  autumn: '%',
  candy: '&',
  stoneWall: 'S',
  woodWall: 'W',
  jadeWall: 'J',
  brick: 'B',
  bronzeBlock: 'x',
  steelBlock: 'm',
  copperBlock: 'k',
  goldBlock: 'Y',
  woodPlatform: '-',
  metalPlatform: '=',
  goldPlatform: '~',
};

function sameAt(ctx: AsciiCellContext, col: number, row: number): boolean {
  const line = ctx.rows[row];
  // Outside the map counts as the same material, so regions run cleanly off the edges.
  if (line === undefined || col < 0 || col >= line.length) return true;
  return line[col] === ctx.char;
}

function neighbors(ctx: AsciiCellContext): Neighbors {
  const { col: c, row: r } = ctx;
  return {
    n: sameAt(ctx, c, r - 1),
    s: sameAt(ctx, c, r + 1),
    e: sameAt(ctx, c + 1, r),
    w: sameAt(ctx, c - 1, r),
    ne: sameAt(ctx, c + 1, r - 1),
    nw: sameAt(ctx, c - 1, r - 1),
    se: sameAt(ctx, c + 1, r + 1),
    sw: sameAt(ctx, c - 1, r + 1),
  };
}

/** Run of the cell's character along a row or column, inside the map only. */
function run(ctx: AsciiCellContext, stepX: number, stepY: number): { start: number; size: number } {
  const inside = (col: number, row: number) => ctx.rows[row]?.[col] === ctx.char;
  let back = 0;
  while (inside(ctx.col - stepX * (back + 1), ctx.row - stepY * (back + 1))) back++;
  let forward = 0;
  while (inside(ctx.col + stepX * (forward + 1), ctx.row + stepY * (forward + 1))) forward++;
  return { start: back, size: back + forward + 1 };
}

function terrainEntry(set: TerrainSet): AsciiLegendEntry {
  switch (set.kind) {
    case 'edge':
      return { tile: (ctx) => edgeTile(set, neighbors(ctx)) };
    case 'platform':
      return {
        tile: (ctx) => {
          const h = run(ctx, 1, 0);
          return platformTile(set, h.start, h.size);
        },
      };
    case 'block':
      return {
        tile: (ctx) => {
          const h = run(ctx, 1, 0);
          const v = run(ctx, 0, 1);
          return blockTile(set, { width: h.size, height: v.size, dx: h.start, dy: v.start });
        },
      };
  }
}

const spawn = (slot: number): AsciiLegendEntry => ({
  object: { type: 'spawn', anchor: 'feet', name: `spawn-${slot + 1}`, properties: { slot } },
});

/**
 * Legend for 16 px maps built from the terrain tileset. Use it as `baseLegend` together with
 * `tileset: terrainTilesetDefinition()` and `tileSize: 16`. Checkpoints and exits are 2×4 tiles
 * (32×64 px) and lava zones 2 tiles tall, matching the 32 px legend's sizes in pixels.
 */
export const TERRAIN_ASCII_LEGEND: Record<string, AsciiLegendEntry> = {
  ...Object.fromEntries(
    (Object.entries(TERRAIN_SETS) as Array<[TerrainSetName, TerrainSet]>).map(([name, set]) => [
      TERRAIN_CHARS[name],
      terrainEntry(set),
    ]),
  ),
  '1': spawn(0),
  '2': spawn(1),
  '3': spawn(2),
  '4': spawn(3),
  o: { object: { type: 'collectible', anchor: 'center', name: 'coin', properties: { kind: 'coin' } } },
  g: { object: { type: 'collectible', anchor: 'center', name: 'gem', properties: { kind: 'gem' } } },
  C: { object: { type: 'checkpoint', anchor: 'zone', name: 'checkpoint', widthTiles: 2, heightTiles: 4 } },
  E: { object: { type: 'exit', anchor: 'zone', name: 'exit', widthTiles: 2, heightTiles: 4 } },
  L: { object: { type: 'hazard', anchor: 'zone', name: 'lava', heightTiles: 2, mergeRow: true, properties: { style: 'lava' } } },
  // Spikes pointing up, one strip per horizontal run (other directions: add `spikes` objects).
  '^': { object: { type: 'spikes', anchor: 'zone', name: 'spikes', heightTiles: 1, mergeRow: true } },
};

/**
 * Cells of edge materials in a strip only 1 tile thick, which the 13-tile sets cannot draw
 * cleanly. The sample generator refuses layouts that contain any.
 */
export function thinTerrainCells(rows: readonly string[]): Array<{ col: number; row: number; char: string }> {
  const edgeChars = new Set(
    (Object.entries(TERRAIN_SETS) as Array<[TerrainSetName, TerrainSet]>)
      .filter(([, set]) => set.kind === 'edge')
      .map(([name]) => TERRAIN_CHARS[name]),
  );
  const found: Array<{ col: number; row: number; char: string }> = [];
  rows.forEach((line, row) => {
    [...line].forEach((char, col) => {
      if (!edgeChars.has(char)) return;
      const nb = neighbors({ char, col, row, rows });
      if ((!nb.n && !nb.s) || (!nb.e && !nb.w)) found.push({ col, row, char });
    });
  });
  return found;
}
