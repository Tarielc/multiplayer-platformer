'use client';

import { LEVELS, PLAYER_SLOTS, type RoomInfo } from '@platformer/shared';
import { CharacterPortrait } from './CharacterPortrait';
import viewStyles from './GameView.module.css';
import styles from './Overlays.module.css';
import { useCountdown } from './useCountdown';

export function LevelCompleteOverlay({
  room,
  receivedAt,
  selfId,
}: {
  room: RoomInfo;
  receivedAt: number;
  selfId: string | null;
}) {
  const left = Math.ceil(useCountdown(room.countdownMs, receivedAt) / 1000);
  const results = [...(room.results ?? [])].sort((a, b) => b.score - a.score);
  const totals = new Map(room.players.map((p) => [p.id, p.campaignScore]));
  const characters = new Map(room.players.map((p) => [p.id, p.characterId]));
  const next = room.nextLevelId ? LEVELS.get(room.nextLevelId) : undefined;

  return (
    <div className={viewStyles.overlay}>
      <div className={styles.panel}>
        <h2>{room.level?.name} complete!</h2>
        <table className={styles.results}>
          <thead>
            <tr>
              <th>Player</th>
              <th>Score</th>
              <th>Items</th>
              <th>Deaths</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => {
              const characterId = characters.get(r.playerId);
              return (
                <tr key={r.playerId} data-self={r.playerId === selfId}>
                  <td style={{ color: PLAYER_SLOTS[r.slot]?.css }}>
                    <span className={styles.who}>
                      {characterId && <CharacterPortrait characterId={characterId} scale={1} />}
                      {PLAYER_SLOTS[r.slot]?.label} {r.name}
                    </span>
                  </td>
                  <td>{r.score}</td>
                  <td>{r.collected}</td>
                  <td>{r.deaths}</td>
                  <td>{totals.get(r.playerId) ?? r.score}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className={styles.dim}>
          {next ? `Next: ${next.name} in ${left}s` : `Final level cleared! Back to the lobby in ${left}s`}
        </p>
      </div>
    </div>
  );
}
