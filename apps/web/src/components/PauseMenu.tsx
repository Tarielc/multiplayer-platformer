'use client';

import type { DevCommand, RoomInfo } from '@platformer/shared';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import type { AudioSettings } from '@/game/audio/audioSettings';
import { useFullscreen, useMediaQuery } from '@/hooks/useFullscreen';
import { useInHandheld } from '@/desk/handheldPad';
import type { HudPlayer } from '@/net/RoomStore';
import { CharacterPortrait } from './CharacterPortrait';
import { CONTROL_ROWS, ControlKeys } from './controls';
import viewStyles from './GameView.module.css';
import styles from './Overlays.module.css';
import { MenuArrow, MossCap } from './PixelIcons';

interface PauseMenuProps {
  room: RoomInfo;
  players: HudPlayer[];
  solo: boolean;
  debug: boolean;
  audio: AudioSettings;
  onResume: () => void;
  onToggleDebug: () => void;
  onAudio: (settings: AudioSettings) => void;
  onDev: (cmd: DevCommand) => void;
  onLeave: () => void;
}

/**
 * The menu (Esc): a mossy stone tablet with a list of options; the focused one gets the firefly
 * arrow. Controls turns the tablet into the controls for this device (Esc / B goes back). In
 * multiplayer a strip below shows who else has the menu open, since the game only pauses once
 * everyone does.
 */
export function PauseMenu({
  room,
  players,
  solo,
  debug,
  audio,
  onResume,
  onToggleDebug,
  onAudio,
  onDev,
  onLeave,
}: PauseMenuProps) {
  const resumeRef = useRef<HTMLButtonElement>(null);
  const controlsRef = useRef<HTMLButtonElement>(null);
  const [page, setPage] = useState<'menu' | 'controls'>('menu');
  const fullscreen = useFullscreen();
  const firstOpen = useRef(true);

  useEffect(() => {
    if (page === 'menu') {
      (firstOpen.current ? resumeRef : controlsRef).current?.focus();
      firstOpen.current = false;
      return;
    }
    // On the controls page Esc goes back to the menu instead of closing it.
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setPage('menu');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [page]);

  const othersPlaying = !solo && !room.paused;
  const present = players.filter((p) => p.connected);
  const inMenu = present.filter((p) => p.menuOpen || p.isSelf).length;
  const volume = Math.round(audio.volume * 100);
  return (
    <div className={`${viewStyles.overlay} ${styles.pauseOverlay}`} role="dialog" aria-modal="true" aria-label="Pause menu">
      <div className={`${styles.tablet} px-panel`}>
        <MossCap className={styles.moss} />
        <div className={styles.tabletHead}>
          <h2 className={`${styles.title} px-outline`}>
            {page === 'controls' ? 'Controls' : room.paused ? 'Paused' : 'Menu'}
          </h2>
          {page === 'menu' && (
            <p className={styles.lead}>
              {room.paused
                ? solo
                  ? 'Game paused.'
                  : 'Paused — every player has the menu open.'
                : othersPlaying
                  ? 'Others are still playing; your character stands still until you resume.'
                  : 'Pausing…'}
            </p>
          )}
        </div>

        {page === 'controls' ? (
          <ControlsPage onBack={() => setPage('menu')} />
        ) : (
          <nav className={styles.items} aria-label="Menu options">
            <MenuItem ref={resumeRef} onClick={onResume}>
              Resume
            </MenuItem>
            <MenuItem
              onClick={() => onAudio({ ...audio, muted: !audio.muted })}
              aria-pressed={!audio.muted}
              value={<span data-on={!audio.muted}>{audio.muted ? 'Off' : 'On'}</span>}
            >
              Sound
            </MenuItem>
            <label className={styles.item} data-disabled={audio.muted}>
              <MenuArrow className={styles.arrow} />
              <span className={styles.itemText}>Volume</span>
              <input
                className={styles.volume}
                type="range"
                min={0}
                max={100}
                step={5}
                value={volume}
                disabled={audio.muted}
                onChange={(e) => onAudio({ ...audio, volume: Number(e.target.value) / 100 })}
                style={{ '--fill': `${volume}%` } as CSSProperties}
              />
              <span className={styles.itemValue}>{volume}</span>
            </label>
            <MenuItem ref={controlsRef} onClick={() => setPage('controls')} value={<span>›</span>}>
              Controls
            </MenuItem>
            <MenuItem
              onClick={onToggleDebug}
              aria-pressed={debug}
              value={
                <>
                  <kbd>F3</kbd>
                  <span data-on={debug}>{debug ? 'On' : 'Off'}</span>
                </>
              }
            >
              Debug overlay
            </MenuItem>
            {fullscreen.supported && (
              <MenuItem
                onClick={fullscreen.toggle}
                aria-pressed={fullscreen.active}
                value={<span data-on={fullscreen.active}>{fullscreen.active ? 'On' : 'Off'}</span>}
              >
                Full screen
              </MenuItem>
            )}
            {room.devCommands && room.phase === 'playing' && (
              <>
                <MenuItem onClick={() => onDev('respawn')} value={<DevTag />}>
                  Respawn at checkpoint
                </MenuItem>
                <MenuItem onClick={() => onDev('skipLevel')} value={<DevTag />}>
                  Skip level
                </MenuItem>
              </>
            )}
            <MenuItem onClick={onLeave} danger>
              Leave room
            </MenuItem>
          </nav>
        )}

        <p className={styles.close}>
          <kbd>Esc</kbd> {page === 'controls' ? 'to go back' : 'to close'}
        </p>
      </div>

      {!solo && (
        <div className={styles.menuStrip}>
          <span className={styles.stripNote}>
            The game pauses when everyone has the menu open · {inMenu} of {present.length}
          </span>
          <ul className={styles.stripPlayers}>
            {players.map((p) => {
              const open = p.isSelf || p.menuOpen;
              return (
                <li
                  key={p.id}
                  className={`${styles.stripChip} px-notch`}
                  data-open={open}
                  data-away={!p.connected}
                  style={{ '--slot': p.color } as CSSProperties}
                >
                  <CharacterPortrait characterId={p.characterId} scale={1} />
                  <span className={styles.stripName}>{p.name}</span>
                  <span className={styles.stripState}>{!p.connected ? 'Away' : open ? 'Menu' : 'Playing'}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The controls for the device in hand: the handheld's pad, touch on a phone, else keys and pad. */
function ControlsPage({ onBack }: { onBack: () => void }) {
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => backRef.current?.focus({ preventScroll: true }), []);
  const handheld = useInHandheld();
  const touch = useMediaQuery('(pointer: coarse)') && !handheld;
  const rows = handheld ? [...CONTROL_ROWS, { action: 'Full screen', pocket: 'Select' }] : CONTROL_ROWS;
  return (
    <>
      <p className={styles.controlsFor}>{handheld ? 'Handheld' : touch ? 'Touch' : 'Keyboard · gamepad'}</p>
      <ul className={styles.controlList}>
        {rows.map((row) => (
          <li key={row.action} className={styles.controlRow}>
            <span className={styles.controlAction}>
              {row.action}
              {'detail' in row && row.detail && <small>{row.detail}</small>}
            </span>
            <span className={styles.controlInput}>
              {handheld ? (
                row.pocket
              ) : touch ? (
                'touch' in row && row.touch
              ) : 'keys' in row ? (
                <>
                  <ControlKeys row={row} className={styles.controlKeys} />
                  <small>Pad: {row.pad}</small>
                </>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <nav className={styles.items} aria-label="Controls">
        <MenuItem ref={backRef} onClick={onBack} padBack>
          Back
        </MenuItem>
      </nav>
    </>
  );
}

function MenuItem({
  ref,
  children,
  value,
  danger = false,
  padBack = false,
  onClick,
  'aria-pressed': pressed,
}: {
  ref?: Ref<HTMLButtonElement>;
  children: ReactNode;
  value?: ReactNode;
  danger?: boolean;
  /** The handheld's B presses this instead of closing the menu. */
  padBack?: boolean;
  onClick: () => void;
  'aria-pressed'?: boolean;
}) {
  return (
    <button
      ref={ref}
      type="button"
      className={styles.item}
      data-danger={danger}
      data-pad-back={padBack || undefined}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <MenuArrow className={styles.arrow} />
      <span className={styles.itemText}>{children}</span>
      {value && <span className={styles.itemValue}>{value}</span>}
    </button>
  );
}

function DevTag() {
  return <span className={`${styles.devTag} px-notch`}>Dev</span>;
}
