'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useGameSession, useRoomView } from '@/hooks/useGameSession';
import { gameServerHttpUrl } from '@/net/serverUrl';
import { ScreenRoom } from '@/screen/ScreenRoom';
import { useScreenKind } from '@/screen/screenEnv';
import { BACKDROP_URL, GAME_TITLE } from './brand';
import { FullscreenButton } from './FullscreenButton';
import { FullscreenPrompt } from './FullscreenPrompt';
import { GameView } from './GameView';
import { LobbyPanel } from './LobbyPanel';
import { Toasts } from './Toasts';
import styles from './RoomScreen.module.css';

export function RoomScreen({ roomId, solo }: { roomId: string; solo: boolean }) {
  const router = useRouter();
  const session = useGameSession(roomId, solo);
  const view = useRoomView(session.store);
  const [copied, setCopied] = useState(false);
  const framed = useScreenKind() !== null;
  const { room, fatal, status } = view;
  const inGame = room !== null && room.phase !== 'lobby';

  const copyInvite = async () => {
    const url = `${window.location.origin}/room/${roomId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Invite link', url);
    }
  };

  const leave = () => {
    session.client.leave();
    router.push('/');
  };

  // On the CRT or the handheld, a room outside a game is a screen of its own.
  if (framed && !inGame) {
    return (
      <>
        <ScreenRoom roomId={roomId} session={session} view={view} onLeave={leave} />
        <Toasts store={session.store} notices={view.notices} />
      </>
    );
  }

  return (
    <div className={styles.screen} data-ingame={inGame}>
      <img className={`${styles.backdrop} px-sprite`} src={BACKDROP_URL} alt="" />
      <div className={styles.scrim} aria-hidden />

      <header className={styles.bar}>
        <Link href="/" className={`${styles.brand} px-outline-sm`}>
          {GAME_TITLE}
        </Link>
        <div className={styles.room}>
          <span className="px-label">Room</span>
          <strong className="px-outline-sm">{roomId}</strong>
          <button className={styles.small} onClick={() => void copyInvite()}>
            {copied ? (
              'Copied!'
            ) : (
              <>
                <span className={styles.long}>Copy invite link</span>
                <span className={styles.short}>Invite</span>
              </>
            )}
          </button>
        </div>
        <div className={styles.right}>
          <span className={styles.conn} data-status={status}>
            <span className={styles.connDot} aria-hidden />
            {status === 'open' ? (view.rttMs !== null ? `${view.rttMs} ms` : 'online') : status}
          </span>
          <FullscreenButton className={`${styles.small} ${styles.icon}`} />
          <button className={styles.small} onClick={leave}>
            Leave<span className={styles.long}> room</span>
          </button>
        </div>
      </header>

      <main className={styles.body}>
        {fatal ? (
          <section className={`${styles.panel} px-panel`}>
            <h2 className="px-outline">{fatal.code === 'UNREACHABLE' ? 'Connection lost' : "Can't join this room"}</h2>
            <p>{fatal.message}</p>
            {fatal.code === 'UNREACHABLE' && (
              <p className={styles.dim}>
                Is the game server running at <code>{gameServerHttpUrl()}</code>? Start it with <code>npm run dev</code>.
              </p>
            )}
            <div className={styles.row}>
              {fatal.code === 'UNREACHABLE' && (
                <button className="primary" onClick={() => session.client.retry()}>
                  Retry
                </button>
              )}
              <Link href="/" className="px-button">
                Back to home
              </Link>
            </div>
          </section>
        ) : !room ? (
          <section className={`${styles.panel} px-panel`}>
            <h2 className="px-outline">{status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</h2>
            <p className={styles.dim}>Joining room {roomId}</p>
          </section>
        ) : room.phase === 'lobby' ? (
          <LobbyPanel session={session} view={view} />
        ) : (
          <GameView session={session} view={view} onLeave={leave} />
        )}
      </main>

      <Toasts store={session.store} notices={view.notices} />
      <FullscreenPrompt ready={room !== null && !fatal} />
    </div>
  );
}
