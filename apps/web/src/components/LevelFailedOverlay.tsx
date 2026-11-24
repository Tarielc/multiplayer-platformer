'use client';

import type { RoomInfo } from '@platformer/shared';
import styles from './Overlays.module.css';
import { useCountdown } from './useCountdown';

/** Co-op team wipe: everyone was knocked out at once, so the level starts over after a short pause. */
export function LevelFailedOverlay({ room, receivedAt }: { room: RoomInfo; receivedAt: number }) {
  const left = useCountdown(room.countdownMs, receivedAt);
  const seconds = Math.max(1, Math.ceil(left / 1000));
  return (
    <div className={`${styles.respawn} ${styles.failed}`} role="alert">
      <span className={`${styles.respawnTag} px-notch`}>Wiped out</span>
      <span className={`${styles.levelName} px-outline`}>Everyone is down</span>
      <span className={`${styles.respawnLabel} px-outline-sm`}>Restarting {room.level?.name ?? 'the level'} in</span>
      <span key={seconds} className={`${styles.respawnNumber} px-outline`} role="timer">
        {seconds}
      </span>
    </div>
  );
}
