import { BACKGROUND_TILES, type BackgroundTile } from '@platformer/shared';

/** Background tile art as data (no Phaser import). Files: `packages/shared/data/backgrounds/`. */
export const BACKGROUND_TILE_SIZE = 64;
/** The world scrolls down by this many px/s, looping every `BACKGROUND_TILE_SIZE` px. */
export const BACKGROUND_SCROLL_PX_PER_SEC = 10;

export const backgroundKey = (name: BackgroundTile) => `bg:${name}`;
export const backgroundPath = (name: BackgroundTile) => `backgrounds/${name}.png`;

/** A level's tile; unknown or missing names fall back to the first. */
export function resolveBackground(name: string | undefined): BackgroundTile {
  return (BACKGROUND_TILES as readonly string[]).includes(name ?? '') ? (name as BackgroundTile) : BACKGROUND_TILES[0];
}

/**
 * Vertical tile offset after `elapsedMs`. Scrolling down means the pattern's offset decreases;
 * it wraps at one tile, so the loop is seamless and the number never grows.
 */
export function backgroundOffsetY(elapsedMs: number): number {
  const px = (elapsedMs / 1000) * BACKGROUND_SCROLL_PX_PER_SEC;
  return BACKGROUND_TILE_SIZE - (px % BACKGROUND_TILE_SIZE);
}
