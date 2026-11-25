import { describe, expect, it } from 'vitest';
import { DEBUG_TILES } from '../art/debugTileset';
import { asciiToTiledMap } from '../dev/asciiMap';
import { defineLevels } from '../levels/manifest';
import type { GameMode } from '../config/modes';
import { levelChecksum } from './checksum';
import { LevelFormatError, parseTiledLevel } from './parse';
import type { TiledMap, TiledObject, TiledObjectGroup, TiledTileLayer } from './tiled';
import { CellFlag, type LevelData } from './types';
import { parseAndValidateLevel, validateLevel } from './validate';

//  row 1: coin, gem, checkpoint, exit      row 2: spawns 1-4, planks, spikes
const ROWS = [
  '            ',
  ' o g  C  E  ',
  ' 12  --^ 34 ',
  '############',
];

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const fixture = (rows: string[] = ROWS): TiledMap => asciiToTiledMap({ rows });
const parse = (map: unknown): LevelData => parseTiledLevel(map, { id: 'fixture', name: 'Fixture' });
const cellAt = (level: LevelData, col: number, row: number) => level.cells[row * level.widthTiles + col];

function terrainLayer(map: TiledMap): TiledTileLayer {
  return map.layers.find((l): l is TiledTileLayer => l.type === 'tilelayer' && l.name === 'terrain')!;
}

function entitiesLayer(map: TiledMap): TiledObjectGroup {
  return map.layers.find((l): l is TiledObjectGroup => l.type === 'objectgroup')!;
}

function object(partial: Partial<TiledObject> & { id: number }): TiledObject {
  return { name: '', x: 0, y: 0, width: 0, height: 0, rotation: 0, visible: true, ...partial };
}

describe('parseTiledLevel', () => {
  it('builds collision cells from tileset tile properties', () => {
    const level = parse(fixture());
    expect(level).toMatchObject({ tileSize: 32, widthTiles: 12, heightTiles: 4, widthPx: 384, heightPx: 128 });
    expect(cellAt(level, 0, 3)).toBe(CellFlag.SOLID);
    expect(cellAt(level, 5, 2)).toBe(CellFlag.ONE_WAY);
    expect(cellAt(level, 7, 2)).toBe(CellFlag.HAZARD);
    expect(cellAt(level, 0, 0)).toBe(CellFlag.EMPTY);
  });

  it('reads spawns, collectibles, checkpoints and exits from object layers', () => {
    const level = parse(fixture());
    expect(level.spawns).toEqual([
      { slot: 0, x: 48, y: 96 },
      { slot: 1, x: 80, y: 96 },
      { slot: 2, x: 304, y: 96 },
      { slot: 3, x: 336, y: 96 },
    ]);
    expect(level.collectibles).toMatchObject([
      { kind: 'coin', x: 48, y: 48, value: 10, radius: 11 },
      { kind: 'gem', x: 112, y: 48, value: 50, radius: 12 },
    ]);
    expect(level.checkpoints).toMatchObject([{ x: 192, y: 0, width: 32, height: 64 }]);
    expect(level.exits).toMatchObject([{ x: 288, y: 0, width: 32, height: 64 }]);
    expect(level.extraObjects).toEqual([]);
  });

  it('masks Tiled flip/rotation flags out of tile gids', () => {
    const map = fixture();
    const data = terrainLayer(map).data as number[];
    const index = 3 * 12; // first floor tile
    data[index] = (data[index]! | 0x80000000 | 0x40000000) >>> 0;
    expect(cellAt(parse(map), 0, 3)).toBe(CellFlag.SOLID);
  });

  it('accepts the object class in `class` (Tiled 1.9) or the object name', () => {
    const map = fixture();
    for (const obj of entitiesLayer(map).objects) {
      if (obj.type === 'spawn') {
        obj.class = obj.type;
        delete obj.type;
      }
    }
    entitiesLayer(map).objects.push(object({ id: 90, name: 'Exit', x: 0, y: 0, width: 32, height: 32 }));
    const level = parse(map);
    expect(level.spawns).toHaveLength(4);
    expect(level.exits).toHaveLength(2);
  });

  it('anchors tile objects at their bottom-left corner', () => {
    const map = fixture();
    entitiesLayer(map).objects.push(object({ id: 91, type: 'collectible', gid: 1, x: 100, y: 200, width: 32, height: 32 }));
    const coin = parse(map).collectibles.find((c) => c.id === 91);
    expect(coin).toMatchObject({ x: 116, y: 184, kind: 'coin' });
  });

  it('honours explicit spawn slots and fills the rest in authoring order', () => {
    const map = fixture(['        ', '        ', '########']);
    const spawn = (id: number, x: number, slot?: number) =>
      object({ id, type: 'spawn', x, y: 64, point: true, ...(slot === undefined ? {} : { properties: [{ name: 'slot', type: 'int', value: slot }] }) });
    entitiesLayer(map).objects.push(spawn(1, 40), spawn(2, 80, 0), spawn(3, 120));
    expect(parse(map).spawns).toEqual([
      { slot: 0, x: 80, y: 64 },
      { slot: 1, x: 40, y: 64 },
      { slot: 2, x: 120, y: 64 },
    ]);
  });

  it('turns point checkpoints into default-sized zones standing on the point', () => {
    const map = fixture(['        ', '        ', '########']);
    entitiesLayer(map).objects.push(object({ id: 5, type: 'checkpoint', x: 100, y: 64, point: true }));
    expect(parse(map).checkpoints[0]).toMatchObject({ x: 84, y: 0, width: 32, height: 64 });
  });

  it('makes every painted cell of a collision layer solid (except one-way and hazard tiles)', () => {
    const map = fixture(['        ', '        ', '########']);
    const data = new Array<number>(8 * 3).fill(0);
    data[0] = 1 + DEBUG_TILES.FLOWER; // decorative tile, no properties
    data[1] = 1 + DEBUG_TILES.PLANK; // one-way stays one-way
    map.layers.push({ id: 9, name: 'collision', type: 'tilelayer', width: 8, height: 3, data, opacity: 1, visible: false });
    const level = parse(map);
    expect(cellAt(level, 0, 0)).toBe(CellFlag.SOLID);
    expect(cellAt(level, 1, 0)).toBe(CellFlag.ONE_WAY);
  });

  it('reads objects inside group layers', () => {
    const map = fixture();
    const entities = entitiesLayer(map);
    map.layers = map.layers.filter((l) => l !== entities);
    map.layers.push({ id: 10, name: 'group', type: 'group', opacity: 1, visible: true, layers: [entities] });
    expect(parse(map).spawns).toHaveLength(4);
  });

  it('keeps objects with unknown classes for custom game code', () => {
    const map = fixture();
    entitiesLayer(map).objects.push(
      object({ id: 77, type: 'Spring', x: 10, y: 20, width: 32, height: 16, properties: [{ name: 'power', type: 'float', value: 1.5 }] }),
    );
    expect(parse(map).extraObjects).toEqual([
      { id: 77, kind: 'spring', name: '', x: 10, y: 20, width: 32, height: 16, properties: { power: 1.5 } },
    ]);
  });

  describe('rejects unsupported maps with actionable errors', () => {
    const cases: Array<[string, (map: TiledMap) => unknown, RegExp]> = [
      ['infinite maps', (m) => ({ ...m, infinite: true }), /Infinite/],
      ['chunked layer data', (m) => (Object.assign(terrainLayer(m), { chunks: [] }), m), /chunks/],
      ['base64 layer data', (m) => (Object.assign(terrainLayer(m), { data: 'AAAA', encoding: 'base64' }), m), /CSV/],
      ['external tilesets', (m) => ({ ...m, tilesets: [{ firstgid: 1, source: '../tiles.tsj' }] }), /Embed/],
      ['non-square tiles', (m) => ({ ...m, tileheight: 16 }), /square/],
      ['non-orthogonal maps', (m) => ({ ...m, orientation: 'isometric' }), /orthogonal/],
      ['wrong layer sizes', (m) => (Object.assign(terrainLayer(m), { data: [1, 2, 3] }), m), /expected/],
      ['JSON that is not a map', () => ({ hello: 'world' }), /layers/],
      ['non-objects', () => null, /not an object/],
    ];
    it.each(cases)('%s', (_name, mutate, message) => {
      const input = mutate(clone(fixture()));
      expect(() => parse(input)).toThrow(LevelFormatError);
      expect(() => parse(input)).toThrow(message);
    });
  });
});

describe('validateLevel', () => {
  const issues = (rows: string[]) => validateLevel(parse(fixture(rows)));

  it('accepts a complete level', () => {
    expect(issues(ROWS)).toEqual([]);
  });

  it('requires at least one spawn', () => {
    expect(issues(['   E', '####'])).toContainEqual(expect.objectContaining({ severity: 'error', message: expect.stringMatching(/spawn/) }));
  });

  it('warns about missing exits and fewer spawns than players', () => {
    const result = issues(['    ', ' 1  ', '####']);
    expect(result.every((i) => i.severity === 'warning')).toBe(true);
    expect(result.map((i) => i.message).join('\n')).toMatch(/exit/);
    expect(result.map((i) => i.message).join('\n')).toMatch(/Only 1 spawn/);
  });

  it('warns about spawns inside solid tiles and unknown objects', () => {
    const map = fixture(['   E', ' 1  ', '####']);
    entitiesLayer(map).objects.push(object({ id: 50, type: 'spawn', x: 16, y: 96, point: true }), object({ id: 51, type: 'mystery' }));
    const messages = validateLevel(parse(map)).map((i) => i.message).join('\n');
    expect(messages).toMatch(/inside a solid tile/);
    expect(messages).toMatch(/unknown class "mystery"/);
  });
});

describe('parseAndValidateLevel', () => {
  it('turns format errors into error issues', () => {
    const result = parseAndValidateLevel({ ...fixture(), infinite: true }, { id: 'broken' });
    expect(result.level).toBeNull();
    expect(result.issues).toEqual([{ severity: 'error', message: expect.stringMatching(/Infinite/) }]);
  });

  it('rejects levels with validation errors but keeps levels with warnings', () => {
    expect(parseAndValidateLevel(fixture(['   E', '####']), { id: 'x' }).level).toBeNull();
    expect(parseAndValidateLevel(fixture([' 1  ', '####']), { id: 'x' }).level).not.toBeNull();
  });
});

describe('levelChecksum', () => {
  it('is stable for identical input', () => {
    expect(levelChecksum(parse(fixture()))).toBe(levelChecksum(parse(clone(fixture()))));
  });

  it('changes when gameplay data changes', () => {
    const moved = ROWS.map((row, i) => (i === 1 ? ' o  g C  E  ' : row));
    expect(levelChecksum(parse(fixture(moved)))).not.toBe(levelChecksum(parse(fixture())));
  });

  it('ignores purely decorative changes', () => {
    const decorated = ROWS.map((row, i) => (i === 0 ? '  * ,   *   ' : row));
    expect(levelChecksum(parse(fixture(decorated)))).toBe(levelChecksum(parse(fixture())));
  });
});

describe('defineLevels', () => {
  const entry = (id: string, next: string | null = null, mode: GameMode = 'coop') => ({ id, name: id, mode, map: `maps/${id}.json`, next });

  it('links levels and exposes the first one', () => {
    const levels = defineLevels([entry('a', 'b'), entry('b')]);
    expect(levels.firstLevelId).toBe('a');
    expect(levels.require('a').next).toBe('b');
    expect(levels.has('c')).toBe(false);
    expect(() => levels.require('c')).toThrow(/Unknown level/);
  });

  it('rejects broken manifests', () => {
    expect(() => defineLevels([])).toThrow(/empty/);
    expect(() => defineLevels([entry('a'), entry('a')])).toThrow(/Duplicate/);
    expect(() => defineLevels([entry('a', 'missing')])).toThrow(/not in the manifest/);
    expect(() => defineLevels([entry('bad id')])).toThrow(/Invalid level id/);
    expect(() => defineLevels([{ ...entry('a'), map: 'maps/a.tmx' }])).toThrow(/\.json/);
  });

  it('keeps one campaign per mode, in play order', () => {
    const levels = defineLevels([entry('c2', null), entry('r1', 'r2', 'race'), entry('c1', 'c2'), entry('r2', null, 'race')]);
    expect(levels.campaign('coop').map((e) => e.id)).toEqual(['c1', 'c2']);
    expect(levels.campaign('race').map((e) => e.id)).toEqual(['r1', 'r2']);
    expect(levels.firstLevelFor('coop')).toBe('c1');
    expect(levels.firstLevelFor('race')).toBe('r1');
    expect(levels.indexInCampaign('c2')).toBe(1);
    expect(levels.indexInCampaign('r1')).toBe(0);
    expect(levels.indexInCampaign('nope')).toBe(-1);
    expect(defineLevels([entry('a')]).firstLevelFor('race')).toBeNull();
  });

  it('rejects campaigns that cross modes, fork, loop or leave levels out', () => {
    expect(() => defineLevels([entry('a', 'b'), entry('b', null, 'race')])).toThrow(/race campaign/);
    expect(() => defineLevels([entry('a', 'c'), entry('b', 'c'), entry('c')])).toThrow(/more than one level/);
    expect(() => defineLevels([entry('a'), entry('b')])).toThrow(/exactly one first level/);
    expect(() => defineLevels([entry('a', 'b'), entry('b', 'a')])).toThrow(/exactly one first level/);
    expect(() => defineLevels([entry('a'), entry('b', 'c'), entry('c', 'b')])).toThrow(/never reaches/);
  });
});
