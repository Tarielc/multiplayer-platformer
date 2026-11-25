/**
 * `Sketch`: a tiny drawing surface for the generated levels, one character per 16 px tile of
 * `terrain-tileset.png`. Layouts say which material goes where (edges and corners are auto-tiled
 * by `asciiToTiledMap`); traps and foes are Tiled objects placed in tile coordinates, each checked
 * against the layout so a level that can't work fails at generation time.
 */
import { TRAP_TUNING, type Dir4, type HintImage, type TiledObject, type TiledProperty } from '@platformer/shared';
import { TERRAIN_CHARS, TERRAIN_SETS, TERRAIN_TILESET, type TerrainSetName } from '@platformer/shared/dev';

export type SetsOfKind<K extends string> = {
  [N in TerrainSetName]: (typeof TERRAIN_SETS)[N]['kind'] extends K ? N : never;
}[TerrainSetName];
/** Materials drawn as auto-tiled regions (ground, walls, brick). */
export type EdgeMaterial = SetsOfKind<'edge'>;
export type BlockMaterial = SetsOfKind<'block'>;
export type PlatformMaterial = SetsOfKind<'platform'>;

export const T = TERRAIN_TILESET.tileSize;
const SOLID_CHARS = new Set(
  (Object.keys(TERRAIN_SETS) as TerrainSetName[]).filter((n) => TERRAIN_SETS[n].kind !== 'platform').map((n) => TERRAIN_CHARS[n]),
);
const PLATFORM_CHARS = new Set(
  (Object.keys(TERRAIN_SETS) as TerrainSetName[]).filter((n) => TERRAIN_SETS[n].kind === 'platform').map((n) => TERRAIN_CHARS[n]),
);

export type MapObject = Omit<TiledObject, 'id'>;
export type ObjectProps = Record<string, number | string>;

/**
 * Tiny drawing surface (one character per 16 px tile) so layouts are described by intent
 * instead of hand-aligned ASCII. Throws on shapes the tileset cannot draw cleanly.
 */
export class Sketch {
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

  /**
   * A hint sign with its bottom-centre at tile point (x, y): advice `text` (a line break starts a
   * new line), a picture (`image`), or both. Pure decoration; place a picture on the floor.
   */
  hint(x: number, y: number, { text, image }: { text?: string; image?: HintImage }): this {
    if (!text && !image) throw new Error(`hint at (${x}, ${y}) has neither text nor image`);
    const props: ObjectProps = {};
    if (text) props.text = text;
    if (image) props.image = image;
    return this.object('hint', { x: x * T, y: y * T }, props);
  }

  /** The name the next object of `type` will get ("trampoline 3"): what a button's `target` names. */
  nextName(type: string): string {
    return `${type} ${this.objects.filter((o) => o.type === type).length + 1}`;
  }

  /** Lava (2 tiles tall, standing on row `y + 1`) in every empty cell of row `y` from x0 to x1. */
  lava(x0: number, x1: number, y: number): this {
    for (let x = x0; x <= x1; x++) if (this.at(x, y) === ' ' && !this.reserved.has(`${x},${y}`)) this.set(x, y, 'L');
    return this;
  }

  /** Empties a rectangle of terrain (a dip, a tunnel, a doorway). */
  carve(x: number, y: number, w: number, h: number): this {
    return this.fill(x, y, w, h, ' ');
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

/** Characters `ch` along an arc: one every `step` columns, `heights[i]` rows above row `y`. */
export function arc(s: Sketch, x: number, y: number, ch: string, heights: readonly number[], step = 2): void {
  heights.forEach((h, i) => s.text(x + i * step, y - h, ch));
}

/** A stone frame around the whole map (walls 2 tiles thick, open at the bottom for pits). */
export function frame(s: Sketch): void {
  s.solid('stoneWall', 0, 0, 2, s.height).solid('stoneWall', s.width - 2, 0, 2, s.height).solid('stoneWall', 2, 0, s.width - 4, 2);
}

/**
 * The control signs of a campaign's first level, in a row on the start hill (floor top at row
 * `f`): move (behind the spawns), jump, double jump, attack, then a box to try the attack on,
 * then the ability sign (`ability: false` leaves it for the caller to place). Each sign is 5
 * tiles wide; the row runs from column 5 to 35.
 */
export function controlSigns(s: Sketch, f: number, { box, ability = true }: { box: number; ability?: boolean }): void {
  s.hint(7.5, f, { image: 'key-move' });
  s.hint(13.5, f, { image: 'key-jump' });
  s.hint(19.5, f, { image: 'key-double-jump' });
  s.hint(25.5, f, { image: 'key-attack' });
  s.box(box, f - 1);
  if (ability) s.hint(32.5, f, { image: 'key-ability' });
}
