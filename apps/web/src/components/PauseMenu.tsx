'use client';

import type { DevCommand, RoomInfo } from '@platformer/shared';
import { useEffect, useRef } from 'react';
import type { AudioSettings } from '@/game/audio/audioSettings';
import viewStyles from './GameView.module.css';
import styles from './Overlays.module.css';

interface PauseMenuProps {
  room: RoomInfo;
  solo: boolean;
  debug: boolean;
  audio: AudioSettings;
  onResume: () => void;
  onToggleDebug: () => void;
  onAudio: (settings: AudioSettings) => void;
  onDev: (cmd: DevCommand) => void;
}

export function PauseMenu({ room, solo, debug, audio, onResume, onToggleDebug, onAudio, onDev }: PauseMenuProps) {
  const resumeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => resumeRef.current?.focus(), []);

  const othersPlaying = !solo && !room.paused;
  return (
    <div className={viewStyles.overlay} role="dialog" aria-modal="true" aria-label="Pause menu">
      <div className={styles.panel}>
        <h2>Menu</h2>
        <p className={styles.dim}>
          {room.paused
            ? solo
              ? 'Game paused.'
              : 'Paused — every player has the menu open.'
            : othersPlaying
              ? 'Others are still playing; your character stands still until you resume.'
              : 'Pausing…'}
        </p>
        <div className={styles.buttons}>
          <button ref={resumeRef} className="primary" onClick={onResume}>
            Resume
          </button>
          <button onClick={() => onAudio({ ...audio, muted: !audio.muted })} aria-pressed={!audio.muted}>
            Sound: {audio.muted ? 'off' : 'on'}
          </button>
          <button onClick={onToggleDebug}>{debug ? 'Hide' : 'Show'} debug overlay (F3)</button>
          {room.devCommands && room.phase === 'playing' && (
            <>
              <button onClick={() => onDev('respawn')}>Respawn at checkpoint</button>
              <button onClick={() => onDev('skipLevel')}>Skip level (dev)</button>
            </>
          )}
        </div>
        <label className={styles.audio}>
          <span>Volume</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(audio.volume * 100)}
            disabled={audio.muted}
            onChange={(e) => onAudio({ ...audio, volume: Number(e.target.value) / 100 })}
          />
        </label>
        <p className={styles.dim}>
          <kbd>Esc</kbd> to close
        </p>
      </div>
    </div>
  );
}
