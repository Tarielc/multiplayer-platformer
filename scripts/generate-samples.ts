/**
 * Bootstraps the bundled sample content:
 *   packages/shared/data/tilesets/debug-tiles.png   (procedural placeholder tileset, 32 px)
 *   packages/shared/data/maps/level-1.json … level-8.json, except level-4   (Tiled JSON maps, 16 px terrain tiles)
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
import { paintButtonSprite } from './lib/buttonSprite';
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

  /**
   * A button on the floor under cell (x, y), linked to the traps named `target` (objects are
   * named "<type> <n>", e.g. "spikes 1"; several separated by commas). It may share its cell
   * with a box placed before it, which is lifted onto its cap and holds it down. `action: 'off'`
   * makes pressing it switch the targets off instead of on.
   */
  button(x: number, y: number, target: string, action: 'on' | 'off' = 'on'): this {
    const cell = this.at(x, y);
    if (cell !== ' ') throw new Error(`button at (${x}, ${y}) overlaps "${cell}"`);
    const other = this.reserved.get(`${x},${y}`);
    if (other && !other.startsWith('box')) throw new Error(`button at (${x}, ${y}) overlaps ${other}`);
    this.needsFloor('button', x, y, 1);
    const at = { x: (x + 0.5) * T, y: (y + 1) * T };
    const box = this.objects.find((o) => o.type === 'box' && o.x === at.x && o.y === at.y);
    if (box) box.y -= TRAP_TUNING.button.height;
    return this.object('button', at, action === 'on' ? { target } : { target, action });
  }

  // --- foes (tile coordinates; `range` in tiles: how far they stray from where they start) ----

  /** A mushroom, chicken, bull or the rhino boss standing on the floor under cell (x, y). */
  foe(kind: 'mushroom' | 'chicken' | 'bull' | 'rhino', x: number, y: number, { range, ...props }: ObjectProps & { range?: number } = {}): this {
    this.needsFloor(kind, x, y, 1);
    return this.object(kind, { x: (x + 0.5) * T, y: (y + 1) * T }, range === undefined ? props : { ...props, range: range * T });
  }

  /** A wasp hovering in the middle of cell (x, y). */
  wasp(x: number, y: number, { range, ...props }: ObjectProps & { range?: number } = {}): this {
    if (this.at(x, y) === undefined) throw new Error(`wasp at (${x}, ${y}) is outside the map`);
    if (SOLID_CHARS.has(this.at(x, y)!)) throw new Error(`wasp at (${x}, ${y}) is inside a wall`);
    return this.object('wasp', { x: (x + 0.5) * T, y: (y + 0.5) * T }, range === undefined ? props : { ...props, range: range * T });
  }

  /** A monkey clinging to the wall on its `side` of cell (x, y), its feet at the cell's bottom; it climbs `range` up and down. */
  monkey(x: number, y: number, side: 'left' | 'right', { range, ...props }: ObjectProps & { range?: number } = {}): this {
    const wall = side === 'left' ? x - 1 : x + 1;
    for (const row of [y - 1, y]) {
      if (!SOLID_CHARS.has(this.at(wall, row) ?? '')) throw new Error(`monkey at (${x}, ${y}) has no wall on its ${side} at row ${row}`);
    }
    const all = { wall: side, ...props, ...(range === undefined ? {} : { range: range * T }) };
    return this.object('monkey', { x: (x + 0.5) * T, y: (y + 1) * T }, all);
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
 * boxes, a button under a box powering the spikes, a saw over the pit, a trampoline to a high
 * ledge, a fan, a box-blocked nook.
 */
function level1(): Sketch {
  const s = new Sketch(150, 36);
  // 1. Start plateau with all four spawns, then two boxes to break or hop over. The second
  //    sits on a button that powers the spikes ahead: smash it and they switch off.
  s.ground(0, 23, 28);
  s.text(4, 27, '1 2 3 4');
  s.text(8, 22, 'o o o');
  s.box(15, 27, 1).box(18, 27, 2);
  s.button(18, 27, 'spikes 1');
  // 2. Step up (4 tiles) with spikes to hop over.
  s.ground(24, 35, 24);
  s.text(28, 19, 'o o');
  s.spikes(30, 23, 3);
  s.foe('chicken', 26, 23, { range: 2 });
  // 3. Bottomless pit (cols 36-41) with a saw sliding high above it, then 4. an island with a
  //    wood platform above it and a trampoline up to a high ledge.
  s.saw(36, 18, 41, 18, { speed: 60 });
  s.ground(42, 55, 24);
  s.platform('woodPlatform', 44, 18, 8);
  s.text(45, 16, 'o g o');
  s.foe('mushroom', 47, 23, { range: 3 });
  s.trampoline(53, 23);
  s.platform('woodPlatform', 52, 11, 5).text(52, 10, 'o o o');
  // 5. Lava trench and bronze blocks.
  s.ground(56, 85, 24);
  s.fill(62, 24, 4, 2, ' ').text(62, 25, 'LLLL');
  s.foe('mushroom', 59, 23, { range: 2 });
  s.wasp(68, 16, { range: 3 });
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
  s.monkey(103, 23, 'right', { range: 2 });
  s.spikes(108, 23, 4);
  s.block('bronzeBlock', 112, 22, 2, 2);
  s.block('steelBlock', 114, 20, 2, 4);
  s.block('bronzeBlock', 116, 18, 2, 6);
  s.ground(118, 149, 18);
  s.text(121, 15, 'o   o');
  s.solid('brick', 128, 13, 8, 3).solid('brick', 134, 16, 2, 2).text(129, 12, 'o  o');
  s.box(128, 17, 3).text(130, 17, 'o o');
  s.foe('bull', 124, 17, { range: 2 });
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
  s.foe('mushroom', 23, 47, { range: 4 });
  s.platform('metalPlatform', 26, 42, 14).text(33, 41, 'o');
  s.foe('chicken', 35, 41, { range: 3 });
  s.fallingPlatform(36, 36);
  s.platform('metalPlatform', 39, 36, 11).text(43, 35, 'o');
  s.platform('metalPlatform', 46, 30, 14).text(53, 29, 'g').text(56, 29, 'C');
  // A monkey on the tower wall pelts the checkpoint platform and the shaft.
  s.monkey(69, 28, 'right', { range: 3 });
  // A saw rides up and down through the long platform: cross when it is at either end.
  s.platform('metalPlatform', 32, 24, 18).text(39, 23, 'o');
  s.saw(44, 18, 44, 31);
  // Falling platforms are the only way up from here.
  s.fallingPlatform(30, 18).fallingPlatform(33, 18);
  s.platform('metalPlatform', 20, 18, 8).text(27, 17, 'o');
  s.platform('metalPlatform', 8, 12, 16).text(15, 11, 'o');
  s.wasp(34, 13, { range: 3 });
  s.monkey(2, 10, 'left', { range: 2 });
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
  s.foe('chicken', 31, 17, { range: 1 });
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
  s.monkey(75, 23, 'right', { range: 1 });
  s.box(84, 25, 2).box(86, 25, 3);
  s.platform('goldPlatform', 90, 21, 5);
  s.spikeHead(91, 15);
  // 4. Candy plateau: a spike-head guarding the gem, a trampoline up onto the gatehouse roof,
  //    a rock-head crusher inside the gatehouse, and a corridor swept by a rock-head.
  s.ground(100, 159, 18, 'candy');
  s.text(104, 15, 'o');
  s.foe('mushroom', 106, 17, { range: 2 });
  s.block('goldBlock', 110, 16, 2, 2);
  s.block('copperBlock', 116, 12, 5, 1).text(118, 10, 'g');
  s.spikeHead(121, 9);
  s.text(122, 15, 'o o');
  s.foe('bull', 119, 17, { range: 3 });
  s.trampoline(125, 17);
  s.solid('jadeWall', 128, 6, 10, 5).text(130, 5, 'o  o');
  s.rockHead(132, 11, 'y');
  s.block('copperBlock', 140, 16, 1, 2).block('copperBlock', 151, 16, 1, 2);
  s.rockHead(141, 16, 'x');
  s.text(145, 15, 'o o');
  s.wasp(147, 12, { range: 3 });
  s.text(154, 17, 'E');
  return s;
}

// --- bigger levels (5–7) ----------------------------------------------------------------------
// Fruit pickups: a apple, s strawberry, p pineapple (20), w melon (50, the rare one).

/** One pickup per column `step` apart, `heights[i]` tiles above row `y` (an arc follows a jump). */
function arc(s: Sketch, x: number, y: number, ch: string, heights: readonly number[], step = 2): void {
  heights.forEach((h, i) => s.text(x + i * step, y - h, ch));
}

/** A stone frame around the whole map (walls 2 tiles thick, open at the bottom for pits). */
function frame(s: Sketch): void {
  s.solid('stoneWall', 0, 0, 2, s.height).solid('stoneWall', s.width - 2, 0, 2, s.height).solid('stoneWall', 2, 0, s.width - 4, 2);
}

/**
 * Orchard Hills (big, gentle): a grass meadow framed in stone, full of fruit. Bronze steps and a
 * trampoline to a sky shelf and a high road of floating blocks; islands over a lava pit crossed
 * past a vertical saw and on falling platforms; a climb up wood platforms (or a fan) to a cliff
 * with a box-shut fruit cave; a long plank swept by a saw over a lower orchard (a fan lifts you
 * back up); steel beams; a stepped descent past spikes and a spike-head; a brick fruit cellar
 * shut by a 3-hit box; and a shelf only a carried (drone) or spat teammate reaches.
 */
function level5(): Sketch {
  const s = new Sketch(240, 46);
  frame(s);
  // 1. Start meadow: apple arc over the spawns, bronze steps, strawberries on a gold platform,
  //    a trampoline up to the sky shelf.
  s.ground(2, 33, 38);
  s.text(5, 37, '1 2 3 4');
  arc(s, 4, 37, 'a', [3, 4, 5, 5, 4, 3]);
  s.block('bronzeBlock', 17, 36, 2, 2).text(17, 35, 'a');
  s.block('bronzeBlock', 21, 34, 2, 4).text(21, 33, 'a');
  s.platform('goldPlatform', 8, 29, 6).text(9, 28, 's s s');
  s.block('steelBlock', 12, 22, 5, 1).text(13, 21, 'p p');
  s.trampoline(27, 37);
  s.platform('woodPlatform', 24, 25, 9).text(25, 24, 's s s s');
  s.box(31, 37, 1).text(31, 34, 'a');
  // 2. Over the lava pit. Low road: islands with a saw riding up and down between the first
  //    two, then falling platforms around a plank. High road (from the sky shelf): floating
  //    bronze blocks and gold planks with a melon at the end.
  s.ground(34, 69, 44);
  s.text(34, 43, 'L'.repeat(36));
  s.solid('grass', 37, 34, 6, 4);
  arc(s, 34, 37, 's', [3, 5]);
  s.text(38, 33, 's s s');
  s.saw(45, 26, 45, 38, { speed: 80 });
  s.solid('grass', 47, 31, 6, 4).text(48, 30, 'p  p');
  s.foe('mushroom', 50, 30, { range: 2 });
  s.fallingPlatform(56, 30).text(56, 27, 's');
  s.platform('woodPlatform', 60, 28, 4).text(61, 26, 'pp');
  s.fallingPlatform(66, 30).text(67, 27, 's');
  s.block('bronzeBlock', 36, 21, 2, 2).text(36, 20, 'a');
  s.platform('goldPlatform', 41, 19, 4).text(42, 18, 'aa');
  s.block('bronzeBlock', 48, 19, 2, 2).text(48, 18, 'a');
  s.platform('goldPlatform', 53, 17, 4).text(54, 16, 'aa');
  s.block('bronzeBlock', 60, 18, 2, 2).text(60, 17, 'w');
  // 3. Checkpoint, then a climb: wood platforms zig-zag up to the cliff (a fan by the wall is
  //    the quick way: strawberries mark its stream).
  s.ground(70, 100, 34);
  s.text(73, 33, 'C');
  s.text(77, 33, 'a a a a');
  s.platform('woodPlatform', 86, 29, 5).text(87, 28, 'p p');
  s.platform('woodPlatform', 93, 24, 5).text(94, 23, 'p p');
  s.platform('woodPlatform', 85, 19, 5).text(86, 18, 'p p');
  s.platform('woodPlatform', 93, 14, 6).text(94, 13, 'a a');
  s.foe('chicken', 90, 33, { range: 3 });
  s.wasp(90, 9, { range: 4 });
  s.fan(99, 33, { range: 20, onMs: 2500, offMs: 1500 });
  for (const y of [29, 25, 21, 17]) s.text(99, y, 's');
  // 4. The high orchard. A secret cave in the cliff: drop through the left plank (Down + Jump),
  //    and a trampoline bounces you back out through the right one.
  s.ground(101, 120, 14);
  s.fill(104, 14, 3, 4, ' ').fill(113, 14, 4, 4, ' ').fill(103, 18, 15, 8, ' ');
  s.platform('woodPlatform', 104, 14, 3).platform('woodPlatform', 113, 14, 4);
  s.text(104, 25, 's s s w s');
  s.text(105, 20, 'a a a a');
  s.trampoline(114, 25);
  s.text(108, 13, 'a a a');
  s.block('bronzeBlock', 109, 8, 2, 2).text(109, 7, 'p');
  s.foe('chicken', 118, 13, { range: 1 });
  // A long plank swept by a saw (jump it; pineapples hang above it), steel beams, and an
  // island with the second checkpoint.
  s.platform('woodPlatform', 122, 15, 16);
  s.saw(124, 13, 135, 13, { speed: 70 });
  s.text(125, 9, 'p   p   p');
  s.block('steelBlock', 141, 16, 4, 1).text(142, 15, 'ss');
  s.block('steelBlock', 148, 14, 4, 1).text(149, 13, 'ss');
  s.solid('grass', 155, 16, 12, 4);
  s.text(160, 15, 'C');
  s.text(157, 15, 'a').text(164, 15, 'a');
  // 4b. Fall off and you land in the lower orchard: spikes, boxes and fruit, and a fan that
  //     lifts you back up beside the island.
  s.ground(121, 169, 38);
  s.text(123, 37, 'a a a');
  s.foe('mushroom', 126, 37, { range: 2 });
  s.spikes(130, 37, 3);
  arc(s, 129, 36, 's', [2, 3, 2]);
  s.box(137, 37, 2).box(138, 37, 1).text(137, 35, 'pp');
  s.block('bronzeBlock', 142, 34, 2, 4).text(142, 33, 'a');
  s.platform('woodPlatform', 146, 32, 6).text(147, 31, 's s s');
  s.spikes(153, 37, 4);
  s.text(158, 37, 'a a a');
  s.foe('mushroom', 160, 37, { range: 3 });
  s.fan(167, 37, { range: 22, onMs: 3000, offMs: 1200 });
  for (const y of [33, 28, 23]) s.text(167, y, 's');
  // 5. Stepped descent: spikes on the first step, a spike-head on the second.
  s.ground(170, 178, 22);
  s.spikes(174, 21, 2);
  arc(s, 172, 20, 's', [1, 3, 3, 1]);
  s.ground(179, 188, 28);
  s.spikeHead(183, 25);
  arc(s, 181, 26, 'p', [4, 6, 6, 4], 2);
  // 6. The orchard floor: floating bronze beams with fruit, a brick cellar shut by a 3-hit box
  //    (Mask Dude's giant swing breaks it at once), a gold shelf too high to jump to (carry a
  //    teammate up with the drone, or spit one up), and the exit.
  s.ground(189, 237, 34);
  s.text(191, 33, 'a s p s a');
  s.foe('bull', 196, 33, { range: 4 });
  s.block('bronzeBlock', 192, 23, 4, 1).text(193, 22, 'pp');
  s.block('bronzeBlock', 198, 28, 4, 1).text(199, 27, 'aa');
  s.solid('brick', 204, 26, 2, 6).solid('brick', 206, 26, 8, 3).solid('brick', 212, 29, 2, 5);
  s.box(204, 33, 3);
  s.text(206, 33, 's s w');
  s.text(206, 25, 'a a a a');
  s.block('bronzeBlock', 216, 28, 4, 1).text(217, 27, 'ss');
  s.platform('goldPlatform', 222, 17, 6).text(223, 16, 'p w p');
  arc(s, 216, 33, 'a', [0, 0, 0, 0, 0]);
  s.text(232, 33, 'E');
  s.monkey(237, 31, 'right', { range: 3 });
  return s;
}

/**
 * Sawmill Gorge (big, harder): autumn cliffs either side of a bottomless gorge, framed in stone.
 * A plank bridge swept by a saw and a vertical saw between planks; the mill, where two log
 * presses slam down (a trampoline lifts you onto its roof, where another saw rolls); a fan out
 * of the gorge past a vertical saw; a lumber yard with a rolling floor saw, spiked lumber stacks
 * and a shed shut by a 3-hit box; and a log carriage (a rock-head) that ferries you over the
 * last pit. A gold shelf over the exit is only reached with the drone or a spit.
 */
function level6(): Sketch {
  const s = new Sketch(250, 48);
  frame(s);
  // 1. Start yard: apples over the spawns, a log pile, fruit crates, a plank and a steel beam.
  s.ground(2, 37, 40, 'autumn');
  s.text(5, 39, '1 2 3 4');
  arc(s, 4, 39, 'a', [3, 4, 5, 5, 4, 3]);
  s.block('bronzeBlock', 18, 38, 2, 2).text(18, 37, 'a');
  s.block('bronzeBlock', 21, 36, 2, 4).text(21, 35, 'a');
  s.box(25, 39, 1).box(26, 39, 2).text(25, 37, 'ss');
  s.platform('woodPlatform', 28, 34, 6).text(29, 33, 's s s');
  s.block('steelBlock', 20, 29, 5, 1).text(21, 28, 'p p');
  s.foe('chicken', 33, 39, { range: 2 });
  // 2. The gorge: a plank bridge swept by a saw (jump it; strawberries hang over it), a vertical
  //    saw between the planks, then falling planks to the mill yard.
  s.platform('woodPlatform', 40, 40, 12);
  s.saw(41, 38, 50, 38, { speed: 70 });
  arc(s, 41, 39, 's', [4, 5, 5, 4], 3);
  s.saw(54, 29, 54, 42, { speed: 80 });
  s.platform('woodPlatform', 57, 37, 8).text(58, 36, 'p  p');
  s.foe('mushroom', 61, 36, { range: 2 });
  s.fallingPlatform(67, 37).text(67, 34, 's');
  s.fallingPlatform(71, 36).text(72, 33, 's');
  // 3. Mill yard and the mill: two log presses slam down inside (run under while they rise).
  //    A trampoline bounces you onto the roof, where a saw rolls along the ridge.
  s.ground(75, 122, 38, 'autumn');
  s.text(77, 37, 'C');
  s.trampoline(80, 37);
  s.solid('woodWall', 84, 24, 30, 4).solid('woodWall', 84, 28, 2, 6).solid('woodWall', 112, 28, 2, 6);
  s.text(88, 37, 'a a');
  s.rockHead(94, 28, 'y');
  s.text(98, 37, 'p');
  s.rockHead(102, 28, 'y', { phaseMs: 900 });
  s.text(106, 37, 'a a');
  s.foe('mushroom', 109, 37, { range: 1 });
  s.saw(87, 22, 110, 22, { speed: 90 });
  s.text(89, 23, 'a   a   a   a   a').text(111, 23, 'w');
  s.text(116, 37, 's s');
  // 4. Out of the gorge: drop onto a steel beam where a fan lifts you (strawberries mark the
  //    stream), then a metal plank, a vertical saw, a falling platform and the cliff.
  s.block('steelBlock', 126, 40, 6, 1);
  s.fan(128, 39, { range: 16, onMs: 2500, offMs: 1500 });
  for (const y of [35, 31, 27]) s.text(128, y, 's');
  s.platform('metalPlatform', 135, 26, 5).text(136, 25, 'p p');
  s.wasp(133, 20, { range: 3 });
  s.saw(142, 18, 142, 32, { speed: 70 });
  s.fallingPlatform(145, 25).text(145, 22, 'w');
  // 5. Lumber yard on the cliff: checkpoint, a saw rolling along the floor (jump it), spiked
  //    lumber stacks, and a shed whose fruit store is shut by a 3-hit box.
  s.ground(151, 199, 22, 'autumn');
  s.text(153, 21, 'C');
  s.saw(158, 20, 170, 20, { speed: 90 });
  arc(s, 159, 21, 'a', [4, 5, 5, 4], 3);
  s.block('copperBlock', 174, 18, 2, 4).text(174, 17, 'p');
  s.spikes(176, 21, 3);
  s.block('copperBlock', 180, 16, 2, 6).text(180, 15, 'p');
  s.solid('woodWall', 186, 16, 12, 4).solid('woodWall', 196, 20, 2, 2);
  s.box(186, 21, 3);
  s.text(189, 21, 's w s');
  s.text(188, 15, 'a a a');
  s.foe('chicken', 183, 21, { range: 1 });
  // 6. The log carriage: drop to the landing and ride the rock-head over the pit (it slams into
  //    the far bank, then comes back), then the exit. The gold shelf over the exit is 16 tiles
  //    up: carry a teammate there with the drone, or spit one up.
  s.ground(200, 212, 34, 'autumn');
  s.text(203, 33, 'a a a');
  s.foe('bull', 206, 33, { range: 3 });
  s.rockHead(213, 34, 'x');
  s.text(217, 33, 's  s  s  s  s');
  s.ground(235, 247, 34, 'autumn');
  s.text(237, 33, 'a');
  s.platform('goldPlatform', 236, 18, 6).text(237, 17, 'w p w');
  s.text(242, 33, 'E');
  s.monkey(247, 31, 'right', { range: 3 });
  return s;
}

/**
 * Candy Keep (the finale): a candy meadow, a lava moat and a jade keep climbed floor by floor
 * to the throne room on its roof. Falling platforms over the moat past a vertical saw and an
 * overhead one; a courtyard with a brick vault shut by a 3-hit box, and a gold shelf over it
 * that needs the drone or a spit; in the keep, two crushers slam down on the ground floor and a
 * fan lifts you up the corner shaft; a rock-head sweeps the gallery (ride it or jump it, and
 * don't get pinned) under a hanging spike-head; the top floor's spiked walk, a spike-head and a
 * vertical saw; then the roof, its merlons swept by a saw, and the exit in the middle. The
 * exit sits above the climb, so no floor of the keep leads away from it.
 */
function level7(): Sketch {
  const s = new Sketch(152, 60);
  frame(s);
  // 1. Candy meadow: strawberries over the spawns, gold blocks either side of spikes, a gold
  //    platform.
  s.ground(2, 37, 52, 'candy');
  s.text(5, 51, '1 2 3 4');
  arc(s, 4, 51, 's', [3, 4, 5, 5, 4, 3]);
  s.block('goldBlock', 17, 50, 2, 2).text(17, 49, 'a');
  s.spikes(20, 51, 3);
  s.block('goldBlock', 24, 48, 2, 4).text(24, 47, 'a');
  s.platform('goldPlatform', 28, 44, 6).text(29, 43, 'p p');
  s.foe('bull', 33, 51, { range: 2 });
  // 2. The lava moat: falling platforms and a vertical saw to a jade pillar (wait there for the
  //    overhead saw), then two more falling platforms under it.
  s.ground(38, 71, 58, 'candy');
  s.text(38, 57, 'L'.repeat(14));
  s.solid('jadeWall', 52, 48, 4, 10).text(53, 47, 'pp');
  s.text(56, 57, 'L'.repeat(16));
  s.fallingPlatform(40, 51).text(40, 48, 's');
  s.fallingPlatform(45, 50).text(45, 47, 's');
  s.saw(49, 40, 49, 54, { speed: 80 });
  s.fallingPlatform(59, 49).text(59, 46, 's');
  s.fallingPlatform(64, 50).text(64, 47, 's');
  s.saw(58, 44, 66, 44, { speed: 60 });
  s.wasp(62, 40, { range: 3 });
  // 3. Courtyard: checkpoint, candy crates, and a brick vault shut by a 3-hit box (Mask Dude's
  //    giant swing opens it at once). Walk over its roof to the keep door. The gold shelf high
  //    over the vault is 14 tiles up: carry a teammate there with the drone, or spit one up.
  s.ground(72, 149, 52, 'candy');
  s.text(74, 51, 'C');
  s.box(78, 51, 1).box(79, 51, 2).text(78, 49, 'aa');
  s.solid('brick', 84, 46, 10, 4).solid('brick', 92, 50, 2, 2);
  s.box(84, 51, 3);
  s.text(86, 51, 's w s');
  s.text(86, 45, 'a a a');
  s.platform('goldPlatform', 85, 32, 6).text(86, 31, 'w p w');
  // 4. The keep: jade walls (a door at the foot of the left one) and three brick floors, their
  //    gaps alternating sides. The top one is the roof.
  s.solid('jadeWall', 96, 6, 3, 42).solid('jadeWall', 147, 6, 3, 46);
  s.solid('brick', 99, 38, 42, 2).solid('brick', 134, 34, 2, 4);
  s.solid('brick', 99, 24, 14, 2).solid('brick', 121, 24, 26, 2);
  s.solid('brick', 99, 10, 42, 2);
  // A monkey on the keep's outer wall pelts the courtyard and the vault roof.
  s.monkey(95, 45, 'right', { range: 3 });
  // Ground floor: two crushers slam down (run under while they rise), spikes, a box, and a fan
  // up the corner shaft (or the gold platform and a double jump).
  s.text(100, 51, 'a a a');
  s.foe('mushroom', 102, 51, { range: 2 });
  s.rockHead(108, 40, 'y');
  s.spikes(113, 51, 4);
  arc(s, 113, 51, 'p', [3, 4], 3);
  s.rockHead(120, 40, 'y', { phaseMs: 1200 });
  s.box(126, 51, 2);
  s.text(129, 51, 'a a');
  s.foe('chicken', 131, 51, { range: 2 });
  s.platform('goldPlatform', 137, 46, 5);
  s.fan(143, 51, { range: 17, onMs: 2600, offMs: 1400 });
  for (const y of [47, 43, 39, 35]) s.text(143, y, 's');
  // Gallery (land in the pocket right of the brick pillar): a rock-head sweeps the floor
  // between the pillar and the keep wall (ride it or jump it; riding collects the fruit).
  // Gold platforms climb the gap in the middle; past them, a spike-head hangs over the
  // fruit at the far end.
  s.rockHead(100, 36, 'x');
  s.text(104, 34, 'p p').text(124, 34, 'a a a');
  s.spikeHead(103, 26);
  s.platform('goldPlatform', 113, 32, 4);
  s.platform('goldPlatform', 117, 28, 4).text(118, 27, 's');
  s.wasp(124, 30, { range: 3 });
  // 5. Top floor: checkpoint, a spike-head to walk under (don't jump), a gold walk over spikes,
  //    and gold steps up the gap to the roof. Left of the climb, a box guards a melon.
  s.text(122, 23, 'C');
  s.spikeHead(128, 19).text(129, 23, 'p');
  s.spikes(133, 23, 6);
  s.platform('goldPlatform', 133, 19, 6).text(134, 18, 's s s');
  s.platform('goldPlatform', 141, 19, 3).platform('goldPlatform', 144, 14, 3).text(145, 13, 's');
  s.text(100, 23, 'w s').box(104, 23, 2).text(106, 23, 'a a a');
  s.foe('mushroom', 108, 23, { range: 2 });
  // 6. The roof: checkpoint, merlons to hop under a saw running along the ceiling (low hops are
  //    safe, a full jump meets it), the exit, and the throne room's fruit beyond it.
  s.text(137, 9, 'C');
  s.solid('brick', 133, 8, 2, 2).solid('brick', 128, 8, 2, 2);
  s.saw(126, 3, 139, 3, { speed: 70 });
  s.text(133, 7, 'p').text(128, 7, 'p');
  s.text(122, 9, 'E');
  s.block('goldBlock', 116, 8, 2, 2).text(116, 7, 'p');
  s.block('goldBlock', 111, 6, 2, 4).text(111, 5, 'w');
  s.text(102, 9, 'a s a s');
  return s;
}

/**
 * Rhino's Den (the boss): a short tunnel with a checkpoint ends on a ledge over a closed stone
 * hall, where the rhino sleeps. Drop in and it wakes up roaring. It walks at you, swipes its horn
 * at anyone in front of it, stomps (jump the shockwaves; up on a ledge, a rock comes loose over
 * you instead) and charges: dodge onto a ledge and it crashes into the wall, rocks fall from the
 * ceiling, and it stands dazed. Only then do hits hurt it. At half health it flies into a rage.
 * The exit at the far end stays shut until it is beaten. The ledges are one-way wood, low
 * enough to jump onto from the floor; the hall is as wide as the screen.
 */
function level8(): Sketch {
  const s = new Sketch(80, 30);
  frame(s);
  // 1. The tunnel: spawns, fruit, the checkpoint, and the ledge you drop from.
  s.ground(2, 23, 14, 'autumn');
  s.solid('stoneWall', 14, 2, 10, 6);
  s.text(4, 13, '1 2 3 4');
  arc(s, 4, 13, 'a', [2, 3, 3, 2]);
  s.text(15, 13, 'C');
  s.text(20, 13, 'p');
  // 2. The hall: a stone ceiling (rocks fall from it), a brick floor, wood ledges to dodge onto.
  s.solid('stoneWall', 24, 2, 54, 8);
  s.ground(24, 77, 27, 'brick');
  s.platform('woodPlatform', 28, 22, 6).text(29, 21, 's s');
  s.platform('woodPlatform', 45, 18, 10).text(47, 17, 'w   w');
  s.platform('woodPlatform', 66, 22, 6).text(67, 21, 's s');
  s.foe('rhino', 44, 26, { facing: 'left' });
  // 3. The way out, shut while the rhino is alive.
  s.text(74, 26, 'E');
  arc(s, 69, 26, 'g', [3], 2);
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
const buttonPath = join(dataDir, 'sprites', 'traps', 'button.png');
if (!existsSync(buttonPath)) {
  const button = paintButtonSprite();
  writeFile(buttonPath, encodePng(button.width, button.height, button.data));
}

const samples: Array<{ id: string; sketch: Sketch; backgroundColor: string; properties?: Record<string, string> }> = [
  { id: 'level-1', sketch: level1(), backgroundColor: '#8fd3ff', properties: { music: 'none' } },
  { id: 'level-2', sketch: level2(), backgroundColor: '#8c9eff' },
  { id: 'level-3', sketch: level3(), backgroundColor: '#ffcf9e' },
  { id: 'level-5', sketch: level5(), backgroundColor: '#f6e7b0' },
  { id: 'level-6', sketch: level6(), backgroundColor: '#d3d6dd' },
  { id: 'level-7', sketch: level7(), backgroundColor: '#ffd3e6' },
  { id: 'level-8', sketch: level8(), backgroundColor: '#c9c2d6' },
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
