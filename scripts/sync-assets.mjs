#!/usr/bin/env node
/**
 * Copies the shared level data (Tiled maps, tilesets) into the Next.js public folder so the
 * browser can fetch it from /assets/... while the game server reads the very same files.
 *
 *   node scripts/sync-assets.mjs          one-shot copy (runs before `next dev` / `next build`)
 *   node scripts/sync-assets.mjs --watch  keep copying on change (part of `npm run dev`)
 */
import { cpSync, existsSync, mkdirSync, rmSync, watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'packages', 'shared', 'data');
const target = join(root, 'apps', 'web', 'public', 'assets');

function sync() {
  if (!existsSync(source)) {
    console.error(`[assets] source folder missing: ${source}`);
    process.exitCode = 1;
    return;
  }
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true });
  console.log(`[assets] synced packages/shared/data -> apps/web/public/assets`);
}

sync();

if (process.argv.includes('--watch')) {
  let timer;
  watch(source, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        sync();
      } catch (error) {
        console.error('[assets] sync failed:', error);
      }
    }, 150);
  });
  console.log('[assets] watching for changes...');
}
