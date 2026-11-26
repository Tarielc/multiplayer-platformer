'use client';

import {
  LEVELS,
  MODE_CONFIG,
  PLAYER_SLOTS,
  ordinal,
  type CharacterId,
  type LevelResult,
  type RoomInfo,
  type RunRecordInfo,
} from '@platformer/shared';
import { useState, type CSSProperties } from 'react';
import { CharacterPortrait } from './CharacterPortrait';
import { formatRaceTime } from './format';
import viewStyles from './GameView.module.css';
import styles from './Overlays.module.css';
import { PixelTrophy } from './PixelIcons';
import { useCountdown } from './useCountdown';

/** Race: placed players first (by place), then everyone else by slot. Fruit doesn't count. */
function byPlace(a: LevelResult, b: LevelResult): number {
  if (a.place !== null && b.place !== null) return a.place - b.place;
  if (a.place !== null) return -1;
  if (b.place !== null) return 1;
  return a.slot - b.slot;
}

/**
 * Between levels: the headline, a podium for the race's top three, the results table and a bar
 * counting down to the next level.
 */
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
  // The countdown's full length, as first seen: the bar fills from there.
  const [totalSeconds] = useState(() => Math.max(1, Math.ceil(room.countdownMs / 1000)));
  const race = room.mode === 'race';
  const results = [...(room.results ?? [])].sort(race ? byPlace : (a, b) => b.score - a.score);
  const totals = new Map(room.players.map((p) => [p.id, p.campaignScore]));
  const characters = new Map(room.players.map((p) => [p.id, p.characterId]));
  const next = room.nextLevelId ? LEVELS.get(room.nextLevelId) : undefined;
  const levelIndex = room.level ? LEVELS.indexInCampaign(room.level.id) : -1;
  const winner = race ? results.find((r) => r.place === 1) : undefined;
  const podium = race ? results.filter((r) => r.place !== null && r.place <= 3) : [];
  const teamScore = results.reduce((sum, r) => sum + r.score, 0);
  const teamTotal = results.reduce((sum, r) => sum + (totals.get(r.playerId) ?? r.score), 0);
  const elapsed = Math.min(totalSeconds, Math.max(0, totalSeconds - left));
  const records = room.records ?? [];
  const levelRecord = new Map<string, RunRecordInfo>();
  for (const record of records) if (record.kind === 'level') for (const id of record.playerIds) levelRecord.set(id, record);
  const teamRecord = race ? undefined : records.find((r) => r.kind === 'level');
  const campaignRecords = records.filter((r) => r.kind === 'campaign');
  const nameOf = new Map(results.map((r) => [r.playerId, r.name]));

  return (
    <div className={`${viewStyles.overlay} ${styles.resultsOverlay}`}>
      <header className={styles.resultsHead}>
        <span className={styles.kicker}>
          {MODE_CONFIG[room.mode].name}
          {levelIndex >= 0 ? ` · ${levelIndex + 1}/${LEVELS.campaign(room.mode).length}` : ''} · {room.level?.name}{' '}
          {race ? 'finished' : 'complete'}
        </span>
        <h2 className={`${styles.headline} px-outline`}>
          {race ? (winner ? `${winner.name} wins the race!` : 'Nobody reached the trophy') : 'Level complete!'}
        </h2>
      </header>

      <div className={styles.resultsBody}>
        {podium.length > 0 && <Podium entries={podium} characters={characters} />}

        <section className={`${styles.resultsPanel} px-panel`} aria-label="Results">
          <table className={styles.results}>
            <thead>
              <tr>
                <th>Player</th>
                {race && <th>Place</th>}
                {race && <th>Time</th>}
                {!race && <th className={styles.num}>Score</th>}
                {!race && <th className={styles.num}>Items</th>}
                <th className={styles.num}>Deaths</th>
                {race && <th className={styles.num}>Points</th>}
                <th className={styles.num}>Total</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => {
                const characterId = characters.get(r.playerId);
                const slot = PLAYER_SLOTS[r.slot];
                return (
                  <tr key={r.playerId} data-self={r.playerId === selfId} style={{ '--slot': slot?.css } as CSSProperties}>
                    <td>
                      <span className={styles.who}>
                        {characterId && <CharacterPortrait characterId={characterId} scale={1} />}
                        <span className={styles.slotLabel}>{slot?.label}</span>
                        {r.name}
                        {r.playerId === selfId && <span className={styles.you}>(you)</span>}
                      </span>
                    </td>
                    {race && (
                      <td>
                        {r.place !== null ? (
                          <span className={`${styles.placeTag} px-notch`} data-place={r.place}>
                            {ordinal(r.place)}
                          </span>
                        ) : (
                          <span className={styles.muted}>–</span>
                        )}
                      </td>
                    )}
                    {race && (
                      <td>
                        {r.timeMs !== null ? formatRaceTime(r.timeMs) : <span className={styles.dnf}>DNF</span>}
                        <RecordBadge record={levelRecord.get(r.playerId)} />
                      </td>
                    )}
                    {!race && <td className={styles.num}>{r.score}</td>}
                    {!race && <td className={styles.num}>{r.collected}</td>}
                    <td className={styles.num}>{r.deaths}</td>
                    {race && (
                      <td className={`${styles.num} ${styles.points}`} data-zero={r.placePoints === 0}>
                        {r.placePoints > 0 ? `+${r.placePoints}` : 0}
                      </td>
                    )}
                    <td className={`${styles.num} ${styles.total}`}>{totals.get(r.playerId) ?? (race ? r.placePoints : r.score)}</td>
                  </tr>
                );
              })}
            </tbody>
            {!race && results.length > 1 && (
              <tfoot>
                <tr>
                  <td>Team</td>
                  <td className={styles.num}>{teamScore}</td>
                  <td className={styles.num}>{results.reduce((sum, r) => sum + r.collected, 0)}</td>
                  <td className={styles.num}>{results.reduce((sum, r) => sum + r.deaths, 0)}</td>
                  <td className={`${styles.num} ${styles.total}`}>{teamTotal}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </section>
      </div>

      {(teamRecord || campaignRecords.length > 0 || (!race && results[0]?.timeMs != null)) && (
        <div className={styles.recordLines}>
          {!race && results[0]?.timeMs != null && (
            <span className={`${styles.recordLine} px-outline-sm`}>
              Team time <strong>{formatRaceTime(results[0].timeMs)}</strong>
              <RecordBadge record={teamRecord} />
            </span>
          )}
          {campaignRecords.map((record) => (
            <span key={record.playerIds.join('+')} className={`${styles.recordLine} px-outline-sm`}>
              {race ? `${record.playerIds.map((id) => nameOf.get(id) ?? '?').join(' · ')} · campaign` : 'Campaign'}{' '}
              <strong>{formatRaceTime(record.timeMs)}</strong>
              <RecordBadge record={record} />
            </span>
          ))}
        </div>
      )}

      <footer className={styles.resultsFoot}>
        <span className={`${styles.nextLine} px-outline-sm`}>
          {next ? (
            <>
              Next: {next.name} in <strong>{left}</strong>s
            </>
          ) : (
            <>
              Final level cleared! Back to the lobby in <strong>{left}</strong>s
            </>
          )}
        </span>
        <div
          className={styles.nextBar}
          role="progressbar"
          aria-label={next ? 'Next level countdown' : 'Back to lobby countdown'}
          aria-valuemin={0}
          aria-valuemax={totalSeconds}
          aria-valuenow={elapsed}
        >
          {Array.from({ length: totalSeconds }, (_, i) => (
            <span key={i} data-filled={i < elapsed} />
          ))}
        </div>
      </footer>
    </div>
  );
}

/** Leaderboard placing of a run that just ended: new #1, personal best, or plain rank. */
function RecordBadge({ record }: { record: RunRecordInfo | undefined }) {
  if (!record) return null;
  const text = record.worldRecord
    ? 'New record!'
    : record.personalBest
      ? record.rank !== null
        ? `Best · #${record.rank}`
        : 'Personal best'
      : record.rank !== null
        ? `#${record.rank}`
        : null;
  if (!text) return null;
  return (
    <span className={`${styles.recordBadge} px-notch`} data-kind={record.worldRecord ? 'world' : record.personalBest ? 'best' : 'rank'}>
      {text}
    </span>
  );
}

/** Race top three on stone steps: 2nd · 1st · 3rd. */
function Podium({ entries, characters }: { entries: LevelResult[]; characters: Map<string, CharacterId> }) {
  const byPlaceNo = new Map(entries.map((r) => [r.place!, r]));
  const order = [2, 1, 3].filter((place) => byPlaceNo.has(place));
  return (
    <div className={styles.podium} role="img" aria-label={entries.map((r) => `${ordinal(r.place!)} ${r.name}`).join(', ')}>
      {order.map((place) => {
        const r = byPlaceNo.get(place)!;
        const characterId = characters.get(r.playerId);
        return (
          <div key={r.playerId} className={styles.podiumCol} data-place={place}>
            {place === 1 && <PixelTrophy scale={5} className={`${styles.podiumTrophy} px-edge`} />}
            <span className={`${styles.podiumName} px-outline-sm`}>{r.name}</span>
            {characterId && <CharacterPortrait characterId={characterId} scale={2} animated />}
            <div className={styles.step}>
              <span className="px-outline">{place}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
