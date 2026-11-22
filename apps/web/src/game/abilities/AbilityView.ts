import {
  ABILITIES,
  Ability,
  CHARACTER_ABILITY,
  Cargo,
  Held,
  Phase,
  isDroneOut,
  type CharacterId,
} from '@platformer/shared';
import type * as Phaser from 'phaser';
import { VIEW_CONFIG } from '../config';
import type { AbilitySignals } from '../player/playerSignals';
import type { PlayerState } from '../player/PlayerStateMachine';
import type { AbilityCueName } from '../presentation';
import { abilityAnim, abilitySheet } from './abilityAnimations';
import {
  ABILITY_SHEETS,
  TONGUE_COLORS,
  animLengthMs,
  frameAt,
  frameName,
  framePoint,
  nearestAimRow,
  reactionSheet,
  relativeAimDeg,
  type AbilityAnimDef,
} from './abilityArt';
import { playFx } from './abilityFx';
import { puff } from '../views/effects';

export interface AbilityFrame extends AbilitySignals {
  /** Bottom-centre of the hitbox, world px. */
  feetX: number;
  feetY: number;
  facing: 1 | -1;
  alive: boolean;
  /** The base animation state and how long it has lasted (ms), for the giant clips. */
  state: PlayerState;
  timeInState: number;
  /** Where the local frog's next tongue would go (world angle); null hides the reticle. */
  aimPreview: number | null;
  /** Alpha of the base sprite (hurt blink), copied onto ability poses. */
  alpha: number;
}

export interface AbilityLook {
  /** An ability pose replaces the character's normal clip. */
  hideBase: boolean;
  /** Swallowed: the player is not drawn at all. */
  hidden: boolean;
  /** Extra px to raise the name label (giant form). */
  labelLift: number;
}

const C = ABILITIES;
const DEPTH = VIEW_CONFIG.depth.players;
const GIANT_CLIPS: Readonly<Record<PlayerState, string>> = {
  idle: 'big_idle',
  run: 'big_run',
  jump: 'big_jump',
  fall: 'big_fall',
  attack: 'big_attack',
  hurt: 'big_hurt',
  dead: 'big_death',
};
/** Cues played when the owner enters a phase. */
const PHASE_CUES: Partial<Record<number, AbilityCueName>> = {
  [Phase.HEAL]: 'healStart',
  [Phase.DRONE_DEPLOY]: 'drone',
  [Phase.GIANT_GROW]: 'grow',
  [Phase.GIANT_SHRINK]: 'shrink',
  [Phase.TONGUE_SHOOT]: 'tongue',
  [Phase.TONGUE_GULP]: 'gulp',
  [Phase.TONGUE_SPIT]: 'spit',
};
/**
 * The claw's grab attempt (ms after the press): it drops, snaps shut, and if nothing was caught
 * by `emptyAt` it rattles, puffs air and reels back up, opening again on the way.
 */
const LUNGE = { dropMs: 80, closeMs: 190, emptyAt: 200, riseMs: 160, depth: 12 } as const;
const LUNGE_MS = LUNGE.dropMs + LUNGE.closeMs + LUNGE.riseMs;

/** Frames of a tongue aim row: windup 0-1, shoot 2, hold 3-4, retract 5, spit 6-7. */
const TONGUE_OUT_PHASES: ReadonlySet<number> = new Set([Phase.TONGUE_SHOOT, Phase.TONGUE_PULL, Phase.TONGUE_RETRACT]);

/**
 * Draws one player's special ability, driven entirely by replicated state (phase + timers), so
 * the local predicted player and interpolated remote players look the same:
 *
 *  - an ability pose sprite inside the player's container that replaces the normal clip
 *    (heal hug, drone pilot, giant form, tongue aim rows, gulp/hold) and reaction poses when
 *    someone else's ability holds this player (pulled, hugged, carried, spat);
 *  - scene-level pieces: the hug's front arm, the drone with its cable and claw, the tongue,
 *    the aim reticle, spit trails.
 *
 * Every sheet is optional: a missing one falls back to the character's normal clips.
 */
export class AbilityView {
  /** Pose sprite; lives in the player's container (positioned at the feet). */
  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly front: Phaser.GameObjects.Sprite;
  private readonly drone: Phaser.GameObjects.Sprite;
  private readonly claw: Phaser.GameObjects.Sprite;
  private readonly cable: Phaser.GameObjects.Graphics;
  private readonly tongue: Phaser.GameObjects.Graphics;
  private readonly tip: Phaser.GameObjects.Sprite;
  private readonly reticle: Phaser.GameObjects.Sprite;
  private characterId: CharacterId;
  private clock = 0;
  private lastPhase: number = Phase.NONE;
  private lastHeld: number = Held.NONE;
  private heldSince = 0;
  private lastCargo: number = Cargo.NONE;
  private cargoSince = -1000;
  private lastSpecialSeq: number | null = null;
  private lungeStart = -Infinity;
  private lungeEmpty = false;
  private lungeSnapped = false;
  private droneFlip = false;
  private lastHealFrame = -1;
  private trailMs = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    characterId: CharacterId,
    private readonly cue: (cue: AbilityCueName, x: number, y: number) => void,
  ) {
    this.characterId = characterId;
    const blank = (key: string) => (scene.textures.exists(key) ? key : '__MISSING');
    this.sprite = scene.add.sprite(0, 0, blank(ABILITY_SHEETS.heal.key)).setVisible(false);
    this.front = scene.add.sprite(0, 0, blank(ABILITY_SHEETS.heal.key)).setVisible(false).setDepth(DEPTH + 2);
    this.drone = scene.add.sprite(0, 0, blank(ABILITY_SHEETS.drone.key)).setVisible(false).setDepth(DEPTH + 3);
    this.claw = scene.add.sprite(0, 0, blank(ABILITY_SHEETS.claw.key)).setVisible(false).setDepth(DEPTH + 3);
    this.cable = scene.add.graphics().setDepth(DEPTH + 2.9);
    this.tongue = scene.add.graphics().setDepth(DEPTH - 0.5);
    this.tip = scene.add.sprite(0, 0, blank(ABILITY_SHEETS.tongueParts.key)).setVisible(false).setDepth(DEPTH - 0.4);
    this.reticle = scene.add.sprite(0, 0, blank(ABILITY_SHEETS.tongueParts.key)).setVisible(false).setDepth(VIEW_CONFIG.depth.effects);
  }

  setCharacter(id: CharacterId): void {
    this.characterId = id;
  }

  /** The drone sprite while it is out (the camera follows it for its pilot). */
  get droneTarget(): Phaser.GameObjects.Sprite | null {
    return this.drone.visible ? this.drone : null;
  }

  update(f: AbilityFrame, dtMs: number): AbilityLook {
    this.clock += dtMs;
    this.hideExtras();
    const look: AbilityLook = { hideBase: false, hidden: false, labelLift: 0 };
    this.sprite.setVisible(false).setAlpha(f.alpha);

    if (f.held !== this.lastHeld) {
      this.lastHeld = f.held;
      this.heldSince = this.clock;
    }
    if (f.phase !== this.lastPhase) {
      const cue = PHASE_CUES[f.phase];
      this.lastPhase = f.phase;
      this.lastHealFrame = -1;
      if (cue && f.alive) this.cue(cue, f.feetX, f.feetY);
    }
    if (f.cargo !== this.lastCargo) {
      this.lastCargo = f.cargo;
      this.cargoSince = this.clock;
      this.lungeStart = -Infinity; // caught something (or let go): the claw state takes over
    }
    if (f.specialSeq !== this.lastSpecialSeq) {
      // A press while flying with an empty claw is a grab attempt (with cargo it is a drop).
      const press = this.lastSpecialSeq !== null && f.phase === Phase.DRONE_PILOT && f.cargo === Cargo.NONE;
      this.lastSpecialSeq = f.specialSeq;
      if (press && f.alive) {
        this.lungeStart = this.clock;
        this.lungeEmpty = false;
        this.lungeSnapped = false;
      }
    }
    if (!f.alive) {
      // A giant dies big; the pose goes away with the clip, like the normal Death clip.
      const death = abilityAnim(ABILITY_SHEETS.bigForm.key, 'big_death');
      if (f.giant > 0 && death) {
        look.hideBase = true;
        if (f.timeInState < animLengthMs(death)) this.pose(ABILITY_SHEETS.bigForm.key, 'big_death', f.timeInState, f);
      }
      return look;
    }

    // Someone else's ability has this player.
    if (f.held === Held.SWALLOWED) {
      look.hidden = true;
      return look;
    }
    const react = reactionSheet(this.characterId).key;
    if (f.held !== Held.NONE) {
      const clip = f.held === Held.CARRIED ? 'carried' : f.held === Held.HUGGED ? 'hugged' : 'pulled';
      look.hideBase = this.pose(react, clip, this.clock - this.heldSince, f);
      return look;
    }
    if (f.flight > 0) {
      look.hideBase = this.pose(react, 'spat', this.clock, f);
      this.trail(f, dtMs);
      return look;
    }

    const ability = CHARACTER_ABILITY[this.characterId];
    const ms = f.phaseTime * 1000;
    switch (ability) {
      case Ability.HEAL:
        if (f.phase === Phase.HEAL) look.hideBase = this.heal(f, ms);
        break;
      case Ability.DRONE:
        look.hideBase = this.pilot(f, ms);
        this.droneAndClaw(f);
        break;
      case Ability.GIANT:
        if (f.phase === Phase.GIANT_GROW) look.hideBase = this.pose(ABILITY_SHEETS.bigForm.key, 'grow', ms, f);
        else if (f.phase === Phase.GIANT_SHRINK) look.hideBase = this.pose(ABILITY_SHEETS.bigForm.key, 'shrink', ms, f);
        else if (f.giant > 0) look.hideBase = this.pose(ABILITY_SHEETS.bigForm.key, GIANT_CLIPS[f.state], f.timeInState, f);
        if (look.hideBase && f.phase !== Phase.GIANT_SHRINK) look.labelLift = 16;
        break;
      case Ability.TONGUE:
        look.hideBase = this.frog(f, ms);
        break;
    }
    return look;
  }

  destroy(): void {
    for (const o of [this.sprite, this.front, this.drone, this.claw, this.cable, this.tongue, this.tip, this.reticle]) o.destroy();
  }

  // --- poses -----------------------------------------------------------------------------------

  /** Shows frame `ms` of `key`/`anim` on the pose sprite (feet at the container origin). */
  private pose(key: string, anim: string, ms: number, f: AbilityFrame, frame?: number): boolean {
    const def = abilityAnim(key, anim);
    if (!def) return false;
    const i = frame ?? frameAt(def, ms);
    this.place(this.sprite, key, anim, def, i, f.facing);
    this.sprite.setPosition(0, 0).setVisible(true);
    return true;
  }

  /** Sets texture, frame, flip and the pivot-based origin of `sprite`. */
  private place(sprite: Phaser.GameObjects.Sprite, key: string, anim: string, def: AbilityAnimDef, i: number, facing: 1 | -1): void {
    const pivot = abilitySheet(key)?.pivot ?? { x: 0, y: 0 };
    const [, , w, h] = def.rects[i] ?? def.rects[0]!;
    const flip = facing < 0;
    sprite
      .setTexture(key, frameName(anim, i))
      .setFlipX(flip)
      .setOrigin(flip ? (w - pivot.x) / w : pivot.x / w, (pivot.y + 1) / h);
  }

  /** A frame-local point of a pivoted sheet → world px. */
  private worldPoint(key: string, point: readonly [number, number], f: AbilityFrame): { x: number; y: number } {
    const pivot = abilitySheet(key)?.pivot ?? { x: 0, y: 0 };
    return { x: f.feetX + (point[0] + 0.5 - pivot.x) * f.facing, y: f.feetY - (pivot.y + 0.5 - point[1]) };
  }

  private heal(f: AbilityFrame, ms: number): boolean {
    const key = ABILITY_SHEETS.heal.key;
    const def = abilityAnim(key, 'heal');
    if (!def) return false;
    const i = frameAt(def, ms);
    this.pose(key, 'heal', ms, f, i);
    // The arm that wraps around the hugged player is drawn over them.
    const frontDef = abilityAnim(key, 'heal_front');
    if (frontDef) {
      this.place(this.front, key, 'heal_front', frontDef, Math.min(i, frontDef.rects.length - 1), f.facing);
      this.front.setPosition(f.feetX, f.feetY).setAlpha(f.alpha).setVisible(true);
    }
    if (i !== this.lastHealFrame) {
      const kiss = framePoint(def, i, 'kiss');
      const hadKiss = this.lastHealFrame >= 0 && framePoint(def, this.lastHealFrame, 'kiss');
      if (kiss && !hadKiss) {
        const at = this.worldPoint(key, kiss, f);
        playFx(this.scene, ABILITY_SHEETS.healFx.key, 'kiss', at.x, at.y, { vy: -24, depth: DEPTH + 4 });
        this.cue('kiss', at.x, at.y);
      }
      this.lastHealFrame = i;
    }
    return true;
  }

  private pilot(f: AbilityFrame, ms: number): boolean {
    const key = ABILITY_SHEETS.pilot.key;
    switch (f.phase) {
      case Phase.DRONE_DEPLOY:
        return this.pose(key, 'deploy', ms, f);
      case Phase.DRONE_SIT:
        return this.pose(key, 'sit_down', ms, f);
      case Phase.DRONE_PILOT:
        return this.pose(key, f.cargo !== Cargo.NONE ? 'pilot_excited' : 'pilot', this.clock, f);
      case Phase.DRONE_RECALL:
        return this.pose(key, 'pilot', this.clock, f);
      case Phase.DRONE_CATCH:
        return this.pose(key, 'catch', ms, f);
      case Phase.DRONE_STAND:
        return this.pose(key, 'stand_up', ms, f);
      default:
        return false;
    }
  }

  private droneAndClaw(f: AbilityFrame): void {
    if (!isDroneOut(f, C)) return;
    const key = ABILITY_SHEETS.drone.key;
    const d = C.drone;
    const t = f.phaseTime;
    const moving = Math.hypot(f.droneVx, f.droneVy) > 20;
    let anim: string;
    let ms = this.clock;
    if (f.phase === Phase.DRONE_DEPLOY) {
      anim = 'deploy';
      ms = (t - d.spawnAt) * 1000 * (530 / Math.max(1, (d.deploy - d.spawnAt) * 1000));
    } else if (f.phase === Phase.DRONE_RECALL) {
      anim = t < d.recall ? 'hover' : 'recall';
      if (t >= d.recall) ms = ((t - d.recall) / Math.max(0.001, d.return)) * 310;
    } else if (f.cargo !== Cargo.NONE) anim = moving ? 'carry_fly' : 'carry';
    else anim = moving ? 'fly' : 'hover';
    const def = abilityAnim(key, anim);
    if (!def) return;
    if (f.droneVx > 5) this.droneFlip = false;
    else if (f.droneVx < -5) this.droneFlip = true;
    else if (f.phase !== Phase.DRONE_PILOT) this.droneFlip = f.facing < 0;
    const i = frameAt(def, ms);
    const lunge = this.lunge(f);
    this.drone
      .setTexture(key, frameName(anim, i))
      .setFlipX(this.droneFlip)
      .setOrigin(0.5, 0.5)
      .setPosition(f.droneX, f.droneY + lunge.droneDy)
      .setRotation(lunge.tilt)
      .setVisible(true);

    // Cable and claw: reeled in while deploying / recalling.
    let reel = 0;
    if (f.phase === Phase.DRONE_DEPLOY) reel = 1;
    else if (f.phase === Phase.DRONE_SIT) reel = 1 - Math.min(1, t / Math.max(0.001, d.sit));
    else if (f.phase === Phase.DRONE_RECALL) reel = Math.min(1, t / Math.max(0.001, d.recall));
    const winchPoint = framePoint(def, i, 'winch') ?? [24, 32];
    const flip = this.droneFlip ? -1 : 1;
    const winch = { x: f.droneX + (winchPoint[0] + 0.5 - 24) * flip, y: f.droneY + (winchPoint[1] + 0.5 - 24) };
    const gripY = f.droneY + d.gripY;
    const clawTop = Math.max(winch.y, gripY - 5 - (gripY - 5 - winch.y) * reel) + lunge.clawDy;
    const clawKey = ABILITY_SHEETS.claw.key;
    const holding = f.cargo !== Cargo.NONE && f.phase === Phase.DRONE_PILOT;
    let clawAnim = holding ? 'close' : this.clock - this.cargoSince < 140 ? 'release' : 'open';
    let clawMs = this.clock - this.cargoSince;
    if (lunge.claw) [clawAnim, clawMs] = lunge.claw;
    const clawDef = abilityAnim(clawKey, clawAnim);
    if (clawDef) {
      const ci = frameAt(clawDef, clawMs);
      this.claw
        .setTexture(clawKey, frameName(clawAnim, ci))
        .setOrigin(0.5, 0)
        .setPosition(f.droneX + lunge.clawDx, clawTop)
        .setVisible(true);
    }
    if (clawTop > winch.y + 1) {
      this.cable.fillStyle(TONGUE_COLORS.outline, 1).fillRect(Math.round(winch.x) - 1, winch.y, 2, clawTop - winch.y);
      this.cable.fillStyle(0x8b93af, 1).fillRect(Math.round(winch.x) - 1, winch.y, 1, clawTop - winch.y);
    }
  }

  /** Offsets and claw clip of the current grab attempt (all zero when there is none). */
  private lunge(f: AbilityFrame): { clawDy: number; clawDx: number; droneDy: number; tilt: number; claw: [string, number] | null } {
    const since = this.clock - this.lungeStart;
    if (f.phase !== Phase.DRONE_PILOT || f.cargo !== Cargo.NONE || since < 0 || since >= LUNGE_MS) {
      return { clawDy: 0, clawDx: 0, droneDy: 0, tilt: 0, claw: null };
    }
    const { dropMs, closeMs, emptyAt, riseMs, depth } = LUNGE;
    const closeAt = dropMs;
    const riseAt = dropMs + closeMs;
    let clawDy: number;
    if (since < closeAt) clawDy = depth * (1 - (1 - since / dropMs) ** 2); // ease out
    else if (since < riseAt) clawDy = depth;
    else clawDy = depth * (1 - (since - riseAt) / riseMs);

    if (since >= closeAt && !this.lungeSnapped) {
      this.lungeSnapped = true;
      this.cue('clawSnap', f.droneX, f.droneY + C.drone.gripY + depth);
    }
    // Still nothing in the claw after the snap: rattle the empty jaws and puff a little air.
    const empty = since >= emptyAt;
    if (empty && !this.lungeEmpty) {
      this.lungeEmpty = true;
      puff(this.scene, f.droneX, f.droneY + C.drone.gripY + depth + 8, 0xffffff, 4, 0.35);
    }
    const rattle = empty && since < riseAt ? (Math.floor(since / 30) % 2 === 0 ? 1 : -1) : 0;
    const tilt = empty ? Math.sin(((since - emptyAt) / (LUNGE_MS - emptyAt)) * Math.PI * 3) * 0.06 * (1 - (since - emptyAt) / (LUNGE_MS - emptyAt)) : 0;
    let claw: [string, number];
    if (since < closeAt) claw = ['open', 0];
    else if (since < riseAt) claw = ['close', since - closeAt];
    else claw = ['release', since - riseAt];
    return { clawDy, clawDx: rattle, droneDy: since >= closeAt && since < emptyAt ? 1 : 0, tilt, claw };
  }

  private frog(f: AbilityFrame, ms: number): boolean {
    const parts = ABILITY_SHEETS.tongueParts.key;
    if (f.aimPreview !== null && (f.phase === Phase.NONE || f.phase === Phase.TONGUE_HOLD)) {
      const reticle = abilityAnim(parts, 'reticle');
      if (reticle) {
        const ox = f.feetX + f.facing * C.tongue.mouth.x;
        const oy = f.feetY + C.tongue.mouth.y;
        const range = f.phase === Phase.TONGUE_HOLD ? 72 : C.tongue.maxLength;
        this.reticle
          .setTexture(parts, frameName('reticle', frameAt(reticle, this.clock)))
          .setPosition(ox + Math.cos(f.aimPreview) * range, oy + Math.sin(f.aimPreview) * range)
          .setAlpha(f.phase === Phase.NONE && f.specialCooldown > 0 ? 0.35 : 0.9)
          .setVisible(true);
      }
    }
    const caster = ABILITY_SHEETS.tongueCaster.key;
    switch (f.phase) {
      case Phase.TONGUE_GULP:
        return this.pose(caster, 'gulp', ms, f);
      case Phase.TONGUE_HOLD:
        return this.pose(caster, 'hold', this.clock, f);
      case Phase.NONE:
        return false;
    }
    const key = ABILITY_SHEETS.tongueAim.key;
    const row = nearestAimRow(relativeAimDeg(f.aim, f.facing));
    let i: number;
    switch (f.phase) {
      case Phase.TONGUE_WINDUP:
        i = ms < 100 ? 0 : 1;
        break;
      case Phase.TONGUE_SHOOT:
        i = 2;
        break;
      case Phase.TONGUE_PULL:
        i = 3 + (Math.floor(this.clock / 120) % 2);
        break;
      case Phase.TONGUE_RETRACT:
        i = 5;
        break;
      case Phase.TONGUE_SPIT:
        i = ms < 100 ? 6 : 7;
        break;
      default:
        i = 7;
    }
    if (!this.pose(key, row, 0, f, i)) return false;
    if (TONGUE_OUT_PHASES.has(f.phase) && f.reach > 0) this.drawTongue(f, key, row, i);
    return true;
  }

  private drawTongue(f: AbilityFrame, key: string, row: string, i: number): void {
    const def = abilityAnim(key, row)!;
    const mouthPoint = framePoint(def, i, 'mouth');
    const sx = f.feetX + f.facing * C.tongue.mouth.x;
    const sy = f.feetY + C.tongue.mouth.y;
    const from = mouthPoint ? this.worldPoint(key, mouthPoint, f) : { x: sx, y: sy };
    const tipX = sx + Math.cos(f.aim) * f.reach;
    const tipY = sy + Math.sin(f.aim) * f.reach;
    this.tongue.lineStyle(4, TONGUE_COLORS.outline, 1).lineBetween(from.x, from.y, tipX, tipY);
    this.tongue.lineStyle(2, TONGUE_COLORS.fill, 1).lineBetween(from.x, from.y, tipX, tipY);
    const parts = ABILITY_SHEETS.tongueParts.key;
    const tipAnim = f.phase === Phase.TONGUE_PULL ? 'tip_grab' : 'tip';
    if (abilityAnim(parts, tipAnim)) {
      this.tip.setTexture(parts, frameName(tipAnim, 0)).setOrigin(0.5, 0.5).setPosition(tipX, tipY).setVisible(true);
    }
  }

  /** Slime droplets behind a spat player. */
  private trail(f: AbilityFrame, dtMs: number): void {
    this.trailMs += dtMs;
    if (this.trailMs < 60) return;
    this.trailMs = 0;
    playFx(this.scene, ABILITY_SHEETS.spitFx.key, 'trail', f.feetX, f.feetY - 12, { fade: true, depth: DEPTH - 0.6 });
  }

  private hideExtras(): void {
    this.front.setVisible(false);
    this.drone.setVisible(false);
    this.claw.setVisible(false);
    this.cable.clear();
    this.tongue.clear();
    this.tip.setVisible(false);
    this.reticle.setVisible(false);
  }
}
