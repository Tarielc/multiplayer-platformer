'use client';

import { LEVELS, MAX_PLAYERS, MODE_CONFIG, PLAYER_SLOTS, slotStyle, type CharacterId } from '@platformer/shared';
import type { CSSProperties } from 'react';
import type { GameSession } from '@/hooks/useGameSession';
import { savePreferredCharacter } from '@/net/identity';
import type { RoomView } from '@/net/RoomStore';
import { CharacterPicker } from './CharacterPicker';
import { CharacterPortrait } from './CharacterPortrait';
import styles from './LobbyPanel.module.css';
import { ModePicker } from './ModePicker';

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
  const teamTotal = finalScores.reduce((sum, p) => sum + p.campaignScore, 0);
  const race = room.mode === 'race';
  const mode = MODE_CONFIG[room.mode];
  const takenBy = new Map<CharacterId, string>(
    room.players.filter((p) => p.id !== view.selfId).map((p) => [p.characterId, slotStyle(p.slot).label]),
  );
  const pickCharacter = (id: CharacterId) => {
    savePreferredCharacter(id);
    client.selectCharacter(id);
  };

  return (
    <section className={styles.lobby}>
      {room.campaignComplete && (
        <div className={styles.banner}>
          <h2>{race && finalScores[0] ? `Race over: ${finalScores[0].name} wins!` : 'Campaign complete!'}</h2>
          <ol>
            {finalScores.map((p) => (
              <li key={p.id} style={{ color: PLAYER_SLOTS[p.slot]?.css }}>
                {p.name} — {p.campaignScore} pts
              </li>
            ))}
          </ol>
          {!race && finalScores.length > 1 && <p className={styles.team}>Team total: {teamTotal} pts</p>}
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
              <div className={styles.avatar}>
                {player ? <CharacterPortrait characterId={player.characterId} scale={2} animated /> : null}
                <span className={styles.slotLabel}>{style.label}</span>
              </div>
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

      {me && (
        <CharacterPicker
          legend="Your character"
          value={me.characterId}
          onChange={pickCharacter}
          takenBy={takenBy}
          disabled={room.phase !== 'lobby'}
        />
      )}

      <ModePicker
        value={room.mode}
        onChange={(next) => client.selectMode(next)}
        disabled={!isHost}
        title={isHost ? undefined : 'Only the host can change the mode'}
      />

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
        {readyCount}/{connected.length} ready · {mode.name} from “{selected?.name ?? room.selectedLevelId}” starts when
        everyone is ready. Share the invite link (or room code) to play together — up to {MAX_PLAYERS} players.
      </p>
    </section>
  );
}
