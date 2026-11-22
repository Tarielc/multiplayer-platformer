import { PLAYER_CONFIG, type LevelData, type LevelZone, type NetWorldState } from '@platformer/shared';
import * as Phaser from 'phaser';
import { TEXTURES } from '../art/textures';
import { VIEW_CONFIG } from '../config';
import { FINISH_ART_HEIGHT, MARKER_ORIGIN, TRAP_SHEETS, trapAnimKey } from '../traps/trapArt';

interface ExitView {
  zone: LevelZone;
  trophy: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
}

/** Horizontal speed (px/s) at which running across the start sign makes it wobble. */
const START_BRUSH_SPEED = 60;
/** Pixels from the checkpoint frame's bottom to the top of the flag (float text anchor). */
const FLAG_TOP = 46;

/**
 * Visuals for level entities parsed from the Tiled object layer: collectibles, the start sign
 * (at the first spawn point), checkpoint flags, finish trophies (with an "n/m at exit" counter)
 * and hazard zones. Pure presentation; state (collected ids, active checkpoints, who is at the
 * exit) comes from server snapshots.
 *
 * Markers: the start sign wobbles when a player runs past it; a checkpoint raises its flag
 * when someone activates it, then waves it; the trophy bounces each time a player arrives.
 */
export class EntityViews {
  private readonly items = new Map<number, Phaser.GameObjects.Image>();
  private readonly flags = new Map<number, Phaser.GameObjects.Sprite>();
  private readonly exits: ExitView[] = [];
  private readonly lava: Phaser.GameObjects.TileSprite[] = [];
  private readonly active = new Set<number>();
  private readonly start: Phaser.GameObjects.Sprite | null = null;
  /** World x range of the start sign's art (pole to the end of the start line). */
  private readonly startSpan = { left: 0, right: 0 };
  private synced = false;
  private atExit = 0;

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

    const first = [...level.spawns].sort((a, b) => a.x - b.x)[0];
    if (first) {
      this.start = this.marker('start', first.x, first.y).setDepth(depth.entities - 0.5);
      // The art spans x 6..60 of its frame.
      const frameLeft = first.x - MARKER_ORIGIN.start.x * TRAP_SHEETS.start.frameWidth;
      this.startSpan.left = frameLeft + 6;
      this.startSpan.right = frameLeft + 60;
      this.backToIdle(this.start);
    }

    for (const zone of level.checkpoints) {
      const flag = this.marker('checkpoint', zone.x + zone.width / 2, zone.y + zone.height);
      this.flags.set(zone.id, flag);
    }

    for (const zone of level.exits) {
      const trophy = this.marker('finish', zone.x + zone.width / 2, zone.y + zone.height);
      this.backToIdle(trophy);
      const label = scene.add
        .text(trophy.x, trophy.y - FINISH_ART_HEIGHT - 4, '', {
          fontFamily: VIEW_CONFIG.label.fontFamily,
          fontSize: `${VIEW_CONFIG.label.fontSize}px`,
          color: '#ffd23f',
          stroke: '#0b0d18',
          strokeThickness: 3,
        })
        .setOrigin(0.5, 1)
        .setResolution(2)
        .setDepth(depth.entities);
      this.exits.push({ zone, trophy, label });
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
    return flag ? { x: flag.x, y: flag.y - FLAG_TOP } : null;
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
      if (this.synced && on === this.active.has(id)) continue;
      changed = true;
      if (!on) {
        flag.stop();
        flag.setFrame(0);
      } else if (this.synced) {
        // Raise the flag, then keep it waving.
        flag.play(trapAnimKey('checkpoint:flagOut'));
        flag.chain(trapAnimKey('checkpoint:flagIdle'));
      } else {
        // Already active when we joined: no raising animation.
        flag.play({ key: trapAnimKey('checkpoint:flagIdle'), startFrame: 0 });
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
      // A new arrival makes the trophy bounce.
      if (this.synced && atExit > this.atExit) exit.trophy.play(trapAnimKey('finish:pressed'));
    }
    this.atExit = atExit;

    const start = this.start;
    if (start && this.synced && !start.anims.isPlaying) {
      const { width, height } = PLAYER_CONFIG.hitbox;
      const { left, right } = this.startSpan;
      const brushed = state.players.some(
        (p) =>
          p.alive &&
          Math.abs(p.vx) >= START_BRUSH_SPEED &&
          p.x + width / 2 >= left &&
          p.x + width / 2 <= right &&
          Math.abs(p.y + height - start.y) <= 8,
      );
      if (brushed) start.play(trapAnimKey('start:moving'));
    }
    this.synced = true;
  }

  private marker(name: 'start' | 'checkpoint' | 'finish', x: number, y: number): Phaser.GameObjects.Sprite {
    const origin = MARKER_ORIGIN[name];
    return this.scene.add.sprite(x, y, TRAP_SHEETS[name].key, 0).setOrigin(origin.x, origin.y).setDepth(VIEW_CONFIG.depth.entities);
  }

  /** One-shot clips (wobble, bounce) end on the idle frame. */
  private backToIdle(sprite: Phaser.GameObjects.Sprite): void {
    sprite.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => sprite.setFrame(0));
  }

  update(frameMs: number): void {
    const dx = (VIEW_CONFIG.lavaScrollPxPerSec * frameMs) / 1000;
    for (const sprite of this.lava) sprite.tilePositionX += dx;
  }
}
