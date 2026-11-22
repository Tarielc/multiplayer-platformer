import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BACKGROUND_TILES, LEVELS } from '@platformer/shared';
import { describe, expect, it } from 'vitest';
import { BACKGROUND_SCROLL_PX_PER_SEC, BACKGROUND_TILE_SIZE, backgroundOffsetY, backgroundPath, resolveBackground } from './backgroundArt';

describe('background tiles', () => {
  it.each(BACKGROUND_TILES)('%s is a 64x64 PNG on disk', (name) => {
    const png = readFileSync(fileURLToPath(new URL(`../../../../../packages/shared/data/${backgroundPath(name)}`, import.meta.url)));
    expect(png.readUInt32BE(16)).toBe(BACKGROUND_TILE_SIZE);
    expect(png.readUInt32BE(20)).toBe(BACKGROUND_TILE_SIZE);
  });

  it('gives every level a known tile, falling back to the first', () => {
    for (const entry of LEVELS.entries) expect(BACKGROUND_TILES).toContain(resolveBackground(entry.background));
    expect(resolveBackground('nope')).toBe(BACKGROUND_TILES[0]);
    expect(resolveBackground(undefined)).toBe(BACKGROUND_TILES[0]);
  });

  it('scrolls down and loops seamlessly every tile', () => {
    const loopMs = (BACKGROUND_TILE_SIZE / BACKGROUND_SCROLL_PX_PER_SEC) * 1000;
    expect(backgroundOffsetY(0)).toBe(BACKGROUND_TILE_SIZE);
    expect(backgroundOffsetY(1000)).toBeLessThan(backgroundOffsetY(0)); // offset falls: the picture moves down
    expect(backgroundOffsetY(loopMs) % BACKGROUND_TILE_SIZE).toBeCloseTo(backgroundOffsetY(0) % BACKGROUND_TILE_SIZE);
    expect(backgroundOffsetY(loopMs * 1000 + 500)).toBeLessThanOrEqual(BACKGROUND_TILE_SIZE);
  });
});
