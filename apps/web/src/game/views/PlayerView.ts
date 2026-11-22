import { slotStyle, type HitboxSize } from '@platformer/shared';
import type * as Phaser from 'phaser';
import { TEXTURES } from '../art/textures';
import { VIEW_CONFIG } from '../config';

export interface PlayerViewOptions {
  slot: number;
  name: string;
  isSelf: boolean;
  hitbox: HitboxSize;
}

/** Visual for one player: body sprite, name label, local-player marker, squash & stretch. */
export class PlayerView {
  readonly container: Phaser.GameObjects.Container;
  private readonly sprite: Phaser.GameObjects.Image;
  private readonly label: Phaser.GameObjects.Text;
  private grounded = true;
  private alive = true;
  private squash: Phaser.Tweens.Tween | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    options: PlayerViewOptions,
  ) {
    const style = slotStyle(options.slot);
    const { label: labelCfg, depth } = VIEW_CONFIG;
    this.sprite = scene.add.image(0, 0, TEXTURES.player(options.slot)).setOrigin(0.5, 1);
    this.label = scene.add
      .text(0, -(options.hitbox.height + labelCfg.offsetY), options.name, {
        fontFamily: labelCfg.fontFamily,
        fontSize: `${labelCfg.fontSize}px`,
        color: style.css,
        stroke: '#0b0d18',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setResolution(2);
    const children: Phaser.GameObjects.GameObject[] = [this.sprite, this.label];
    if (options.isSelf) {
      const markerY = this.label.y - this.label.height - 2;
      children.push(scene.add.image(0, markerY, TEXTURES.marker).setOrigin(0.5, 1));
    }
    this.container = scene.add.container(0, 0, children).setDepth(depth.players + (options.isSelf ? 1 : 0));
  }

  setName(name: string): void {
    if (this.label.text !== name) this.label.setText(name);
  }

  setConnected(connected: boolean): void {
    this.container.setAlpha(connected ? 1 : 0.4);
  }

  /** `feetX/feetY` = bottom-center of the hitbox in world pixels. */
  render(feetX: number, feetY: number, facing: 1 | -1, grounded: boolean, vy: number, alive: boolean): void {
    if (!alive) {
      this.alive = false;
      this.container.setVisible(false);
      return;
    }
    if (!this.alive) {
      // Respawn: no landing squash.
      this.alive = true;
      this.grounded = grounded;
      this.container.setVisible(true);
    }
    this.container.setPosition(feetX, feetY);
    this.sprite.setFlipX(facing < 0);
    const { squash } = VIEW_CONFIG;
    if (grounded && !this.grounded) this.pulse(squash.landX, squash.landY);
    else if (!grounded && this.grounded && vy < 0) this.pulse(squash.jumpX, squash.jumpY);
    this.grounded = grounded;
  }

  destroy(): void {
    this.squash?.remove();
    this.container.destroy();
  }

  private pulse(scaleX: number, scaleY: number): void {
    this.squash?.remove();
    this.sprite.setScale(scaleX, scaleY);
    this.squash = this.scene.tweens.add({
      targets: this.sprite,
      scaleX: 1,
      scaleY: 1,
      duration: VIEW_CONFIG.squash.durationMs,
      ease: 'Quad.easeOut',
    });
  }
}
