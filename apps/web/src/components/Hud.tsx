'use client';

import { LEVELS, MODE_CONFIG, ordinal, type RoomInfo } from '@platformer/shared';
import type { CSSProperties } from 'react';
import type { NetStats } from '@/game/bridge';
import type { HudPlayer, RoomView } from '@/net/RoomStore';
import { abilityIconPath } from '@/game/abilities/abilityArt';
import { DEFAULT_ASSET_BASE } from '@/game/services';
import { useTouchDevice } from '@/hooks/useTouchDevice';
import { CharacterPortrait } from './CharacterPortrait';
import styles from './Hud.module.css';
import { useCountdown } from './useCountdown';

/**
 * Minimal HUD: one chip per active player (slot color, name, hearts, score, status) + level info.
 * Co-op adds the team score; a race shows places and, after the first finish, the race clock.
 * On touch devices it also has the menu button (a phone has no Esc key).
 */
export function Hud({ view, stats, onMenu }: { view: RoomView; stats: NetStats | null; onMenu: () => void }) {
  const room = view.room!;
  const levelIndex = room.level ? LEVELS.entries.findIndex((e) => e.id === room.level!.id) : -1;
  const touch = useTouchDevice();
  const coop = room.mode === 'coop';
  const teamScore = view.hud.reduce((sum, p) => sum + p.score, 0);
  return (
    <div className={styles.hud} data-touch={touch}>
      <div className={styles.players}>
        {view.hud.map((player) => (
          <PlayerChip key={player.id} player={player} />
        ))}
      </div>
      <div className={styles.level}>
        {room.level && (
          <span>
            {MODE_CONFIG[room.mode].name} · {levelIndex >= 0 ? `${levelIndex + 1}/${LEVELS.entries.length} · ` : ''}
            {room.level.name}
          </span>
        )}
        {coop && view.hud.length > 1 && (
          <span>
            Team <span className={styles.score}>{teamScore}</span>
          </span>
        )}
        <span className={styles.hint}>
          <kbd>L</kbd>/<kbd>C</kbd>/right-click special · <kbd>Esc</kbd> menu
        </span>
      </div>
      {touch && (
        <button type="button" className={styles.menu} aria-label="Menu" onClick={onMenu}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
            <path fill="currentColor" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
          </svg>
        </button>
      )}
      {room.mode === 'race' && room.raceEndsInMs !== null && (
        <RaceClock room={room} receivedAt={view.roomReceivedAt} />
      )}
      {stats && (
        <div className={styles.stats}>
          {stats.fps} fps · rtt {stats.rttMs ?? '–'} ms · pending {stats.pendingInputs} · corr{' '}
          {stats.correctionPx.toFixed(1)} px · interp {Math.round(stats.interpAheadMs)} ms · tick {stats.serverTick}
        </div>
      )}
    </div>
  );
}

/** Race: seconds left for everyone still racing (frozen while the game is paused). */
function RaceClock({ room, receivedAt }: { room: RoomInfo; receivedAt: number }) {
  const ms = room.raceEndsInMs ?? 0;
  const ticking = useCountdown(ms, receivedAt);
  const seconds = Math.ceil((room.paused ? ms : ticking) / 1000);
  return (
    <div className={styles.raceClock} data-urgent={seconds <= 5} role="timer" aria-live="off">
      Race ends in <span className={styles.raceSeconds}>{seconds}</span>s
    </div>
  );
}

function PlayerChip({ player }: { player: HudPlayer }) {
  const status = !player.connected
    ? 'reconnecting'
    : player.place > 0
      ? `finished ${ordinal(player.place)}`
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
      data-dim={!player.connected || (!player.alive && player.place === 0)}
      data-finished={player.place > 0}
      style={{ '--slot': player.color } as CSSProperties}
    >
      <CharacterPortrait characterId={player.characterId} scale={1} className={styles.portrait} />
      <span className={styles.badge}>{player.label}</span>
      <span className={styles.name}>{player.name}</span>
      <Hearts hp={player.hp} max={player.maxHp} />
      <AbilityIcon player={player} />
      <span className={styles.score}>{player.score}</span>
      {status && <span className={styles.status}>{status}</span>}
    </div>
  );
}

/** The special ability's icon: dimmed with the seconds left while it recharges, lit while in use. */
function AbilityIcon({ player }: { player: HudPlayer }) {
  const { name, cooldown, active } = player.ability;
  const ready = cooldown <= 0;
  const label = active ? `${name} (active)` : ready ? `${name} (ready)` : `${name} (${cooldown.toFixed(1)} s)`;
  return (
    <span className={styles.ability} data-ready={ready} data-active={active} title={label} aria-label={label} role="img">
      <img src={`${DEFAULT_ASSET_BASE}/${abilityIconPath(player.characterId)}`} alt="" width={20} height={20} />
      {!ready && !active && <span className={styles.cooldown}>{Math.ceil(cooldown)}</span>}
    </span>
  );
}

/** Pixel hearts: filled for each heart left. A heart pops as it empties. */
function Hearts({ hp, max }: { hp: number; max: number }) {
  return (
    <span className={styles.hearts} role="img" aria-label={`${hp} of ${max} hearts`}>
      {Array.from({ length: max }, (_, i) => (
        <svg key={i} className={styles.heart} data-full={i < hp} viewBox="0 0 7 6" shapeRendering="crispEdges" aria-hidden>
          <path d="M1 0h2v1h1v-1h2v1h1v2h-1v1h-1v1h-1v1h-1v-1h-1v-1h-1v-1h-1v-2h1z" />
        </svg>
      ))}
    </span>
  );
}
