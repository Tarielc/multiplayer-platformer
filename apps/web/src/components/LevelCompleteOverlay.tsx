'use client';

import { LEVELS, PLAYER_SLOTS, ordinal, type LevelResult, type RoomInfo } from '@platformer/shared';
import { CharacterPortrait } from './CharacterPortrait';
import { formatRaceTime } from './format';
import viewStyles from './GameView.module.css';
import styles from './Overlays.module.css';
import { useCountdown } from './useCountdown';

/** Race: placed players first (by place), then everyone else by slot. Fruit doesn't count. */
function byPlace(a: LevelResult, b: LevelResult): number {
  if (a.place !== null && b.place !== null) return a.place - b.place;
  if (a.place !== null) return -1;
  if (b.place !== null) return 1;
  return a.slot - b.slot;
}

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
  const race = room.mode === 'race';
  const results = [...(room.results ?? [])].sort(race ? byPlace : (a, b) => b.score - a.score);
  const totals = new Map(room.players.map((p) => [p.id, p.campaignScore]));
  const characters = new Map(room.players.map((p) => [p.id, p.characterId]));
  const next = room.nextLevelId ? LEVELS.get(room.nextLevelId) : undefined;
  const winner = race ? results.find((r) => r.place === 1) : undefined;
  const teamScore = results.reduce((sum, r) => sum + r.score, 0);
  const teamTotal = results.reduce((sum, r) => sum + (totals.get(r.playerId) ?? r.score), 0);

  return (
    <div className={viewStyles.overlay}>
      <div className={styles.panel}>
        <h2>
          {room.level?.name} {race ? 'finished' : 'complete'}!
        </h2>
        {race && <p className={styles.dim}>{winner ? `${winner.name} wins the race!` : 'Nobody reached the trophy.'}</p>}
        <table className={styles.results}>
          <thead>
            <tr>
              <th>Player</th>
              {race && <th>Place</th>}
              {race && <th>Time</th>}
              {!race && <th>Score</th>}
              {!race && <th>Items</th>}
              <th>Deaths</th>
              {race && <th>Points</th>}
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
                  {race && <td className={styles.place}>{r.place !== null ? ordinal(r.place) : '–'}</td>}
                  {race && <td>{r.timeMs !== null ? formatRaceTime(r.timeMs) : 'DNF'}</td>}
                  {!race && <td>{r.score}</td>}
                  {!race && <td>{r.collected}</td>}
                  <td>{r.deaths}</td>
                  {race && <td>{r.placePoints > 0 ? `+${r.placePoints}` : 0}</td>}
                  <td>{totals.get(r.playerId) ?? (race ? r.placePoints : r.score)}</td>
                </tr>
              );
            })}
          </tbody>
          {!race && results.length > 1 && (
            <tfoot>
              <tr>
                <td>Team</td>
                <td>{teamScore}</td>
                <td>{results.reduce((sum, r) => sum + r.collected, 0)}</td>
                <td>{results.reduce((sum, r) => sum + r.deaths, 0)}</td>
                <td>{teamTotal}</td>
              </tr>
            </tfoot>
          )}
        </table>
        <p className={styles.dim}>
          {next ? `Next: ${next.name} in ${left}s` : `Final level cleared! Back to the lobby in ${left}s`}
        </p>
      </div>
    </div>
  );
}
