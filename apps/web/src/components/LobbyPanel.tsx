'use client';

import { LEVELS, MAX_PLAYERS, MODE_CONFIG, PLAYER_SLOTS, scalingSummary, slotStyle, type CharacterId } from '@platformer/shared';
import type { CSSProperties } from 'react';
import type { GameSession } from '@/hooks/useGameSession';
import { savePreferredCharacter } from '@/net/identity';
import type { RoomView } from '@/net/RoomStore';
import { CharacterPicker } from './CharacterPicker';
import { CharacterPortrait } from './CharacterPortrait';
import styles from './LobbyPanel.module.css';
import { ModePicker } from './ModePicker';
import { MossCap, PixelTrophy } from './PixelIcons';

export function LobbyPanel({ session, view }: { session: GameSession; view: RoomView }) {
  const room = view.room!;
  const { client } = session;
  const me = room.players.find((p) => p.id === view.selfId);
  const isHost = me?.isHost ?? false;
  const bySlot = new Map(room.players.map((p) => [p.slot, p]));
  const connected = room.players.filter((p) => p.connected);
  const readyCount = connected.filter((p) => p.ready).length;
  const levels = LEVELS.entries;
  const levelIndex = Math.max(0, levels.findIndex((e) => e.id === room.selectedLevelId));
  const selected = levels[levelIndex];
  const finalScores = room.campaignComplete ? [...room.players].sort((a, b) => b.campaignScore - a.campaignScore) : [];
  const teamTotal = finalScores.reduce((sum, p) => sum + p.campaignScore, 0);
  const race = room.mode === 'race';
  const mode = MODE_CONFIG[room.mode];
  // Everyone in the room counts when the level starts (see Room.startLevel).
  const scaling = scalingSummary(room.mode, room.players.length);
  const takenBy = new Map<CharacterId, string>(
    room.players.filter((p) => p.id !== view.selfId).map((p) => [p.characterId, slotStyle(p.slot).label]),
  );
  const pickCharacter = (id: CharacterId) => {
    savePreferredCharacter(id);
    client.selectCharacter(id);
  };
  const stepLevel = (delta: number) => {
    const next = levels[(levelIndex + delta + levels.length) % levels.length];
    if (next) client.selectLevel(next.id);
  };
  const hostOnly = isHost ? undefined : 'Only the host can change this';

  return (
    <section className={styles.lobby}>
      {room.campaignComplete && (
        <div className={`${styles.banner} px-panel`}>
          <MossCap className={styles.moss} />
          <PixelTrophy scale={6} className="px-edge" />
          <div className={styles.bannerBody}>
            <h2 className="px-outline">
              {race && finalScores[0] ? `${finalScores[0].name} wins the race!` : 'Campaign complete!'}
            </h2>
            <ol>
              {finalScores.map((p) => (
                <li key={p.id}>
                  <span style={{ color: PLAYER_SLOTS[p.slot]?.css }}>{p.name}</span>
                  <span className={styles.points}>{p.campaignScore} pts</span>
                </li>
              ))}
            </ol>
            {!race && finalScores.length > 1 && <p className={styles.team}>Team total: {teamTotal} pts</p>}
            <p className={styles.dim}>Ready up to play again.</p>
          </div>
        </div>
      )}

      <div className={styles.slots}>
        {Array.from({ length: MAX_PLAYERS }, (_, slot) => {
          const player = bySlot.get(slot);
          const style = PLAYER_SLOTS[slot]!;
          const slotVars = { '--slot': style.css, '--slot-shade': style.shadeCss } as CSSProperties;
          if (!player) {
            return (
              <div key={slot} className={styles.empty} style={slotVars}>
                <span className={`${styles.tag} px-notch`}>{style.label}</span>
                <span className={styles.waiting}>Waiting for player…</span>
                <span className={styles.dim}>
                  Share code <strong className={styles.code}>{room.roomId}</strong>
                </span>
              </div>
            );
          }
          return (
            <div key={slot} className={`${styles.slot} px-panel`} data-ready={player.ready} style={slotVars}>
              <div className={styles.alcove}>
                <CharacterPortrait characterId={player.characterId} scale={3} animated className={styles.portrait} />
                <span className={`${styles.tag} ${styles.tagFloat} px-notch`}>{style.label}</span>
                {player.isHost && <span className={styles.host}>Host</span>}
              </div>
              <div className={styles.name}>
                <span className="px-outline-sm">{player.name}</span>
                {player.id === view.selfId && <span className={styles.you}>(you)</span>}
              </div>
              <div className={styles.meta}>
                {!player.connected ? (
                  <span className={styles.warn}>Reconnecting…</span>
                ) : (
                  <span className={player.ready ? styles.ok : styles.dim}>
                    <span className={styles.readyDot} aria-hidden />
                    {player.ready ? 'Ready' : 'Not ready'}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className={styles.setup}>
        {me && (
          <section className={`${styles.card} px-panel`} aria-label="Your character">
            <CharacterPicker
              legend="Your character"
              value={me.characterId}
              onChange={pickCharacter}
              takenBy={takenBy}
              disabled={room.phase !== 'lobby'}
            />
          </section>
        )}

        <section className={`${styles.card} px-panel`} aria-label="Mode">
          <ModePicker value={room.mode} onChange={(next) => client.selectMode(next)} disabled={!isHost} title={hostOnly} />
          {scaling && <p className={styles.note}>{scaling}</p>}
          {race && mode.race && <p className={styles.note}>Points by place: {mode.race.placePoints.join(' · ')}</p>}
        </section>

        <section className={`${styles.card} px-panel`} aria-label="Starting level">
          <span className="px-label">Starting level</span>
          <div className={styles.carousel} title={hostOnly}>
            <button type="button" className={styles.arrow} aria-label="Previous level" disabled={!isHost} onClick={() => stepLevel(-1)}>
              ◀
            </button>
            <div className={styles.levelShown} aria-live="polite">
              <span className={`${styles.levelNo} px-outline`}>{levelIndex + 1}</span>
              <span className={`${styles.levelName} px-outline-sm`}>{selected?.name ?? room.selectedLevelId}</span>
            </div>
            <button type="button" className={styles.arrow} aria-label="Next level" disabled={!isHost} onClick={() => stepLevel(1)}>
              ▶
            </button>
          </div>
          <div className={styles.pips} aria-hidden>
            {levels.map((entry, i) => (
              <span key={entry.id} data-state={i === levelIndex ? 'current' : i < levelIndex ? 'before' : 'after'} />
            ))}
          </div>
        </section>
      </div>

      <footer className={styles.footer}>
        <div className={styles.count}>
          <span className={`${styles.countNumber} px-outline`} data-all={readyCount === connected.length}>
            {readyCount}/{connected.length}
          </span>
          <span className={styles.hint}>
            {mode.name} from “{selected?.name ?? room.selectedLevelId}” starts when everyone is ready. Share the invite
            link or code — up to {MAX_PLAYERS} players.
          </span>
        </div>
        <button className={`${styles.ready} ${me?.ready ? '' : 'primary'}`} onClick={() => client.setReady(!me?.ready)} disabled={!me}>
          {me?.ready ? 'Not ready' : 'Ready'}
        </button>
      </footer>
    </section>
  );
}
