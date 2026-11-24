'use client';

import { LEVELS, MODE_CONFIG, type RoomInfo } from '@platformer/shared';
import styles from './Overlays.module.css';
import { useCountdown } from './useCountdown';

/** 3 · 2 · 1 · Go! over the level, under its mode tag and name. */
export function CountdownOverlay({ room, receivedAt }: { room: RoomInfo; receivedAt: number }) {
  const left = useCountdown(room.countdownMs, receivedAt);
  const seconds = Math.ceil(left / 1000);
  const levelIndex = room.level ? LEVELS.entries.findIndex((e) => e.id === room.level!.id) : -1;
  return (
    <div className={styles.countdown}>
      <div className={styles.countHead}>
        <span className={`${styles.modeTag} px-notch`} data-mode={room.mode}>
          {MODE_CONFIG[room.mode].name}
          {levelIndex >= 0 ? ` · ${levelIndex + 1}/${LEVELS.entries.length}` : ''}
        </span>
        <span className={`${styles.levelName} px-outline`}>{room.level?.name}</span>
        {room.scaledFor !== null && room.scaledFor > 1 && (
          <span className={`${styles.scaledFor} px-outline-sm`}>Foes scaled for {room.scaledFor} players</span>
        )}
      </div>
      <div key={seconds} className={`${styles.number} px-outline`} data-go={seconds <= 0} role="timer" aria-live="assertive">
        {seconds > 0 ? seconds : 'Go!'}
      </div>
    </div>
  );
}
