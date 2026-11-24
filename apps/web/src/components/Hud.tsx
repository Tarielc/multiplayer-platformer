'use client';

import { LEVELS, MODE_CONFIG, PLAYER_CONFIG, ordinal, type RoomInfo } from '@platformer/shared';
import type { CSSProperties } from 'react';
import type { NetStats } from '@/game/bridge';
import type { HudPlayer, RoomView } from '@/net/RoomStore';
import { useTouchDevice } from '@/hooks/useTouchDevice';
import { AbilityBadge } from './AbilityBadge';
import { CharacterPortrait } from './CharacterPortrait';
import { FullscreenButton } from './FullscreenButton';
import styles from './Hud.module.css';
import { PixelHeart, PixelTrophy } from './PixelIcons';
import { useCountdown } from './useCountdown';

/**
 * The in-game HUD, drawn in 1280×720 reference pixels and scaled with the stage (`--k`, set by
 * GameView). Top-left: your plate (portrait, hearts) and a chip per teammate. Top-right: the
 * team score (co-op) or the race clock, and which level this is. Bottom-right: the menu key.
 * Touch devices get a menu button instead (a phone has no Esc key), with a full-screen toggle beside it.
 */
export function Hud({ view, stats, onMenu }: { view: RoomView; stats: NetStats | null; onMenu: () => void }) {
  const room = view.room!;
  const touch = useTouchDevice();
  const levelIndex = room.level ? LEVELS.entries.findIndex((e) => e.id === room.level!.id) : -1;
  const mode = MODE_CONFIG[room.mode];
  const coop = room.mode === 'coop';
  const self = view.hud.find((p) => p.isSelf);
  const others = view.hud.filter((p) => !p.isSelf);
  const teamScore = view.hud.reduce((sum, p) => sum + p.score, 0);

  return (
    <div className={styles.hud} data-touch={touch}>
      <div className={styles.topLeft}>
        {self && <SelfPlate player={self} />}
        {others.length > 0 && (
          <ul className={styles.chips} aria-label="Teammates">
            {others.map((player) => (
              <PlayerChip key={player.id} player={player} />
            ))}
          </ul>
        )}
      </div>

      <div className={styles.topRight}>
        <div className={styles.info}>
          {coop && (
            <div className={styles.score} role="status" aria-label={`${view.hud.length > 1 ? 'Team score' : 'Score'} ${teamScore}`}>
              <PixelTrophy scale={4} className="px-edge" />
              <span className="px-outline">{teamScore}</span>
            </div>
          )}
          {!coop && room.raceEndsInMs !== null && <RaceClock room={room} receivedAt={view.roomReceivedAt} />}
          {room.level && (
            <span className={`${styles.line} px-outline-sm`}>
              {mode.name}
              {levelIndex >= 0 ? ` · ${levelIndex + 1}/${LEVELS.entries.length}` : ''} · {room.level.name}
            </span>
          )}
          {coop && view.hud.length > 1 && <span className={`${styles.sub} px-outline-sm`}>Team score</span>}
          {!coop && mode.race && (
            <span className={`${styles.sub} ${styles.dim} px-outline-sm`}>
              Finish to score · {mode.race.placePoints.join(' · ')}
            </span>
          )}
        </div>
        {touch && <FullscreenButton className={`${styles.menu} px-notch`} />}
        {touch && (
          <button type="button" className={`${styles.menu} px-notch`} aria-label="Menu" onClick={onMenu}>
            <svg viewBox="0 0 6 6" width="18" height="18" shapeRendering="crispEdges" aria-hidden>
              <path fill="currentColor" d="M1 0h1v6h-1zM4 0h1v6h-1z" />
            </svg>
          </button>
        )}
      </div>

      {!touch && (
        <div className={styles.escHint}>
          <kbd>Esc</kbd>
          <span className="px-outline-sm">Menu</span>
        </div>
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
    <div
      className={`${styles.clock} px-notch`}
      data-urgent={seconds <= 5}
      role="timer"
      aria-live="off"
      aria-label={`Race ends in ${seconds} seconds`}
    >
      <span className={styles.clockLabel}>
        Race
        <br />
        ends in
      </span>
      <span className={`${styles.clockSeconds} px-outline`}>{seconds}</span>
      <span className={styles.clockUnit}>sec</span>
    </div>
  );
}

/** What a player is doing, when it is worth a word: finished, down, away. */
function statusOf(player: HudPlayer): string | null {
  if (!player.connected) return 'reconnecting';
  if (player.place > 0) return null; // the place tag says it
  if (!player.alive) return 'respawning';
  if (player.atExit) return 'at exit';
  if (player.menuOpen) return 'in menu';
  return null;
}

/** Your own plate: framed portrait in your slot colour, tag, name and big hearts. */
function SelfPlate({ player }: { player: HudPlayer }) {
  const status = statusOf(player);
  return (
    <div
      className={styles.plate}
      data-dim={!player.connected || (!player.alive && player.place === 0)}
      style={{ '--slot': player.color } as CSSProperties}
    >
      <div className={`${styles.frame} px-notch`}>
        <div className={`${styles.frameSlot} px-notch`}>
          <div className={`${styles.frameInner} px-notch`}>
            <CharacterPortrait characterId={player.characterId} scale={2} />
          </div>
        </div>
      </div>
      <div className={styles.plateBody}>
        <div className={styles.plateHead}>
          <span className={`${styles.tag} px-notch`}>{player.label}</span>
          <span className={`${styles.plateName} px-outline-sm`}>{player.name}</span>
          {player.place > 0 && <PlaceTag place={player.place} />}
        </div>
        <Hearts hp={player.hp} max={player.maxHp} scale={4} />
        {status && <span className={`${styles.status} px-outline-sm`}>{status}</span>}
      </div>
    </div>
  );
}

/** A teammate: portrait, name, small hearts and their ability (or their place, once finished). */
function PlayerChip({ player }: { player: HudPlayer }) {
  const status = statusOf(player);
  return (
    <li
      className={`${styles.chip} px-notch`}
      data-dim={!player.connected || (!player.alive && player.place === 0)}
      style={{ '--slot': player.color } as CSSProperties}
    >
      <CharacterPortrait characterId={player.characterId} scale={1} className={styles.chipPortrait} />
      <span className={styles.chipName}>{player.name}</span>
      {status && <span className={styles.chipStatus}>{status}</span>}
      {player.place > 0 ? (
        <PlaceTag place={player.place} />
      ) : (
        <>
          <Hearts hp={player.hp} max={player.maxHp} scale={2} />
          <AbilityBadge characterId={player.characterId} ability={player.ability} size="chip" />
        </>
      )}
    </li>
  );
}

function PlaceTag({ place }: { place: number }) {
  return (
    <span className={`${styles.place} px-notch`} data-place={place}>
      {ordinal(place)}
    </span>
  );
}

/**
 * Pixel hearts: red for each heart left, dark when lost (a heart pops as it empties). Hearts
 * past the usual maximum (Giant Form) are gold.
 */
function Hearts({ hp, max, scale }: { hp: number; max: number; scale: number }) {
  return (
    <span className={styles.hearts} data-scale={scale} role="img" aria-label={`${hp} of ${max} hearts`}>
      {Array.from({ length: max }, (_, i) => (
        <PixelHeart
          key={i}
          kind={i >= hp ? 'empty' : i >= PLAYER_CONFIG.maxHp ? 'bonus' : 'full'}
          scale={scale}
          className={`${styles.heart} ${scale > 2 ? 'px-edge' : ''}`}
        />
      ))}
    </span>
  );
}
