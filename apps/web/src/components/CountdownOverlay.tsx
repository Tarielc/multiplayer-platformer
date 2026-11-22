'use client';

import type { RoomInfo } from '@platformer/shared';
import styles from './Overlays.module.css';
import { useCountdown } from './useCountdown';

export function CountdownOverlay({ room, receivedAt }: { room: RoomInfo; receivedAt: number }) {
  const left = useCountdown(room.countdownMs, receivedAt);
  const seconds = Math.ceil(left / 1000);
  return (
    <div className={styles.countdown}>
      <div className={styles.levelName}>{room.level?.name}</div>
      <div key={seconds} className={styles.number}>
        {seconds > 0 ? seconds : 'Go!'}
      </div>
    </div>
  );
}
