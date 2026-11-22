/**
 * Bootstraps the bundled sample content:
 *   packages/shared/data/tilesets/debug-tiles.png   (procedural placeholder tileset)
 *   packages/shared/data/maps/level-1.json, level-2.json   (Tiled JSON maps)
 *
 * The committed JSON maps are the source of truth: edit them in Tiled. Re-running this
 * script overwrites the two sample maps. Usage: npm run samples:generate
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEBUG_TILESET,
  LEVELS,
  levelChecksum,
  paintDebugTileset,
  parseManifestLevel,
  type TiledMap,
} from '@platformer/shared';
import { asciiToTiledMap } from '@platformer/shared/dev';
import { encodePng } from './lib/png';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'packages', 'shared', 'data');

/** Tiny drawing surface so layouts are described by intent instead of hand-aligned ASCII. */
class Sketch {
  private readonly grid: string[][];

  constructor(readonly width: number, readonly height: number) {
    this.grid = Array.from({ length: height }, () => Array<string>(width).fill(' '));
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
  ground(x0: number, x1: number, top: number): this {
    return this.fill(x0, top, x1 - x0 + 1, this.height - top, '#');
  }

  text(x: number, y: number, str: string): this {
    [...str].forEach((ch, i) => {
      if (ch !== ' ') this.set(x + i, y, ch);
    });
    return this;
  }

  rows(): string[] {
    return this.grid.map((r) => r.join(''));
  }
}

function level1(): string[] {
  const s = new Sketch(72, 18);
  // Sky decoration.
  s.text(5, 2, 'c').text(19, 3, 'c').text(33, 2, 'c').text(50, 3, 'c').text(64, 2, 'c');
  // 1. Start plateau with all four spawns.
  s.ground(0, 11, 14);
  s.text(2, 13, '1234').text(7, 13, ',*,').set(10, 13, '>');
  s.text(4, 10, 'ooo');
  // 2. Step up (2 tiles).
  s.ground(12, 17, 12);
  s.set(13, 11, ',').text(14, 9, 'oo');
  // 3. Bottomless pit (cols 18-20), then 4. an island with one-way planks above it.
  s.ground(21, 27, 12);
  s.text(22, 9, '----').text(22, 8, 'ogo');
  s.text(26, 11, '*');
  // 5. Spike run.
  s.ground(28, 41, 12);
  s.text(30, 11, '^^').set(34, 11, '^');
  s.set(31, 8, 'o').set(35, 8, 'o');
  // 6. Checkpoint.
  s.set(38, 11, 'C').set(40, 11, ',');
  // 7. Lava basin crossed on planks.
  s.ground(42, 47, 16);
  s.text(42, 15, 'LLLLLL');
  s.text(43, 11, '--').text(46, 10, '--');
  s.set(44, 8, 'g');
  // 8. Final stretch: brick block, crate stairs, exit plateau.
  s.ground(48, 58, 12);
  s.fill(52, 10, 2, 2, 'B').text(52, 9, 'oo');
  s.set(56, 11, 'X').fill(57, 10, 1, 2, 'X').fill(58, 9, 1, 3, 'X');
  s.ground(59, 71, 9);
  s.text(61, 8, 'o o o').set(67, 8, 'E').text(69, 8, ',*');
  return s.rows();
}

function level2(): string[] {
  const s = new Sketch(36, 30);
  s.text(6, 4, 'c').text(26, 8, 'c').text(4, 15, 'c').text(30, 20, 'c');
  // Stone side walls and floor.
  s.fill(0, 0, 1, 27, 'S').fill(35, 0, 1, 27, 'S');
  s.ground(0, 35, 27);
  s.text(3, 26, '1234').set(9, 26, ',').text(12, 26, '^^^').set(20, 26, '*');
  // Zig-zag climb on one-way planks (each step is 3 tiles up and overlaps the previous one).
  s.text(8, 24, '-------').set(10, 23, 'o');
  s.text(13, 21, '-------').set(16, 20, 'o');
  s.text(18, 18, '-------').set(21, 17, 'o');
  s.text(23, 15, '-------').set(26, 14, 'g').set(28, 14, 'C');
  s.text(16, 12, '---------').set(19, 11, 'o');
  s.text(10, 9, '--------').set(13, 8, 'o');
  s.text(4, 6, '--------').set(7, 5, 'o');
  // Exit ledge (solid stone) up and to the right of the last plank.
  s.fill(13, 3, 8, 1, 'S');
  s.set(16, 2, 'g').set(18, 2, 'E');
  return s.rows();
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

const samples: Array<{ id: string; rows: string[]; backgroundColor: string; properties?: Record<string, string> }> = [
  { id: 'level-1', rows: level1(), backgroundColor: '#8fd3ff', properties: { music: 'none' } },
  { id: 'level-2', rows: level2(), backgroundColor: '#8c9eff' },
];

let failed = false;
for (const sample of samples) {
  const entry = LEVELS.require(sample.id);
  const map = asciiToTiledMap({
    rows: sample.rows,
    backgroundColor: sample.backgroundColor,
    ...(sample.properties ? { properties: sample.properties } : {}),
  });
  writeFile(join(dataDir, entry.map), formatTiledJson(map));
  const { level, issues } = parseManifestLevel(map, entry);
  console.log(`\n${sample.id} (${map.width}x${map.height}) checksum=${level ? levelChecksum(level) : 'n/a'}`);
  console.log(sample.rows.map((r) => `  |${r}|`).join('\n'));
  for (const issue of issues) console.log(`  [${issue.severity}] ${issue.message}`);
  if (!level) failed = true;
}
if (failed) process.exitCode = 1;
