import { FOE_TUNING, modeFoes, type FoeTuning, type GameMode, type NetFoeState, type NetShotState } from '@platformer/shared';
import type * as Phaser from 'phaser';
import { abilitySheet } from '../abilities/abilityAnimations';
import { frameAt, frameName, type AbilitySheetDef } from '../abilities/abilityArt';
import { VIEW_CONFIG } from '../config';
import type { DebugBox } from '../debug/DebugDraw';
import type { WorldCueEvent } from '../presentation';
import { BossBar } from './BossBar';
import { FOE_SHEETS, foeClip, foePivot, shotClip, shotPivot } from './foeArt';

/** F3 colour of foe hitboxes. */
const DEBUG_COLOR = 0xff5d73;
/** How fast a spat foe tumbles (rad/s). */
const SPIN = 14;

/**
 * Where the local player's ability holds a foe, from the predicted body (so it isn't drawn
 * 100 ms behind the tongue or the claw): hanging from the claw's grip (x, y) by its top,
 * centred on the tongue tip (x, y), or in the frog's mouth (hidden; x, y unused).
 */
export interface FoeAnchor {
  at: 'claw' | 'tongue' | 'mouth';
  x: number;
  y: number;
}

const NO_ANCHORS: ReadonlyMap<number, FoeAnchor> = new Map();

/**
 * Draws the foes and their stingers and bananas from (interpolated) replicated state. Frames
 * come from each foe's state clock, so a peck or a throw lines up with when the server lets
 * it hurt. Foes whose sheet failed to load are simply not drawn. Also announces what is worth
 * a sound: a chicken's squawk, a bull's snort and crash, a shot leaving, the rhino's roar and
 * stomps (which shake the screen too), and shows the boss's health bar.
 */
export class FoeViews {
  private readonly foes = new Map<number, { sprite: Phaser.GameObjects.Sprite; state: string }>();
  private readonly shots = new Map<number, { sprite: Phaser.GameObjects.Sprite; hit: boolean }>();
  private last: readonly NetFoeState[] = [];
  private readonly bossBar: BossBar;
  /** The level's foe tuning: co-op scales foe health to the team (boss bar, rhino rage). */
  private tuning: Readonly<FoeTuning> = FOE_TUNING;
  private team: { mode: GameMode; players: number } | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly onCue: (event: WorldCueEvent) => void,
  ) {
    this.bossBar = new BossBar(scene);
  }

  /** The room's mode and the team the level was scaled for (`RoomInfo.scaledFor`); cheap to call every frame. */
  setTeam(mode: GameMode, scaledFor: number | null): void {
    const players = scaledFor ?? 1;
    if (this.team?.mode === mode && this.team.players === players) return;
    this.team = { mode, players };
    this.tuning = modeFoes(mode, players);
  }

  update(
    samples: readonly NetFoeState[],
    shots: readonly NetShotState[],
    held: ReadonlyMap<number, FoeAnchor> = NO_ANCHORS,
    frameMs = 16,
  ): void {
    const foes = held.size > 0 ? samples.map((foe) => anchored(foe, held.get(foe.id))) : samples;
    this.last = foes;
    this.bossBar.update(foes, frameMs, this.tuning);
    const seen = new Set<number>();
    for (const foe of foes) {
      const sheet = abilitySheet(FOE_SHEETS[foe.kind].key);
      if (!sheet) continue;
      seen.add(foe.id);
      let view = this.foes.get(foe.id);
      if (!view) {
        const sprite = this.scene.add.sprite(0, 0, FOE_SHEETS[foe.kind].key).setDepth(VIEW_CONFIG.depth.players - 1);
        view = { sprite, state: foe.state };
        this.foes.set(foe.id, view);
      } else if (view.state !== foe.state) {
        view.state = foe.state;
        this.cue(foe);
      }
      if (foe.state === 'swallowed') {
        view.sprite.setVisible(false);
        continue;
      }
      const { anim, scale } = foeClip(foe, this.tuning.rhino.hp);
      const at = foePivot(foe, sheet);
      if (!this.pose(view.sprite, sheet, anim, foe.t * 1000, scale)) continue;
      if (foe.state === 'flying') {
        // Spat: it tumbles about its middle.
        const { height } = FOE_TUNING[foe.kind];
        view.sprite.setOrigin(0.5, 0.5).setPosition(foe.x, foe.y - height / 2).setRotation(foe.facing * foe.t * SPIN);
      } else {
        view.sprite.setPosition(at.x, at.y).setRotation(0);
      }
      view.sprite.setFlipX(foe.facing < 0);
    }
    for (const [id, view] of this.foes) {
      if (seen.has(id)) continue;
      view.sprite.destroy();
      this.foes.delete(id);
    }

    const flying = new Set<number>();
    for (const shot of shots) {
      const sheetFile = FOE_SHEETS[shot.kind];
      const sheet = abilitySheet(sheetFile.key);
      if (!sheet) continue;
      flying.add(shot.id);
      let view = this.shots.get(shot.id);
      if (!view) {
        const sprite = this.scene.add.sprite(0, 0, sheetFile.key).setDepth(VIEW_CONFIG.depth.players + 0.6);
        view = { sprite, hit: shot.hit };
        this.shots.set(shot.id, view);
        if (!shot.hit) this.shotCue(shot);
      } else if (shot.hit && !view.hit) {
        view.hit = true;
        if (shot.kind === 'rock') {
          this.onCue({ cue: 'thud', x: shot.x, y: shot.y, isSelf: false });
          this.shake(shot.x, shot.y, 90, 0.002);
        }
      }
      const { sprite } = view;
      if (!this.pose(sprite, sheet, shotClip(shot), shot.t * 1000, 1)) continue;
      const at = shotPivot(shot, sheet);
      sprite.setPosition(at.x, at.y);
      // The stinger is drawn pointing right: turn it along its flight (and keep that on impact).
      if (shot.kind === 'stinger' && !shot.hit && (shot.vx !== 0 || shot.vy !== 0)) sprite.setRotation(Math.atan2(shot.vy, shot.vx));
      // A shockwave is drawn running right.
      if (shot.kind === 'shockwave' && shot.vx !== 0) sprite.setFlipX(shot.vx < 0);
    }
    for (const [id, view] of this.shots) {
      if (flying.has(id)) continue;
      view.sprite.destroy();
      this.shots.delete(id);
    }
  }

  /** F3: foe hitboxes. */
  debugBoxes(boxes: DebugBox[]): void {
    for (const foe of this.last) {
      if (foe.state === 'dead' || foe.state === 'swallowed') continue;
      const { width, height } = FOE_TUNING[foe.kind];
      boxes.push({ x: foe.x - width / 2, y: foe.y - height, width, height, color: DEBUG_COLOR });
    }
  }

  destroy(): void {
    for (const view of this.foes.values()) view.sprite.destroy();
    for (const view of this.shots.values()) view.sprite.destroy();
    this.foes.clear();
    this.shots.clear();
    this.bossBar.destroy();
  }

  /** Shows frame `ms` into `anim`, with the sheet's pivot as origin. False if the clip is missing. */
  private pose(sprite: Phaser.GameObjects.Sprite, sheet: AbilitySheetDef, anim: string, ms: number, scale: number): boolean {
    const def = sheet.animations[anim];
    if (!def) {
      sprite.setVisible(false);
      return false;
    }
    const frame = frameAt(def, ms, scale);
    const rect = def.rects[frame];
    if (!rect) return false;
    const [, , w, h] = rect;
    const pivot = sheet.pivot ?? { x: w / 2, y: h };
    sprite.setFrame(frameName(anim, frame)).setOrigin(pivot.x / w, pivot.y / h).setVisible(true);
    return true;
  }

  private cue(foe: NetFoeState): void {
    const at = { x: foe.x, y: foe.y, isSelf: false };
    if (foe.kind === 'chicken' && foe.state === 'alert') this.onCue({ cue: 'squawk', ...at });
    else if (foe.kind === 'bull' && foe.state === 'windup') this.onCue({ cue: 'snort', ...at });
    else if (foe.kind === 'bull' && foe.state === 'crash') this.onCue({ cue: 'thud', ...at });
    else if (foe.kind === 'rhino') this.rhinoCue(foe);
  }

  /** The boss: roars shake the screen, a charge snorts, a crash booms (the rocks come loose). Hits on its armour clang (`foeHurt`, blocked). */
  private rhinoCue(foe: NetFoeState): void {
    const at = { x: foe.x, y: foe.y - FOE_TUNING.rhino.height / 2, isSelf: false };
    switch (foe.state) {
      case 'roar':
      case 'enrage':
        this.onCue({ cue: 'roar', ...at });
        this.shake(foe.x, foe.y, foe.state === 'enrage' ? 700 : 500, 0.006);
        break;
      case 'windup':
        this.onCue({ cue: 'snort', ...at });
        break;
      case 'crash':
        this.onCue({ cue: 'thud', ...at });
        this.shake(foe.x, foe.y, 400, 0.012);
        break;
    }
  }

  private shotCue(shot: NetShotState): void {
    const at = { x: shot.x, y: shot.y, isSelf: false };
    switch (shot.kind) {
      case 'stinger':
        this.onCue({ cue: 'sting', ...at });
        break;
      case 'banana':
        this.onCue({ cue: 'toss', ...at });
        break;
      case 'shockwave':
        // The stomp lands (two waves at once: the cue's interval drops the second).
        this.onCue({ cue: 'thud', ...at });
        this.shake(shot.x, shot.y, 260, 0.008);
        break;
      case 'rock':
        this.onCue({ cue: 'shake', ...at });
        break;
    }
  }

  /** Shakes the camera, if (x, y) is on screen or near it. */
  private shake(x: number, y: number, ms: number, intensity: number): void {
    const camera = this.scene.cameras.main;
    const view = camera.worldView;
    const margin = 160;
    if (x < view.x - margin || x > view.right + margin || y < view.y - margin || y > view.bottom + margin) return;
    camera.shake(ms, intensity);
  }
}

/** A foe the local player's ability holds, moved to where the prediction has the tongue or the claw. */
function anchored(foe: NetFoeState, anchor: FoeAnchor | undefined): NetFoeState {
  if (!anchor || foe.state === 'dead') return foe;
  const state = anchor.at === 'mouth' ? 'swallowed' : 'held';
  const t = foe.state === state ? foe.t : 0;
  if (anchor.at === 'mouth') return { ...foe, state, t };
  const { height } = FOE_TUNING[foe.kind];
  return { ...foe, state, t, wall: 0, x: anchor.x, y: anchor.at === 'claw' ? anchor.y + height : anchor.y + height / 2 };
}
