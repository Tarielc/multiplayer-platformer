'use client';

import { LEVELS } from '@platformer/shared';
import type { CSSProperties } from 'react';
import type { NetStats } from '@/game/bridge';
import type { HudPlayer, RoomView } from '@/net/RoomStore';
import styles from './Hud.module.css';

/** Minimal HUD: one chip per active player (slot color, name, score, status) + level info. */
export function Hud({ view, stats }: { view: RoomView; stats: NetStats | null }) {
  const room = view.room!;
  const levelIndex = room.level ? LEVELS.entries.findIndex((e) => e.id === room.level!.id) : -1;
  return (
    <div className={styles.hud}>
      <div className={styles.players}>
        {view.hud.map((player) => (
          <PlayerChip key={player.id} player={player} />
        ))}
      </div>
      <div className={styles.level}>
        {room.level && (
          <span>
            {levelIndex >= 0 ? `${levelIndex + 1}/${LEVELS.entries.length} · ` : ''}
            {room.level.name}
          </span>
        )}
        <span className={styles.hint}>
          <kbd>Esc</kbd> menu
        </span>
      </div>
      {stats && (
        <div className={styles.stats}>
          {stats.fps} fps · rtt {stats.rttMs ?? '–'} ms · pending {stats.pendingInputs} · corr{' '}
          {stats.correctionPx.toFixed(1)} px · interp {Math.round(stats.interpAheadMs)} ms · tick {stats.serverTick}
        </div>
      )}
    </div>
  );
}

function PlayerChip({ player }: { player: HudPlayer }) {
  const status = !player.connected
    ? 'reconnecting'
    : !player.alive
      ? 'respawning'
      : player.atExit
        ? 'at exit'
        : player.menuOpen
          ? 'in menu'
          : null;
  return (
    <div
      className={styles.chip}
      data-self={player.isSelf}
      data-dim={!player.connected || !player.alive}
      style={{ '--slot': player.color } as CSSProperties}
    >
      <span className={styles.badge}>{player.label}</span>
      <span className={styles.name}>{player.name}</span>
      <span className={styles.score}>{player.score}</span>
      {status && <span className={styles.status}>{status}</span>}
    </div>
  );
}
