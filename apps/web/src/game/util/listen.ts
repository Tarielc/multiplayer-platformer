import type { EventMap, TypedEmitter } from '@platformer/shared';
import * as Phaser from 'phaser';

/**
 * Subscribes to an emitter for the lifetime of a scene run: unsubscribes automatically on
 * scene SHUTDOWN (restart/stop) and DESTROY (game.destroy). Prevents handlers leaking into
 * restarted scenes or outliving the game.
 */
export function listen<E extends EventMap, K extends keyof E>(
  scene: Phaser.Scene,
  emitter: TypedEmitter<E>,
  event: K,
  handler: (payload: E[K]) => void,
): void {
  const off = emitter.on(event, handler);
  const cleanup = () => {
    off();
    scene.events.off(Phaser.Scenes.Events.SHUTDOWN, cleanup);
    scene.events.off(Phaser.Scenes.Events.DESTROY, cleanup);
  };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
  scene.events.once(Phaser.Scenes.Events.DESTROY, cleanup);
}

/**
 * Runs `fn` once when the scene shuts down or is destroyed. Errors are logged, not thrown:
 * an exception here would abort Phaser's own shutdown or teardown and leak the game.
 */
export function onSceneEnd(scene: Phaser.Scene, fn: () => void): void {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    scene.events.off(Phaser.Scenes.Events.SHUTDOWN, run);
    scene.events.off(Phaser.Scenes.Events.DESTROY, run);
    try {
      fn();
    } catch (error) {
      console.error(`[${scene.sys.settings.key}] cleanup failed`, error);
    }
  };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, run);
  scene.events.once(Phaser.Scenes.Events.DESTROY, run);
}
