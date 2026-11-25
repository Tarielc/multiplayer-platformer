/**
 * Draws each generated level as a small overview PNG (3 px per tile) so a whole layout can be
 * judged at a glance: terrain by material, traps and foes as coloured marks, fruit, checkpoints,
 * hints and the exit. Output goes to `.level-previews/` (git-ignored).
 *
 * Usage: npm run levels:preview [-- race-1 coop-2]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coop1, coop2, coop3, coop4 } from './levels/coop';
import { race1, race2, race3 } from './levels/race';
import { T, type Sketch } from './levels/sketch';
import { encodePng } from './lib/png';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '.level-previews');
const P = 3;

const builders: Record<string, () => Sketch> = {
  'coop-1': coop1,
  'coop-2': coop2,
  'coop-3': coop3,
  'coop-4': coop4,
  'race-1': race1,
  'race-2': race2,
  'race-3': race3,
};

type RGB = [number, number, number];
const TILE: Record<string, RGB> = {
  '#': [92, 160, 72],
  '%': [196, 120, 64],
  '&': [236, 140, 190],
  S: [120, 120, 132],
  W: [150, 100, 60],
  J: [70, 160, 140],
  B: [170, 80, 70],
  x: [200, 150, 80],
  m: [170, 180, 190],
  k: [210, 110, 60],
  Y: [240, 200, 60],
  '-': [190, 140, 90],
  '=': [180, 190, 200],
  '~': [250, 220, 90],
  L: [255, 60, 20],
  a: [80, 255, 80],
  s: [80, 255, 80],
  p: [80, 255, 80],
  w: [80, 255, 80],
  C: [60, 140, 255],
  E: [255, 255, 255],
};
const OBJECT: Record<string, RGB> = {
  spikes: [255, 0, 0],
  trampoline: [255, 0, 255],
  button: [255, 255, 0],
  box: [140, 90, 40],
  saw: [255, 140, 0],
  fan: [0, 255, 255],
  fallingPlatform: [255, 180, 120],
  rockHead: [40, 40, 40],
  spikeHead: [120, 0, 0],
  hint: [255, 230, 180],
};
const FOE: RGB = [255, 255, 255];

const ids = process.argv.slice(2).length > 0 ? process.argv.slice(2) : Object.keys(builders);
mkdirSync(outDir, { recursive: true });
for (const id of ids) {
  const build = builders[id];
  if (!build) throw new Error(`Unknown level "${id}" (known: ${Object.keys(builders).join(', ')})`);
  const s = build();
  const rows = s.rows();
  const w = s.width * P;
  const h = s.height * P;
  const px = new Uint8ClampedArray(w * h * 4);
  const put = (x: number, y: number, [r, g, b]: RGB) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = 255;
  };
  for (let i = 0; i < w * h; i++) [px[i * 4], px[i * 4 + 1], px[i * 4 + 2], px[i * 4 + 3]] = [24, 26, 40, 255];
  rows.forEach((row, ty) =>
    [...row].forEach((ch, tx) => {
      const c = TILE[ch] ?? (/[1-4]/.test(ch) ? ([255, 255, 255] as RGB) : undefined);
      if (!c) return;
      const thin = ch === '-' || ch === '=' || ch === '~';
      const dot = 'aspwCE1234'.includes(ch);
      for (let y = 0; y < P; y++)
        for (let x = 0; x < P; x++) {
          if (thin && y > 0) continue;
          if (dot && (x !== 1 || y === 0)) continue;
          put(tx * P + x, ty * P + y, c);
        }
    }),
  );
  for (const o of s.objects) {
    const c = OBJECT[o.type ?? ''] ?? FOE;
    const x0 = Math.floor((o.x / T) * P);
    const y0 = Math.floor((o.y / T) * P);
    const x1 = o.width ? Math.ceil(((o.x + o.width) / T) * P) : x0 + 2;
    const y1 = o.height ? Math.ceil(((o.y + o.height) / T) * P) : y0;
    const top = o.height ? y0 : y0 - 3;
    for (let y = top; y < Math.max(y1, top + 2); y++) for (let x = x0; x < Math.max(x1, x0 + 2); x++) put(x, y, c);
  }
  const file = join(outDir, `${id}.png`);
  writeFileSync(file, encodePng(w, h, px));
  console.log(`  ${file}`);
}
