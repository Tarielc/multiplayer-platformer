/**
 * Bootstraps the bundled sample content:
 *   packages/shared/data/tilesets/debug-tiles.png   (procedural placeholder tileset, 32 px)
 *   packages/shared/data/maps/level-1.json … level-3.json   (Tiled JSON maps, 16 px terrain tiles)
 *   packages/shared/data/sprites/traps/fan.png   (placeholder fan sheet, only if missing)
 *
 * The levels are built from `terrain-tileset.png` with the auto-tiling ASCII legend in
 * `@platformer/shared/dev` (terrainTileset.ts): edges, corners and inner corners are picked
 * from each cell's neighbors, so layouts here only say *which material goes where*. Traps are
 * Tiled objects placed with `Sketch` helpers in tile coordinates (`s.saw(…)`, `s.box(…)`…),
 * which check that each one fits where it is put.
 *
 * The committed JSON maps are the source of truth: edit them in Tiled. Re-running this
 * script overwrites the sample maps. Usage: npm run samples:generate
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEBUG_TILESET,
  LEVELS,
  TRAP_TUNING,
  levelChecksum,
  paintDebugTileset,
  parseManifestLevel,
  type Dir4,
  type TiledMap,
  type TiledObject,
  type TiledProperty,
} from '@platformer/shared';
import {
  TERRAIN_ASCII_LEGEND,
  TERRAIN_CHARS,
  TERRAIN_SETS,
  TERRAIN_TILESET,
  asciiToTiledMap,
  terrainTilesetDefinition,
  thinTerrainCells,
  type TerrainSetName,
} from '@platformer/shared/dev';
import { paintFanPlaceholder } from './lib/fanPlaceholder';
import { encodePng } from './lib/png';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'packages', 'shared', 'data');

type SetsOfKind<K extends string> = {
  [N in TerrainSetName]: (typeof TERRAIN_SETS)[N]['kind'] extends K ? N : never;
}[TerrainSetName];
/** Materials drawn as auto-tiled regions (ground, walls, brick). */
type EdgeMaterial = SetsOfKind<'edge'>;
type BlockMaterial = SetsOfKind<'block'>;
type PlatformMaterial = SetsOfKind<'platform'>;

const T = TERRAIN_TILESET.tileSize;
const SOLID_CHARS = new Set(
  (Object.keys(TERRAIN_SETS) as TerrainSetName[]).filter((n) => TERRAIN_SETS[n].kind !== 'platform').map((n) => TERRAIN_CHARS[n]),
);
const PLATFORM_CHARS = new Set(
  (Object.keys(TERRAIN_SETS) as TerrainSetName[]).filter((n) => TERRAIN_SETS[n].kind === 'platform').map((n) => TERRAIN_CHARS[n]),
);

type MapObject = Omit<TiledObject, 'id'>;
type ObjectProps = Record<string, number | string>;

/**
 * Tiny drawing surface (one character per 16 px tile) so layouts are described by intent
 * instead of hand-aligned ASCII. Throws on shapes the tileset cannot draw cleanly.
 */
class Sketch {
  private readonly grid: string[][];
  /** Trap objects, in pixels. */
  readonly objects: MapObject[] = [];
  /** Cells taken by traps ("x,y" -> what), so nothing else is put there. */
  private readonly reserved = new Map<string, string>();

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.grid = Array.from({ length: height }, () => Array<string>(width).fill(' '));
  }

  private at(x: number, y: number): string | undefined {
    return this.grid[y]?.[x];
  }

  set(x: number, y: number, ch: string): this {
    const row = this.grid[y];
    if (row && x >= 0 && x < this.width) row[x] = ch;
    return this;
  }

  fill(x: number, y: number, w: number, h: number, ch: string): this {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, ch);
    return this;
  }

  /** Solid ground from column x0..x1 (inclusive), top row `top`, down to the map bottom. */
  ground(x0: number, x1: number, top: number, material: EdgeMaterial = 'grass'): this {
    return this.fill(x0, top, x1 - x0 + 1, this.height - top, TERRAIN_CHARS[material]);
  }

  /** A rectangle of an auto-tiled material (walls, brick, floating ground). */
  solid(material: EdgeMaterial, x: number, y: number, w: number, h: number): this {
    return this.fill(x, y, w, h, TERRAIN_CHARS[material]);
  }

  /**
   * A block: 1×1, a 1-tall beam, a 1-wide pillar, or an even-sized stack of 2×2 blocks.
   * Blocks of one material must not touch, or the auto-tiler would read them as one shape.
   */
  block(material: BlockMaterial, x: number, y: number, w: number, h: number): this {
    if (!(w === 1 || h === 1 || (w % 2 === 0 && h % 2 === 0))) {
      throw new Error(`${material} at (${x}, ${y}): ${w}x${h} is not a beam, pillar or even 2x2 stack`);
    }
    const ch = TERRAIN_CHARS[material];
    for (let yy = y - 1; yy <= y + h; yy++) {
      for (let xx = x - 1; xx <= x + w; xx++) {
        const inside = xx >= x && xx < x + w && yy >= y && yy < y + h;
        if (!inside && this.at(xx, yy) === ch) throw new Error(`${material} at (${x}, ${y}) touches another ${material}`);
      }
    }
    return this.fill(x, y, w, h, ch);
  }

  /** A one-way platform (at least 2 tiles: two end caps). */
  platform(material: PlatformMaterial, x: number, y: number, length: number): this {
    if (length < 2) throw new Error(`${material} at (${x}, ${y}) must be at least 2 tiles long`);
    return this.fill(x, y, length, 1, TERRAIN_CHARS[material]);
  }

  /** Objects (spawns, coins, zones…). Spaces are skipped; objects may only go in empty cells. */
  text(x: number, y: number, str: string): this {
    [...str].forEach((ch, i) => {
      if (ch === ' ') return;
      if (this.at(x + i, y) !== ' ') throw new Error(`"${ch}" at (${x + i}, ${y}) overlaps "${this.at(x + i, y)}"`);
      const trap = this.reserved.get(`${x + i},${y}`);
      if (trap) throw new Error(`"${ch}" at (${x + i}, ${y}) overlaps ${trap}`);
      this.set(x + i, y, ch);
    });
    return this;
  }

  // --- traps (tile coordinates; see docs/level-authoring.md for what each property does) ------

  /** A strip of spikes over `length` cells from (x, y), blades pointing `dir`; solid behind the base. */
  spikes(x: number, y: number, length: number, dir: Dir4 = 'up'): this {
    const along = dir === 'up' || dir === 'down';
    const [w, h] = along ? [length, 1] : [1, length];
    this.claim('spikes', x, y, w, h);
    const [bx, by] = dir === 'up' ? [0, 1] : dir === 'down' ? [0, -1] : dir === 'left' ? [1, 0] : [-1, 0];
    for (let i = 0; i < length; i++) {
      const cx = along ? x + i : x;
      const cy = along ? y : y + i;
      if (!SOLID_CHARS.has(this.at(cx + bx, cy + by) ?? '')) throw new Error(`spikes at (${cx}, ${cy}) have nothing solid behind them`);
    }
    return this.object('spikes', { x: x * T, y: y * T, width: w * T, height: h * T }, dir === 'up' ? {} : { dir });
  }

  /** A trampoline on the floor under cells (x, y) and (x + 1, y). */
  trampoline(x: number, y: number, props: ObjectProps = {}): this {
    this.claim('trampoline', x, y, 2, 1);
    this.needsFloor('trampoline', x, y, 2);
    return this.object('trampoline', { x: (x + 1) * T, y: (y + 1) * T }, props);
  }

  /** A saw whose centre ping-pongs between the centres of tiles (x0, y0) and (x1, y1), on one axis. */
  saw(x0: number, y0: number, x1: number, y1: number, props: ObjectProps = {}): this {
    if (x0 !== x1 && y0 !== y1) throw new Error(`saw (${x0}, ${y0}) -> (${x1}, ${y1}) must run along one axis`);
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
    if (ax === bx && ay === by) return this.object('saw', { x: (ax + 0.5) * T, y: (ay + 0.5) * T }, props);
    if (bx - ax === 1 || by - ay === 1) throw new Error(`saw at (${ax}, ${ay}): a track must be at least 2 tiles long`);
    // The track runs along the rectangle's long axis, through its middle.
    const rect =
      ay === by
        ? { x: (ax + 0.5) * T, y: ay * T, width: (bx - ax) * T, height: T }
        : { x: ax * T, y: (ay + 0.5) * T, width: T, height: (by - ay) * T };
    return this.object('saw', rect, props);
  }

  /** A falling platform over cells (x, y) and (x + 1, y), its top on the cells' top edge. */
  fallingPlatform(x: number, y: number, props: ObjectProps = {}): this {
    this.claim('falling platform', x, y, 2, 1);
    const { width, height } = TRAP_TUNING.fallingPlatform;
    return this.object('fallingPlatform', { x: x * T, y: y * T, width, height }, props);
  }

  /** An upward fan on the floor under cells (x, y) and (x + 1, y); `range` in tiles. */
  fan(x: number, y: number, { range, ...props }: ObjectProps & { range?: number } = {}): this {
    this.claim('fan', x, y, 2, 1);
    this.needsFloor('fan', x, y, 2);
    return this.object('fan', { x: (x + 1) * T, y: (y + 1) * T }, range === undefined ? props : { ...props, range: range * T });
  }

  /** A rock-head filling cells (x..x+1, y..y+1); it slides along `axis` between the walls it finds. */
  rockHead(x: number, y: number, axis: 'x' | 'y', props: ObjectProps = {}): this {
    this.claim('rock-head', x, y, 2, 2);
    const size = TRAP_TUNING.rockHead.size;
    return this.object('rockHead', { x: x * T, y: y * T, width: size, height: size }, { axis, ...props });
  }

  /** A spike-head centred in the 3×3 cells from (x, y). */
  spikeHead(x: number, y: number): this {
    this.claim('spike-head', x, y, 3, 3);
    const size = TRAP_TUNING.spikeHead.size;
    const inset = (3 * T - size) / 2;
    return this.object('spikeHead', { x: x * T + inset, y: y * T + inset, width: size, height: size });
  }

  /** A box (variant 1–3: hits to break) standing on the floor under cell (x, y). */
  box(x: number, y: number, variant: 1 | 2 | 3 = 1): this {
    this.claim(`box${variant}`, x, y, 1, 1);
    this.needsFloor(`box${variant}`, x, y, 1);
    return this.object('box', { x: (x + 0.5) * T, y: (y + 1) * T }, variant === 1 ? {} : { variant });
  }

  private claim(what: string, x: number, y: number, w: number, h: number): void {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const cell = this.at(xx, yy);
        if (cell === undefined) throw new Error(`${what} at (${x}, ${y}) is outside the map`);
        if (cell !== ' ') throw new Error(`${what} at (${x}, ${y}) overlaps "${cell}" at (${xx}, ${yy})`);
        const other = this.reserved.get(`${xx},${yy}`);
        if (other) throw new Error(`${what} at (${x}, ${y}) overlaps ${other}`);
        this.reserved.set(`${xx},${yy}`, what);
      }
    }
  }

  private needsFloor(what: string, x: number, y: number, w: number): void {
    for (let xx = x; xx < x + w; xx++) {
      const below = this.at(xx, y + 1) ?? '';
      if (!SOLID_CHARS.has(below) && !PLATFORM_CHARS.has(below)) throw new Error(`${what} at (${x}, ${y}) has no floor under (${xx}, ${y + 1})`);
    }
  }

  /** A rect (top-left + size) or a point (no size) object, in pixels. */
  private object(type: string, at: { x: number; y: number; width?: number; height?: number }, props: ObjectProps = {}): this {
    const count = this.objects.filter((o) => o.type === type).length + 1;
    const properties = Object.entries(props).map(
      ([name, value]): TiledProperty => ({
        name,
        type: typeof value === 'string' ? 'string' : Number.isInteger(value) ? 'int' : 'float',
        value,
      }),
    );
    const sized = at.width !== undefined && at.height !== undefined;
    this.objects.push({
      name: `${type} ${count}`,
      type,
      x: at.x,
      y: at.y,
      width: at.width ?? 0,
      height: at.height ?? 0,
      ...(sized ? {} : { point: true }),
      ...(properties.length > 0 ? { properties } : {}),
    });
    return this;
  }

  rows(): string[] {
    return this.grid.map((r) => r.join(''));
  }
}

// Level metrics at 16 px tiles (default tuning): a full jump rises 112 px = 7 tiles, ledges up to
// 6 tiles are comfortable, a running jump clears ~10 tiles (8 is comfortable), and the 20×28
// player needs 2×2 tiles of clearance. The double jump adds 80 px = 5 tiles: 12 tiles up from the
// ground, ~16 tiles across with a run.

/**
 * Green Hills (gentle intro): grass, bronze and steel blocks, brick, wood platforms. Traps:
 * boxes, spikes, a saw over the pit, a trampoline to a high ledge, a fan, a box-blocked nook.
 */
function level1(): Sketch {
  const s = new Sketch(150, 36);
  // 1. Start plateau with all four spawns, then two boxes to break or hop over.
  s.ground(0, 23, 28);
  s.text(4, 27, '1 2 3 4');
  s.text(8, 22, 'o o o');
  s.box(15, 27, 1).box(18, 27, 2);
  // 2. Step up (4 tiles) with spikes to hop over.
  s.ground(24, 35, 24);
  s.text(28, 19, 'o o');
  s.spikes(30, 23, 3);
  // 3. Bottomless pit (cols 36-41) with a saw sliding high above it, then 4. an island with a
  //    wood platform above it and a trampoline up to a high ledge.
  s.saw(36, 18, 41, 18, { speed: 60 });
  s.ground(42, 55, 24);
  s.platform('woodPlatform', 44, 18, 8);
  s.text(45, 16, 'o g o');
  s.trampoline(53, 23);
  s.platform('woodPlatform', 52, 11, 5).text(52, 10, 'o o o');
  // 5. Lava trench and bronze blocks.
  s.ground(56, 85, 24);
  s.fill(62, 24, 4, 2, ' ').text(62, 25, 'LLLL');
  s.block('bronzeBlock', 70, 22, 2, 2).text(70, 20, 'o');
  s.block('bronzeBlock', 74, 19, 3, 1).text(75, 17, 'o');
  // 6. Checkpoint, and a fan that lifts you to a ledge too high to jump to.
  s.text(78, 23, 'C');
  s.fan(82, 23);
  s.platform('woodPlatform', 84, 17, 3).text(84, 16, 'o o');
  // 7. Lava basin crossed on wood platforms.
  s.ground(86, 97, 32);
  s.text(86, 31, 'L'.repeat(12));
  s.platform('woodPlatform', 88, 22, 4);
  s.platform('woodPlatform', 94, 20, 4);
  s.text(91, 16, 'g');
  // 8. Final stretch: brick wall, a spiked floor, block stairs, then the exit plateau with a
  //    brick hut whose coin nook is blocked by a 3-hit box.
  s.ground(98, 119, 24);
  s.solid('brick', 104, 20, 4, 4).text(104, 18, 'o  o');
  s.spikes(108, 23, 4);
  s.block('bronzeBlock', 112, 22, 2, 2);
  s.block('steelBlock', 114, 20, 2, 4);
  s.block('bronzeBlock', 116, 18, 2, 6);
  s.ground(118, 149, 18);
  s.text(121, 15, 'o   o');
  s.solid('brick', 128, 13, 8, 3).solid('brick', 134, 16, 2, 2).text(129, 12, 'o  o');
  s.box(128, 17, 3).text(130, 17, 'o o');
  s.text(140, 17, 'E');
  return s;
}

/**
 * Sky Steps (vertical): a stone tower climbed on metal platforms to a jade ledge. Traps: floor
 * spikes, a trampoline and a fan up the open shaft, falling platforms, a vertical saw.
 */
function level2(): Sketch {
  const s = new Sketch(72, 60);
  // Stone walls (2 tiles thick) on a grass floor with a lava pit and spikes.
  s.solid('stoneWall', 0, 0, 2, 54).solid('stoneWall', 70, 0, 2, 54);
  s.ground(0, 71, 54);
  s.text(6, 53, '1 2 3 4');
  s.fill(24, 54, 6, 2, ' ').text(24, 55, 'LLLLLL');
  s.block('steelBlock', 40, 50, 2, 4).text(40, 48, 'o');
  s.spikes(44, 53, 4);
  s.block('steelBlock', 54, 52, 2, 2).text(60, 53, 'o');
  // The open shaft on the right: a trampoline up to a ledge, where a fan lifts you to the
  // checkpoint platform (a shortcut past the first three steps).
  s.trampoline(64, 53);
  s.platform('metalPlatform', 61, 41, 7).text(65, 40, 'o o');
  s.fan(61, 40, { range: 11, onMs: 2500, offMs: 1500 });
  // Zig-zag climb on one-way platforms (each 6 tiles = 96 px up, overlapping the previous one).
  s.platform('metalPlatform', 16, 48, 14).text(21, 47, 'o');
  s.platform('metalPlatform', 26, 42, 14).text(33, 41, 'o');
  s.fallingPlatform(36, 36);
  s.platform('metalPlatform', 39, 36, 11).text(43, 35, 'o');
  s.platform('metalPlatform', 46, 30, 14).text(53, 29, 'g').text(56, 29, 'C');
  // A saw rides up and down through the long platform: cross when it is at either end.
  s.platform('metalPlatform', 32, 24, 18).text(39, 23, 'o');
  s.saw(44, 18, 44, 31);
  // Falling platforms are the only way up from here.
  s.fallingPlatform(30, 18).fallingPlatform(33, 18);
  s.platform('metalPlatform', 20, 18, 8).text(27, 17, 'o');
  s.platform('metalPlatform', 8, 12, 16).text(15, 11, 'o');
  // Exit ledge (solid jade wall) up and to the right of the last platform.
  s.solid('jadeWall', 26, 6, 16, 2);
  s.text(33, 5, 'g').text(37, 5, 'E');
  return s;
}

/**
 * Sunset Ruins (hardest): autumn and candy ground, wood and jade walls, brick, copper and gold
 * blocks. Traps: spiked floors, saws and falling platforms over the lava canyon, boxes,
 * spike-heads guarding ledges, a rock-head crusher in the gatehouse and one sweeping the
 * corridor to the exit (don't get caught against a wall).
 */
function level3(): Sketch {
  const s = new Sketch(160, 40);
  // 1. Autumn start; a wood-walled ruin climbed on gold platforms over a spiked floor.
  s.ground(0, 33, 30, 'autumn');
  s.text(4, 29, '1 2 3 4');
  s.text(12, 25, 'o o o');
  s.platform('goldPlatform', 20, 25, 4);
  s.platform('goldPlatform', 24, 20, 4);
  s.spikes(21, 29, 7);
  s.solid('woodWall', 28, 18, 6, 12).text(29, 16, 'o  o');
  // 2. Lava canyon: a saw sweeps above the copper beam, falling platforms, a saw by the pillar.
  s.ground(34, 61, 38, 'autumn');
  s.text(34, 37, 'L'.repeat(28));
  s.block('copperBlock', 37, 22, 5, 1);
  s.saw(36, 18, 43, 18, { speed: 70 });
  s.block('goldBlock', 45, 20, 2, 2).text(45, 18, 'g');
  s.fallingPlatform(50, 23).fallingPlatform(54, 22);
  s.saw(56, 10, 56, 18);
  s.block('copperBlock', 58, 20, 2, 4);
  // 3. Candy fields: checkpoint, boxes, spikes before the brick wall, then a gold platform up to
  //    the plateau under a spike-head.
  s.ground(62, 99, 26, 'candy');
  s.text(66, 25, 'C').text(70, 23, 'o o');
  s.box(68, 25, 1);
  s.spikes(73, 25, 3);
  s.solid('brick', 76, 21, 6, 5).text(77, 19, 'o  o');
  s.box(84, 25, 2).box(86, 25, 3);
  s.platform('goldPlatform', 90, 21, 5);
  s.spikeHead(91, 15);
  // 4. Candy plateau: a spike-head guarding the gem, a trampoline up onto the gatehouse roof,
  //    a rock-head crusher inside the gatehouse, and a corridor swept by a rock-head.
  s.ground(100, 159, 18, 'candy');
  s.text(104, 15, 'o');
  s.block('goldBlock', 110, 16, 2, 2);
  s.block('copperBlock', 116, 12, 5, 1).text(118, 10, 'g');
  s.spikeHead(121, 9);
  s.text(122, 15, 'o o');
  s.trampoline(125, 17);
  s.solid('jadeWall', 128, 6, 10, 5).text(130, 5, 'o  o');
  s.rockHead(132, 11, 'y');
  s.block('copperBlock', 140, 16, 1, 2).block('copperBlock', 151, 16, 1, 2);
  s.rockHead(141, 16, 'x');
  s.text(145, 15, 'o o');
  s.text(154, 17, 'E');
  return s;
}

/** Pretty JSON with tile data printed one map row per line (readable diffs, Tiled-compatible). */
function formatTiledJson(map: TiledMap): string {
  const blocks: string[] = [];
  const copy = structuredClone(map);
  for (const layer of copy.layers) {
    if (layer.type !== 'tilelayer' || !Array.isArray(layer.data)) continue;
    const lines: string[] = [];
    for (let r = 0; r < layer.height; r++) lines.push(layer.data.slice(r * layer.width, (r + 1) * layer.width).join(','));
    blocks.push(lines.join(',\n        '));
    (layer as { data: unknown }).data = `__TILE_DATA_${blocks.length - 1}__`;
  }
  let json = JSON.stringify(copy, null, 2);
  blocks.forEach((block, i) => {
    json = json.replace(`"__TILE_DATA_${i}__"`, `[\n        ${block}\n      ]`);
  });
  return `${json}\n`;
}

function writeFile(path: string, contents: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  console.log(`  wrote ${path.slice(root.length + 1).replaceAll('\\', '/')}`);
}

const tileset = paintDebugTileset();
writeFile(join(dataDir, DEBUG_TILESET.file), encodePng(tileset.width, tileset.height, tileset.data));

// Never overwrite real fan art dropped over the placeholder.
const fanPath = join(dataDir, 'sprites', 'traps', 'fan.png');
if (!existsSync(fanPath)) {
  const fan = paintFanPlaceholder();
  writeFile(fanPath, encodePng(fan.width, fan.height, fan.data));
}

const samples: Array<{ id: string; sketch: Sketch; backgroundColor: string; properties?: Record<string, string> }> = [
  { id: 'level-1', sketch: level1(), backgroundColor: '#8fd3ff', properties: { music: 'none' } },
  { id: 'level-2', sketch: level2(), backgroundColor: '#8c9eff' },
  { id: 'level-3', sketch: level3(), backgroundColor: '#ffcf9e' },
];

let failed = false;
for (const sample of samples) {
  const entry = LEVELS.require(sample.id);
  const rows = sample.sketch.rows();
  const thin = thinTerrainCells(rows);
  const map = asciiToTiledMap({
    rows,
    objects: sample.sketch.objects,
    baseLegend: TERRAIN_ASCII_LEGEND,
    tileset: terrainTilesetDefinition(1),
    tileSize: TERRAIN_TILESET.tileSize,
    backgroundColor: sample.backgroundColor,
    ...(sample.properties ? { properties: sample.properties } : {}),
  });
  writeFile(join(dataDir, entry.map), formatTiledJson(map));
  const { level, issues } = parseManifestLevel(map, entry);
  console.log(`\n${sample.id} (${map.width}x${map.height}, ${level?.traps.length ?? 0} traps) checksum=${level ? levelChecksum(level) : 'n/a'}`);
  console.log(rows.map((r) => `  |${r}|`).join('\n'));
  for (const issue of issues) console.log(`  [${issue.severity}] ${issue.message}`);
  for (const cell of thin) console.log(`  [error] "${cell.char}" at (${cell.col}, ${cell.row}) is in a 1-tile-thick strip`);
  if (!level || thin.length > 0) failed = true;
}
if (failed) process.exitCode = 1;
