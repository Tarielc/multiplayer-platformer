import * as Phaser from 'phaser';
import { VIEW_CONFIG } from './config';
import { trackGameCreated, trackGameDestroyed } from './registry';
import { BootScene } from './scenes/BootScene';
import { LevelScene } from './scenes/LevelScene';
import type { GameServices } from './services';

let sharedAudioContext: AudioContext | null | undefined;

/**
 * One AudioContext for every game this page creates. Browsers limit how many contexts a page
 * may open, and a context the player already unlocked (by a click or key press) stays unlocked
 * for the next game. Phaser suspends, rather than closes, a context it was given.
 */
function audioContext(): AudioContext | undefined {
  if (sharedAudioContext === undefined) {
    try {
      sharedAudioContext = typeof AudioContext === 'undefined' ? null : new AudioContext();
    } catch {
      sharedAudioContext = null;
    }
  }
  return sharedAudioContext ?? undefined;
}

export interface GameHandle {
  game: Phaser.Game;
  /** Idempotent. Destroys the game (async: completes next frame) and removes `parent`. */
  destroy: () => void;
}

/**
 * Creates the Phaser game inside `parent`. Only imported dynamically from GameCanvas, so
 * Phaser never loads during server rendering.
 */
export function createGame(parent: HTMLElement, services: GameServices): GameHandle {
  const game = new Phaser.Game({
    type: Phaser.AUTO, // WebGL, with Canvas fallback
    parent,
    width: VIEW_CONFIG.width,
    height: VIEW_CONFIG.height,
    backgroundColor: VIEW_CONFIG.backgroundColor,
    pixelArt: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    input: { keyboard: true, gamepad: true },
    // Sounds are synthesized at boot (game/audio); recorded overrides load in BootScene.
    audio: { context: audioContext() },
    banner: false,
    scene: [new BootScene(services), new LevelScene(services)],
  });
  trackGameCreated();

  let destroyed = false;
  game.events.once(Phaser.Core.Events.DESTROY, () => {
    trackGameDestroyed();
    parent.remove();
  });

  return {
    game,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      // Shut running scenes down first, so their SHUTDOWN cleanup runs while scene plugins
      // (keyboard, tweens, display list) still exist. Inside game.destroy() the plugins are
      // torn down before scene DESTROY listeners run.
      for (const scene of game.scene.getScenes(false)) {
        const { sys } = scene;
        if (sys.isActive() || sys.isPaused() || sys.isSleeping()) game.scene.stop(scene);
      }
      game.destroy(true);
    },
  };
}
