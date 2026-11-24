'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_AUDIO_SETTINGS,
  loadAudioSettings,
  saveAudioSettings,
  type AudioSettings,
} from '@/game/audio/audioSettings';
import { GameBridge, type NetStats } from '@/game/bridge';
import { DEFAULT_ASSET_BASE, type GameServices } from '@/game/services';
import type { GameSession } from '@/hooks/useGameSession';
import { lockLandscape, useFullscreen, useMediaQuery } from '@/hooks/useFullscreen';
import { useTouchDevice } from '@/hooks/useTouchDevice';
import type { RoomView } from '@/net/RoomStore';
import { CountdownOverlay } from './CountdownOverlay';
import { RespawnOverlay } from './RespawnOverlay';
import { GameCanvas } from './GameCanvas';
import { Hud } from './Hud';
import { LevelCompleteOverlay } from './LevelCompleteOverlay';
import { PauseMenu } from './PauseMenu';
import { TouchControls } from './TouchControls';
import { AbilityButton } from './AbilityBadge';
import { FullscreenIcon } from './FullscreenButton';
import styles from './GameView.module.css';

/** Width the HUD is laid out for; it scales with the stage from there. */
const HUD_REFERENCE_WIDTH = 1280;

/**
 * In-game screen (countdown / playing / level complete): the Phaser canvas plus React overlays.
 * Owns the menu + debug UI state and forwards it to Phaser (bridge) and the server (pause rule).
 */
export function GameView({ session, view, onLeave }: { session: GameSession; view: RoomView; onLeave: () => void }) {
  const { client, store } = session;
  const room = view.room!;
  const [bridge] = useState(() => new GameBridge());
  const services = useMemo<GameServices>(() => ({ client, bridge, assetBase: DEFAULT_ASSET_BASE }), [client, bridge]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [debug, setDebug] = useState(false);
  const [audio, setAudio] = useState<AudioSettings>(DEFAULT_AUDIO_SETTINGS);
  const [stats, setStats] = useState<NetStats | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // The HUD is drawn in 1280×720 reference pixels: --k scales it with the stage (no re-render).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const fit = () => {
      const k = Math.min(1.5, Math.max(0.6, stage.clientWidth / HUD_REFERENCE_WIDTH));
      stage.style.setProperty('--k', k.toFixed(3));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // A new level run closes the menu (derived-state reset during render).
  const run = room.level?.run ?? 0;
  const [menuRun, setMenuRun] = useState(run);
  if (menuRun !== run) {
    setMenuRun(run);
    setMenuOpen(false);
  }

  useEffect(() => {
    bridge.setMenuOpen(menuOpen);
    client.setMenuOpen(menuOpen);
  }, [bridge, client, menuOpen]);

  // localStorage is browser-only: load after hydration, like the player name.
  useEffect(() => setAudio(loadAudioSettings()), []);
  useEffect(() => bridge.setAudio(audio), [bridge, audio]);

  useEffect(() => {
    bridge.setDebug(debug);
    if (!debug) return;
    return bridge.on('net:stats', setStats);
  }, [bridge, debug]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault();
        setMenuOpen((open) => !open);
      } else if (event.code === 'F3') {
        event.preventDefault();
        setDebug((on) => !on);
      }
    };
    window.addEventListener('keydown', onKey);
    const offs = [
      bridge.on('input:menu', () => setMenuOpen((open) => !open)),
      bridge.on('level:warning', ({ message }) => store.notify('warn', message)),
      bridge.on('scene:error', ({ message }) => store.notify('error', message)),
    ];
    return () => {
      window.removeEventListener('keydown', onKey);
      for (const off of offs) off();
    };
  }, [bridge, store]);

  // Full screen on a phone: keep it sideways while the game runs (released on leaving it).
  const touch = useTouchDevice();
  const fullscreen = useFullscreen();
  useEffect(() => {
    if (!touch || !fullscreen.active) return;
    return lockLandscape();
  }, [touch, fullscreen.active]);

  const portrait = useMediaQuery('(orientation: portrait)');
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  const showNudge = touch && portrait && !nudgeDismissed && !menuOpen;

  const solo = room.players.length === 1;

  return (
    <div className={styles.view}>
      <div ref={stageRef} className={styles.stage}>
        <GameCanvas services={services} />
        <Hud view={view} stats={debug ? stats : null} onMenu={() => setMenuOpen(true)} />
        {room.phase === 'playing' && <AbilityButton self={view.hud.find((p) => p.isSelf)} />}
        {room.phase === 'playing' && <RespawnOverlay players={view.hud} />}
        {room.phase === 'countdown' && <CountdownOverlay room={room} receivedAt={view.roomReceivedAt} />}
        {room.phase === 'levelComplete' && (
          <LevelCompleteOverlay room={room} receivedAt={view.roomReceivedAt} selfId={view.selfId} />
        )}
        {room.paused && !menuOpen && <div className={`${styles.pausedBadge} px-notch`}>Paused</div>}
        {menuOpen && (
          <PauseMenu
            room={room}
            players={view.hud}
            solo={solo}
            debug={debug}
            audio={audio}
            onResume={() => setMenuOpen(false)}
            onToggleDebug={() => setDebug((on) => !on)}
            onAudio={(next) => setAudio(saveAudioSettings(next))}
            onDev={(cmd) => {
              client.dev(cmd);
              setMenuOpen(false);
            }}
            onLeave={onLeave}
          />
        )}
        {view.status !== 'open' && !view.fatal && (
          <div className={`${styles.connection} px-notch`}>{view.status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</div>
        )}
      </div>
      {showNudge && (
        <RotateNudge
          fullscreen={fullscreen.supported && !fullscreen.active ? fullscreen.toggle : null}
          onDismiss={() => setNudgeDismissed(true)}
        />
      )}
      {!menuOpen && <TouchControls touch={bridge.touch} self={view.hud.find((p) => p.isSelf)} />}
    </div>
  );
}

/** Phone held upright: the 16:9 stage is a strip, so suggest turning it (and full screen). */
function RotateNudge({ fullscreen, onDismiss }: { fullscreen: (() => void) | null; onDismiss: () => void }) {
  return (
    <div className={`${styles.nudge} px-notch`} role="status">
      <svg className={styles.nudgeIcon} viewBox="0 0 13 13" width="44" height="44" shapeRendering="crispEdges" aria-hidden>
        <path
          fill="currentColor"
          d="M4 1h5v11h-5zM5 2v8h3v-8zM6 10h1v1h-1zM0 6h1v3h1v1h1v1h-2v-1h-1zM12 7h-1v-3h-1v-1h-1v-1h2v1h1z"
        />
      </svg>
      <div className={styles.nudgeText}>
        <strong>Turn sideways</strong>
        <span>{fullscreen ? 'Landscape and full screen give' : 'Landscape gives'} the stage far more room.</span>
      </div>
      <div className={styles.nudgeActions}>
        {fullscreen && (
          <button type="button" className="gold" onClick={fullscreen}>
            <FullscreenIcon />
            Full screen
          </button>
        )}
        <button type="button" onClick={onDismiss}>
          Stay
        </button>
      </div>
    </div>
  );
}
