'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_AUDIO_SETTINGS,
  loadAudioSettings,
  saveAudioSettings,
  type AudioSettings,
} from '@/game/audio/audioSettings';
import { GameBridge, type NetStats } from '@/game/bridge';
import { DEFAULT_ASSET_BASE, type GameServices } from '@/game/services';
import type { GameSession } from '@/hooks/useGameSession';
import type { RoomView } from '@/net/RoomStore';
import { CountdownOverlay } from './CountdownOverlay';
import { GameCanvas } from './GameCanvas';
import { Hud } from './Hud';
import { LevelCompleteOverlay } from './LevelCompleteOverlay';
import { PauseMenu } from './PauseMenu';
import { TouchControls } from './TouchControls';
import styles from './GameView.module.css';

/**
 * In-game screen (countdown / playing / level complete): the Phaser canvas plus React overlays.
 * Owns the menu + debug UI state and forwards it to Phaser (bridge) and the server (pause rule).
 */
export function GameView({ session, view }: { session: GameSession; view: RoomView }) {
  const { client, store } = session;
  const room = view.room!;
  const [bridge] = useState(() => new GameBridge());
  const services = useMemo<GameServices>(() => ({ client, bridge, assetBase: DEFAULT_ASSET_BASE }), [client, bridge]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [debug, setDebug] = useState(false);
  const [audio, setAudio] = useState<AudioSettings>(DEFAULT_AUDIO_SETTINGS);
  const [stats, setStats] = useState<NetStats | null>(null);

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

  const solo = room.players.length === 1;

  return (
    <div className={styles.view}>
      <div className={styles.stage}>
        <GameCanvas services={services} />
        <Hud view={view} stats={debug ? stats : null} onMenu={() => setMenuOpen(true)} />
        {room.phase === 'countdown' && <CountdownOverlay room={room} receivedAt={view.roomReceivedAt} />}
        {room.phase === 'levelComplete' && (
          <LevelCompleteOverlay room={room} receivedAt={view.roomReceivedAt} selfId={view.selfId} />
        )}
        {room.paused && !menuOpen && <div className={styles.pausedBadge}>Paused</div>}
        {menuOpen && (
          <PauseMenu
            room={room}
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
          />
        )}
        {view.status !== 'open' && !view.fatal && (
          <div className={styles.connection}>{view.status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</div>
        )}
      </div>
      {!menuOpen && <TouchControls touch={bridge.touch} self={view.hud.find((p) => p.isSelf)} />}
    </div>
  );
}
