import { FOE_TUNING, isBoss, type FoeTuning, type NetFoeState } from '@platformer/shared';
import type * as Phaser from 'phaser';
import { abilitySheet } from '../abilities/abilityAnimations';
import { frameName } from '../abilities/abilityArt';
import { VIEW_CONFIG } from '../config';
import { FOE_SHEETS, rhinoRage } from './foeArt';

const WIDTH = 300;
const HEIGHT = 10;
const PORTRAIT = 40;
/** From the bottom of the screen. */
const BOTTOM = 18;
/** How fast the pale "damage taken" trail catches up with the health (fraction of the bar per second). */
const TRAIL_RATE = 0.6;

const NAMES: Partial<Record<NetFoeState['kind'], string>> = { rhino: 'BOULDER, THE RHINO' };

/**
 * The boss's health, along the bottom of the screen: its portrait (angry in a rage), its name,
 * and a bar with a trail showing the last hit. Shows once the boss wakes up (leaves `idle`),
 * and fades out after it is beaten.
 */
export class BossBar {
  private readonly root: Phaser.GameObjects.Container;
  private readonly fill: Phaser.GameObjects.Rectangle;
  private readonly trail: Phaser.GameObjects.Rectangle;
  private readonly portrait: Phaser.GameObjects.Sprite | null;
  private readonly name: Phaser.GameObjects.Text;
  /** Bosses seen awake (so the bar stays up while one stands idle mid-fight). */
  private readonly awake = new Set<number>();
  private bossId: number | null = null;
  private shown = 0;
  private trailFrac = 1;

  constructor(private readonly scene: Phaser.Scene) {
    const x = VIEW_CONFIG.width / 2;
    const y = VIEW_CONFIG.height - BOTTOM - HEIGHT / 2;
    const left = -WIDTH / 2 + PORTRAIT / 2;
    this.root = scene.add.container(x, y).setScrollFactor(0).setDepth(VIEW_CONFIG.depth.effects + 5).setAlpha(0);
    const frame = scene.add.rectangle(left - 2, 0, WIDTH + 4, HEIGHT + 4, 0x07110d).setOrigin(0, 0.5).setStrokeStyle(2, 0x4b5a46);
    const back = scene.add.rectangle(left, 0, WIDTH, HEIGHT, 0x2a1a14).setOrigin(0, 0.5);
    this.trail = scene.add.rectangle(left, 0, WIDTH, HEIGHT, 0xede6c8).setOrigin(0, 0.5);
    this.fill = scene.add.rectangle(left, 0, WIDTH, HEIGHT, 0xe8743b).setOrigin(0, 0.5);
    this.name = scene.add
      .text(left, -HEIGHT / 2 - 3, '', { fontFamily: VIEW_CONFIG.label.fontFamily, fontSize: '11px', color: '#ede6c8', stroke: '#07110d', strokeThickness: 3 })
      .setOrigin(0, 1);
    const sheet = FOE_SHEETS.rhino.key;
    this.portrait = abilitySheet(sheet)?.animations.portrait
      ? scene.add.sprite(-WIDTH / 2 - PORTRAIT / 2 + 4, -4, sheet, frameName('portrait', 0)).setOrigin(0.5, 0.5)
      : null;
    this.root.add([frame, back, this.trail, this.fill, this.name, ...(this.portrait ? [this.portrait] : [])]);
  }

  /** `tuning`: the level's foe tuning, for the boss's full health (co-op scales it). */
  update(foes: readonly NetFoeState[], frameMs: number, tuning: Readonly<FoeTuning> = FOE_TUNING): void {
    const boss = foes.find((f) => isBoss(f.kind));
    if (boss && boss.state !== 'idle') this.awake.add(boss.id);
    const showing = !!boss && this.awake.has(boss.id) && boss.state !== 'dead';
    // Fade in and out.
    this.shown = Math.max(0, Math.min(1, this.shown + (showing ? 1 : -1) * (frameMs / 400)));
    this.root.setAlpha(this.shown);
    if (!boss) return;
    if (boss.id !== this.bossId) {
      this.bossId = boss.id;
      this.trailFrac = 1;
      this.name.setText(NAMES[boss.kind] ?? boss.kind.toUpperCase());
    }
    const frac = Math.max(0, Math.min(1, boss.hp / tuning[boss.kind].hp));
    this.trailFrac = Math.max(frac, this.trailFrac - TRAIL_RATE * (frameMs / 1000));
    this.fill.setSize(WIDTH * frac, HEIGHT);
    this.trail.setSize(WIDTH * this.trailFrac, HEIGHT);
    const rage = boss.kind === 'rhino' && rhinoRage(boss, tuning.rhino.hp);
    this.fill.setFillStyle(rage ? 0xe5484d : 0xe8743b);
    this.portrait?.setFrame(frameName('portrait', rage ? 1 : 0));
  }

  destroy(): void {
    this.root.destroy();
  }
}
