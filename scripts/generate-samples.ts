/**
 * Bootstraps the bundled content:
 *   packages/shared/data/maps/coop-1.json … coop-4.json, race-1.json … race-3.json
 *       (Tiled JSON maps, 16 px terrain tiles; see `scripts/levels/`)
 *   packages/shared/data/tilesets/debug-tiles.png   (procedural placeholder tileset, 32 px)
 *   packages/shared/data/sprites/traps/fan.png, button.png   (placeholders, only if missing)
 *
 * The levels are built from `terrain-tileset.png` with the auto-tiling ASCII legend in
 * `@platformer/shared/dev` (terrainTileset.ts): edges, corners and inner corners are picked
 * from each cell's neighbors, so layouts only say *which material goes where*. Traps and foes
 * are Tiled objects placed with `Sketch` helpers in tile coordinates, which check that each one
 * fits where it is put. The co-op team puzzles are in `scripts/levels/puzzles.ts`.
 *
 * Re-running this script overwrites those maps, so after editing one in Tiled, stop generating
 * it here (or copy it to a new file first).
 *
 * Usage: npm run samples:generate [-- --only coop-2]
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEBUG_TILESET, LEVELS, levelChecksum, paintDebugTileset, parseManifestLevel, type TiledMap } from '@platformer/shared';
import { TERRAIN_ASCII_LEGEND, TERRAIN_TILESET, asciiToTiledMap, terrainTilesetDefinition, thinTerrainCells } from '@platformer/shared/dev';
import { coop1, coop2, coop3, coop4 } from './levels/coop';
import { race1, race2, race3 } from './levels/race';
import type { Sketch } from './levels/sketch';
import { paintButtonSprite } from './lib/buttonSprite';
import { paintFanPlaceholder } from './lib/fanPlaceholder';
import { encodePng } from './lib/png';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'packages', 'shared', 'data');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;

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

const samples: Array<{ id: string; build: () => Sketch; backgroundColor: string; properties?: Record<string, string> }> = [
  { id: 'coop-1', build: coop1, backgroundColor: '#8fd3ff' },
  { id: 'coop-2', build: coop2, backgroundColor: '#ffcf9e' },
  { id: 'coop-3', build: coop3, backgroundColor: '#c9b8ff' },
  { id: 'coop-4', build: coop4, backgroundColor: '#c9c2d6' },
  { id: 'race-1', build: race1, backgroundColor: '#f6e7b0' },
  { id: 'race-2', build: race2, backgroundColor: '#9ec9ff' },
  { id: 'race-3', build: race3, backgroundColor: '#ffd3e6' },
];

let failed = false;
for (const sample of samples) {
  if (only && sample.id !== only) continue;
  const entry = LEVELS.require(sample.id);
  const sketch = sample.build();
  const rows = sketch.rows();
  const thin = thinTerrainCells(rows);
  const map = asciiToTiledMap({
    rows,
    objects: sketch.objects,
    baseLegend: TERRAIN_ASCII_LEGEND,
    tileset: terrainTilesetDefinition(1),
    tileSize: TERRAIN_TILESET.tileSize,
    backgroundColor: sample.backgroundColor,
    ...(sample.properties ? { properties: sample.properties } : {}),
  });
  writeFile(join(dataDir, entry.map), formatTiledJson(map));
  const { level, issues } = parseManifestLevel(map, entry);
  console.log(`\n${sample.id} (${map.width}x${map.height}, ${level?.traps.length ?? 0} traps, ${level?.foes.length ?? 0} foes) checksum=${level ? levelChecksum(level) : 'n/a'}`);
  if (args.includes('--print')) console.log(rows.map((r) => `  |${r}|`).join('\n'));
  for (const issue of issues) console.log(`  [${issue.severity}] ${issue.message}`);
  for (const cell of thin) console.log(`  [error] "${cell.char}" at (${cell.col}, ${cell.row}) is in a 1-tile-thick strip`);
  if (!level || thin.length > 0) failed = true;
}
if (failed) process.exitCode = 1;
