import { slotStyle, type CharacterId, type HitboxSize } from '@platformer/shared';
import type * as Phaser from 'phaser';
import { AbilityView } from '../abilities/AbilityView';
import { TEXTURES } from '../art/textures';
import { VIEW_CONFIG } from '../config';
import { PlayerAnimationController } from '../player/PlayerAnimationController';
import type { PlayerSignals } from '../player/playerSignals';
import { PlayerStateMachine, type PlayerState } from '../player/PlayerStateMachine';
import type { PlayerCueEvent, PlayerCueName } from '../presentation';

export interface PlayerViewOptions {
  id: string;
  slot: number;
  name: string;
  isSelf: boolean;
  hitbox: HitboxSize;
  characterId: CharacterId;
  /** Receives every cue (jump, doubleJump, land, step, attack, hurt, death, respawn) for sound and effects. */
  onCue: (event: PlayerCueEvent) => void;
}

/**
 * Visual for one player. Composes:
 *  - `PlayerStateMachine`: signals → animation state + cues (Phaser-free logic);
 *  - `PlayerAnimationController`: state → the character's clips on a Phaser sprite;
 * plus the name label, the local-player marker and squash & stretch on jumps and landings.
 */
export class PlayerView {
  readonly container: Phaser.GameObjects.Container;
  private readonly anim: PlayerAnimationController;
  private readonly fsm = new PlayerStateMachine(VIEW_CONFIG.animation);
  private readonly label: Phaser.GameObjects.Text;
  private readonly marker: Phaser.GameObjects.Image | null = null;
  private readonly ability: AbilityView;
  private readonly labelY: number;
  private readonly markerY: number = 0;
  private squash: Phaser.Tweens.Tween | null = null;
  private grounded = true;
  private invulnerable = false;
  private blinkMs = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly options: PlayerViewOptions,
  ) {
    const style = slotStyle(options.slot);
    const { label: labelCfg, depth } = VIEW_CONFIG;
    this.anim = new PlayerAnimationController(scene, options.characterId, (event) => {
      if (event === 'step' && this.grounded) this.emit('step');
    });
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
    this.labelY = this.label.y;
    this.ability = new AbilityView(scene, options.characterId, (cue) => this.emit(cue));
    const children: Phaser.GameObjects.GameObject[] = [this.anim.sprite, this.ability.sprite, this.label];
    if (options.isSelf) {
      this.markerY = this.label.y - this.label.height - 2;
      this.marker = scene.add.image(0, this.markerY, TEXTURES.marker).setOrigin(0.5, 1);
      children.push(this.marker);
    }
    this.container = scene.add.container(0, 0, children).setDepth(depth.players + (options.isSelf ? 1 : 0));
    this.fsm.onChange(({ to, reentered }) => this.anim.play(to, reentered));
  }

  get state(): PlayerState {
    return this.fsm.state;
  }

  get characterId(): CharacterId {
    return this.anim.characterId;
  }

  setName(name: string): void {
    if (this.label.text !== name) this.label.setText(name);
  }

  setConnected(connected: boolean): void {
    this.container.setAlpha(connected ? 1 : 0.4);
  }

  setCharacter(id: CharacterId): void {
    this.anim.setCharacter(id);
    this.ability.setCharacter(id);
  }

  /** The pilot's drone while it is out (the camera follows it). */
  get droneTarget(): Phaser.GameObjects.Sprite | null {
    return this.ability.droneTarget;
  }

  /** Blinks the sprite while traps can't hurt the player (after taking a hit). */
  setInvulnerable(on: boolean): void {
    this.invulnerable = on;
  }

  /**
   * `feetX/feetY` = bottom-centre of the hitbox in world pixels. `aimPreview` (local frog only)
   * shows where the tongue would go.
   */
  render(feetX: number, feetY: number, facing: 1 | -1, signals: PlayerSignals, dtMs: number, aimPreview: number | null = null): void {
    // Dead players stay where they died, so the Death clip plays on the spot.
    this.container.setPosition(feetX, feetY);
    this.grounded = signals.grounded;
    const cues = this.fsm.update(signals, dtMs);
    this.anim.setFacing(facing);
    this.anim.update();
    this.label.setVisible(signals.alive);
    this.marker?.setVisible(signals.alive);
    const { blinkPeriodMs, blinkAlpha } = VIEW_CONFIG.invulnerable;
    this.blinkMs = this.invulnerable && signals.alive ? this.blinkMs + dtMs : 0;
    const alpha = this.blinkMs > 0 && Math.floor(this.blinkMs / blinkPeriodMs) % 2 === 0 ? blinkAlpha : 1;
    this.anim.sprite.setAlpha(alpha);

    const look = this.ability.update(
      {
        ...signals,
        feetX,
        feetY,
        facing,
        state: this.fsm.state,
        timeInState: this.fsm.timeInState,
        aimPreview,
        alpha,
      },
      dtMs,
    );
    this.anim.sprite.setVisible(signals.alive ? !look.hideBase && !look.hidden : !look.hideBase && this.anim.sprite.visible);
    this.label.setVisible(signals.alive && !look.hidden).setY(this.labelY - look.labelLift);
    this.marker?.setVisible(signals.alive && !look.hidden).setY(this.markerY - look.labelLift);

    const { squash } = VIEW_CONFIG;
    for (const cue of cues) {
      if (cue === 'land') this.pulse(squash.landX, squash.landY);
      else if (cue === 'jump' || cue === 'doubleJump') this.pulse(squash.jumpX, squash.jumpY);
      this.emit(cue);
    }
  }

  destroy(): void {
    this.squash?.remove();
    this.ability.destroy();
    this.anim.destroy();
    this.container.destroy();
  }

  private emit(cue: PlayerCueName): void {
    this.options.onCue({
      cue,
      playerId: this.options.id,
      characterId: this.anim.characterId,
      isSelf: this.options.isSelf,
      x: this.container.x,
      y: this.container.y,
    });
  }

  private pulse(scaleX: number, scaleY: number): void {
    const sprite = this.anim.sprite;
    this.squash?.remove();
    sprite.setScale(scaleX, scaleY);
    this.squash = this.scene.tweens.add({
      targets: sprite,
      scaleX: 1,
      scaleY: 1,
      duration: VIEW_CONFIG.squash.durationMs,
      ease: 'Quad.easeOut',
    });
  }
}
