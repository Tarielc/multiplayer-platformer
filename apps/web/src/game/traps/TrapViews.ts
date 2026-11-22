import {
  fanOn,
  rockHeadImpacts,
  rockHeadRect,
  sawCenter,
  type BoxTrap,
  type Dir4,
  type FallingPhase,
  type FallingPlatformTrap,
  type FanTrap,
  type RockHeadTrap,
  type SawTrap,
  type SpikeHeadTrap,
  type SpikesTrap,
  type TrampolineTrap,
  type TrapDef,
  type TrapField,
} from '@platformer/shared';
import type * as Phaser from 'phaser';
import { VIEW_CONFIG } from '../config';
import type { DebugBox } from '../debug/DebugDraw';
import type { StateMachine } from '../fsm/StateMachine';
import type { WorldCueEvent } from '../presentation';
import { createHeadStateMachine, type HeadSignals, type HeadState } from './headStateMachine';
import { BOX_DEBRIS, TRAP_SHEETS, sheetForTrap, trapAnimKey, trapFrame, type TrapClipName, type TrapSheetName } from './trapArt';

/** Rotation that turns art drawn pointing up so it points `dir`. */
const DIR_ROTATION: Record<Dir4, number> = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 };

const TRAP_DEPTH = VIEW_CONFIG.depth.entities - 0.5;

const DEBUG_COLORS = { solid: 0xffa94d, oneWay: 0xffd23f, hazard: 0xff4d6a, wind: 0x6ad8ff } as const;

type Cue = (event: WorldCueEvent) => void;

interface TrapView {
  /** `tick` = fractional simulation tick to draw at (the local player's predicted tick). */
  update(tick: number, frameMs: number): void;
  destroy(): void;
}

/**
 * Draws every trap of a level. Positions come from the same pure tick functions the server
 * uses (`TrapField` at the local predicted tick), so what you see is what you collide with;
 * replicated state (box hits, falling-platform triggers) is read from the field, which the
 * predictor keeps in sync with snapshots. One-off moments (a trampoline launch, a spike-head
 * being touched, a box hit) come in through the methods below, from game events or the
 * local prediction. Pure presentation.
 */
export class TrapViews {
  private readonly views = new Map<number, TrapView>();
  private readonly debris: Debris[] = [];
  /** Boxes the ability prop views are drawing right now (their trap view stays hidden). */
  private readonly props = new Set<number>();
  private lastTick = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly field: TrapField,
    private readonly cue: Cue,
  ) {
    for (const trap of field.traps) this.views.set(trap.id, this.createView(trap));
  }

  update(tick: number, frameMs: number): void {
    this.lastTick = tick;
    for (const view of this.views.values()) view.update(tick, frameMs);
    for (let i = this.debris.length - 1; i >= 0; i--) {
      if (this.debris[i]!.update(frameMs)) continue;
      this.debris[i]!.destroy();
      this.debris.splice(i, 1);
    }
  }

  /** A trampoline launched someone (local prediction for you, the server event for others). */
  bounce(trapId: number, isSelf: boolean): void {
    const view = this.views.get(trapId);
    if (view instanceof TrampolineView) view.launch(isSelf);
  }

  /** A player touched a trap; spike-heads squash on the side that was touched. */
  trapHit(trapId: number, side: Dir4): void {
    const view = this.views.get(trapId);
    if (view instanceof HeadView) view.impact(side);
  }

  boxHit(boxId: number, broken: boolean, isSelf: boolean): void {
    const view = this.views.get(boxId);
    if (!(view instanceof BoxView)) return;
    if (broken) this.debris.push(...view.burst(isSelf));
    else view.hit(isSelf);
  }

  /** Ids of the boxes drawn as ability props this frame. */
  setProps(ids: ReadonlySet<number>): void {
    this.props.clear();
    for (const id of ids) this.props.add(id);
  }

  /** A box that was out of the level (carried or spat by an ability) shattered at (x, y). */
  burstAt(boxId: number, variant: 1 | 2 | 3, x: number, y: number, isSelf: boolean): void {
    const view = this.views.get(boxId);
    this.debris.push(...boxDebris(this.scene, sheetForTrap('box', variant), x, y));
    if (view instanceof BoxView) view.markBroken();
    this.cue({ cue: 'boxBreak', x, y, isSelf });
  }

  /** F3 overlay: collision boxes, hurt areas and wind streams at the current render tick. */
  debugBoxes(out: DebugBox[]): void {
    const tick = this.lastTick;
    for (const c of this.field.colliders(Math.floor(tick))) {
      out.push({ x: c.x, y: c.y, width: c.width, height: c.height, color: c.oneWay ? DEBUG_COLORS.oneWay : DEBUG_COLORS.solid });
    }
    for (const h of this.field.hazards(tick)) {
      const r = h.rect ?? (h.circle && { x: h.circle.x - h.circle.r, y: h.circle.y - h.circle.r, width: h.circle.r * 2, height: h.circle.r * 2 });
      if (r) out.push({ ...r, color: DEBUG_COLORS.hazard, ghost: true });
    }
    for (const fan of this.field.fans) out.push({ ...fan.stream, color: DEBUG_COLORS.wind, ghost: true });
  }

  destroy(): void {
    for (const view of this.views.values()) view.destroy();
    this.views.clear();
    for (const piece of this.debris) piece.destroy();
    this.debris.length = 0;
  }

  private createView(trap: TrapDef): TrapView {
    const { scene, field, cue } = this;
    switch (trap.kind) {
      case 'spikes':
        return new SpikesView(scene, trap);
      case 'trampoline':
        return new TrampolineView(scene, trap, cue);
      case 'saw':
        return new SawView(scene, trap);
      case 'fallingPlatform':
        return new FallingPlatformView(scene, trap, field, cue);
      case 'fan':
        return new FanView(scene, trap);
      case 'rockHead':
        return new HeadView(scene, trap, 'rockHead', cue);
      case 'spikeHead':
        return new HeadView(scene, trap, 'spikeHead', cue);
      case 'box':
        return new BoxView(scene, trap, field, cue, (id) => this.props.has(id));
    }
  }
}

// --- helpers ---------------------------------------------------------------------------------

/** A sprite whose frame `bodyX/bodyY` sits on the body's top-left. */
function bodySprite(scene: Phaser.Scene, name: TrapSheetName, x: number, y: number): Phaser.GameObjects.Sprite {
  const sheet = TRAP_SHEETS[name];
  return scene.add
    .sprite(x - sheet.bodyX, y - sheet.bodyY, sheet.key, trapFrame(name, 0, 0))
    .setOrigin(0, 0)
    .setDepth(TRAP_DEPTH);
}

const play = (sprite: Phaser.GameObjects.Sprite, clip: TrapClipName) => sprite.play(trapAnimKey(clip));

/** Shows `frame` again whenever a one-shot clip on `sprite` finishes. */
function settleOnComplete(sprite: Phaser.GameObjects.Sprite, frame: number): void {
  sprite.on('animationcomplete', () => sprite.setFrame(frame));
}

// --- views -----------------------------------------------------------------------------------

class SpikesView implements TrapView {
  private readonly strip: Phaser.GameObjects.TileSprite;

  constructor(scene: Phaser.Scene, trap: SpikesTrap) {
    const across = trap.dir === 'up' || trap.dir === 'down';
    // The art points up; a left/right column is a horizontal strip turned on its side.
    const length = across ? trap.width : trap.height;
    const thickness = across ? trap.height : trap.width;
    this.strip = scene.add
      .tileSprite(trap.x + trap.width / 2, trap.y + trap.height / 2, length, thickness, TRAP_SHEETS.spikes.key, 0)
      .setRotation(DIR_ROTATION[trap.dir])
      .setDepth(TRAP_DEPTH - 0.1);
  }

  update(): void {}

  destroy(): void {
    this.strip.destroy();
  }
}

class TrampolineView implements TrapView {
  private readonly sprite: Phaser.GameObjects.Sprite;

  constructor(
    scene: Phaser.Scene,
    private readonly trap: TrampolineTrap,
    private readonly cue: Cue,
  ) {
    this.sprite = bodySprite(scene, 'trampoline', trap.x, trap.y);
    settleOnComplete(this.sprite, 0);
  }

  launch(isSelf: boolean): void {
    play(this.sprite, 'trampoline:launch');
    this.cue({ cue: 'bounce', x: this.trap.x + this.trap.width / 2, y: this.trap.y, isSelf });
  }

  update(): void {}

  destroy(): void {
    this.sprite.destroy();
  }
}

class SawView implements TrapView {
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly track: Phaser.GameObjects.Graphics | null = null;

  constructor(
    scene: Phaser.Scene,
    private readonly trap: SawTrap,
  ) {
    if (trap.ax !== trap.bx || trap.ay !== trap.by) {
      // Dotted rail between the two ends, with a stud at each end.
      const g = scene.add.graphics().setDepth(TRAP_DEPTH - 0.2);
      const length = Math.hypot(trap.bx - trap.ax, trap.by - trap.ay);
      const steps = Math.max(1, Math.floor(length / 6));
      g.fillStyle(0x1b1f2e, 0.75);
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        g.fillRect(Math.round(trap.ax + (trap.bx - trap.ax) * t) - 1, Math.round(trap.ay + (trap.by - trap.ay) * t) - 1, 2, 2);
      }
      g.fillStyle(0x3a4057, 1);
      g.fillCircle(trap.ax, trap.ay, 3).fillCircle(trap.bx, trap.by, 3);
      this.track = g;
    }
    this.sprite = scene.add.sprite(trap.ax, trap.ay, TRAP_SHEETS.saw.key, 0).setOrigin(0.5, 0.5).setDepth(TRAP_DEPTH);
    play(this.sprite, 'saw:spin');
  }

  update(tick: number): void {
    const c = sawCenter(this.trap, tick);
    this.sprite.setPosition(c.x, c.y);
  }

  destroy(): void {
    this.track?.destroy();
    this.sprite.destroy();
  }
}

class FallingPlatformView implements TrapView {
  private readonly sprite: Phaser.GameObjects.Sprite;
  private phase: FallingPhase = 'idle';
  /** Fade-in after coming back, ms left. */
  private fadeMs = 0;

  constructor(
    scene: Phaser.Scene,
    private readonly trap: FallingPlatformTrap,
    private readonly field: TrapField,
    private readonly cue: Cue,
  ) {
    this.sprite = bodySprite(scene, 'fallingPlatform', trap.x, trap.y);
    play(this.sprite, 'fallingPlatform:fly');
  }

  update(tick: number, frameMs: number): void {
    const { trap, sprite } = this;
    const state = this.field.fallingState(trap, tick);
    const { fallTicks } = this.field.config.fallingPlatform;
    if (state.phase !== this.phase) {
      if (state.phase === 'shaking') this.cue({ cue: 'shake', x: trap.x + trap.width / 2, y: trap.y, isSelf: false });
      if (state.phase === 'idle' && (this.phase === 'gone' || this.phase === 'falling')) this.fadeMs = 300;
      this.phase = state.phase;
    }
    this.fadeMs = Math.max(0, this.fadeMs - frameMs);
    let x = trap.x;
    let alpha = 1 - this.fadeMs / 300;
    if (state.phase === 'shaking') x += Math.round(Math.sin(state.elapsed * 2.2));
    if (state.phase === 'falling') alpha = Math.min(1, Math.max(0, 1 - (state.elapsed - fallTicks * 0.55) / (fallTicks * 0.45)));
    sprite.setVisible(state.phase !== 'gone');
    sprite.setAlpha(alpha);
    sprite.setPosition(x - TRAP_SHEETS.fallingPlatform.bodyX, trap.y + state.dy - TRAP_SHEETS.fallingPlatform.bodyY);
  }

  destroy(): void {
    this.sprite.destroy();
  }
}

interface Streak {
  shape: Phaser.GameObjects.Rectangle;
  /** 0..1 along the stream, from the fan outwards. */
  t: number;
  /** 0..1 across the stream. */
  u: number;
  speed: number;
}

class FanView implements TrapView {
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly streaks: Streak[] = [];
  private on: boolean | null = null;

  constructor(
    scene: Phaser.Scene,
    private readonly trap: FanTrap,
  ) {
    this.sprite = scene.add
      .sprite(trap.x + trap.width / 2, trap.y + trap.height / 2, TRAP_SHEETS.fan.key, 0)
      .setRotation(DIR_ROTATION[trap.dir])
      .setDepth(TRAP_DEPTH);
    const vertical = trap.dir === 'up' || trap.dir === 'down';
    for (let i = 0; i < 5; i++) {
      const shape = scene.add
        .rectangle(0, 0, vertical ? 1 : 6, vertical ? 6 : 1, 0xffffff, 1)
        .setDepth(VIEW_CONFIG.depth.effects - 1);
      this.streaks.push({ shape, t: i / 5, u: Math.random(), speed: 0.9 + Math.random() * 0.5 });
    }
  }

  update(tick: number, frameMs: number): void {
    const on = fanOn(this.trap, tick);
    if (on !== this.on) {
      this.on = on;
      if (on) play(this.sprite, 'fan:on');
      else this.sprite.stop().setFrame(0);
    }
    const s = this.trap.stream;
    const length = this.trap.dir === 'up' || this.trap.dir === 'down' ? s.height : s.width;
    for (const streak of this.streaks) {
      streak.shape.setVisible(on);
      if (!on) continue;
      streak.t += (streak.speed * 220 * frameMs) / 1000 / Math.max(1, length);
      if (streak.t >= 1) {
        streak.t -= 1;
        streak.u = Math.random();
      }
      const { t, u } = streak;
      const [x, y] =
        this.trap.dir === 'up'
          ? [s.x + u * s.width, s.y + s.height * (1 - t)]
          : this.trap.dir === 'down'
            ? [s.x + u * s.width, s.y + s.height * t]
            : this.trap.dir === 'left'
              ? [s.x + s.width * (1 - t), s.y + u * s.height]
              : [s.x + s.width * t, s.y + u * s.height];
      streak.shape.setPosition(Math.round(x), Math.round(y)).setAlpha(0.45 * (1 - t) * Math.min(1, t * 6));
    }
  }

  destroy(): void {
    this.sprite.destroy();
    for (const streak of this.streaks) streak.shape.destroy();
  }
}

/** Rock-heads (impacts from their schedule) and spike-heads (impacts from players touching them). */
class HeadView implements TrapView {
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly fsm: StateMachine<HeadState, HeadSignals>;
  private pending: Dir4 | null = null;
  private lastTick: number | null = null;

  constructor(
    scene: Phaser.Scene,
    private readonly trap: RockHeadTrap | SpikeHeadTrap,
    private readonly sheet: 'rockHead' | 'spikeHead',
    private readonly cue: Cue,
  ) {
    this.sprite = bodySprite(scene, sheet, trap.x, trap.y);
    const { sprite } = this;
    this.fsm = createHeadStateMachine({
      idle: () => sprite.stop().setFrame(trapFrame(sheet, 0, 0)),
      blink: () => play(sprite, `${sheet}:blink`),
      impact: (side) => play(sprite, side === 'left' || side === 'right' ? `${sheet}:hitSide` : `${sheet}:hitEnd`),
      playing: () => sprite.anims.isPlaying,
    });
  }

  impact(side: Dir4): void {
    this.pending = side;
  }

  update(tick: number, frameMs: number): void {
    const { trap, sprite } = this;
    if (trap.kind === 'rockHead') {
      const rect = rockHeadRect(trap, tick);
      sprite.setPosition(rect.x - TRAP_SHEETS.rockHead.bodyX, rect.y - TRAP_SHEETS.rockHead.bodyY);
      const now = Math.floor(tick);
      // Wall slams scheduled since the last frame (skipped after a long gap, e.g. a hidden tab).
      if (this.lastTick !== null && now > this.lastTick && now - this.lastTick < 30) {
        const impacts = rockHeadImpacts(trap, this.lastTick, now);
        const last = impacts[impacts.length - 1];
        if (last) {
          this.pending = last.side;
          this.cue({ cue: 'thud', x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, isSelf: false });
        }
      }
      if (this.lastTick === null || now > this.lastTick || now < this.lastTick - 30) this.lastTick = now;
    }
    this.fsm.update({ impact: this.pending }, frameMs);
    this.pending = null;
  }

  destroy(): void {
    this.sprite.destroy();
  }
}

class BoxView implements TrapView {
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly sheet: TrapSheetName;
  private broken = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly trap: BoxTrap,
    private readonly field: TrapField,
    private readonly cue: Cue,
    private readonly isProp: (id: number) => boolean,
  ) {
    this.sheet = sheetForTrap('box', trap.variant);
    this.sprite = bodySprite(scene, this.sheet, trap.x, trap.y);
    settleOnComplete(this.sprite, 0);
  }

  hit(isSelf: boolean): void {
    if (this.broken) return;
    play(this.sprite, `${this.sheet as 'box1' | 'box2' | 'box3'}:hit`);
    this.cue({ cue: 'boxHit', ...this.center(), isSelf });
  }

  /** Breaks apart: the box disappears and its pieces fly out from the centre. */
  burst(isSelf: boolean): Debris[] {
    if (this.broken) return [];
    this.broken = true;
    this.sprite.setVisible(false).stop();
    const center = this.center();
    this.cue({ cue: 'boxBreak', ...center, isSelf });
    return boxDebris(this.scene, this.sheet, center.x, center.y);
  }

  markBroken(): void {
    this.broken = true;
    this.sprite.setVisible(false);
  }

  update(): void {
    // Broken before we saw the hit (joined late, or a dropped event): just hide it.
    if (!this.broken && this.field.isBroken(this.trap.id)) {
      this.broken = true;
      this.sprite.setVisible(false);
    }
    if (this.broken) return;
    // Picked up by an ability (drawn by the prop views meanwhile), or put down somewhere else.
    const rect = this.field.boxRect(this.trap.id);
    this.sprite.setVisible(rect !== null && !this.isProp(this.trap.id));
    if (rect) {
      const sheet = TRAP_SHEETS[this.sheet];
      this.sprite.setPosition(rect.x - sheet.bodyX, rect.y - sheet.bodyY);
    }
  }

  destroy(): void {
    this.sprite.destroy();
  }

  private center(): { x: number; y: number } {
    const rect = this.field.boxRect(this.trap.id) ?? this.trap;
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }
}

/** Box pieces flying out from (cx, cy). */
function boxDebris(scene: Phaser.Scene, sheetName: TrapSheetName, cx: number, cy: number): Debris[] {
  const sheet = TRAP_SHEETS[sheetName];
  const pieces: Debris[] = [];
  const { pieces: count, speed } = BOX_DEBRIS;
  for (let i = 0; i < count; i++) {
    // Left pieces fly left, right pieces right; all start with a hop.
    const dirX = i % 2 === 0 ? -1 : 1;
    const lift = i < 2 ? 1 : 0.55;
    const vx = dirX * speed * (0.55 + 0.45 * Math.random());
    const vy = -speed * lift * (0.9 + 0.3 * Math.random());
    const image = scene.add
      .sprite(cx + sheet.frameWidth / 2 - sheet.bodyX - 10, cy + sheet.frameHeight / 2 - sheet.bodyY - 10, sheet.key, trapFrame(sheetName, BOX_DEBRIS.row, i))
      // Just behind the terrain: pieces that fall into the ground disappear into it.
      .setDepth(VIEW_CONFIG.depth.tiles - 0.5);
    pieces.push(new Debris(image, vx, vy, dirX * (2 + Math.random() * 3)));
  }
  return pieces;
}

/** One flying box piece: ballistic, spinning, fading out, then gone. */
class Debris {
  private age = 0;

  constructor(
    private readonly image: Phaser.GameObjects.Sprite,
    private vx: number,
    private vy: number,
    private readonly spin: number,
  ) {}

  /** False once it has expired. */
  update(frameMs: number): boolean {
    const dt = frameMs / 1000;
    this.age += frameMs;
    this.vy += BOX_DEBRIS.gravity * dt;
    this.image.x += this.vx * dt;
    this.image.y += this.vy * dt;
    this.image.rotation += this.spin * dt;
    const life = BOX_DEBRIS.lifeMs;
    this.image.setAlpha(Math.min(1, Math.max(0, (life - this.age) / (life * 0.4))));
    return this.age < life;
  }

  destroy(): void {
    this.image.destroy();
  }
}
