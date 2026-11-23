import type { CharacterId } from '@platformer/shared';
import type * as Phaser from 'phaser';
import { animKey, CHARACTER_SHEET, CLIPS, type ClipFrameEvent, type ClipName } from '../characters/characterArt';
import type { PlayerState } from './PlayerStateMachine';

const CLIP_FOR_STATE: Readonly<Record<PlayerState, ClipName>> = {
  idle: 'idle',
  run: 'run',
  jump: 'jump',
  fall: 'fall',
  attack: 'attack',
  hurt: 'hurt',
  dead: 'death',
};

/**
 * Owns a player's sprite and maps animation states to the character's clips:
 *
 *  - looping clips keep playing when the state is re-requested; one-shots restart only when
 *    their state is (re)entered;
 *  - clips with an intro (Fall) play the full strip once, then chain into their loop;
 *  - per-frame events declared in `CLIPS[clip].frameEvents` (footsteps) are reported through
 *    `onFrameEvent`; the column comes from the texture frame (Phaser's `index` is 1-based);
 *  - the Death clip hides the sprite when it finishes;
 *  - `setCharacter` swaps the character and replays the current state seamlessly.
 */
export class PlayerAnimationController {
  readonly sprite: Phaser.GameObjects.Sprite;
  private state: PlayerState | null = null;
  private lastFrame: string | number | null = null;

  constructor(
    scene: Phaser.Scene,
    private character: CharacterId,
    private readonly onFrameEvent: (event: ClipFrameEvent) => void = () => {},
  ) {
    this.sprite = scene.add.sprite(0, 0, CHARACTER_SHEET.key).setOrigin(0.5, 1);
  }

  get characterId(): CharacterId {
    return this.character;
  }

  /** Current Phaser animation key (debugging / dev snapshot). */
  get currentKey(): string | null {
    return this.sprite.anims.currentAnim?.key ?? null;
  }

  /**
   * Shows `state`. `restart` replays a one-shot that is already showing (a new swing or hit
   * while the previous one is still on screen).
   */
  play(state: PlayerState, restart = false): void {
    const changed = state !== this.state;
    this.state = state;
    const clip = CLIP_FOR_STATE[state];
    const def = CLIPS[clip];
    const id = this.character;
    // Show the sprite for every new clip (an ability pose may have hidden it, e.g. a giant
    // dying); only a finished Death clip stays hidden.
    if (state !== 'dead' || changed || restart) this.sprite.setVisible(true);

    if (def.loopFrom !== undefined) {
      if (!changed && !restart) return;
      this.sprite.chain(); // clear anything queued by an earlier state
      this.sprite.play(animKey(id, clip, 'intro'));
      this.sprite.chain(animKey(id, clip, 'loop'));
      return;
    }
    if (def.loop) {
      this.sprite.chain();
      this.sprite.play(animKey(id, clip), !restart);
      return;
    }
    if (changed || restart) {
      this.sprite.chain();
      this.sprite.play(animKey(id, clip));
    }
  }

  setFacing(facing: 1 | -1): void {
    this.sprite.setFlipX(facing < 0);
  }

  setCharacter(id: CharacterId): void {
    if (id === this.character) return;
    this.character = id;
    const state = this.state;
    if (!state) return;
    // Keep the clip's progress so the swap is seamless (a running Death or Attack continues).
    const progress = this.sprite.anims.getProgress();
    const wasPlaying = this.sprite.anims.isPlaying;
    this.state = null;
    this.play(state);
    if (wasPlaying && progress > 0 && progress < 1) this.sprite.anims.setProgress(progress);
  }

  /** Call once per rendered frame, after `play`. Emits frame events; hides finished deaths. */
  update(): void {
    const anims = this.sprite.anims;
    const frame = anims.currentFrame;
    const name = frame?.textureFrame ?? null;
    if (name !== this.lastFrame) {
      this.lastFrame = name;
      const clip = this.state ? CLIP_FOR_STATE[this.state] : null;
      const events = clip ? CLIPS[clip].frameEvents : undefined;
      if (events && name !== null) {
        const event = events[Number(name) % CHARACTER_SHEET.columns];
        if (event) this.onFrameEvent(event);
      }
    }
    if (this.state === 'dead' && !anims.isPlaying && this.sprite.visible) this.sprite.setVisible(false);
  }

  destroy(): void {
    this.sprite.destroy();
  }
}
