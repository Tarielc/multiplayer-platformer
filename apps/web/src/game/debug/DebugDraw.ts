import { CellFlag, slotStyle, type HitboxSize, type LevelData } from '@platformer/shared';
import type * as Phaser from 'phaser';
import { VIEW_CONFIG } from '../config';

export interface DebugBox {
  x: number;
  y: number;
  /** Defaults to the player hitbox size. */
  width?: number;
  height?: number;
  color: number;
  /** Server "ghost" boxes and attack reach boxes are drawn thinner. */
  ghost?: boolean;
}

/**
 * F3 overlay: collision cells, zones and spawns (drawn once), plus player hitboxes, active
 * attack reach boxes and the last authoritative server position of the local player (drawn
 * each frame).
 */
export class DebugDraw {
  private readonly staticLayer: Phaser.GameObjects.Graphics;
  private readonly dynamicLayer: Phaser.GameObjects.Graphics;
  private visible = false;

  constructor(
    scene: Phaser.Scene,
    level: LevelData,
    private readonly hitbox: HitboxSize,
  ) {
    const depth = VIEW_CONFIG.depth.debug;
    this.staticLayer = scene.add.graphics().setDepth(depth);
    this.dynamicLayer = scene.add.graphics().setDepth(depth + 1);
    this.drawStatic(level);
    this.setVisible(false);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.staticLayer.setVisible(visible);
    this.dynamicLayer.setVisible(visible);
    if (!visible) this.dynamicLayer.clear();
  }

  draw(boxes: DebugBox[]): void {
    if (!this.visible) return;
    const g = this.dynamicLayer;
    g.clear();
    for (const box of boxes) {
      g.lineStyle(box.ghost ? 1 : 2, box.color, box.ghost ? 0.9 : 1);
      g.strokeRect(box.x, box.y, box.width ?? this.hitbox.width, box.height ?? this.hitbox.height);
    }
  }

  private drawStatic(level: LevelData): void {
    const g = this.staticLayer;
    const ts = level.tileSize;
    for (let row = 0; row < level.heightTiles; row++) {
      for (let col = 0; col < level.widthTiles; col++) {
        const flags = level.cells[row * level.widthTiles + col] ?? 0;
        if (flags === CellFlag.EMPTY) continue;
        const x = col * ts;
        const y = row * ts;
        if (flags & CellFlag.SOLID) {
          g.lineStyle(1, 0x7ee081, 0.5);
          g.strokeRect(x + 0.5, y + 0.5, ts - 1, ts - 1);
        }
        if (flags & CellFlag.ONE_WAY) {
          g.lineStyle(2, 0xffc94d, 0.9);
          g.lineBetween(x, y + 1, x + ts, y + 1);
        }
        if (flags & CellFlag.HAZARD) {
          g.fillStyle(0xff5d73, 0.25);
          g.fillRect(x, y, ts, ts);
        }
      }
    }
    const zone = (color: number, z: { x: number; y: number; width: number; height: number }) => {
      g.lineStyle(2, color, 0.9);
      g.strokeRect(z.x, z.y, z.width, z.height);
    };
    for (const z of level.checkpoints) zone(0x4fc3ff, z);
    for (const z of level.exits) zone(0x7ee081, z);
    for (const z of level.hazards) zone(0xff5d73, z);
    for (const item of level.collectibles) {
      g.lineStyle(1, 0xffd23f, 0.9);
      g.strokeCircle(item.x, item.y, item.radius);
    }
    for (const spawn of level.spawns) {
      const color = slotStyle(spawn.slot).color;
      g.lineStyle(2, color, 1);
      g.lineBetween(spawn.x - 5, spawn.y, spawn.x + 5, spawn.y);
      g.lineBetween(spawn.x, spawn.y - 10, spawn.x, spawn.y);
    }
  }
}
