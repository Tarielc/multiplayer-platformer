import type { NetPropState } from '@platformer/shared';
import type * as Phaser from 'phaser';
import { VIEW_CONFIG } from '../config';
import { TRAP_SHEETS, sheetForTrap, trapFrame } from '../traps/trapArt';

/** Spin of a spat box, rad/s. */
const SPIN = 14;

/**
 * Boxes an ability has picked up (carried by the claw, on the tongue, falling after a drop,
 * flying after a spit). While a box is a prop its trap view is hidden; when the server puts it
 * back the trap view shows it again at its new place.
 */
export class PropViews {
  private readonly sprites = new Map<number, Phaser.GameObjects.Sprite>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly boxSize: { width: number; height: number },
  ) {}

  /**
   * Draws `props` (top-left positions; `attached` overrides them for boxes the local player
   * holds) and returns the ids on screen, swallowed ones included.
   */
  update(props: readonly NetPropState[], attached: ReadonlyMap<number, { x: number; y: number }>, dtMs: number): Set<number> {
    const seen = new Set<number>();
    for (const prop of props) {
      seen.add(prop.id);
      const sprite = this.sprites.get(prop.id) ?? this.create(prop);
      if (prop.state === 'swallowed') {
        sprite.setVisible(false);
        continue;
      }
      const at = attached.get(prop.id) ?? prop;
      sprite.setPosition(at.x + this.boxSize.width / 2, at.y + this.boxSize.height / 2).setVisible(true);
      if (prop.state === 'flying') sprite.rotation += (Math.sign(prop.vx) || 1) * SPIN * (dtMs / 1000);
      else sprite.rotation = 0;
    }
    for (const [id, sprite] of this.sprites) {
      if (seen.has(id)) continue;
      sprite.destroy();
      this.sprites.delete(id);
    }
    return seen;
  }

  destroy(): void {
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();
  }

  private create(prop: NetPropState): Phaser.GameObjects.Sprite {
    const name = sheetForTrap('box', prop.variant);
    const sheet = TRAP_SHEETS[name];
    // The box body sits centred in its frame, so the sprite is centred on the body.
    const sprite = this.scene.add
      .sprite(0, 0, sheet.key, trapFrame(name, 0, 0))
      .setOrigin((sheet.bodyX + this.boxSize.width / 2) / sheet.frameWidth, (sheet.bodyY + this.boxSize.height / 2) / sheet.frameHeight)
      .setDepth(VIEW_CONFIG.depth.players + 0.5);
    this.sprites.set(prop.id, sprite);
    return sprite;
  }
}
