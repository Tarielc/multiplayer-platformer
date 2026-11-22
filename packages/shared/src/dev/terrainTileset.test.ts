import { describe, expect, it } from 'vitest';
import { CellFlag } from '../level/types';
import { asciiToLevel, asciiToTiledMap } from './asciiMap';
import {
  TERRAIN_ASCII_LEGEND,
  TERRAIN_SETS,
  TERRAIN_TILESET,
  terrainSetTiles,
  terrainTileId,
  terrainTilesetDefinition,
  thinTerrainCells,
} from './terrainTileset';

const build = (rows: string[]) =>
  asciiToTiledMap({ rows, baseLegend: TERRAIN_ASCII_LEGEND, tileset: terrainTilesetDefinition(1), tileSize: 16 });

/** Local tile ids of the terrain layer, as rows (0 = empty). */
function tileRows(rows: string[]): number[][] {
  const map = build(rows);
  const layer = map.layers.find((l) => l.type === 'tilelayer' && l.name === 'terrain');
  if (!layer || layer.type !== 'tilelayer' || !Array.isArray(layer.data)) throw new Error('no terrain layer');
  const data = layer.data;
  return Array.from({ length: map.height }, (_, r) =>
    data.slice(r * map.width, (r + 1) * map.width).map((gid) => (gid ? gid - 1 : 0)),
  );
}

const { col: gc, row: gr } = TERRAIN_SETS.grass;
const grass = (dx: number, dy: number) => terrainTileId(gc + dx, gr + dy);

describe('terrain tileset definition', () => {
  const def = terrainTilesetDefinition(1);

  it('matches the image grid', () => {
    expect(def).toMatchObject({ tilewidth: 16, tileheight: 16, columns: 22, imagewidth: 352, imageheight: 176 });
    expect(def.image).toBe(TERRAIN_TILESET.imageFromMaps);
  });

  it('marks every set tile solid except the one-way platforms', () => {
    const props = new Map(def.tiles!.map((t) => [t.id, t.properties?.map((p) => p.name)]));
    for (const [name, set] of Object.entries(TERRAIN_SETS)) {
      const expected = set.kind === 'platform' ? ['oneWay'] : ['collides'];
      for (const id of terrainSetTiles(set)) expect(props.get(id), `${name} tile ${id}`).toEqual(expected);
    }
    // 7 edge sets × 13 + 4 block sets × 11 + 3 platforms × 3, with no tile claimed twice.
    expect(def.tiles).toHaveLength(7 * 13 + 4 * 11 + 3 * 3);
    expect(new Set(def.tiles!.map((t) => t.id)).size).toBe(def.tiles!.length);
  });
});

describe('terrain auto-tiling', () => {
  it('draws a block with corners, edges and center; the map bottom continues the region', () => {
    const t = tileRows(['     ', ' ### ', ' ### ', ' ### ']);
    expect(t[1]!.slice(1, 4)).toEqual([grass(0, 0), grass(1, 0), grass(2, 0)]);
    expect(t[2]!.slice(1, 4)).toEqual([grass(0, 1), grass(1, 1), grass(2, 1)]);
    // Row 3 touches the bottom of the map, so it is not a bottom edge.
    expect(t[3]!.slice(1, 4)).toEqual([grass(0, 1), grass(1, 1), grass(2, 1)]);
  });

  it('picks inner corners facing the empty diagonal', () => {
    const t = tileRows([
      '        ',
      ' ##  ## ',
      ' ###### ',
      ' ###### ',
      '        ',
    ]);
    expect(t[2]![2]).toBe(grass(3, 1)); // empty up-right
    expect(t[2]![5]).toBe(grass(4, 1)); // empty up-left
    const u = tileRows([' ###### ', ' ###### ', ' ##  ## ', '        ']);
    expect(u[1]![2]).toBe(grass(3, 0)); // empty down-right
    expect(u[1]![5]).toBe(grass(4, 0)); // empty down-left
  });

  it('treats different materials as separate regions', () => {
    const t = tileRows(['  ', 'SS', 'SS', '##', '##']);
    const { col, row } = TERRAIN_SETS.stoneWall;
    // Column 0 continues off the map's left edge, so these are plain bottom / top edges.
    expect(t[2]![0]).toBe(terrainTileId(col + 1, row + 2)); // stone bottom edge above the grass
    expect(t[3]![0]).toBe(grass(1, 0)); // grass top below the stone
  });

  it('shapes blocks by their extent', () => {
    const { col, row } = TERRAIN_SETS.steelBlock;
    const t = tileRows([' m mmm m mm ', '       m mm ', '       m    ']);
    expect(t[0]![1]).toBe(terrainTileId(col, row + 1)); // small
    expect(t[0]!.slice(3, 6)).toEqual([0, 1, 2].map((dx) => terrainTileId(col + dx, row))); // beam
    expect([t[0]![7], t[1]![7], t[2]![7]]).toEqual([0, 1, 2].map((dy) => terrainTileId(col + 3, row + dy))); // pillar
    expect([t[0]![9], t[0]![10], t[1]![9], t[1]![10]]).toEqual([
      terrainTileId(col + 1, row + 1),
      terrainTileId(col + 2, row + 1),
      terrainTileId(col + 1, row + 2),
      terrainTileId(col + 2, row + 2),
    ]); // 2×2
  });

  it('caps platforms and repeats the middle', () => {
    const { col, row } = TERRAIN_SETS.woodPlatform;
    const t = tileRows(['-----']);
    expect(t[0]).toEqual([0, 1, 1, 1, 2].map((dx) => terrainTileId(col + dx, row)));
  });

  it('reports strips only one tile thick', () => {
    expect(thinTerrainCells(['    ', ' ## ', ' ## ', '    '])).toEqual([]);
    expect(thinTerrainCells(['    ', ' ## ', '    ']).map((c) => c.col)).toEqual([1, 2]);
    // Platforms and blocks are meant to be thin.
    expect(thinTerrainCells(['    ', ' -- ', ' mm ', '    '])).toEqual([]);
  });
});

describe('terrain levels', () => {
  it('parse into solid and one-way cells with 16 px zones', () => {
    const level = asciiToLevel(
      {
        rows: ['             ', ' 1  ==   E   ', '#############'],
        baseLegend: TERRAIN_ASCII_LEGEND,
        tileset: terrainTilesetDefinition(1),
        tileSize: 16,
      },
      { id: 't' },
    );
    expect(level.tileSize).toBe(16);
    const cell = (c: number, r: number) => level.cells[r * level.widthTiles + c]!;
    expect(cell(0, 2) & CellFlag.SOLID).toBeTruthy();
    expect(cell(4, 1) & CellFlag.ONE_WAY).toBeTruthy();
    expect(cell(4, 1) & CellFlag.SOLID).toBeFalsy();
    expect(level.exits[0]).toMatchObject({ x: 9 * 16, y: 2 * 16 - 64, width: 32, height: 64 });
    expect(level.spawns[0]).toMatchObject({ x: 24, y: 32 });
  });
});
