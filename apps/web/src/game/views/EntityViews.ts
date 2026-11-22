import type { LevelData, LevelZone, NetWorldState } from '@platformer/shared';
import type * as Phaser from 'phaser';
import { TEXTURES } from '../art/textures';
import { VIEW_CONFIG } from '../config';

interface ExitView {
  zone: LevelZone;
  door: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
}

/**
 * Visuals for level entities parsed from the Tiled object layer: collectibles, checkpoint
 * flags, exit doors (with an "n/m at exit" counter) and hazard zones. Pure presentation; state
 * (collected ids, active checkpoints, who is at the exit) comes from server snapshots.
 */
export class EntityViews {
  private readonly items = new Map<number, Phaser.GameObjects.Image>();
  private readonly flags = new Map<number, Phaser.GameObjects.Image>();
  private readonly exits: ExitView[] = [];
  private readonly lava: Phaser.GameObjects.TileSprite[] = [];
  private readonly active = new Set<number>();

  constructor(
    private readonly scene: Phaser.Scene,
    level: LevelData,
  ) {
    const { depth, collectible } = VIEW_CONFIG;

    for (const zone of level.hazards) {
      const style = zone.properties.style;
      const sprite = scene.add
        .tileSprite(zone.x, zone.y, zone.width, zone.height, style === 'lava' ? TEXTURES.lava : TEXTURES.danger)
        .setOrigin(0, 0)
        .setDepth(depth.entities - 1);
      if (style === 'lava') this.lava.push(sprite);
    }

    for (const zone of level.checkpoints) {
      const flag = scene.add
        .image(zone.x + zone.width / 2, zone.y + zone.height, TEXTURES.flagDown)
        .setOrigin(0.5, 1)
        .setDepth(depth.entities);
      this.flags.set(zone.id, flag);
    }

    for (const zone of level.exits) {
      const door = scene.add
        .image(zone.x + zone.width / 2, zone.y + zone.height, TEXTURES.door)
        .setOrigin(0.5, 1)
        .setDepth(depth.entities);
      const label = scene.add
        .text(door.x, door.y - door.height - 4, '', {
          fontFamily: VIEW_CONFIG.label.fontFamily,
          fontSize: `${VIEW_CONFIG.label.fontSize}px`,
          color: '#ffd23f',
          stroke: '#0b0d18',
          strokeThickness: 3,
        })
        .setOrigin(0.5, 1)
        .setResolution(2)
        .setDepth(depth.entities);
      this.exits.push({ zone, door, label });
    }

    for (const item of level.collectibles) {
      const key = scene.textures.exists(item.kind) ? item.kind : TEXTURES.coin;
      const image = scene.add.image(item.x, item.y, key).setDepth(depth.entities);
      scene.tweens.add({
        targets: image,
        y: item.y - collectible.bobPx,
        duration: collectible.bobMs,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
        delay: (item.id * 137) % collectible.bobMs,
      });
      this.items.set(item.id, image);
    }
  }

  /** World position of a collectible (for pickup effects). */
  itemPosition(entityId: number): { x: number; y: number } | null {
    const item = this.items.get(entityId);
    return item ? { x: item.x, y: item.y } : null;
  }

  flagPosition(checkpointId: number): { x: number; y: number } | null {
    const flag = this.flags.get(checkpointId);
    return flag ? { x: flag.x, y: flag.y - flag.height } : null;
  }

  /** Pickup animation; `sync` keeps it hidden afterwards. */
  collect(entityId: number): void {
    const item = this.items.get(entityId);
    if (!item?.visible || item.getData('collecting')) return;
    item.setData('collecting', true);
    this.scene.tweens.killTweensOf(item);
    this.scene.tweens.add({
      targets: item,
      y: item.y - 14,
      scale: 1.6,
      alpha: 0,
      duration: 260,
      ease: 'Quad.easeOut',
      onComplete: () => item.setVisible(false),
    });
  }

  sync(state: NetWorldState): void {
    for (const id of state.collected) {
      const item = this.items.get(id);
      if (item?.visible && !item.getData('collecting')) item.setVisible(false);
    }

    let changed = false;
    const active = new Set<number>();
    for (const p of state.players) if (p.checkpointId !== null) active.add(p.checkpointId);
    for (const [id, flag] of this.flags) {
      const on = active.has(id);
      if (on === this.active.has(id)) continue;
      changed = true;
      flag.setTexture(on ? TEXTURES.flagUp : TEXTURES.flagDown);
      if (on) {
        flag.setScale(1, 0.6);
        this.scene.tweens.add({ targets: flag, scaleY: 1, duration: 220, ease: 'Back.easeOut' });
      }
    }
    if (changed) {
      this.active.clear();
      for (const id of active) this.active.add(id);
    }

    const alive = state.players.filter((p) => p.alive).length;
    const atExit = state.players.filter((p) => p.alive && p.atExit).length;
    for (const exit of this.exits) {
      const text = state.players.length > 0 ? `${atExit}/${alive} at exit` : '';
      if (exit.label.text !== text) exit.label.setText(text);
    }
  }

  update(frameMs: number): void {
    const dx = (VIEW_CONFIG.lavaScrollPxPerSec * frameMs) / 1000;
    for (const sprite of this.lava) sprite.tilePositionX += dx;
  }
}
