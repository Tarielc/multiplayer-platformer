'use client';

import { LEVELS, MAX_PLAYERS, PLAYER_SLOTS } from '@platformer/shared';
import type { CSSProperties } from 'react';
import type { GameSession } from '@/hooks/useGameSession';
import type { RoomView } from '@/net/RoomStore';
import styles from './LobbyPanel.module.css';

export function LobbyPanel({ session, view }: { session: GameSession; view: RoomView }) {
  const room = view.room!;
  const { client } = session;
  const me = room.players.find((p) => p.id === view.selfId);
  const isHost = me?.isHost ?? false;
  const bySlot = new Map(room.players.map((p) => [p.slot, p]));
  const connected = room.players.filter((p) => p.connected);
  const readyCount = connected.filter((p) => p.ready).length;
  const selected = LEVELS.get(room.selectedLevelId);
  const finalScores = room.campaignComplete ? [...room.players].sort((a, b) => b.campaignScore - a.campaignScore) : [];

  return (
    <section className={styles.lobby}>
      {room.campaignComplete && (
        <div className={styles.banner}>
          <h2>Campaign complete!</h2>
          <ol>
            {finalScores.map((p) => (
              <li key={p.id} style={{ color: PLAYER_SLOTS[p.slot]?.css }}>
                {p.name} — {p.campaignScore} pts
              </li>
            ))}
          </ol>
          <p>Ready up to play again.</p>
        </div>
      )}

      <div className={styles.slots}>
        {Array.from({ length: MAX_PLAYERS }, (_, slot) => {
          const player = bySlot.get(slot);
          const style = PLAYER_SLOTS[slot]!;
          return (
            <div
              key={slot}
              className={styles.slot}
              data-filled={Boolean(player)}
              data-ready={player?.ready ?? false}
              style={{ '--slot': style.css, '--slot-shade': style.shadeCss } as CSSProperties}
            >
              <div className={styles.avatar}>{style.label}</div>
              {player ? (
                <>
                  <div className={styles.name}>
                    {player.name}
                    {player.id === view.selfId && <span className={styles.you}> (you)</span>}
                  </div>
                  <div className={styles.meta}>
                    {player.isHost && <span>host</span>}
                    {!player.connected && <span className={styles.warn}>reconnecting…</span>}
                    <span className={player.ready ? styles.ok : styles.dim}>{player.ready ? 'ready' : 'not ready'}</span>
                  </div>
                </>
              ) : (
                <div className={styles.empty}>Waiting for player…</div>
              )}
            </div>
          );
        })}
      </div>

      <div className={styles.controls}>
        <label className={styles.level}>
          <span>Level</span>
          <select
            value={room.selectedLevelId}
            disabled={!isHost}
            onChange={(e) => client.selectLevel(e.target.value)}
            title={isHost ? 'Choose the starting level' : 'Only the host can change the level'}
          >
            {LEVELS.entries.map((entry, index) => (
              <option key={entry.id} value={entry.id}>
                {index + 1}. {entry.name}
              </option>
            ))}
          </select>
        </label>
        <button className={me?.ready ? '' : 'primary'} onClick={() => client.setReady(!me?.ready)} disabled={!me}>
          {me?.ready ? 'Not ready' : 'Ready'}
        </button>
      </div>

      <p className={styles.hint}>
        {readyCount}/{connected.length} ready · starts at “{selected?.name ?? room.selectedLevelId}” when everyone is
        ready. Share the invite link (or room code) to play together — up to {MAX_PLAYERS} players.
      </p>
    </section>
  );
}
