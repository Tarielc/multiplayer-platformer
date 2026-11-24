'use client';

import { respawnDelayMs } from '@platformer/shared';
import type { HudPlayer } from '@/net/RoomStore';
import styles from './Overlays.module.css';

/**
 * While you are dead: the seconds until you respawn, who the camera follows meanwhile (the
 * lowest-slot teammate still in play, as `LevelScene.spectateTarget` picks), and how long the
 * next death will cost, since every death in a level waits longer. Alone, every wait is capped
 * at `soloMaxRespawnDelayMs`, so that line is left out.
 */
export function RespawnOverlay({ players }: { players: readonly HudPlayer[] }) {
  const self = players.find((p) => p.isSelf);
  if (!self || self.alive || self.place > 0 || self.respawnIn <= 0) return null;
  const watching = [...players]
    .sort((a, b) => a.slot - b.slot)
    .find((p) => !p.isSelf && p.alive && p.place === 0);
  const solo = players.length === 1;
  const next = Math.round(respawnDelayMs(self.deaths + 1, solo) / 1000);
  return (
    <div className={styles.respawn} role="timer" aria-live="polite">
      <span className={`${styles.respawnTag} px-notch`}>Knocked out</span>
      <span className={`${styles.respawnLabel} px-outline-sm`}>Back in</span>
      <span key={self.respawnIn} className={`${styles.respawnNumber} px-outline`}>
        {self.respawnIn}
      </span>
      {watching && (
        <span className={`${styles.respawnLine} px-outline-sm`}>
          Watching <span style={{ color: watching.color }}>{watching.label}</span> {watching.name}
        </span>
      )}
      {!solo && <span className={`${styles.respawnHint} px-outline-sm`}>Next knockout this level: {next} s</span>}
    </div>
  );
}
