import type * as Phaser from 'phaser';
import { backgroundKey, backgroundOffsetY, resolveBackground } from '../art/backgroundArt';
import { VIEW_CONFIG } from '../config';

/**
 * The world background: one seamless tile repeated over the whole view, fixed to the camera and
 * drifting down forever (an endless, slow loop). If the tile failed to load, the level's
 * background colour shows instead.
 */
export class Backdrop {
  private readonly sprite: Phaser.GameObjects.TileSprite | null = null;
  private elapsedMs = 0;

  constructor(scene: Phaser.Scene, tile: string | undefined) {
    const key = backgroundKey(resolveBackground(tile));
    if (!scene.textures.exists(key)) return;
    this.sprite = scene.add
      .tileSprite(0, 0, VIEW_CONFIG.width, VIEW_CONFIG.height, key)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(VIEW_CONFIG.depth.backdrop);
  }

  update(frameMs: number): void {
    if (!this.sprite) return;
    this.elapsedMs += frameMs;
    this.sprite.tilePositionY = backgroundOffsetY(this.elapsedMs);
  }
}
