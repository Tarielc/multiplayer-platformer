import type * as Phaser from 'phaser';
import { VIEW_CONFIG } from '../config';
import { abilityAnim } from './abilityAnimations';
import { animLengthMs, frameAt, frameName } from './abilityArt';

export interface FxOptions {
  /** Drift, px/s. */
  vx?: number;
  vy?: number;
  depth?: number;
  flip?: boolean;
  /** Fade out over the clip. */
  fade?: boolean;
  /** Plays this long (loops keep looping), default one full play. */
  durationMs?: number;
  delayMs?: number;
}

/**
 * Plays one generated ability clip once at a world position (centred), then removes it.
 * Does nothing when the sheet failed to load.
 */
export function playFx(scene: Phaser.Scene, key: string, animName: string, x: number, y: number, options: FxOptions = {}): void {
  const anim = abilityAnim(key, animName);
  if (!anim) return;
  const length = options.durationMs ?? animLengthMs(anim);
  const sprite = scene.add
    .sprite(x, y, key, frameName(animName, 0))
    .setDepth(options.depth ?? VIEW_CONFIG.depth.effects)
    .setFlipX(options.flip ?? false)
    .setVisible(!options.delayMs);
  const clock = { t: 0 };
  scene.tweens.add({
    targets: clock,
    t: length,
    duration: length,
    delay: options.delayMs ?? 0,
    onStart: () => sprite.setVisible(true),
    onUpdate: () => {
      sprite.setFrame(frameName(animName, frameAt(anim, clock.t)));
      const s = clock.t / 1000;
      sprite.setPosition(x + (options.vx ?? 0) * s, y + (options.vy ?? 0) * s);
      if (options.fade) sprite.setAlpha(Math.max(0, 1 - clock.t / length));
    },
    onComplete: () => sprite.destroy(),
  });
}
