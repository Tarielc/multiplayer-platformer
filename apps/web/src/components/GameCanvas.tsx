'use client';

import { useEffect, useRef } from 'react';
import type { GameServices } from '@/game/services';
import styles from './GameView.module.css';

/**
 * Mounts the Phaser game. Phaser touches `window` at import time, so it is loaded with a
 * dynamic import inside the effect (never during SSR).
 *
 * Strict Mode runs effect -> cleanup -> effect. The first effect's import resolves after its
 * cleanup set `disposed`, so it never creates a game: exactly one Phaser.Game exists, in its
 * own child element, and cleanup calls `game.destroy(true)` (which completes on the next frame).
 */
export function GameCanvas({ services }: { services: GameServices }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let destroy: (() => void) | null = null;
    const mount = document.createElement('div');
    mount.className = styles.mount!;
    host.appendChild(mount);

    import('@/game/createGame')
      .then(({ createGame }) => {
        if (disposed) {
          mount.remove();
          return;
        }
        destroy = createGame(mount, services).destroy;
      })
      .catch((error: unknown) => {
        services.bridge.emit('scene:error', { message: `Failed to start the game: ${String(error)}` });
      });

    return () => {
      disposed = true;
      if (destroy) destroy();
      else mount.remove();
    };
  }, [services]);

  return <div ref={hostRef} className={styles.canvasHost} />;
}
