import type { TiledProperty, TiledTileset } from '../level/tiled';

/**
 * Placeholder "debug" tileset painted procedurally, so the template boots without any art.
 * The same pixels are produced by `scripts/generate-samples.ts` (written to
 * data/tilesets/debug-tiles.png for Tiled) and by the client as a fallback texture when the
 * PNG is missing.
 */
export const DEBUG_TILES = {
  GRASS: 0,
  DIRT: 1,
  BRICK: 2,
  PLANK: 3,
  SPIKES: 4,
  TUFT: 5,
  FLOWER: 6,
  BG_BRICK: 7,
  LAVA: 8,
  CRATE: 9,
  ICE: 10,
  STONE: 11,
  WATER: 12,
  CLOUD: 13,
  SIGN: 14,
  MISSING: 15,
} as const;

export interface DebugTileSpec {
  id: number;
  key: string;
  collides?: boolean;
  oneWay?: boolean;
  hazard?: boolean;
}

export const DEBUG_TILESET = {
  name: 'debug-tiles',
  /** Path relative to the shared data directory. */
  file: 'tilesets/debug-tiles.png',
  /** Path as referenced from a map in data/maps/. */
  imageFromMaps: '../tilesets/debug-tiles.png',
  tileSize: 32,
  columns: 8,
  rows: 2,
  tiles: [
    { id: DEBUG_TILES.GRASS, key: 'grass', collides: true },
    { id: DEBUG_TILES.DIRT, key: 'dirt', collides: true },
    { id: DEBUG_TILES.BRICK, key: 'brick', collides: true },
    { id: DEBUG_TILES.PLANK, key: 'plank', oneWay: true },
    { id: DEBUG_TILES.SPIKES, key: 'spikes', hazard: true },
    { id: DEBUG_TILES.TUFT, key: 'tuft' },
    { id: DEBUG_TILES.FLOWER, key: 'flower' },
    { id: DEBUG_TILES.BG_BRICK, key: 'bg-brick' },
    { id: DEBUG_TILES.LAVA, key: 'lava', hazard: true },
    { id: DEBUG_TILES.CRATE, key: 'crate', collides: true },
    { id: DEBUG_TILES.ICE, key: 'ice', collides: true },
    { id: DEBUG_TILES.STONE, key: 'stone', collides: true },
    { id: DEBUG_TILES.WATER, key: 'water' },
    { id: DEBUG_TILES.CLOUD, key: 'cloud' },
    { id: DEBUG_TILES.SIGN, key: 'sign' },
    { id: DEBUG_TILES.MISSING, key: 'missing' },
  ] satisfies DebugTileSpec[],
} as const;

/** Embedded Tiled tileset definition (with collision properties) for the debug tiles. */
export function debugTilesetDefinition(firstgid = 1): TiledTileset {
  const { tileSize, columns, rows } = DEBUG_TILESET;
  return {
    firstgid,
    name: DEBUG_TILESET.name,
    image: DEBUG_TILESET.imageFromMaps,
    imagewidth: columns * tileSize,
    imageheight: rows * tileSize,
    tilewidth: tileSize,
    tileheight: tileSize,
    tilecount: columns * rows,
    columns,
    margin: 0,
    spacing: 0,
    tiles: DEBUG_TILESET.tiles
      .filter((t: DebugTileSpec) => t.collides || t.oneWay || t.hazard)
      .map((t: DebugTileSpec) => {
        const properties: TiledProperty[] = [];
        if (t.collides) properties.push({ name: 'collides', type: 'bool', value: true });
        if (t.oneWay) properties.push({ name: 'oneWay', type: 'bool', value: true });
        if (t.hazard) properties.push({ name: 'hazard', type: 'bool', value: true });
        return { id: t.id, type: t.key, properties };
      }),
  };
}

// --- pixel painting -----------------------------------------------------------------------

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

type RGB = readonly [number, number, number];

const rgb = (hex: number): RGB => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

export function createImage(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** Deterministic per-pixel noise in [0, 1). */
function noise(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

class Painter {
  constructor(
    private readonly img: RgbaImage,
    private readonly ox: number,
    private readonly oy: number,
    readonly size: number,
  ) {}

  /** Source-over blend of one pixel in tile-local coordinates. */
  px(x: number, y: number, color: RGB, alpha = 255): void {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    const i = ((this.oy + y) * this.img.width + (this.ox + x)) * 4;
    const d = this.img.data;
    const a = alpha / 255;
    const da = (d[i + 3] ?? 0) / 255;
    const outA = a + da * (1 - a);
    if (outA <= 0) return;
    for (let c = 0; c < 3; c++) {
      d[i + c] = ((color[c] ?? 0) * a + (d[i + c] ?? 0) * da * (1 - a)) / outA;
    }
    d[i + 3] = outA * 255;
  }

  rect(x: number, y: number, w: number, h: number, color: RGB, alpha = 255): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.px(xx, yy, color, alpha);
  }

  circle(cx: number, cy: number, r: number, color: RGB, alpha = 255): void {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) this.px(x, y, color, alpha);
      }
    }
  }

  speckle(base: RGB, dark: RGB, light: RGB, seed: number, y0 = 0): void {
    for (let y = y0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const n = noise(x, y, seed);
        this.px(x, y, n < 0.12 ? dark : n > 0.92 ? light : base);
      }
    }
  }
}

const C = {
  dirt: rgb(0x7a4b2a),
  dirtDark: rgb(0x5e3820),
  dirtLight: rgb(0x93613a),
  grass: rgb(0x4caf50),
  grassLight: rgb(0x8be07c),
  grassDark: rgb(0x2e7d32),
  stoneGray: rgb(0x8d8d99),
  mortar: rgb(0x5d5d6b),
  brickHi: rgb(0xaeaebb),
  wood: rgb(0xb9814a),
  woodDark: rgb(0x7f4f26),
  woodLight: rgb(0xdca46a),
  steel: rgb(0xcfd8dc),
  steelDark: rgb(0x90a4ae),
  steelBase: rgb(0x607d8b),
  petal: rgb(0xff80ab),
  pollen: rgb(0xffeb3b),
  bgBrick: rgb(0x3b3f5c),
  bgMortar: rgb(0x2a2d42),
  lava: rgb(0xff5722),
  lavaHot: rgb(0xffc107),
  lavaDark: rgb(0xbf360c),
  crate: rgb(0xa1887f),
  crateFrame: rgb(0x6d4c41),
  ice: rgb(0xb3e5fc),
  iceHi: rgb(0xe1f5fe),
  iceEdge: rgb(0x4fc3f7),
  stone: rgb(0x78909c),
  stoneDark: rgb(0x546e7a),
  stoneLight: rgb(0xb0bec5),
  water: rgb(0x29b6f6),
  white: rgb(0xffffff),
  magenta: rgb(0xff00ff),
  black: rgb(0x111111),
} as const;

function bricks(p: Painter, face: RGB, mortar: RGB, hi: RGB | null): void {
  const s = p.size;
  p.rect(0, 0, s, s, face);
  for (let y = 0; y < s; y++) {
    const row = Math.floor(y / 16);
    const offset = row % 2 === 0 ? 0 : 8;
    for (let x = 0; x < s; x++) {
      const bx = (x + offset) % 16;
      const by = y % 16;
      if (by === 15 || bx === 15) p.px(x, y, mortar);
      else if (hi && (by === 0 || bx === 0)) p.px(x, y, hi);
    }
  }
}

const TILE_PAINTERS: Record<number, (p: Painter) => void> = {
  [DEBUG_TILES.GRASS]: (p) => {
    p.speckle(C.dirt, C.dirtDark, C.dirtLight, 1);
    p.rect(0, 0, p.size, 7, C.grass);
    p.rect(0, 0, p.size, 2, C.grassLight);
    for (let x = 0; x < p.size; x++) {
      const drop = Math.floor(noise(x, 0, 7) * 4);
      for (let y = 7; y < 7 + drop; y++) p.px(x, y, C.grassDark);
    }
  },
  [DEBUG_TILES.DIRT]: (p) => {
    p.speckle(C.dirt, C.dirtDark, C.dirtLight, 2);
    p.circle(8, 22, 2.2, C.dirtDark);
    p.circle(23, 9, 1.6, C.dirtLight);
  },
  [DEBUG_TILES.BRICK]: (p) => bricks(p, C.stoneGray, C.mortar, C.brickHi),
  [DEBUG_TILES.PLANK]: (p) => {
    p.rect(0, 0, p.size, 10, C.wood);
    p.rect(0, 0, p.size, 2, C.woodLight);
    p.rect(0, 9, p.size, 1, C.woodDark);
    for (let x = 3; x < p.size; x += 9) p.rect(x, 3, 4, 1, C.woodDark);
    p.rect(3, 10, 3, 4, C.woodDark);
    p.rect(p.size - 6, 10, 3, 4, C.woodDark);
  },
  [DEBUG_TILES.SPIKES]: (p) => {
    const s = p.size;
    for (let i = 0; i < 4; i++) {
      const cx = i * 8 + 4;
      for (let y = 14; y < s - 2; y++) {
        const half = ((y - 14) / (s - 16)) * 4;
        for (let x = Math.floor(cx - half); x < Math.ceil(cx + half); x++) p.px(x, y, x < cx ? C.steel : C.steelDark);
      }
    }
    p.rect(0, s - 3, s, 3, C.steelBase);
  },
  [DEBUG_TILES.TUFT]: (p) => {
    for (let x = 4; x < 28; x += 3) {
      const h = 3 + Math.floor(noise(x, 3, 11) * 6);
      p.rect(x, 32 - h, 1, h, x % 2 ? C.grass : C.grassDark);
    }
  },
  [DEBUG_TILES.FLOWER]: (p) => {
    p.rect(15, 16, 2, 16, C.grassDark);
    p.rect(17, 24, 4, 2, C.grass);
    for (const [dx, dy] of [[-3, 0], [3, 0], [0, -3], [0, 3]] as const) p.circle(16 + dx, 13 + dy, 2.6, C.petal);
    p.circle(16, 13, 1.8, C.pollen);
  },
  [DEBUG_TILES.BG_BRICK]: (p) => bricks(p, C.bgBrick, C.bgMortar, null),
  [DEBUG_TILES.LAVA]: (p) => {
    const s = p.size;
    for (let x = 0; x < s; x++) {
      const wave = 4 + Math.abs(((x + 4) % 16) - 8) / 4;
      for (let y = Math.floor(wave); y < s; y++) {
        const n = noise(x, y, 21);
        p.px(x, y, n > 0.88 ? C.lavaHot : y > 24 && n < 0.3 ? C.lavaDark : C.lava);
      }
      p.px(x, Math.floor(wave), C.lavaHot);
    }
  },
  [DEBUG_TILES.CRATE]: (p) => {
    const s = p.size;
    p.rect(0, 0, s, s, C.crateFrame);
    p.rect(3, 3, s - 6, s - 6, C.crate);
    for (let i = 3; i < s - 3; i++) {
      p.px(i, i, C.crateFrame);
      p.px(i + 1, i, C.crateFrame);
      p.px(s - 1 - i, i, C.crateFrame);
      p.px(s - 2 - i, i, C.crateFrame);
    }
  },
  [DEBUG_TILES.ICE]: (p) => {
    const s = p.size;
    p.rect(0, 0, s, s, C.ice);
    p.rect(0, 0, s, 2, C.iceEdge);
    for (let i = 0; i < 10; i++) {
      p.px(6 + i, 20 - i, C.iceHi);
      p.px(16 + i, 28 - i, C.iceHi);
    }
  },
  [DEBUG_TILES.STONE]: (p) => {
    p.speckle(C.stone, C.stoneDark, C.stoneLight, 5);
    p.rect(0, 0, p.size, 3, C.stoneLight);
  },
  [DEBUG_TILES.WATER]: (p) => {
    p.rect(0, 0, p.size, p.size, C.water, 150);
    p.rect(0, 0, p.size, 2, C.white, 170);
  },
  [DEBUG_TILES.CLOUD]: (p) => {
    p.circle(10, 20, 7, C.white, 235);
    p.circle(19, 15, 9, C.white, 235);
    p.circle(25, 21, 6, C.white, 235);
  },
  [DEBUG_TILES.SIGN]: (p) => {
    p.rect(14, 16, 4, 16, C.crateFrame);
    p.rect(4, 5, 24, 12, C.crate);
    p.rect(4, 5, 24, 1, C.woodLight);
    p.rect(9, 10, 12, 2, C.crateFrame);
    for (let i = 0; i < 4; i++) p.rect(19 + i, 8 + i, 1, 6 - 2 * i, C.crateFrame);
  },
  [DEBUG_TILES.MISSING]: (p) => {
    for (let y = 0; y < p.size; y++) {
      for (let x = 0; x < p.size; x++) p.px(x, y, (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? C.magenta : C.black);
    }
  },
};

/** Paints the full debug tileset (columns x rows tiles) into an RGBA buffer. */
export function paintDebugTileset(): RgbaImage {
  const { tileSize, columns, rows } = DEBUG_TILESET;
  const img = createImage(columns * tileSize, rows * tileSize);
  for (let id = 0; id < columns * rows; id++) {
    const painter = new Painter(img, (id % columns) * tileSize, Math.floor(id / columns) * tileSize, tileSize);
    (TILE_PAINTERS[id] ?? TILE_PAINTERS[DEBUG_TILES.MISSING]!)(painter);
  }
  return img;
}
