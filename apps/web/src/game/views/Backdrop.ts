import type * as Phaser from 'phaser';
import { VIEW_CONFIG } from '../config';

/** Procedural parallax layers fixed to the camera, scrolled by a fraction of camera movement. */
export class Backdrop {
  private readonly layers: { sprite: Phaser.GameObjects.TileSprite; factor: number; baseY: number }[] = [];

  constructor(scene: Phaser.Scene) {
    VIEW_CONFIG.parallax.forEach((layer, index) => {
      if (!scene.textures.exists(layer.texture)) return;
      const source = scene.textures.get(layer.texture).getSourceImage();
      const baseY = Math.round(VIEW_CONFIG.height * layer.y);
      const sprite = scene.add
        .tileSprite(0, baseY, VIEW_CONFIG.width, source.height, layer.texture)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setAlpha(layer.alpha)
        .setDepth(VIEW_CONFIG.depth.backdrop + index);
      this.layers.push({ sprite, factor: layer.scrollFactor, baseY });
    });
  }

  update(camera: Phaser.Cameras.Scene2D.Camera): void {
    for (const layer of this.layers) {
      layer.sprite.tilePositionX = camera.scrollX * layer.factor;
      layer.sprite.y = layer.baseY - camera.scrollY * layer.factor * 0.5;
    }
  }
}
