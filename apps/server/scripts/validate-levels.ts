/**
 * `npm run levels:validate` — parses every level in the manifest with the same pipeline the
 * server and client use, and checks that referenced tileset images exist on disk.
 * Exits non-zero on errors so it can gate CI.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { LEVELS } from '@platformer/shared';
import { defaultDataDir } from '../src/env';
import { LevelRepository, formatLevelReports } from '../src/levels/LevelRepository';
import { silentLogger } from '../src/log';

const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : defaultDataDir();
const repo = new LevelRepository(dataDir, LEVELS, silentLogger);
const reports = await repo.loadAll();

// Tileset images are only needed by the browser (the server never loads art), so a missing
// image is a warning: the client falls back to generated textures.
for (const report of reports) {
  if (!report.ok) continue;
  const map = JSON.parse(await readFile(report.file, 'utf8')) as { tilesets?: { name?: string; image?: string }[] };
  for (const tileset of map.tilesets ?? []) {
    if (!tileset.image) continue;
    const imagePath = join(dirname(report.file), tileset.image);
    if (!existsSync(imagePath)) {
      report.issues.push({
        severity: 'warning',
        message: `tileset "${tileset.name ?? '?'}" image not found at ${imagePath} (the client will use a generated fallback)`,
      });
    }
  }
}

console.log(`Validating ${reports.length} level(s) in ${dataDir}\n`);
console.log(formatLevelReports(reports));

const errors = reports.reduce((n, r) => n + r.issues.filter((i) => i.severity === 'error').length + (r.ok ? 0 : 1), 0);
const warnings = reports.reduce((n, r) => n + r.issues.filter((i) => i.severity === 'warning').length, 0);
console.log(`\n${reports.filter((r) => r.ok).length}/${reports.length} OK, ${warnings} warning(s)`);
process.exit(errors > 0 ? 1 : 0);
