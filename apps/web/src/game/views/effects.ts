import type * as Phaser from 'phaser';
import { TEXTURES } from '../art/textures';
import { VIEW_CONFIG } from '../config';

/** Burst of puffs (death, respawn). */
export function puff(scene: Phaser.Scene, x: number, y: number, tint: number, count = 10): void {
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const distance = 12 + Math.random() * 16;
    const particle = scene.add
      .image(x, y, TEXTURES.puff)
      .setTint(tint)
      .setScale(0.7 + Math.random() * 0.7)
      .setDepth(VIEW_CONFIG.depth.effects);
    scene.tweens.add({
      targets: particle,
      x: x + Math.cos(angle) * distance,
      y: y + Math.sin(angle) * distance,
      alpha: 0,
      scale: 0.2,
      duration: 360 + Math.random() * 160,
      ease: 'Cubic.easeOut',
      onComplete: () => particle.destroy(),
    });
  }
}

/** Rising, fading text ("+10", "Checkpoint!"). */
export function floatText(scene: Phaser.Scene, x: number, y: number, text: string, color: string): void {
  const label = scene.add
    .text(x, y, text, {
      fontFamily: VIEW_CONFIG.label.fontFamily,
      fontSize: `${VIEW_CONFIG.label.fontSize + 2}px`,
      color,
      stroke: '#0b0d18',
      strokeThickness: 3,
    })
    .setOrigin(0.5, 1)
    .setResolution(2)
    .setDepth(VIEW_CONFIG.depth.effects);
  scene.tweens.add({
    targets: label,
    y: y - 22,
    alpha: 0,
    duration: 750,
    ease: 'Quad.easeOut',
    onComplete: () => label.destroy(),
  });
}
